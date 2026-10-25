import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  BusinessHoursResponse,
  DepartmentResponse,
  IntakeFormResponse,
  IntegrationAvailabilityResponse,
  RoutingSettingsResponse,
  SkillResponse,
  TopicResponse,
  TopicTestResponse,
} from '@bizchat/types';

/**
 * Server-side client for the BizChat integration API. Never ship an API key to a browser: issue a
 * customer identity proof on your server and pass that to `window.BizChat.identify` instead.
 */
export interface BizChatClientOptions {
  /** A `bzc_...` key from Dashboard → Integrations. */
  apiKey: string;
  /** For example `https://api.example.com`; the `/api/v1/integrations` prefix is added. */
  baseUrl: string;
  /** Retries for rate limits, unavailability, and network failures. Default 2. */
  maxRetries?: number;
  /** Per-attempt timeout in milliseconds. Default 15 000. */
  timeoutMs?: number;
  /** For tests or custom transports; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

export interface WriteOptions {
  /**
   * Reuse the same key when retrying the same action later (for example from a job queue). The
   * client generates one per call otherwise and reuses it across its own retries.
   */
  idempotencyKey?: string;
}

export class BizChatError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'BizChatError';
  }
}

export type ConversationStatus =
  | 'NEW'
  | 'QUEUED'
  | 'OFFERED'
  | 'ASSIGNED'
  | 'ACTIVE'
  | 'WAITING_FOR_CUSTOMER'
  | 'WAITING_FOR_AGENT'
  | 'RESOLVED'
  | 'CLOSED';

export interface IntegrationConversation {
  id: string;
  status: ConversationStatus;
  source: string;
  subject: string | null;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  departmentId: string | null;
  topicId: string | null;
  overflowLevel: number;
  followUpRequested: boolean;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  /** Present only for keys with `intake:read`. */
  intake?: unknown;
  followUp?: { requestedAt: string; contact: Record<string, string | null> } | null;
}

export interface IntegrationMessage {
  id: string;
  conversationId: string;
  sequenceNumber: string;
  senderType: 'VISITOR' | 'CUSTOMER' | 'AGENT' | 'SYSTEM' | 'INTEGRATION';
  integrationKeyId: string | null;
  messageType: string;
  content: string | null;
  createdAt: string;
}

export interface StartConversationInput {
  externalId: string;
  content: string;
  subject?: string;
  departmentPublicId?: string;
  topicPublicId?: string;
  intake?: { answers: Record<string, string>; consent?: boolean };
}

export interface SetupConsultant {
  membershipId: string;
  displayName: string;
  email: string;
  role: string;
  status: string;
  maxConcurrentChats: number;
  routingEnabled: boolean;
  departmentIds: string[];
  skills: { skillId: string; proficiency: number }[];
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT';
type Body = Record<string, unknown>;

const RETRYABLE = new Set([429, 502, 503, 504]);

export class BizChatClient {
  private readonly root: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  public constructor(private readonly options: BizChatClientOptions) {
    if (!/^bzc_/.test(options.apiKey)) throw new Error('apiKey must be a bzc_ integration key');
    this.root = `${options.baseUrl.replace(/\/+$/, '')}/api/v1/integrations`;
    this.maxRetries = options.maxRetries ?? 2;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetcher = options.fetch ?? fetch;
  }

  public readonly conversations = {
    list: (query: { cursor?: string; limit?: number } = {}) =>
      this.request<{ conversations: IntegrationConversation[]; nextCursor: string | null }>(
        'GET',
        `/conversations${search(query)}`,
      ),
    get: (id: string) => this.request<IntegrationConversation>('GET', `/conversations/${id}`),
    messages: (id: string, query: { afterSequence?: string; limit?: number } = {}) =>
      this.request<{ messages: IntegrationMessage[]; hasMore: boolean; nextSequence: string }>(
        'GET',
        `/conversations/${id}/messages${search(query)}`,
      ),
    create: (input: StartConversationInput, options: WriteOptions = {}) =>
      this.request<{ conversation: IntegrationConversation; message: IntegrationMessage }>(
        'POST',
        '/conversations',
        input as unknown as Body,
        options.idempotencyKey ?? randomUUID(),
      ),
    send: (id: string, content: string, options: WriteOptions = {}) =>
      this.request<IntegrationMessage>(
        'POST',
        `/conversations/${id}/messages`,
        { content },
        options.idempotencyKey ?? randomUUID(),
      ),
    resolve: (id: string, input: { reason?: string } = {}, options: WriteOptions = {}) =>
      this.request<IntegrationConversation>(
        'POST',
        `/conversations/${id}/resolve`,
        input,
        options.idempotencyKey ?? randomUUID(),
      ),
  };

  public readonly customers = {
    /** A five-minute proof for `window.BizChat.identify`; return it only to that customer. */
    identify: (input: { externalId: string; name?: string; email?: string }) =>
      this.request<{ identityToken: string; expiresAt: string }>(
        'POST',
        '/customers/identify',
        input,
      ),
  };

  public availability(): Promise<IntegrationAvailabilityResponse> {
    return this.request('GET', '/availability');
  }

  public readonly setup = {
    departments: this.resource<DepartmentResponse>('departments'),
    skills: this.resource<SkillResponse>('skills'),
    topics: {
      ...this.resource<TopicResponse>('topics'),
      test: (message: string) =>
        this.request<TopicTestResponse>('POST', '/setup/topics/test', { message }),
    },
    intakeForms: this.resource<IntakeFormResponse>('intake-forms'),
    routingSettings: {
      get: () => this.request<RoutingSettingsResponse>('GET', '/setup/routing-settings'),
      update: (input: Body) =>
        this.request<RoutingSettingsResponse>('PUT', '/setup/routing-settings', input),
    },
    businessHours: {
      get: () => this.request<BusinessHoursResponse>('GET', '/setup/business-hours'),
      update: (input: {
        hours: { weekday: number; openingTime: string; closingTime: string; isClosed: boolean }[];
      }) => this.request<BusinessHoursResponse>('PUT', '/setup/business-hours', input),
    },
    consultants: {
      list: () => this.request<SetupConsultant[]>('GET', '/setup/consultants'),
      update: (
        membershipId: string,
        input: {
          departmentIds?: string[];
          skills?: { skillId: string; proficiency: number }[];
          maxConcurrentChats?: number;
          routingEnabled?: boolean;
        },
      ) => this.request<SetupConsultant>('PATCH', `/setup/consultants/${membershipId}`, input),
    },
  };

  private resource<T>(path: string): {
    list: () => Promise<T[]>;
    create: (input: Body) => Promise<T>;
    update: (id: string, input: Body) => Promise<T>;
  } {
    return {
      list: () => this.request<T[]>('GET', `/setup/${path}`),
      create: (input) => this.request<T>('POST', `/setup/${path}`, input),
      update: (id, input) => this.request<T>('PATCH', `/setup/${path}/${id}`, input),
    };
  }

  /**
   * Reads, and writes carrying an idempotency key, are retried; other writes are not, because a
   * retry after a lost response could apply them twice.
   */
  private async request<T>(
    method: Method,
    path: string,
    body?: Body,
    idempotencyKey?: string,
  ): Promise<T> {
    const retryable = method === 'GET' || idempotencyKey !== undefined;
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(`${this.root}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${this.options.apiKey}`,
            accept: 'application/json',
            ...(body ? { 'content-type': 'application/json' } : {}),
            ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (cause) {
        if (retryable && attempt < this.maxRetries) {
          await delay(backoff(attempt));
          continue;
        }
        throw new BizChatError(0, 'NETWORK_ERROR', messageOf(cause));
      }
      if (response.ok) return (await response.json()) as T;
      if (retryable && RETRYABLE.has(response.status) && attempt < this.maxRetries) {
        await delay(retryAfter(response) ?? backoff(attempt));
        continue;
      }
      throw await errorFrom(response);
    }
  }
}

function search(query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined) params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** Exponential backoff with full jitter: up to 0.5 s, 1 s, 2 s... capped at 8 s. */
export function backoff(attempt: number, random = Math.random): number {
  return Math.round(random() * Math.min(8_000, 500 * 2 ** attempt));
}

function retryAfter(response: Response): number | undefined {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.min(seconds, 60) * 1_000 : undefined;
}

async function errorFrom(response: Response): Promise<BizChatError> {
  const body = (await response.json().catch(() => undefined)) as
    | { error?: { code?: string; message?: string; requestId?: string; details?: unknown } }
    | undefined;
  return new BizChatError(
    response.status,
    body?.error?.code ?? `HTTP_${response.status}`,
    body?.error?.message ?? response.statusText,
    body?.error?.requestId ?? response.headers.get('x-request-id') ?? undefined,
    body?.error?.details,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Request failed';
}

export type WebhookEventType =
  | 'conversation.created'
  | 'message.created'
  | 'conversation.resolved'
  | 'conversation.queued'
  | 'conversation.offered'
  | 'conversation.assigned'
  | 'conversation.overflowed'
  | 'conversation.follow_up_requested'
  | 'conversation.closed';

export interface WebhookEvent<T = Record<string, unknown>> {
  id: string;
  type: WebhookEventType;
  version: string;
  createdAt: string;
  data: T;
}

export interface VerifyWebhookInput {
  /** The exact request body bytes, before any JSON parsing. */
  rawBody: string | Buffer;
  /** The `X-BizChat-Signature` header. */
  signature: string | undefined | null;
  /** The endpoint's `whsec_...` signing secret. */
  secret: string;
  /** Accepted clock difference. Default 300 seconds. */
  toleranceSeconds?: number;
  /** For tests. */
  now?: Date;
}

/** Checks the timestamp window and the HMAC with a constant-time comparison. */
export function verifyWebhook(input: VerifyWebhookInput): boolean {
  const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(input.signature ?? '');
  if (!match) return false;
  const now = (input.now ?? new Date()).getTime() / 1_000;
  if (Math.abs(now - Number(match[1])) > (input.toleranceSeconds ?? 300)) return false;
  const expected = createHmac('sha256', input.secret)
    .update(`${match[1]}.`)
    .update(input.rawBody)
    .digest();
  return timingSafeEqual(expected, Buffer.from(match[2]!, 'hex'));
}

/** Verifies, then parses. Throws for a bad signature, so unverified bodies are never used. */
export function parseWebhook<T = Record<string, unknown>>(
  input: VerifyWebhookInput,
): WebhookEvent<T> {
  if (!verifyWebhook(input))
    throw new BizChatError(401, 'WEBHOOK_SIGNATURE_INVALID', 'Webhook signature check failed');
  return JSON.parse(input.rawBody.toString()) as WebhookEvent<T>;
}
