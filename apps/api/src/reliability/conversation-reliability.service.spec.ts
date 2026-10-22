import { ConversationReliabilityService } from './conversation-reliability.service';

describe('ConversationReliabilityService', () => {
  const config = {
    get: jest.fn((key: string) => (key === 'RELIABILITY_SWEEP_INTERVAL_MS' ? 5_000 : 1_000)),
  };

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
    const service = new ConversationReliabilityService(
      prisma as never,
      { getAgentState: jest.fn().mockResolvedValue('OFFLINE') } as never,
      {} as never,
      {} as never,
      { emit } as never,
      config as never,
    );

    const ids = await service.agentDisconnected('business-1', 'profile-1', 'membership-1');

    expect(ids).toEqual(['conversation-1']);
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
    const routeConversation = jest.fn().mockResolvedValue({ outcome: 'ASSIGNED' });
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
      $transaction: jest.fn(async (operation: (client: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
      ),
    };
    const service = new ConversationReliabilityService(
      prisma as never,
      { getAgentState: jest.fn().mockResolvedValue('OFFLINE') } as never,
      { routeConversation } as never,
      { recordInTransaction } as never,
      { emit: jest.fn() } as never,
      config as never,
    );

    await service.runSweep();

    expect(transaction.conversationAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { releasedAt: expect.any(Date) as Date } }),
    );
    expect(recordInTransaction).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ type: 'REASSIGNED', actorType: 'SYSTEM' }),
    );
    expect(routeConversation).toHaveBeenCalledWith('business-1', 'conversation-1', {
      assignmentType: 'REASSIGNMENT',
    });
  });
});
