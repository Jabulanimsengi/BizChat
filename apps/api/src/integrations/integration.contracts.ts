import { z } from 'zod';

export const integrationScopes = [
  'conversations:read',
  'conversations:write',
  'messages:read',
  'messages:write',
  'customers:identify',
  // Pre-chat form answers are personal information, so reading them needs its own scope.
  'intake:read',
  // Who is online and whether the business is open, e.g. to show a chat button only when staffed.
  'availability:read',
] as const;
export const webhookEvents = [
  'conversation.created',
  'message.created',
  'conversation.resolved',
  'conversation.queued',
  'conversation.offered',
  'conversation.assigned',
  'conversation.overflowed',
  'conversation.follow_up_requested',
  'conversation.closed',
] as const;
export const keySchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    scopes: z
      .array(z.enum(integrationScopes))
      .min(1)
      .max(integrationScopes.length)
      .transform((items) => [...new Set(items)]),
    expiresInDays: z.number().int().min(1).max(365).default(90),
  })
  .strict();
export const pageSchema = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const historySchema = z
  .object({
    afterSequence: z
      .string()
      .regex(/^\d{1,18}$/)
      .default('0'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const customerSchema = z.object({ externalId: z.string().trim().min(1).max(200) }).strict();
/** Optional name and email claims pre-fill matching pre-chat form fields for this customer. */
export const identifySchema = customerSchema
  .extend({
    name: z.string().trim().min(1).max(100).optional(),
    email: z.string().trim().email().max(254).optional(),
  })
  .strict();
export type IdentifyInput = z.infer<typeof identifySchema>;
export const startSchema = customerSchema
  .extend({
    content: z.string().trim().min(1).max(4000),
    departmentPublicId: z.string().max(64).optional(),
    topicPublicId: z.string().max(64).optional(),
    intake: z
      .object({
        answers: z.record(z.string().max(40), z.string().max(500)),
        consent: z.boolean().optional(),
      })
      .strict()
      .optional(),
    subject: z.string().trim().max(240).optional(),
  })
  .strict();
export const sendSchema = z.object({ content: z.string().trim().min(1).max(4000) }).strict();
export const resolveSchema = z.object({ reason: z.string().trim().max(240).optional() }).strict();
export const webhookSchema = z
  .object({
    url: z.string().url().max(2000),
    events: z
      .array(z.enum(webhookEvents))
      .min(1)
      .max(webhookEvents.length)
      .transform((items) => [...new Set(items)]),
  })
  .strict();
export const idempotencySchema = z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/);
export type IntegrationScope = (typeof integrationScopes)[number];
export interface IntegrationPrincipal {
  keyId: string;
  businessId: string;
  scopes: string[];
}
export type KeyInput = z.infer<typeof keySchema>;
export type PageInput = z.infer<typeof pageSchema>;
export type HistoryInput = z.infer<typeof historySchema>;
export type StartInput = z.infer<typeof startSchema>;
export type SendInput = z.infer<typeof sendSchema>;
export type ResolveInput = z.infer<typeof resolveSchema>;
export type WebhookInput = z.infer<typeof webhookSchema>;
