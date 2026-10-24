import { describe, expect, it } from 'vitest';
import {
  agentPresenceUpdateSchema,
  agentProfileUpdateSchema,
  conversationHistorySchema,
  conversationStartSchema,
  conversationStatusUpdateSchema,
  conversationTransferSchema,
  createCannedResponseSchema,
  createDepartmentSchema,
  createDomainSchema,
  createTagSchema,
  internalNoteSchema,
  loginSchema,
  messageHistoryQuerySchema,
  registerSchema,
  setConversationTagsSchema,
  typingUpdateSchema,
  updateAgentDepartmentsSchema,
  updateWidgetSettingsSchema,
  updateBusinessHoursSchema,
  createBusinessUserSchema,
  auditLogQuerySchema,
  widgetBootstrapSchema,
  createSkillSchema,
  updateBusinessUserSchema,
  updateRoutingSettingsSchema,
  offerResponseSchema,
  createTopicSchema,
  updateTopicSchema,
  intakeSubmitSchema,
} from './index';

describe('topic validation', () => {
  it('fills topic defaults and bounds keyword weights', () => {
    const parsed = createTopicSchema.parse({ name: 'Company registration' });
    expect(parsed).toMatchObject({
      priority: 'NORMAL',
      keywords: [],
      showAsQuickReply: true,
      isDefault: false,
    });
    expect(
      createTopicSchema.safeParse({ name: 'Tax', keywords: [{ phrase: 'vat', weight: 6 }] })
        .success,
    ).toBe(false);
    expect(
      createTopicSchema.safeParse({ name: 'Tax', requiredSkillMinProficiency: 0 }).success,
    ).toBe(false);
  });

  it('requires at least one field on update and rejects unknown fields', () => {
    expect(updateTopicSchema.safeParse({}).success).toBe(false);
    expect(updateTopicSchema.safeParse({ status: 'DISABLED' }).success).toBe(true);
    expect(updateTopicSchema.safeParse({ businessId: 'x' }).success).toBe(false);
  });

  it('accepts a topic choice or "something else" (null)', () => {
    const conversationId = '7d3c1c8e-5b1f-4c1a-9a43-2f7f5b1c9e10';
    expect(
      intakeSubmitSchema.safeParse({ conversationId, topicPublicId: 'topic_abcdefgh12' }).success,
    ).toBe(true);
    expect(intakeSubmitSchema.safeParse({ conversationId, topicPublicId: null }).success).toBe(
      true,
    );
    expect(intakeSubmitSchema.safeParse({ conversationId, topicPublicId: 'dept_x' }).success).toBe(
      false,
    );
  });

  it('keeps the confirm threshold below the auto-route threshold', () => {
    expect(
      updateRoutingSettingsSchema.safeParse({ autoRouteThreshold: 0.5, confirmThreshold: 0.6 })
        .success,
    ).toBe(false);
    expect(
      updateRoutingSettingsSchema.safeParse({ autoRouteThreshold: 0.7, confirmThreshold: 0.3 })
        .success,
    ).toBe(true);
  });
});

describe('skill routing validation', () => {
  const skillId = '7d3c1c8e-5b1f-4c1a-9a43-2f7f5b1c9e10';

  it('accepts consultant proficiency from 1 to 5 only', () => {
    expect(
      updateBusinessUserSchema.safeParse({ skills: [{ skillId, proficiency: 5 }] }).success,
    ).toBe(true);
    expect(
      updateBusinessUserSchema.safeParse({ skills: [{ skillId, proficiency: 0 }] }).success,
    ).toBe(false);
    expect(
      updateBusinessUserSchema.safeParse({ skills: [{ skillId, proficiency: 6 }] }).success,
    ).toBe(false);
  });

  it('rejects listing the same skill twice for a consultant', () => {
    const result = updateBusinessUserSchema.safeParse({
      skills: [
        { skillId, proficiency: 2 },
        { skillId, proficiency: 4 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('validates skill names and routing strategies', () => {
    expect(createSkillSchema.safeParse({ name: ' Tax returns ' }).data?.name).toBe('Tax returns');
    expect(createSkillSchema.safeParse({ name: 'T' }).success).toBe(false);
    expect(updateRoutingSettingsSchema.safeParse({ routingStrategy: 'BEST_SKILL' }).success).toBe(
      true,
    );
    expect(updateRoutingSettingsSchema.safeParse({ routingStrategy: 'RANDOM' }).success).toBe(
      false,
    );
  });

  it('bounds offer settings and requires at least one field', () => {
    expect(
      updateRoutingSettingsSchema.safeParse({
        assignmentMode: 'OFFER',
        offerTimeoutSeconds: 10,
        missedOffersBeforeAway: 0,
        exclusionSeconds: 3600,
      }).success,
    ).toBe(true);
    expect(updateRoutingSettingsSchema.safeParse({ offerTimeoutSeconds: 5 }).success).toBe(false);
    expect(updateRoutingSettingsSchema.safeParse({ missedOffersBeforeAway: 11 }).success).toBe(
      false,
    );
    expect(updateRoutingSettingsSchema.safeParse({ exclusionSeconds: 30 }).success).toBe(false);
    expect(updateRoutingSettingsSchema.safeParse({}).success).toBe(false);
  });

  it('accepts offer responses with an optional short reason', () => {
    expect(offerResponseSchema.safeParse({ offerId: skillId }).success).toBe(true);
    expect(
      offerResponseSchema.safeParse({ offerId: skillId, reason: 'x'.repeat(241) }).success,
    ).toBe(false);
    expect(offerResponseSchema.safeParse({ offerId: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('authentication validation', () => {
  it('normalizes email addresses during registration', () => {
    const result = registerSchema.parse({
      businessName: 'Example',
      displayName: 'Owner Name',
      email: ' OWNER@Example.COM ',
      password: 'a-secure-passphrase',
      timezone: 'Africa/Johannesburg',
    });
    expect(result.email).toBe('owner@example.com');
  });

  it('rejects an empty login password', () => {
    expect(() => loginSchema.parse({ email: 'owner@example.com', password: '' })).toThrow();
  });

  it('validates public widget bootstrap identifiers', () => {
    expect(widgetBootstrapSchema.parse({ businessPublicId: 'pub_12345678' }).businessPublicId).toBe(
      'pub_12345678',
    );
    expect(() =>
      widgetBootstrapSchema.parse({ businessPublicId: 'business-database-id' }),
    ).toThrow();
  });

  it('leaves domain normalization to the server domain service', () => {
    expect(createDomainSchema.parse({ domain: ' HTTPS://Example.com/ ' }).domain).toBe(
      'HTTPS://Example.com/',
    );
  });

  it('requires retry-safe UUID message identifiers and bounded content', () => {
    expect(
      conversationStartSchema.parse({
        clientMessageId: '2dc4cf9d-863d-44fd-9a31-1ca5f8ec415c',
        content: ' Hello ',
      }).content,
    ).toBe('Hello');
    expect(() =>
      conversationStartSchema.parse({ clientMessageId: 'retry-1', content: 'Hello' }),
    ).toThrow();
    expect(() =>
      conversationStartSchema.parse({
        clientMessageId: '2dc4cf9d-863d-44fd-9a31-1ca5f8ec415c',
        content: 'x'.repeat(4001),
      }),
    ).toThrow();
  });

  it('accepts public department selection and validates durable department membership ids', () => {
    expect(
      conversationStartSchema.parse({
        clientMessageId: '2dc4cf9d-863d-44fd-9a31-1ca5f8ec415c',
        content: 'Help',
        departmentPublicId: 'dept_12345678',
      }).departmentPublicId,
    ).toBe('dept_12345678');
    expect(createDepartmentSchema.parse({ name: 'Technical', isDefault: true }).name).toBe(
      'Technical',
    );
    expect(() =>
      updateAgentDepartmentsSchema.parse({ departmentIds: ['internal-not-a-uuid'] }),
    ).toThrow();
  });

  it('validates cursor pagination direction', () => {
    expect(messageHistoryQuerySchema.parse({ limit: '25' }).limit).toBe(25);
    expect(() =>
      messageHistoryQuerySchema.parse({ beforeSequence: '10', afterSequence: '12' }),
    ).toThrow();
  });

  it('validates visitor history and lifecycle inputs', () => {
    expect(
      conversationHistorySchema.parse({
        conversationId: '2dc4cf9d-863d-44fd-9a31-1ca5f8ec415c',
        beforeSequence: '12',
      }).limit,
    ).toBe(50);
    expect(conversationStatusUpdateSchema.parse({ status: 'WAITING_FOR_CUSTOMER' }).status).toBe(
      'WAITING_FOR_CUSTOMER',
    );
    expect(() => conversationStatusUpdateSchema.parse({ status: 'DELETED' })).toThrow();
  });

  it('validates transfers, private notes, tags, and canned responses', () => {
    const id = '2dc4cf9d-863d-44fd-9a31-1ca5f8ec415c';
    expect(conversationTransferSchema.parse({ agentProfileId: id }).agentProfileId).toBe(id);
    expect(() =>
      conversationTransferSchema.parse({ agentProfileId: id, departmentId: id }),
    ).toThrow();
    expect(
      internalNoteSchema.parse({ clientMessageId: id, content: 'Private context' }).content,
    ).toBe('Private context');
    expect(createTagSchema.parse({ name: 'Complaint' }).color).toBe('#64748b');
    expect(setConversationTagsSchema.parse({ tagIds: [id] }).tagIds).toEqual([id]);
    expect(
      createCannedResponseSchema.parse({ title: 'Greeting', content: 'Hello there' }).title,
    ).toBe('Greeting');
  });

  it('bounds consultant profiles and transient real-time commands', () => {
    expect(agentProfileUpdateSchema.parse({ maxConcurrentChats: 8 }).maxConcurrentChats).toBe(8);
    expect(() => agentProfileUpdateSchema.parse({ maxConcurrentChats: 0 })).toThrow();
    expect(agentPresenceUpdateSchema.parse({ state: 'DO_NOT_DISTURB' }).state).toBe(
      'DO_NOT_DISTURB',
    );
    expect(
      typingUpdateSchema.parse({ conversationId: '2dc4cf9d-863d-44fd-9a31-1ca5f8ec415c' })
        .conversationId,
    ).toBeTruthy();
  });

  it('bounds the durable agent disconnect grace period', () => {
    expect(
      updateWidgetSettingsSchema.parse({ agentDisconnectGraceSeconds: 45 })
        .agentDisconnectGraceSeconds,
    ).toBe(45);
    expect(() => updateWidgetSettingsSchema.parse({ agentDisconnectGraceSeconds: 0 })).toThrow();
    expect(() => updateWidgetSettingsSchema.parse({ agentDisconnectGraceSeconds: 901 })).toThrow();
  });

  it('validates all seven unique operating days and real opening windows', () => {
    const hours = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      openingTime: '09:00',
      closingTime: '17:00',
      isClosed: weekday === 0,
    }));
    expect(updateBusinessHoursSchema.parse({ hours }).hours).toHaveLength(7);
    expect(() =>
      updateBusinessHoursSchema.parse({ hours: hours.map((hour) => ({ ...hour, weekday: 1 })) }),
    ).toThrow();
    expect(() =>
      updateBusinessHoursSchema.parse({
        hours: hours.map((hour, index) => (index === 2 ? { ...hour, closingTime: '09:00' } : hour)),
      }),
    ).toThrow();
  });

  it('validates managed users and audit pagination', () => {
    expect(
      createBusinessUserSchema.parse({
        displayName: 'New Agent',
        email: ' AGENT@EXAMPLE.COM ',
        password: 'long-secure-password',
        role: 'CONSULTANT',
      }).email,
    ).toBe('agent@example.com');
    expect(() =>
      createBusinessUserSchema.parse({
        displayName: 'Owner',
        email: 'owner@example.com',
        password: 'long-secure-password',
        role: 'OWNER',
      }),
    ).toThrow();
    expect(auditLogQuerySchema.parse({ limit: '50', action: 'user.' }).limit).toBe(50);
  });

  it('rejects invalid tenant timezones', () => {
    expect(() =>
      registerSchema.parse({
        businessName: 'Example',
        displayName: 'Owner Name',
        email: 'owner@example.com',
        password: 'a-secure-passphrase',
        timezone: 'Not/A_Timezone',
      }),
    ).toThrow();
  });
});
