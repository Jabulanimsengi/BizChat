import { ConversationRoutingService } from './conversation-routing.service';

type RoutingOutcome = { outcome: 'ASSIGNED' | 'QUEUED'; conversation: { status: string } };
interface QueueEntryFixture {
  id: string;
  businessId: string;
  conversationId: string;
  departmentId: string | null;
  priority: 'NORMAL' | 'URGENT';
  enqueuedAt: Date;
}
type RedisMock = Record<'set' | 'del' | 'eval' | 'exists', jest.Mock>;

describe('ConversationRoutingService', () => {
  const config = { get: jest.fn(() => 120) };

  const queueEntry = (
    id: string,
    departmentId: string | null,
    minute = 0,
    priority: 'NORMAL' | 'URGENT' = 'NORMAL',
  ): QueueEntryFixture => ({
    id: `entry-${id}`,
    businessId: 'business-1',
    conversationId: id,
    departmentId,
    priority,
    enqueuedAt: new Date(Date.UTC(2026, 9, 22, 8, minute)),
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
        status: { in: ['NEW', 'QUEUED'] },
        assignedAgentMembershipId: null,
        visitor: {
          is: { sessions: { none: { widgetSessions: { some: { lastSeenAt: { gte: cutoff } } } } } },
        },
      }) as unknown,
      data: { status: 'CLOSED', closedAt: expect.any(Date) as Date, reassignmentDueAt: null },
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
      conversation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
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
});
