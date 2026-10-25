import { QueueWaitService } from './queue-wait.service';

describe('QueueWaitService', () => {
  const now = new Date('2026-10-25T10:10:00Z');

  const setup = (
    overrides: { updated?: number; due?: unknown[]; conversation?: unknown } = {},
  ): {
    service: QueueWaitService;
    prisma: Record<string, Record<string, jest.Mock>>;
    routing: Record<string, jest.Mock>;
    recordInTransaction: jest.Mock;
    emit: jest.Mock;
  } => {
    const conversation = {
      id: 'conversation-1',
      businessId: 'business-1',
      visitorId: 'visitor-1',
    };
    const prisma = {
      conversation: {
        findMany: jest.fn().mockResolvedValue(overrides.due ?? []),
        updateMany: jest.fn().mockResolvedValue({ count: overrides.updated ?? 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(conversation),
        findFirst: jest.fn().mockResolvedValue(overrides.conversation ?? null),
      },
    } as Record<string, Record<string, jest.Mock>>;
    const transactional = {
      ...prisma,
      $transaction: jest.fn((work: (transaction: unknown) => unknown) => work(prisma)),
    };
    const routing = {
      drainBusinessQueue: jest.fn().mockResolvedValue(1),
      conversationResponse: jest.fn().mockResolvedValue({ id: 'conversation-1' }),
      publishTimelineMessage: jest.fn(),
    };
    const recordInTransaction = jest
      .fn()
      .mockResolvedValue({ event: { id: 'event-1' }, message: { id: 'message-1' } });
    const emit = jest.fn();
    const service = new QueueWaitService(
      transactional as never,
      routing as never,
      { recordInTransaction, serialize: jest.fn(() => ({ id: 'event-1' })) } as never,
      { emit } as never,
    );
    return { service, prisma, routing, recordInTransaction, emit };
  };

  const overflowing = {
    id: 'conversation-1',
    businessId: 'business-1',
    overflowLevel: 0,
    topic: {
      overflowSteps: [
        { afterSeconds: 60, addDepartmentIds: ['general'] },
        { afterSeconds: 120, relaxSkill: true },
        { afterSeconds: 600, anyConsultant: true },
      ],
    },
    queueEntry: { enqueuedAt: new Date('2026-10-25T10:07:50Z') },
  };

  it('jumps to the level the wait has reached, starts a new cycle, and drains the tenant', async () => {
    const { service, prisma, routing, recordInTransaction, emit } = setup({ due: [overflowing] });

    await expect(service.advanceOverflow(now)).resolves.toBe(1);

    expect(prisma.conversation!.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ overflowLevel: 0, status: 'QUEUED' }) as unknown,
      data: {
        overflowLevel: 2,
        nextOverflowAt: new Date('2026-10-25T10:17:50Z'),
        routingCycleStartedAt: now,
      },
    });
    expect(recordInTransaction).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ type: 'OVERFLOWED', metadata: { fromLevel: 0, toLevel: 2 } }),
    );
    expect(emit).toHaveBeenCalledWith(
      'conversation.operation',
      expect.objectContaining({ operation: 'OVERFLOWED' }),
    );
    expect(routing.drainBusinessQueue).toHaveBeenCalledWith('business-1');
  });

  it('leaves a conversation alone when another sweep or an assignment got there first', async () => {
    const { service, routing, emit } = setup({ due: [overflowing], updated: 0 });

    await expect(service.advanceOverflow(now)).resolves.toBe(0);

    expect(emit).not.toHaveBeenCalled();
    expect(routing.drainBusinessQueue).not.toHaveBeenCalled();
  });

  it('tells a visitor once when the maximum wait passes', async () => {
    const maxWaitAt = new Date('2026-10-25T10:09:00Z');
    const { service, prisma, emit } = setup({
      due: [{ id: 'conversation-1', businessId: 'business-1', maxWaitAt }],
    });

    await expect(service.notifyLongWaits(now)).resolves.toBe(1);

    expect(prisma.conversation!.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ maxWaitAt, maxWaitNotifiedAt: null }) as unknown,
      data: { maxWaitNotifiedAt: now, maxWaitAt: null },
    });
    expect(emit).toHaveBeenCalledWith('conversation.wait_options', {
      businessId: 'business-1',
      conversationId: 'conversation-1',
      reason: 'MAX_WAIT',
    });
  });

  it('stores follow-up details but keeps them out of the timeline metadata', async () => {
    const { service, prisma, routing, recordInTransaction, emit } = setup();

    await service.requestFollowUp(
      { businessId: 'business-1', visitorId: 'visitor-1' },
      { conversationId: 'conversation-1', email: 'thandi@example.test', name: 'Thandi' },
    );

    expect(prisma.conversation!.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        visitorId: 'visitor-1',
        assignedAgentMembershipId: null,
        followUpRequestedAt: null,
      }) as unknown,
      data: expect.objectContaining({
        followUpContact: { name: 'Thandi', email: 'thandi@example.test', phone: null, note: null },
      }) as unknown,
    });
    expect(recordInTransaction).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        type: 'FOLLOW_UP_REQUESTED',
        metadata: { email: true, phone: false },
      }),
    );
    expect(routing.publishTimelineMessage).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      'conversation.operation',
      expect.objectContaining({ operation: 'FOLLOW_UP_REQUESTED' }),
    );
  });

  it('explains why a follow-up cannot be recorded', async () => {
    const identity = { businessId: 'business-1', visitorId: 'visitor-1' };
    const input = { conversationId: 'conversation-1', phone: '+27 11 555 0100' };

    await expect(
      setup({
        updated: 0,
        conversation: { followUpRequestedAt: new Date(), intakeStatus: 'COMPLETE' },
      }).service.requestFollowUp(identity, input),
    ).rejects.toMatchObject({ response: { code: 'FOLLOW_UP_ALREADY_REQUESTED' } });
    await expect(
      setup({
        updated: 0,
        conversation: { followUpRequestedAt: null, intakeStatus: 'COMPLETE' },
      }).service.requestFollowUp(identity, input),
    ).rejects.toMatchObject({ response: { code: 'FOLLOW_UP_UNAVAILABLE' } });
    await expect(
      setup({ updated: 0 }).service.requestFollowUp(identity, input),
    ).rejects.toMatchObject({ response: { code: 'CONVERSATION_NOT_FOUND' } });
  });
});
