import { isIP } from 'node:net';
import { z } from 'zod';

const trustedProxySchema = z
  .string()
  .default('')
  .superRefine((value, context) => {
    const entries = value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    for (const entry of entries) {
      if (!isValidProxyEntry(entry)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${entry}" is not a valid IP address or CIDR range`,
        });
      }
    }
  });

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    SESSION_SECRET: z.string().min(32),
    WIDGET_TOKEN_SECRET: z.string().min(32),
    SESSION_TTL_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 90)
      .default(168),
    WIDGET_SESSION_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
    AGENT_PRESENCE_TTL_SECONDS: z.coerce.number().int().min(15).max(300).default(45),
    TYPING_TTL_SECONDS: z.coerce.number().int().min(3).max(30).default(6),
    RELIABILITY_SWEEP_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(5_000),
    RELIABILITY_RETRY_BASE_MS: z.coerce.number().int().min(250).max(60_000).default(1_000),
    // Retention deletes are not urgent; hourly keeps each run small.
    RETENTION_SWEEP_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(86_400_000)
      .default(3_600_000),
    QUEUE_ABANDON_AFTER_SECONDS: z.coerce.number().int().min(30).max(3_600).default(120),
    // Assignment mode stored for newly registered businesses; existing ones keep theirs.
    NEW_TENANT_ASSIGNMENT_MODE: z.enum(['AUTO', 'OFFER']).default('OFFER'),
    SOCKET_REDIS_ADAPTER_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    APP_URL: z.string().url(),
    DASHBOARD_URL: z.string().url(),
    ALLOWED_DEV_ORIGINS: z.string().default(''),
    ATTACHMENT_STORAGE_PATH: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine(
        (value) => !value.includes('\0'),
        'ATTACHMENT_STORAGE_PATH must not contain NUL bytes',
      )
      .default('var/attachments'),
    ATTACHMENT_STORAGE_DRIVER: z.enum(['filesystem', 's3']).default('filesystem'),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().trim().min(1).max(64).default('us-east-1'),
    S3_BUCKET: z.string().trim().min(1).max(63).optional(),
    S3_ACCESS_KEY_ID: z.string().trim().min(1).max(256).optional(),
    S3_SECRET_ACCESS_KEY: z.string().trim().min(1).max(512).optional(),
    S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    S3_ALLOW_INSECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    S3_SERVER_SIDE_ENCRYPTION: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    S3_PREFIX: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[\w!\-.*'()/]+$/, 'S3_PREFIX contains unsupported characters')
      .default('attachments'),
    ATTACHMENT_SCANNER: z.enum(['clamav', 'disabled']).default('disabled'),
    CLAMAV_HOST: z.string().trim().min(1).max(255).default('127.0.0.1'),
    CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
    CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(250).max(60_000).default(10_000),
    TRUSTED_PROXIES: trustedProxySchema,
    THROTTLER_FAIL_MODE: z.enum(['open', 'closed']).optional(),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
    EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
    SMTP_HOST: z.string().trim().min(1).max(255).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    SMTP_USER: z.string().trim().max(255).optional(),
    SMTP_PASSWORD: z.string().max(512).optional(),
    SMTP_FROM: z.string().trim().min(3).max(320).default('BizChat <no-reply@bizchat.local>'),
  })
  .superRefine((environment, context) => {
    if (environment.ATTACHMENT_STORAGE_DRIVER === 's3') {
      for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!environment[key]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when ATTACHMENT_STORAGE_DRIVER is s3`,
          });
        }
      }
    }

    if (environment.NODE_ENV !== 'production') return;

    const knownPlaceholder = (value: string): boolean => value.startsWith('replace-with-');
    if (knownPlaceholder(environment.SESSION_SECRET)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SESSION_SECRET'],
        message: 'Production SESSION_SECRET must not use the documented placeholder',
      });
    }
    if (knownPlaceholder(environment.WIDGET_TOKEN_SECRET)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WIDGET_TOKEN_SECRET'],
        message: 'Production WIDGET_TOKEN_SECRET must not use the documented placeholder',
      });
    }
    if (environment.SESSION_SECRET === environment.WIDGET_TOKEN_SECRET) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WIDGET_TOKEN_SECRET'],
        message: 'Session and widget secrets must be different',
      });
    }
    if (!environment.APP_URL.startsWith('https://')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_URL'],
        message: 'Production APP_URL must use HTTPS',
      });
    }
    if (!environment.DASHBOARD_URL.startsWith('https://')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DASHBOARD_URL'],
        message: 'Production DASHBOARD_URL must use HTTPS',
      });
    }
    if (environment.ALLOWED_DEV_ORIGINS.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ALLOWED_DEV_ORIGINS'],
        message: 'Development origins must be empty in production',
      });
    }
    if (!environment.SOCKET_REDIS_ADAPTER_ENABLED) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SOCKET_REDIS_ADAPTER_ENABLED'],
        message: 'Production deployments must enable the Socket.IO Redis adapter',
      });
    }
    if (environment.ATTACHMENT_STORAGE_DRIVER !== 's3') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ATTACHMENT_STORAGE_DRIVER'],
        message: 'Production attachments must use s3 object storage',
      });
    }
    if (environment.ATTACHMENT_SCANNER !== 'clamav') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ATTACHMENT_SCANNER'],
        message: 'Production attachments must be scanned for malware',
      });
    }
    if (environment.S3_ENDPOINT && environment.S3_ENDPOINT.startsWith('http://')) {
      const loopback = /https?:\/\/(127\.0\.0\.1|localhost|\[::1]|0\.0\.0\.0)(:\d+)?/.test(
        environment.S3_ENDPOINT,
      );
      if (!loopback && !environment.S3_ALLOW_INSECURE) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['S3_ENDPOINT'],
          message:
            'Production S3_ENDPOINT must use HTTPS unless it targets a loopback address or S3_ALLOW_INSECURE is true',
        });
      }
    }
    if (!environment.SMTP_HOST) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_HOST'],
        message: 'Production requires SMTP_HOST so password reset and verification email works',
      });
    }
    if (environment.THROTTLER_FAIL_MODE === 'open') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['THROTTLER_FAIL_MODE'],
        message: 'Production rate limiting must fail closed when Redis is unavailable',
      });
    }
  });

export function resolveThrottlerFailMode(
  environment: Pick<Environment, 'NODE_ENV' | 'THROTTLER_FAIL_MODE'>,
): 'open' | 'closed' {
  if (environment.THROTTLER_FAIL_MODE) return environment.THROTTLER_FAIL_MODE;
  return environment.NODE_ENV === 'production' ? 'closed' : 'open';
}

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(input: Record<string, unknown>): Environment {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${result.error.message}`);
  }
  return result.data;
}

export function isValidProxyEntry(entry: string): boolean {
  if (!entry || entry.includes('*')) return false;
  const [address, prefix, ...rest] = entry.split('/');
  if (rest.length > 0 || !address) return false;
  const version = isIP(address);
  if (version === 0) return false;
  if (prefix === undefined) return true;
  if (prefix === '' || !/^\d+$/.test(prefix)) return false;
  const value = Number(prefix);
  return version === 4 ? value <= 32 : value <= 128;
}

export function parseTrustedProxies(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
