import { ConversationRoutingService } from './conversation-routing.service';

type RoutingOutcome = { outcome: 'ASSIGNED' | 'QUEUED'; conversation: { status: string } };
interface QueueEntryFixture {
  id: string;
  businessId: string;
  conversationId: string;
  departmentId: string | null;
  priority: 'NORMAL' | 'URGENT';
  enqueuedAt: Date;
  conversation: { requiredSkillId: string | null; requiredSkillMinProficiency: number | null };
}
type RedisMock = Record<'set' | 'del' | 'eval' | 'exists', jest.Mock>;

describe('ConversationRoutingService', () => {
  const config = { get: jest.fn(() => 120) };

  const queueEntry = (
    id: string,
    departmentId: string | null,
    minute = 0,
    priority: 'NORMAL' | 'URGENT' = 'NORMAL',
    skill: { id: string; min: number } | null = null,
  ): QueueEntryFixture => ({
    id: `entry-${id}`,
    businessId: 'business-1',
    conversationId: id,
    departmentId,
    priority,
    enqueuedAt: new Date(Date.UTC(2026, 9, 22, 8, minute)),
    conversation: {
      requiredSkillId: skill?.id ?? null,
      requiredSkillMinProficiency: skill?.min ?? null,
    },
  });

  const conversationRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'conversation-1',
    businessId: 'business-1',
    visitorId: 'visitor-1',
    departmentId: 'sales',
    assignedAgentMembershipId: null,
    status: 'CLOSED',
    priority: 'NORMAL',
    source: 'WEB_WIDGET',
    subject: null,
    createdAt: new Date('2026-10-22T08:00:00Z'),
    updatedAt: new Date('2026-10-22T08:05:00Z'),
    lastMessageAt: new Date('2026-10-22T08:00:00Z'),
    resolvedAt: null,
    reopenedAt: null,
    ...overrides,
  });

  const lockingRedis = (): RedisMock => ({
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    eval: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
  });

  const createService = (
    prisma: unknown,
    redis: unknown,
    overrides: Record<string, unknown> = {},
  ): ConversationRoutingService =>
    new ConversationRoutingService(
      prisma as never,
      {} as never,
      (overrides.events ?? { emit: jest.fn() }) as never,
      (overrides.timeline ?? {}) as never,
      redis as never,
      config as never,
    );

  it('drains the oldest highest-priority entries and skips departments with no capacity', async () => {
    const entries = [
      queueEntry('urgent-sales', 'sales', 3, 'URGENT'),
      queueEntry('normal-sales', 'sales', 1),
      queueEntry('normal-support', 'support', 2),
      queueEntry('later-sales', 'sales', 4),
    ];
    const prisma = {
      conversationQueueEntry: { findMany: jest.fn().mockResolvedValue(entries) },
      conversation: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = createService(prisma, lockingRedis());
    const outcomes: Record<string, RoutingOutcome> = {
      'urgent-sales': { outcome: 'ASSIGNED', conversation: { status: 'ASSIGNED' } },
      'normal-sales': { outcome: 'QUEUED', conversation: { status: 'QUEUED' } },
      'normal-support': { outcome: 'QUEUED', conversation: { status: 'QUEUED' } },
    };
    const route = jest
      .spyOn(service, 'routeConversation')
      .mockImplementation((_businessId: string, id: string) =>
        Promise.resolve(outcomes[id] as never),
      );

    await expect(service.drainBusinessQueue('business-1')).resolves.toBe(1);

    expect(prisma.conversationQueueEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ priority: 'desc' }, { enqueuedAt: 'asc' }, { id: 'asc' }],
        take: 200,
      }),
    );
    expect(route.mock.calls.map(([, id]) => id)).toEqual([
      'urgent-sales',
      'normal-sales',
      'normal-support',
    ]);
    // Positions are republished only for the department an assignment moved.
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: [{ departmentId: { in: ['sales'] } }] }) as unknown,
      }),
    );
  });

  it('does not exhaust a department when the conversation left the queue concurrently', async () => {
    const prisma = {
      conversationQueueEntry: {
        findMany: jest
          .fn()
          .mockResolvedValue([queueEntry('closed', 'sales', 1), queueEntry('waiting', 'sales', 2)]),
      },
      conversation: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = createService(prisma, lockingRedis());
    const route = jest
      .spyOn(service, 'routeConversation')
      .mockResolvedValueOnce({ outcome: 'QUEUED', conversation: { status: 'CLOSED' } } as never)
      .mockResolvedValueOnce({
        outcome: 'ASSIGNED',
        conversation: { status: 'ASSIGNED' },
      } as never);

    await expect(service.drainBusinessQueue('business-1')).resolves.toBe(1);
    expect(route).toHaveBeenCalledTimes(2);
  });

  it('marks the queue dirty instead of draining while another instance holds the lock', async () => {
    const prisma = { conversationQueueEntry: { findMany: jest.fn() } };
    const redis = { ...lockingRedis(), set: jest.fn().mockResolvedValueOnce(null) };
    const service = createService(prisma, redis);

    await expect(service.drainBusinessQueue('business-1')).resolves.toBe(0);

    expect(prisma.conversationQueueEntry.findMany).not.toHaveBeenCalled();
    expect(redis.set).toHaveBeenLastCalledWith(
      'routing:drain:business-1:pending',
      '1',
      'PX',
      30_000,
    );
  });

  it('makes another pass when a trigger arrived during the drain, then releases its lock', async () => {
    const prisma = {
      conversationQueueEntry: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const redis = {
      ...lockingRedis(),
      exists: jest.fn().mockResolvedValueOnce(1).mockResolvedValue(0),
    };
    const service = createService(prisma, redis);

    await service.drainBusinessQueue('business-1');

    expect(prisma.conversationQueueEntry.findMany).toHaveBeenCalledTimes(2);
    expect(redis.eval).toHaveBeenCalledTimes(2);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('DEL'"),
      1,
      'routing:drain:business-1:lock',
      expect.any(String),
    );
  });

  it('still drains when Redis is unavailable because PostgreSQL claims stay authoritative', async () => {
    const prisma = {
      conversationQueueEntry: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const redis = { ...lockingRedis(), set: jest.fn().mockRejectedValue(new Error('down')) };
    const service = createService(prisma, redis);

    await service.drainBusinessQueue('business-1');

    expect(prisma.conversationQueueEntry.findMany).toHaveBeenCalledTimes(1);
  });

  it('closes a queued conversation whose visitor left and tells the inbox', async () => {
    const now = new Date('2026-10-22T09:00:00Z');
    const closedRow = conversationRow();
    const transaction = {
      conversation: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ currentOfferId: null, assignedAgentMembershipId: null }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(closedRow),
      },
      conversationQueueEntry: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      conversationParticipant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      conversation: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ id: 'conversation-1', businessId: 'business-1' }])
          .mockResolvedValueOnce([]),
      },
      department: { findUnique: jest.fn().mockResolvedValue({ name: 'Sales' }) },
      conversationTag: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (operation: (client: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
      ),
    };
    const emit = jest.fn();
    const recordInTransaction = jest
      .fn()
      .mockResolvedValue({ event: { id: 'event-1' }, message: null });
    const timeline = {
      recordInTransaction,
      serialize: jest.fn().mockReturnValue({ id: 'event-1' }),
    };
    const service = createService(prisma, lockingRedis(), { events: { emit }, timeline });

    await expect(service.abandonDepartedVisitors(now)).resolves.toBe(1);

    const cutoff = new Date('2026-10-22T08:58:00Z');
    expect(transaction.conversation.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'conversation-1',
        businessId: 'business-1',
        currentOfferId: null,
        AND: [
          {
            OR: [
              { status: { in: ['NEW', 'QUEUED'] }, assignedAgentMembershipId: null },
              { status: 'OFFERED' },
            ],
          },
          expect.anything(),
        ],
        visitor: {
          is: { sessions: { none: { widgetSessions: { some: { lastSeenAt: { gte: cutoff } } } } } },
        },
      }) as unknown,
      data: {
        status: 'CLOSED',
        closedAt: expect.any(Date) as Date,
        reassignmentDueAt: null,
        assignedAgentMembershipId: null,
        currentOfferId: null,
        offerExpiresAt: null,
      },
    });
    expect(transaction.conversationQueueEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { removedAt: expect.any(Date) as Date } }),
    );
    expect(recordInTransaction).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        type: 'CLOSED',
        actorType: 'SYSTEM',
        metadata: { reason: 'VISITOR_LEFT_QUEUE', abandonAfterSeconds: 120 },
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      'conversation.operation',
      expect.objectContaining({
        operation: 'ABANDONED',
        visitorId: 'visitor-1',
        conversation: expect.objectContaining({
          status: 'CLOSED',
          departmentName: 'Sales',
        }) as unknown,
      }),
    );
    // The rest of the Sales queue gets fresh positions.
    expect(prisma.conversation.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: [{ departmentId: { in: ['sales'] } }] }) as unknown,
      }),
    );
  });

  it('keeps a visitor queued when they came back between the scan and the close', async () => {
    const transaction = {
      conversation: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ currentOfferId: null, assignedAgentMembershipId: null }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      conversationQueueEntry: { updateMany: jest.fn() },
    };
    const prisma = {
      conversation: {
        findMany: jest.fn().mockResolvedValue([{ id: 'conversation-1', businessId: 'business-1' }]),
      },
      $transaction: jest.fn(async (operation: (client: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
      ),
    };
    const emit = jest.fn();
    const service = createService(prisma, lockingRedis(), { events: { emit } });

    await expect(service.abandonDepartedVisitors()).resolves.toBe(0);
    expect(transaction.conversationQueueEntry.updateMany).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("cancels the consultant's pending offer when an offered visitor leaves", async () => {
    const transaction = {
      conversation: {
        findFirst: jest.fn().mockResolvedValue({
          currentOfferId: 'offer-1',
          assignedAgentMembershipId: 'membership-expert',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(conversationRow()),
      },
      conversationOffer: { update: jest.fn().mockResolvedValue({}) },
      conversationQueueEntry: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      conversationParticipant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      conversation: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ id: 'conversation-1', businessId: 'business-1' }])
          .mockResolvedValueOnce([]),
      },
      department: { findUnique: jest.fn().mockResolvedValue(null) },
      conversationTag: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (operation: (client: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
      ),
    };
    const emit = jest.fn();
    const timeline = {
      recordInTransaction: jest.fn().mockResolvedValue({ event: { id: 'event-1' }, message: null }),
      serialize: jest.fn().mockReturnValue({ id: 'event-1' }),
    };
    const service = createService(prisma, lockingRedis(), { events: { emit }, timeline });

    await expect(service.abandonDepartedVisitors()).resolves.toBe(1);

    // Only the offer that was current when read is closed out.
    expect(transaction.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ currentOfferId: 'offer-1' }) as unknown,
      }),
    );
    expect(transaction.conversationOffer.update).toHaveBeenCalledWith({
      where: { id: 'offer-1' },
      data: { outcome: 'CANCELLED', respondedAt: expect.any(Date) as Date, reason: 'VISITOR_LEFT' },
    });
    expect(emit).toHaveBeenCalledWith('conversation.offer_withdrawn', {
      businessId: 'business-1',
      agentMembershipId: 'membership-expert',
      offerId: 'offer-1',
      conversationId: 'conversation-1',
      reason: 'CANCELLED',
    });
  });

  it('keeps trying other skill levels after a skill scope runs out of consultants', async () => {
    const tax3 = { id: 'tax', min: 3 };
    const prisma = {
      conversationQueueEntry: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            queueEntry('tax-3', 'sales', 1, 'NORMAL', tax3),
            queueEntry('tax-4', 'sales', 2, 'NORMAL', { id: 'tax', min: 4 }),
            queueEntry('tax-1', 'sales', 3, 'NORMAL', { id: 'tax', min: 1 }),
          ]),
      },
      conversation: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = createService(prisma, lockingRedis());
    const route = jest
      .spyOn(service, 'routeConversation')
      .mockResolvedValueOnce({ outcome: 'QUEUED', conversation: { status: 'QUEUED' } } as never)
      .mockResolvedValueOnce({
        outcome: 'ASSIGNED',
        conversation: { status: 'ASSIGNED' },
      } as never);

    await service.drainBusinessQueue('business-1');

    // tax-4 is stricter than the exhausted tax-3 scope; tax-1 is looser and may still find someone.
    expect(route.mock.calls.map(([, id]) => id)).toEqual(['tax-3', 'tax-1']);
  });

  describe('skill-based eligibility', () => {
    const businessId = 'business-1';
    const profile = (id: string, proficiency: number): Record<string, unknown> => ({
      id,
      businessId,
      membershipId: `membership-${id}`,
      userId: `user-${id}`,
      maxConcurrentChats: 5,
      lastAssignedAt: null,
      skills: [{ proficiency }],
    });
    const setup = (
      skillActive: boolean,
      strategy: 'LEAST_BUSY' | 'BEST_SKILL',
    ): {
      service: ConversationRoutingService;
      findProfiles: jest.Mock;
      tryClaim: jest.Mock;
    } => {
      const findProfiles = jest
        .fn()
        .mockResolvedValue([profile('competent', 3), profile('expert', 5)]);
      const prisma = {
        conversation: {
          findFirst: jest.fn().mockResolvedValue({
            ...conversationRow({ status: 'NEW', visitorId: null, departmentId: null }),
            requiredSkillId: 'skill-tax',
            requiredSkillMinProficiency: 3,
          }),
          count: jest.fn().mockResolvedValue(0),
        },
        widgetSettings: { findUnique: jest.fn().mockResolvedValue(null) },
        routingSettings: { findUnique: jest.fn().mockResolvedValue({ routingStrategy: strategy }) },
        skill: { findFirst: jest.fn().mockResolvedValue(skillActive ? { id: 'skill-tax' } : null) },
        agentProfile: { findMany: findProfiles },
        conversationOffer: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const service = new ConversationRoutingService(
        prisma as never,
        { getAgentState: jest.fn().mockResolvedValue('ONLINE') } as never,
        { emit: jest.fn() } as never,
        {} as never,
        lockingRedis() as never,
        config as never,
      );
      const internals = service as unknown as { tryClaim: jest.Mock; queue: jest.Mock };
      internals.tryClaim = jest.fn().mockResolvedValue(null);
      internals.queue = jest.fn().mockResolvedValue({ outcome: 'QUEUED' });
      return { service, findProfiles, tryClaim: internals.tryClaim };
    };

    it('requires the skill at the minimum proficiency and tries the best match first', async () => {
      const { service, findProfiles, tryClaim } = setup(true, 'BEST_SKILL');

      await service.routeConversation(businessId, 'conversation-1');

      expect(findProfiles).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            skills: { some: { skillId: 'skill-tax', proficiency: { gte: 3 } } },
          }) as unknown,
        }),
      );
      const requirement = { skillId: 'skill-tax', minProficiency: 3 };
      expect(tryClaim.mock.calls.map(([, candidate]) => (candidate as { id: string }).id)).toEqual([
        'expert',
        'competent',
      ]);
      expect(tryClaim).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: 'expert', proficiency: 5 }),
        'AUTO',
        requirement,
        null,
      );
    });

    it('ignores a requirement on a disabled skill so the conversation can still route', async () => {
      const { service, findProfiles, tryClaim } = setup(false, 'LEAST_BUSY');

      await service.routeConversation(businessId, 'conversation-1');

      const where = (findProfiles.mock.calls[0] as [{ where: Record<string, unknown> }])[0].where;
      expect(where).not.toHaveProperty('skills');
      expect(tryClaim).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'AUTO',
        null,
        null,
      );
    });
  });

  describe('offers', () => {
    const offeredRow = {
      ...conversationRow({ status: 'OFFERED', visitorId: null, departmentId: null }),
      assignedAgentMembershipId: 'membership-expert',
      currentOfferId: 'offer-1',
      offerExpiresAt: new Date(Date.now() + 30_000),
      requiredSkillId: null,
    };

    it('offers instead of assigning in OFFER mode and skips consultants who recently passed', async () => {
      const findProfiles = jest.fn().mockResolvedValue([
        {
          id: 'expert',
          businessId: 'business-1',
          membershipId: 'membership-expert',
          userId: 'user-expert',
          maxConcurrentChats: 5,
          lastAssignedAt: null,
          skills: [],
        },
      ]);
      const prisma = {
        conversation: {
          findFirst: jest.fn().mockResolvedValue({
            ...conversationRow({ status: 'NEW', visitorId: null, departmentId: null }),
            requiredSkillId: null,
          }),
          count: jest.fn().mockResolvedValue(0),
        },
        widgetSettings: { findUnique: jest.fn().mockResolvedValue(null) },
        routingSettings: {
          findUnique: jest.fn().mockResolvedValue({
            routingStrategy: 'LEAST_BUSY',
            assignmentMode: 'OFFER',
            offerTimeoutSeconds: 30,
            exclusionSeconds: 300,
          }),
        },
        agentProfile: { findMany: findProfiles },
        conversationOffer: {
          findMany: jest.fn().mockResolvedValue([{ agentProfileId: 'decliner' }]),
        },
      };
      const emit = jest.fn();
      const service = new ConversationRoutingService(
        prisma as never,
        { getAgentState: jest.fn().mockResolvedValue('ONLINE') } as never,
        { emit } as never,
        {} as never,
        lockingRedis() as never,
        config as never,
      );
      const internals = service as unknown as {
        tryClaim: jest.Mock;
        publish: jest.Mock;
        offerEvent: jest.Mock;
      };
      internals.tryClaim = jest.fn().mockResolvedValue({
        conversation: offeredRow,
        timeline: { event: {}, message: null },
        offerId: 'offer-1',
      });
      internals.publish = jest.fn().mockResolvedValue({ outcome: 'OFFERED', conversation: {} });
      internals.offerEvent = jest.fn().mockResolvedValue({ offerId: 'offer-1' });

      const routed = await service.routeConversation('business-1', 'conversation-1');

      expect(routed.outcome).toBe('OFFERED');
      expect(prisma.conversationOffer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ outcome: { in: ['DECLINED', 'EXPIRED'] } }) as unknown,
        }),
      );
      expect(findProfiles).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { notIn: ['decliner'] } }) as unknown,
        }),
      );
      const offer = (internals.tryClaim.mock.calls[0] as unknown[])[4] as { expiresAt: Date };
      expect(offer.expiresAt.getTime() - Date.now()).toBeGreaterThan(29_000);
      expect(internals.publish).toHaveBeenCalledWith(offeredRow, 'OFFERED');
      expect(emit).toHaveBeenCalledWith('conversation.offered', { offerId: 'offer-1' });
    });

    it('claims an offer by reserving capacity without creating an assignment', async () => {
      const transaction = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        agentProfile: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'expert',
            membershipId: 'membership-expert',
            userId: 'user-expert',
            maxConcurrentChats: 2,
            user: { displayName: 'Expert' },
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        conversation: {
          count: jest.fn().mockResolvedValue(1),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: jest.fn().mockResolvedValue(offeredRow),
        },
        conversationQueueEntry: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        conversationOffer: { create: jest.fn().mockResolvedValue({}) },
      };
      const recordInTransaction = jest.fn().mockResolvedValue({ event: {}, message: null });
      const service = createService(
        {
          $transaction: jest.fn(
            async (operation: (client: typeof transaction) => Promise<unknown>) =>
              operation(transaction),
          ),
        },
        lockingRedis(),
        { timeline: { recordInTransaction } },
      );
      const expiresAt = new Date(Date.now() + 30_000);
      const tryClaim = (
        service as unknown as {
          tryClaim: (...args: unknown[]) => Promise<{ offerId: string | null } | null>;
        }
      ).tryClaim.bind(service);

      const claimed = await tryClaim(
        { ...offeredRow, status: 'QUEUED', assignedAgentMembershipId: null },
        { id: 'expert' },
        'AUTO',
        null,
        { expiresAt },
      );

      expect(claimed?.offerId).toEqual(expect.any(String));
      expect(transaction.conversation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            assignedAgentMembershipId: 'membership-expert',
            status: 'OFFERED',
            currentOfferId: claimed?.offerId,
            offerExpiresAt: expiresAt,
          },
        }),
      );
      // Capacity counts pending offers so the consultant cannot be over-offered.
      expect(transaction.conversation.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: expect.arrayContaining(['OFFERED', 'ASSIGNED']) as unknown },
          }) as unknown,
        }),
      );
      expect(transaction.conversationOffer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: claimed?.offerId,
          agentProfileId: 'expert',
          expiresAt,
          assignmentType: 'AUTO',
        }) as unknown,
      });
      expect(recordInTransaction).toHaveBeenCalledWith(
        transaction,
        expect.objectContaining({ type: 'OFFERED' }),
      );
      const [, offeredEvent] = recordInTransaction.mock.calls[0] as [unknown, object];
      expect(offeredEvent).not.toHaveProperty('systemMessage');
    });
  });
});
