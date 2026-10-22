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
} from './index';

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
