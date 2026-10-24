import { ConversationReliabilityService } from './conversation-reliability.service';

describe('ConversationReliabilityService', () => {
  const config = {
    get: jest.fn((key: string) => (key === 'RELIABILITY_SWEEP_INTERVAL_MS' ? 5_000 : 1_000)),
  };
  const leaderRedis = (): { eval: jest.Mock } => ({ eval: jest.fn().mockResolvedValue(1) });
  const idleOffers = (): Record<'cancelForAgent' | 'expireDue', jest.Mock> => ({
    cancelForAgent: jest.fn().mockResolvedValue(0),
    expireDue: jest.fn().mockResolvedValue(0),
  });
  const idleIntake = (): { expirePrompts: jest.Mock } => ({
    expirePrompts: jest.fn().mockResolvedValue(0),
  });
  const idleRouting = (): Record<
    'routeConversation' | 'abandonDepartedVisitors' | 'drainBusinessQueue',
    jest.Mock
  > => ({
    routeConversation: jest.fn().mockResolvedValue({ outcome: 'ASSIGNED' }),
    abandonDepartedVisitors: jest.fn().mockResolvedValue(0),
    drainBusinessQueue: jest.fn().mockResolvedValue(0),
  });

  it('persists a tenant-configured grace deadline and publishes recovery state', async () => {
    let persistedUpdate: unknown;
    const updateMany = jest.fn((input: unknown) => {
      persistedUpdate = input;
      return Promise.resolve({ count: 1 });
    });
    const emit = jest.fn();
    const prisma = {
      widgetSettings: {
        findUnique: jest.fn().mockResolvedValue({ agentDisconnectGraceSeconds: 45 }),
      },
      conversation: {
        findMany: jest.fn().mockResolvedValue([{ id: 'conversation-1', visitorId: 'visitor-1' }]),
        updateMany,
      },
    };
    const offers = idleOffers();
    const service = new ConversationReliabilityService(
      prisma as never,
      { getAgentState: jest.fn().mockResolvedValue('OFFLINE') } as never,
      {} as never,
      {} as never,
      { emit } as never,
      {} as never,
      config as never,
      offers as never,
      idleIntake() as never,
    );

    const ids = await service.agentDisconnected('business-1', 'profile-1', 'membership-1');

    expect(ids).toEqual(['conversation-1']);
    // Pending offers move on immediately instead of waiting out the grace period.
    expect(offers.cancelForAgent).toHaveBeenCalledWith('business-1', 'membership-1');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agentDisconnectedAt: expect.any(Date) as Date,
          reassignmentDueAt: expect.any(Date) as Date,
        }) as unknown,
      }),
    );
    const update = persistedUpdate as {
      data: { agentDisconnectedAt: Date; reassignmentDueAt: Date };
    };
    expect(
      update.data.reassignmentDueAt.getTime() - update.data.agentDisconnectedAt.getTime(),
    ).toBe(45_000);
    expect(emit).toHaveBeenCalledWith(
      'conversation.recovery',
      expect.objectContaining({ state: 'DISCONNECTED_GRACE', conversationId: 'conversation-1' }),
    );
  });

  it('atomically releases an expired assignment and reroutes with reassignment history', async () => {
    const now = new Date(Date.now() - 1_000);
    const conversation = {
      id: 'conversation-1',
      businessId: 'business-1',
      visitorId: 'visitor-1',
      departmentId: 'department-1',
      assignedAgentMembershipId: 'membership-1',
      status: 'ACTIVE',
      priority: 'NORMAL',
      reassignmentDueAt: now,
      reassignmentAttempts: 0,
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ acquired: true }]),
      conversation: {
        findUnique: jest.fn().mockResolvedValue(conversation),
        update: jest.fn().mockResolvedValue({
          ...conversation,
          assignedAgentMembershipId: null,
          status: 'NEW',
          reassignmentAttempts: 1,
        }),
      },
      businessMembership: { findUniqueOrThrow: jest.fn().mockResolvedValue({ userId: 'user-1' }) },
      conversationAssignment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      conversationParticipant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      conversationQueueEntry: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const routing = idleRouting();
    const recordInTransaction = jest.fn().mockResolvedValue({ event: {}, message: null });
    const prisma = {
      conversation: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([conversation])
          .mockResolvedValueOnce([]),
      },
      agentProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'profile-1' }) },
      conversationQueueEntry: { groupBy: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (operation: (client: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
      ),
    };
    const service = new ConversationReliabilityService(
      prisma as never,
      { getAgentState: jest.fn().mockResolvedValue('OFFLINE') } as never,
      routing as never,
      { recordInTransaction } as never,
      { emit: jest.fn() } as never,
      leaderRedis() as never,
      config as never,
      idleOffers() as never,
      idleIntake() as never,
    );

    await service.runSweep();

    expect(transaction.conversationAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { releasedAt: expect.any(Date) as Date } }),
    );
    expect(recordInTransaction).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ type: 'REASSIGNED', actorType: 'SYSTEM' }),
    );
    expect(routing.routeConversation).toHaveBeenCalledWith('business-1', 'conversation-1', {
      assignmentType: 'REASSIGNMENT',
    });
  });

  it('leaves the sweep to the instance that holds the lease', async () => {
    const prisma = { conversation: { findMany: jest.fn() } };
    const routing = idleRouting();
    const redis = { eval: jest.fn().mockResolvedValue(0) };
    const service = new ConversationReliabilityService(
      prisma as never,
      {} as never,
      routing as never,
      {} as never,
      { emit: jest.fn() } as never,
      redis as never,
      config as never,
      idleOffers() as never,
      idleIntake() as never,
    );

    await service.runSweep();

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('PEXPIRE'),
      1,
      'reliability:sweep:leader',
      expect.any(String),
      15_000,
    );
    expect(prisma.conversation.findMany).not.toHaveBeenCalled();
    expect(routing.abandonDepartedVisitors).not.toHaveBeenCalled();
  });

  it('skips the sweep when Redis cannot confirm the lease', async () => {
    const prisma = { conversation: { findMany: jest.fn() } };
    const service = new ConversationReliabilityService(
      prisma as never,
      {} as never,
      idleRouting() as never,
      {} as never,
      { emit: jest.fn() } as never,
      { eval: jest.fn().mockRejectedValue(new Error('down')) } as never,
      config as never,
      idleOffers() as never,
      idleIntake() as never,
    );

    await service.runSweep();

    expect(prisma.conversation.findMany).not.toHaveBeenCalled();
  });

  it('abandons departed visitors and drains tenant backlogs oldest wait first', async () => {
    const groupBy = jest
      .fn()
      .mockResolvedValue([{ businessId: 'tenant-oldest' }, { businessId: 'tenant-newer' }]);
    const prisma = {
      conversation: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ businessId: 'tenant-newer', id: 'stuck-1' }]),
      },
      conversationQueueEntry: { groupBy },
    };
    const routing = idleRouting();
    const offers = idleOffers();
    const intake = idleIntake();
    const service = new ConversationReliabilityService(
      prisma as never,
      {} as never,
      routing as never,
      {} as never,
      { emit: jest.fn() } as never,
      leaderRedis() as never,
      config as never,
      offers as never,
      intake as never,
    );

    await service.runSweep();

    expect(offers.expireDue).toHaveBeenCalledTimes(1);
    expect(intake.expirePrompts).toHaveBeenCalledTimes(1);
    expect(routing.abandonDepartedVisitors).toHaveBeenCalledTimes(1);
    // Conversations still waiting on a topic choice are not routed by the sweep.
    expect(prisma.conversation.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          assignedAgentMembershipId: null,
          status: 'NEW',
          reassignmentDueAt: null,
          intakeStatus: { in: ['NOT_REQUIRED', 'COMPLETE'] },
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(routing.routeConversation).toHaveBeenCalledWith('tenant-newer', 'stuck-1');
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { _min: { enqueuedAt: 'asc' } } }),
    );
    expect(routing.drainBusinessQueue.mock.calls).toEqual([['tenant-oldest'], ['tenant-newer']]);
  });
});
