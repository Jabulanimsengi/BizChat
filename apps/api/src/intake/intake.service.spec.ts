import { ConflictException, NotFoundException } from '@nestjs/common';
import { IntakeService } from './intake.service';

describe('IntakeService', () => {
  const identity = { businessId: 'business-1', visitorId: 'visitor-1' };
  const sales = {
    id: 'registration',
    publicId: 'topic_registration01',
    name: 'Company registration',
    departmentId: 'sales',
    department: { status: 'ACTIVE' },
    priority: 'HIGH',
    requiredSkillId: null,
    requiredSkillMinProficiency: null,
  };
  const general = {
    id: 'general',
    publicId: 'topic_general000001',
    name: 'General',
    departmentId: null,
    department: null,
    priority: 'NORMAL',
    requiredSkillId: null,
    requiredSkillMinProficiency: null,
  };

  const setup = (
    changed = 1,
  ): {
    service: IntakeService;
    transaction: Record<
      'conversation' | 'conversationQueueEntry' | 'conversationClassification',
      Record<string, jest.Mock>
    >;
    prisma: { conversation: { findFirst: jest.Mock; findMany: jest.Mock } };
    catalog: { findActive: jest.Mock; quickReplies: jest.Mock };
    routing: { routeConversation: jest.Mock };
    timeline: { recordInTransaction: jest.Mock };
  } => {
    const transaction = {
      conversation: { updateMany: jest.fn().mockResolvedValue({ count: changed }) },
      conversationQueueEntry: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      conversationClassification: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      conversation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'conversation-1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      department: { findFirst: jest.fn().mockResolvedValue({ id: 'default-department' }) },
      $transaction: jest.fn(async (operation: (client: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
      ),
    };
    const catalog = {
      findActive: jest.fn((_businessId: string, publicId: string | null) =>
        Promise.resolve(publicId === null ? general : sales),
      ),
      quickReplies: jest.fn().mockResolvedValue([]),
    };
    const routing = { routeConversation: jest.fn().mockResolvedValue({ outcome: 'ASSIGNED' }) };
    const timeline = { recordInTransaction: jest.fn().mockResolvedValue({}) };
    const service = new IntakeService(
      prisma as never,
      catalog as never,
      routing as never,
      timeline as never,
    );
    return { service, transaction, prisma, catalog, routing, timeline };
  };

  it("applies the visitor's choice to the conversation and its queue entry, then routes", async () => {
    const { service, transaction, routing, timeline } = setup();

    await service.submit(identity, {
      conversationId: 'conversation-1',
      topicPublicId: 'topic_registration01',
    });

    expect(transaction.conversation.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'conversation-1',
        businessId: 'business-1',
        OR: [
          { intakeStatus: 'AWAITING_TOPIC' },
          {
            intakeStatus: { in: ['NOT_REQUIRED', 'COMPLETE'] },
            status: { in: ['NEW', 'QUEUED'] },
            assignedAgentMembershipId: null,
          },
        ],
      }) as unknown,
      data: {
        topicId: 'registration',
        departmentId: 'sales',
        priority: 'HIGH',
        requiredSkillId: null,
        requiredSkillMinProficiency: null,
        intakeStatus: 'COMPLETE',
        intakeExpiresAt: null,
      },
    });
    expect(transaction.conversationQueueEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { departmentId: 'sales', priority: 'HIGH' } }),
    );
    expect(transaction.conversationClassification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        topicId: 'registration',
        method: 'VISITOR_CHOICE',
      }) as unknown,
    });
    expect(timeline.recordInTransaction).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ type: 'TOPIC_SET', actorType: 'VISITOR', actorId: 'visitor-1' }),
    );
    expect(routing.routeConversation).toHaveBeenCalledWith('business-1', 'conversation-1');
  });

  it('sends "Something else" to the default topic and its default department', async () => {
    const { service, transaction, catalog } = setup();

    await service.submit(identity, { conversationId: 'conversation-1', topicPublicId: null });

    expect(catalog.findActive).toHaveBeenCalledWith('business-1', null);
    expect(transaction.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          topicId: 'general',
          departmentId: 'default-department',
        }) as unknown,
      }),
    );
  });

  it('refuses a topic change once a consultant has the conversation', async () => {
    const { service, routing } = setup(0);

    await expect(
      service.submit(identity, { conversationId: 'conversation-1', topicPublicId: null }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(routing.routeConversation).not.toHaveBeenCalled();
  });

  it("refuses another visitor's conversation", async () => {
    const { service, prisma } = setup();
    prisma.conversation.findFirst.mockResolvedValue(null);

    await expect(
      service.submit(identity, { conversationId: 'conversation-1', topicPublicId: null }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conversation-1', businessId: 'business-1', visitorId: 'visitor-1' },
      }),
    );
  });

  it('falls back to the default topic when a prompt goes unanswered', async () => {
    const { service, prisma, transaction, routing } = setup();
    prisma.conversation.findMany.mockResolvedValue([
      { id: 'conversation-1', businessId: 'business-1' },
    ]);

    await expect(service.expirePrompts()).resolves.toBe(1);

    // Only a conversation still awaiting a topic is changed by the fallback.
    expect(transaction.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conversation-1', businessId: 'business-1', intakeStatus: 'AWAITING_TOPIC' },
      }),
    );
    expect(transaction.conversationClassification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ topicId: 'general', method: 'TIMEOUT' }) as unknown,
    });
    expect(routing.routeConversation).toHaveBeenCalledWith('business-1', 'conversation-1');
  });

  it('builds a prompt only for keyword decisions that need the visitor', () => {
    const { service } = setup();
    const base = {
      topic: sales,
      method: 'KEYWORD',
      confidence: 0.5,
      candidates: [],
      routing: {},
      intakeExpiresAt: null,
      options: [sales, general],
    };

    expect(service.prompt(null)).toBeUndefined();
    expect(
      service.prompt({ ...base, decision: 'ROUTE', intakeStatus: 'COMPLETE' } as never),
    ).toBeUndefined();
    expect(
      service.prompt({ ...base, decision: 'CONFIRM', intakeStatus: 'COMPLETE' } as never),
    ).toEqual({
      step: 'TOPIC',
      mode: 'CONFIRM',
      topics: [
        { publicId: 'topic_registration01', name: 'Company registration' },
        { publicId: 'topic_general000001', name: 'General' },
      ],
      selectedTopic: { publicId: 'topic_registration01', name: 'Company registration' },
      expiresAt: null,
    });
    expect(
      service.prompt({
        ...base,
        topic: null,
        decision: 'ASK',
        intakeStatus: 'AWAITING_TOPIC',
      } as never)?.mode,
    ).toBe('ASK');
  });
});
