import { z } from 'zod';

const passwordSchema = z.string().min(12).max(128);

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const registerSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  displayName: z.string().trim().min(2).max(100),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  password: passwordSchema,
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine(isValidTimezone, 'Invalid IANA timezone')
    .default('UTC'),
});

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
});

export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
});

export const resetPasswordSchema = z.object({
  token: z
    .string()
    .trim()
    .min(20)
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/, 'Invalid token'),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({
  token: z
    .string()
    .trim()
    .min(20)
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/, 'Invalid token'),
});

export const updateBusinessSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine(isValidTimezone, 'Invalid IANA timezone')
      .optional(),
    defaultLocale: z.string().trim().min(2).max(35).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const createDomainSchema = z.object({
  domain: z.string().trim().min(1).max(300),
});

export const updateDomainStatusSchema = z.object({
  status: z.enum(['PENDING', 'DISABLED']),
});

export const widgetBootstrapSchema = z.object({
  businessPublicId: z
    .string()
    .trim()
    .regex(/^pub_[A-Za-z0-9_-]{8,60}$/),
  visitorToken: z.string().min(32).max(200).optional(),
  identityToken: z.string().min(32).max(2000).optional(),
});

export const updateWidgetSettingsSchema = z
  .object({
    displayName: z.string().trim().min(2).max(120).nullable().optional(),
    primaryColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    greeting: z.string().trim().min(1).max(240).optional(),
    launcherPosition: z.enum(['BOTTOM_RIGHT', 'BOTTOM_LEFT']).optional(),
    enabled: z.boolean().optional(),
    departmentSelectionEnabled: z.boolean().optional(),
    preferPreviousConsultant: z.boolean().optional(),
    queueMessage: z.string().trim().min(1).max(240).optional(),
    offlineMessage: z.string().trim().min(1).max(240).optional(),
    resolvedMessage: z.string().trim().min(1).max(240).optional(),
    reopenWindowMinutes: z.number().int().min(1).max(43_200).optional(),
    agentDisconnectGraceSeconds: z.number().int().min(1).max(900).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

const clientMessageIdSchema = z.string().uuid();
const messageContentSchema = z.string().trim().min(1).max(4000);
const sequenceSchema = z.string().regex(/^\d+$/);

export const conversationStartSchema = z.object({
  clientMessageId: clientMessageIdSchema,
  content: messageContentSchema,
  departmentPublicId: z
    .string()
    .trim()
    .regex(/^dept_[A-Za-z0-9_-]{8,60}$/)
    .optional(),
});

export const createDepartmentSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  isDefault: z.boolean().optional(),
});

export const updateDepartmentSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
    isDefault: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const updateAgentDepartmentsSchema = z.object({
  departmentIds: z.array(z.string().uuid()).max(100),
});

export const createSkillSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(240).nullable().optional(),
  })
  .strict();

export const updateSkillSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(240).nullable().optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const agentSkillSchema = z.object({
  skillId: z.string().uuid(),
  proficiency: z.number().int().min(1).max(5),
});

export const updateRoutingSettingsSchema = z
  .object({ routingStrategy: z.enum(['LEAST_BUSY', 'BEST_SKILL']) })
  .strict();

const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const updateBusinessHoursSchema = z.object({
  hours: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        openingTime: timeSchema,
        closingTime: timeSchema,
        isClosed: z.boolean(),
      }),
    )
    .length(7)
    .superRefine((hours, context) => {
      if (new Set(hours.map(({ weekday }) => weekday)).size !== 7)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Each weekday must appear exactly once',
        });
      hours.forEach((hour, index) => {
        if (!hour.isClosed && hour.openingTime === hour.closingTime)
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Opening and closing times must differ',
            path: [index, 'closingTime'],
          });
      });
    }),
});

export const createBusinessUserSchema = z.object({
  displayName: z.string().trim().min(2).max(100),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  password: passwordSchema,
  role: z.enum(['ADMIN', 'SUPERVISOR', 'CONSULTANT']),
  departmentIds: z.array(z.string().uuid()).max(100).default([]),
});

export const updateBusinessUserSchema = z
  .object({
    displayName: z.string().trim().min(2).max(100).optional(),
    role: z.enum(['OWNER', 'ADMIN', 'SUPERVISOR', 'CONSULTANT']).optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
    maxConcurrentChats: z.number().int().min(1).max(50).optional(),
    routingEnabled: z.boolean().optional(),
    departmentIds: z.array(z.string().uuid()).max(100).optional(),
    skills: z
      .array(agentSkillSchema)
      .max(50)
      .refine(
        (skills) => new Set(skills.map(({ skillId }) => skillId)).size === skills.length,
        'Each skill can be listed once',
      )
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const auditLogQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  action: z.string().trim().max(120).optional(),
});

export const messageSendSchema = z.object({
  conversationId: z.string().uuid(),
  clientMessageId: clientMessageIdSchema,
  content: messageContentSchema,
});

export const agentMessageSendSchema = z.object({
  clientMessageId: clientMessageIdSchema,
  content: messageContentSchema,
});

export const attachmentMessageSchema = z.object({
  clientMessageId: clientMessageIdSchema,
  content: z.string().trim().max(4000).optional(),
});

export const conversationResumeSchema = z.object({
  conversationId: z.string().uuid(),
  afterSequence: sequenceSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const conversationHistorySchema = z.object({
  conversationId: z.string().uuid(),
  beforeSequence: sequenceSchema,
  limit: z.number().int().min(1).max(100).default(50),
});

export const messageHistoryQuerySchema = z
  .object({
    beforeSequence: sequenceSchema.optional(),
    afterSequence: sequenceSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine(
    (value) => !(value.beforeSequence && value.afterSequence),
    'Use either beforeSequence or afterSequence',
  );

export const conversationListQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  status: z
    .enum([
      'NEW',
      'QUEUED',
      'ASSIGNED',
      'ACTIVE',
      'WAITING_FOR_CUSTOMER',
      'WAITING_FOR_AGENT',
      'RESOLVED',
      'CLOSED',
    ])
    .optional(),
});

export const conversationStatusUpdateSchema = z.object({
  status: z.enum([
    'NEW',
    'QUEUED',
    'ASSIGNED',
    'ACTIVE',
    'WAITING_FOR_CUSTOMER',
    'WAITING_FOR_AGENT',
    'RESOLVED',
    'CLOSED',
  ]),
});

export const conversationTransferSchema = z
  .object({
    agentProfileId: z.string().uuid().optional(),
    departmentId: z.string().uuid().optional(),
    expectedAssignedAgentMembershipId: z.string().uuid().nullable().optional(),
    reason: z.string().trim().max(240).optional(),
  })
  .strict()
  .refine(
    (value) => Number(Boolean(value.agentProfileId)) + Number(Boolean(value.departmentId)) === 1,
    'Choose exactly one consultant or department',
  );

export const conversationOperationSchema = z
  .object({ reason: z.string().trim().max(240).optional() })
  .strict();

export const internalNoteSchema = z.object({
  clientMessageId: clientMessageIdSchema,
  content: messageContentSchema,
});

export const setConversationTagsSchema = z.object({ tagIds: z.array(z.string().uuid()).max(25) });

export const createTagSchema = z.object({
  name: z.string().trim().min(2).max(80),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#64748b'),
});
export const updateTagSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const createCannedResponseSchema = z.object({
  title: z.string().trim().min(2).max(120),
  content: messageContentSchema,
  shortcut: z.string().trim().min(1).max(40).nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
});
export const updateCannedResponseSchema = z
  .object({
    title: z.string().trim().min(2).max(120).optional(),
    content: messageContentSchema.optional(),
    shortcut: z.string().trim().min(1).max(40).nullable().optional(),
    departmentId: z.string().uuid().nullable().optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');
export const cannedResponseListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  departmentId: z.string().uuid().optional(),
  includeDisabled: z.coerce.boolean().default(false),
});

export const messageReceiptSchema = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
});

export const messageReadSchema = z.object({
  conversationId: z.string().uuid(),
  throughSequence: sequenceSchema,
});

export const agentProfileUpdateSchema = z
  .object({
    maxConcurrentChats: z.number().int().min(1).max(50).optional(),
    routingEnabled: z.boolean().optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const agentPresenceUpdateSchema = z.object({
  state: z.enum(['ONLINE', 'BUSY', 'AWAY', 'DO_NOT_DISTURB']),
});

export const conversationSubscriptionSchema = z.object({
  conversationId: z.string().uuid(),
  afterSequence: sequenceSchema.optional(),
});

export const typingUpdateSchema = z.object({
  conversationId: z.string().uuid(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type UpdateBusinessInput = z.infer<typeof updateBusinessSchema>;
export type CreateDomainInput = z.infer<typeof createDomainSchema>;
export type UpdateDomainStatusInput = z.infer<typeof updateDomainStatusSchema>;
export type WidgetBootstrapInput = z.infer<typeof widgetBootstrapSchema>;
export type UpdateWidgetSettingsInput = z.infer<typeof updateWidgetSettingsSchema>;
export type ConversationStartInput = z.infer<typeof conversationStartSchema>;
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
export type UpdateAgentDepartmentsInput = z.infer<typeof updateAgentDepartmentsSchema>;
export type CreateSkillInput = z.infer<typeof createSkillSchema>;
export type UpdateSkillInput = z.infer<typeof updateSkillSchema>;
export type AgentSkillInput = z.infer<typeof agentSkillSchema>;
export type UpdateRoutingSettingsInput = z.infer<typeof updateRoutingSettingsSchema>;
export type UpdateBusinessHoursInput = z.infer<typeof updateBusinessHoursSchema>;
export type CreateBusinessUserInput = z.infer<typeof createBusinessUserSchema>;
export type UpdateBusinessUserInput = z.infer<typeof updateBusinessUserSchema>;
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
export type MessageSendInput = z.infer<typeof messageSendSchema>;
export type AgentMessageSendInput = z.infer<typeof agentMessageSendSchema>;
export type AttachmentMessageInput = z.infer<typeof attachmentMessageSchema>;
export type ConversationResumeInput = z.infer<typeof conversationResumeSchema>;
export type ConversationHistoryInput = z.infer<typeof conversationHistorySchema>;
export type MessageHistoryQuery = z.infer<typeof messageHistoryQuerySchema>;
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;
export type ConversationStatusUpdateInput = z.infer<typeof conversationStatusUpdateSchema>;
export type ConversationTransferInput = z.infer<typeof conversationTransferSchema>;
export type ConversationOperationInput = z.infer<typeof conversationOperationSchema>;
export type InternalNoteInput = z.infer<typeof internalNoteSchema>;
export type SetConversationTagsInput = z.infer<typeof setConversationTagsSchema>;
export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
export type CreateCannedResponseInput = z.infer<typeof createCannedResponseSchema>;
export type UpdateCannedResponseInput = z.infer<typeof updateCannedResponseSchema>;
export type CannedResponseListQuery = z.infer<typeof cannedResponseListQuerySchema>;
export type MessageReceiptInput = z.infer<typeof messageReceiptSchema>;
export type MessageReadInput = z.infer<typeof messageReadSchema>;
export type AgentProfileUpdateInput = z.infer<typeof agentProfileUpdateSchema>;
export type AgentPresenceUpdateInput = z.infer<typeof agentPresenceUpdateSchema>;
export type ConversationSubscriptionInput = z.infer<typeof conversationSubscriptionSchema>;
export type TypingUpdateInput = z.infer<typeof typingUpdateSchema>;
