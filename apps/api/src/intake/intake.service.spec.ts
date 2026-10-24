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
    prisma: {
      conversation: { findFirst: jest.Mock; findMany: jest.Mock };
      conversationIntake: { count: jest.Mock };
    };
    catalog: { findActive: jest.Mock; quickReplies: jest.Mock };
    forms: Record<'requirement' | 'record' | 'validate' | 'widgetForm', jest.Mock>;
    routing: { routeConversation: jest.Mock };
    timeline: { recordInTransaction: jest.Mock };
    emit: jest.Mock;
  } => {
    const transaction = {
      conversation: { updateMany: jest.fn().mockResolvedValue({ count: changed }) },
      conversationQueueEntry: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      conversationClassification: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      conversation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'conversation-1',
          businessId: 'business-1',
          visitorId: 'visitor-1',
          topicId: 'registration',
          intakeStatus: 'AWAITING_FORM',
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      conversationIntake: { count: jest.fn().mockResolvedValue(0) },
      department: { findFirst: jest.fn().mockResolvedValue({ id: 'default-department' }) },
      $transaction: jest.fn(async (operation: (client: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
      ),
    };
    const forms = {
      requirement: jest.fn().mockResolvedValue(null),
      record: jest.fn().mockResolvedValue(undefined),
      validate: jest.fn().mockReturnValue([{ key: 'name', label: 'Name', value: 'Thandi' }]),
      widgetForm: jest
        .fn()
        .mockReturnValue({ name: 'Company details', consentText: null, fields: [] }),
    };
    const emit = jest.fn();
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
      forms as never,
      routing as never,
      timeline as never,
      { emit } as never,
    );
    return { service, transaction, prisma, catalog, forms, routing, timeline, emit };
  };
  const form = { id: 'form-1', name: 'Company details', version: 2, consentText: null };

  it('moves to the form step instead of routing when the chosen topic has a form', async () => {
    const { service, transaction, forms, routing } = setup();
    forms.requirement.mockResolvedValue({ form, prefill: {}, autoAnswers: null });

    const result = await service.submit(identity, {
      conversationId: 'conversation-1',
      topicPublicId: 'topic_registration01',
    });

    expect(transaction.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ intakeStatus: 'AWAITING_FORM' }) as unknown,
      }),
    );
    expect(result).toEqual({
      routed: null,
      intake: expect.objectContaining({ step: 'FORM', mode: 'ASK' }) as unknown,
    });
    expect(routing.routeConversation).not.toHaveBeenCalled();
  });

  it('stores a form that identity claims already answer, then routes', async () => {
    const { service, transaction, forms, routing } = setup();
    const autoAnswers = [{ key: 'email', label: 'Email', value: 'thandi@example.com' }];
    forms.requirement.mockResolvedValue({ form, prefill: {}, autoAnswers });

    await service.submit(identity, {
      conversationId: 'conversation-1',
      topicPublicId: 'topic_registration01',
    });

    expect(transaction.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ intakeStatus: 'COMPLETE' }) as unknown,
      }),
    );
    expect(forms.record).toHaveBeenCalledWith(
      transaction,
      'business-1',
      'conversation-1',
      form,
      autoAnswers,
      false,
    );
    expect(routing.routeConversation).toHaveBeenCalled();
  });

  it('does not ask for a second form after one was submitted', async () => {
    const { service, prisma, forms } = setup();
    prisma.conversationIntake.count.mockResolvedValue(1);

    await service.submit(identity, { conversationId: 'conversation-1', topicPublicId: null });

    expect(forms.requirement).not.toHaveBeenCalled();
  });

  it('validates, stores, and routes a submitted form', async () => {
    const { service, transaction, forms, routing } = setup();
    forms.requirement.mockResolvedValue({ form, prefill: { name: 'Thandi' }, autoAnswers: null });

    const result = await service.submitForm(identity, {
      conversationId: 'conversation-1',
      answers: { registration_number: '2019/123456/07' },
      consent: true,
    });

    expect(forms.validate).toHaveBeenCalledWith(
      form,
      expect.objectContaining({ answers: { registration_number: '2019/123456/07' } }),
      { name: 'Thandi' },
    );
    expect(transaction.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'conversation-1', businessId: 'business-1', intakeStatus: 'AWAITING_FORM' },
      data: { intakeStatus: 'COMPLETE' },
    });
    expect(forms.record).toHaveBeenCalledWith(
      transaction,
      'business-1',
      'conversation-1',
      form,
      [{ key: 'name', label: 'Name', value: 'Thandi' }],
      true,
    );
    expect(routing.routeConversation).toHaveBeenCalledWith('business-1', 'conversation-1');
    expect(result.intake).toBeNull();
  });

  it('rejects a form submission when no form is pending', async () => {
    const { service, prisma, routing } = setup();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      businessId: 'business-1',
      intakeStatus: 'COMPLETE',
    });

    await expect(
      service.submitForm(identity, { conversationId: 'conversation-1', answers: {} }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(routing.routeConversation).not.toHaveBeenCalled();
  });

  it('asks a still-connected visitor for the form after a topic prompt times out', async () => {
    const { service, prisma, forms, routing, emit } = setup();
    prisma.conversation.findMany.mockResolvedValue([
      { id: 'conversation-1', businessId: 'business-1', visitorId: 'visitor-1' },
    ]);
    forms.requirement.mockResolvedValue({ form, prefill: {}, autoAnswers: null });

    await service.expirePrompts();

    expect(emit).toHaveBeenCalledWith(
      'intake.required',
      expect.objectContaining({
        conversationId: 'conversation-1',
        prompt: expect.objectContaining({ step: 'FORM' }) as unknown,
      }),
    );
    expect(routing.routeConversation).not.toHaveBeenCalled();
  });

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
