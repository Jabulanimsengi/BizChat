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

/** Raw pre-chat answers keyed by field key; checked against the form by `validateIntakeAnswers`. */
export const intakeAnswersSchema = z
  .object({
    answers: z
      .record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.string().max(500))
      .refine((answers) => Object.keys(answers).length <= 10, 'Too many answers'),
    consent: z.boolean().optional(),
  })
  .strict();

export const conversationStartSchema = z.object({
  clientMessageId: clientMessageIdSchema,
  content: messageContentSchema,
  departmentPublicId: z
    .string()
    .trim()
    .regex(/^dept_[A-Za-z0-9_-]{8,60}$/)
    .optional(),
  topicPublicId: z
    .string()
    .trim()
    .regex(/^topic_[A-Za-z0-9_-]{8,60}$/)
    .optional(),
  /** Answers to the default form when the tenant asks for it before the chat starts. */
  intake: intakeAnswersSchema.optional(),
});

export const intakeFormSubmitSchema = intakeAnswersSchema
  .extend({ conversationId: z.string().uuid() })
  .strict();

const intakeFieldSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    label: z.string().trim().min(1).max(80),
    type: z.enum(['TEXT', 'EMAIL', 'PHONE', 'SELECT', 'REFERENCE']),
    required: z.boolean().default(false),
    maxLength: z.number().int().min(1).max(200).optional(),
    options: z.array(z.string().trim().min(1).max(80)).min(1).max(20).optional(),
    mask: z.string().min(1).max(40).optional(),
    prefillFrom: z.enum(['name', 'email']).optional(),
  })
  .strict()
  .superRefine((field, context) => {
    if (field.type === 'SELECT' && !field.options)
      context.addIssue({
        code: 'custom',
        message: 'A choice field needs options',
        path: ['options'],
      });
    if (field.type !== 'SELECT' && field.options)
      context.addIssue({
        code: 'custom',
        message: 'Only choice fields have options',
        path: ['options'],
      });
    if (field.type === 'REFERENCE' && !field.mask)
      context.addIssue({
        code: 'custom',
        message: 'A reference field needs a format',
        path: ['mask'],
      });
    if (field.type !== 'REFERENCE' && field.mask)
      context.addIssue({
        code: 'custom',
        message: 'Only reference fields have a format',
        path: ['mask'],
      });
    if (field.prefillFrom && field.type !== 'TEXT' && field.type !== 'EMAIL')
      context.addIssue({
        code: 'custom',
        message: 'Only text and email fields can be prefilled',
        path: ['prefillFrom'],
      });
  });

const intakeFieldsSchema = z
  .array(intakeFieldSchema)
  .min(1)
  .max(10)
  .refine(
    (fields) => new Set(fields.map(({ key }) => key)).size === fields.length,
    'Each field key can be used once',
  );

export const createIntakeFormSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    fields: intakeFieldsSchema,
    consentText: z.string().trim().min(1).max(1000).nullable().optional(),
  })
  .strict();

export const updateIntakeFormSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    fields: intakeFieldsSchema.optional(),
    consentText: z.string().trim().min(1).max(1000).nullable().optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

/**
 * Character-by-character format check: `#` digit, `A` letter, `*` letter or digit, anything else
 * must match literally. Linear in the input, so a business-defined format cannot stall the server.
 */
export function matchesMask(value: string, mask: string): boolean {
  if (value.length !== mask.length) return false;
  for (let index = 0; index < mask.length; index += 1) {
    const expected = mask[index]!;
    const actual = value[index]!;
    const digit = actual >= '0' && actual <= '9';
    const letter = /^[A-Za-z]$/.test(actual);
    if (
      expected === '#'
        ? !digit
        : expected === 'A'
          ? !letter
          : expected === '*'
            ? !(digit || letter)
            : actual !== expected
    )
      return false;
  }
  return true;
}

const emailSchema = z.string().email().max(254);
const PHONE = /^\+?[0-9 ()-]{7,20}$/;

export type IntakeValidation =
  | { ok: true; answers: { key: string; label: string; value: string }[] }
  | { ok: false; errors: Record<string, string> };

/** Checks answers against a form's fields; prefilled values fill fields the visitor left out. */
export function validateIntakeAnswers(
  form: {
    fields: {
      key: string;
      label: string;
      type: string;
      required: boolean;
      maxLength?: number;
      options?: string[];
      mask?: string;
    }[];
    consentText: string | null;
  },
  input: { answers: Record<string, string>; consent?: boolean },
  prefill: Record<string, string> = {},
): IntakeValidation {
  const errors: Record<string, string> = {};
  const answers: { key: string; label: string; value: string }[] = [];
  const known = new Set(form.fields.map(({ key }) => key));
  for (const key of Object.keys(input.answers))
    if (!known.has(key)) errors[key] = 'This field is not on the form';
  for (const field of form.fields) {
    const value = (input.answers[field.key] ?? prefill[field.key] ?? '').trim();
    if (!value) {
      if (field.required) errors[field.key] = `${field.label} is required`;
      continue;
    }
    if (value.length > (field.maxLength ?? 200)) errors[field.key] = `${field.label} is too long`;
    else if (field.type === 'EMAIL' && !emailSchema.safeParse(value).success)
      errors[field.key] = `${field.label} must be an email address`;
    else if (field.type === 'PHONE' && !PHONE.test(value))
      errors[field.key] = `${field.label} must be a phone number`;
    else if (field.type === 'SELECT' && !field.options?.includes(value))
      errors[field.key] = `Choose one of the options for ${field.label}`;
    else if (field.type === 'REFERENCE' && field.mask && !matchesMask(value, field.mask))
      errors[field.key] = `${field.label} must look like ${field.mask}`;
    else answers.push({ key: field.key, label: field.label, value });
  }
  if (form.consentText && !input.consent) errors.consent = 'Consent is required';
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, answers };
}

/** The visitor's topic choice; null means "Something else" (the default topic). */
export const intakeSubmitSchema = z
  .object({
    conversationId: z.string().uuid(),
    topicPublicId: z
      .string()
      .trim()
      .regex(/^topic_[A-Za-z0-9_-]{8,60}$/)
      .nullable(),
  })
  .strict();

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
  .object({
    routingStrategy: z.enum(['LEAST_BUSY', 'BEST_SKILL']).optional(),
    assignmentMode: z.enum(['AUTO', 'OFFER']).optional(),
    offerTimeoutSeconds: z.number().int().min(10).max(120).optional(),
    missedOffersBeforeAway: z.number().int().min(0).max(10).optional(),
    exclusionSeconds: z.number().int().min(60).max(3600).optional(),
    autoRouteThreshold: z.number().min(0.1).max(0.95).optional(),
    confirmThreshold: z.number().min(0.05).max(0.9).optional(),
    topicPromptTimeoutSeconds: z.number().int().min(15).max(600).optional(),
    intakeFormTiming: z.enum(['AFTER_TOPIC', 'BEFORE_CHAT']).optional(),
    defaultIntakeFormId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required')
  .refine(
    (value) =>
      value.autoRouteThreshold === undefined ||
      value.confirmThreshold === undefined ||
      value.confirmThreshold < value.autoRouteThreshold,
    'The confirm threshold must be below the auto-route threshold',
  );

const topicTextSchema = z.string().trim().min(1).max(80);
const topicFields = {
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).nullable(),
  departmentId: z.string().uuid().nullable(),
  requiredSkillId: z.string().uuid().nullable(),
  requiredSkillMinProficiency: z.number().int().min(1).max(5).nullable(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']),
  keywords: z
    .array(z.object({ phrase: topicTextSchema, weight: z.number().int().min(1).max(5).optional() }))
    .max(50),
  negativeKeywords: z.array(topicTextSchema).max(30),
  examples: z.array(z.string().trim().min(1).max(240)).max(20),
  showAsQuickReply: z.boolean(),
  isDefault: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
  intakeFormId: z.string().uuid().nullable(),
  overflowSteps: z
    .array(
      z
        .object({
          afterSeconds: z.number().int().min(10).max(86_400),
          addDepartmentIds: z.array(z.string().uuid()).max(10).default([]),
          relaxSkill: z.boolean().default(false),
          anyConsultant: z.boolean().default(false),
        })
        .strict()
        .refine(
          (step) => step.addDepartmentIds.length > 0 || step.relaxSkill || step.anyConsultant,
          'Each overflow step must widen who can take the chat',
        ),
    )
    .max(5)
    .refine(
      (steps) =>
        steps.every(
          (step, index) => index === 0 || step.afterSeconds > steps[index - 1]!.afterSeconds,
        ),
      'Overflow steps must be in increasing wait order',
    ),
  maxWaitSeconds: z.number().int().min(30).max(86_400).nullable(),
};

export const createTopicSchema = z
  .object({
    name: topicFields.name,
    description: topicFields.description.optional(),
    departmentId: topicFields.departmentId.optional(),
    requiredSkillId: topicFields.requiredSkillId.optional(),
    requiredSkillMinProficiency: topicFields.requiredSkillMinProficiency.optional(),
    priority: topicFields.priority.default('NORMAL'),
    keywords: topicFields.keywords.default([]),
    negativeKeywords: topicFields.negativeKeywords.default([]),
    examples: topicFields.examples.default([]),
    showAsQuickReply: topicFields.showAsQuickReply.default(true),
    isDefault: topicFields.isDefault.default(false),
    sortOrder: topicFields.sortOrder.default(0),
    intakeFormId: topicFields.intakeFormId.optional(),
    overflowSteps: topicFields.overflowSteps.default([]),
    maxWaitSeconds: topicFields.maxWaitSeconds.optional(),
  })
  .strict();

export const updateTopicSchema = z
  .object({
    name: topicFields.name.optional(),
    description: topicFields.description.optional(),
    departmentId: topicFields.departmentId.optional(),
    requiredSkillId: topicFields.requiredSkillId.optional(),
    requiredSkillMinProficiency: topicFields.requiredSkillMinProficiency.optional(),
    priority: topicFields.priority.optional(),
    keywords: topicFields.keywords.optional(),
    negativeKeywords: topicFields.negativeKeywords.optional(),
    examples: topicFields.examples.optional(),
    showAsQuickReply: topicFields.showAsQuickReply.optional(),
    isDefault: topicFields.isDefault.optional(),
    sortOrder: topicFields.sortOrder.optional(),
    intakeFormId: topicFields.intakeFormId.optional(),
    overflowSteps: topicFields.overflowSteps.optional(),
    maxWaitSeconds: topicFields.maxWaitSeconds.optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

/** Contact details a waiting visitor leaves so the business can get back to them. */
export const followUpRequestSchema = z
  .object({
    conversationId: z.string().uuid(),
    name: z.string().trim().max(100).optional(),
    email: emailSchema.optional(),
    phone: z.string().trim().regex(PHONE, 'Enter a phone number').optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.email || value.phone), {
    message: 'Leave an email address or a phone number',
    path: ['email'],
  });

const analyticsDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
/** Inclusive local dates, at most 92 days apart. */
export const analyticsQuerySchema = z
  .object({
    from: analyticsDate,
    to: analyticsDate,
    departmentId: z.string().uuid().optional(),
    topicId: z.string().uuid().optional(),
  })
  .strict()
  .refine((value) => value.from <= value.to, {
    message: 'from must not be after to',
    path: ['from'],
  })
  .refine((value) => Date.parse(value.to) - Date.parse(value.from) <= 91 * 86_400_000, {
    message: 'Choose at most 92 days',
    path: ['to'],
  });

export const topicTestSchema = z.object({ message: messageContentSchema }).strict();

export const offerResponseSchema = z
  .object({
    offerId: z.string().uuid(),
    reason: z.string().trim().max(240).optional(),
  })
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

/** What an integration may change about a consultant: routing only, never role, status, or name. */
export const setupConsultantSchema = z
  .object({
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
      'OFFERED',
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
export type OfferResponseInput = z.infer<typeof offerResponseSchema>;
export type IntakeSubmitInput = z.infer<typeof intakeSubmitSchema>;
export type CreateTopicInput = z.infer<typeof createTopicSchema>;
export type UpdateTopicInput = z.infer<typeof updateTopicSchema>;
export type TopicTestInput = z.infer<typeof topicTestSchema>;
export type UpdateBusinessHoursInput = z.infer<typeof updateBusinessHoursSchema>;
export type CreateBusinessUserInput = z.infer<typeof createBusinessUserSchema>;
export type SetupConsultantInput = z.infer<typeof setupConsultantSchema>;
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
export type IntakeAnswersInput = z.infer<typeof intakeAnswersSchema>;
export type IntakeFormSubmitInput = z.infer<typeof intakeFormSubmitSchema>;
export type AnalyticsQueryInput = z.infer<typeof analyticsQuerySchema>;
export type FollowUpRequestInput = z.infer<typeof followUpRequestSchema>;
export type CreateIntakeFormInput = z.infer<typeof createIntakeFormSchema>;
export type UpdateIntakeFormInput = z.infer<typeof updateIntakeFormSchema>;
