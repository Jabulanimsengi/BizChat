import { z } from 'zod';
import { identifySchema, startSchema, sendSchema, resolveSchema } from './integration.contracts';

// Keep request documentation generated from the same contracts used by validation.
function schema(value: z.ZodTypeAny): object {
  if (value instanceof z.ZodOptional) return schema(value.unwrap() as z.ZodTypeAny);
  if (value instanceof z.ZodString) {
    const result: Record<string, unknown> = { type: 'string' };
    for (const check of value._def.checks) {
      if (check.kind === 'min') result.minLength = check.value;
      if (check.kind === 'max') result.maxLength = check.value;
    }
    return result;
  }
  if (value instanceof z.ZodBoolean) return { type: 'boolean' };
  // Pre-chat answers: string values keyed by the form's field keys.
  if (value instanceof z.ZodRecord)
    return { type: 'object', additionalProperties: schema(value.valueSchema as z.ZodTypeAny) };
  if (value instanceof z.ZodObject) {
    const shape = value.shape as Record<string, z.ZodTypeAny>;
    return {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        Object.entries(shape).map(([key, item]) => [key, schema(item)]),
      ),
      required: Object.entries(shape)
        .filter(([, item]) => !item.isOptional())
        .map(([key]) => key),
    };
  }
  throw new Error('Unsupported OpenAPI contract type');
}
const id = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const retry = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  description: 'Unique per tenant for 30 days; reuse only for the same operation and body.',
  schema: { type: 'string', pattern: '^[A-Za-z0-9_.:-]{8,128}$' },
};
const limit = {
  name: 'limit',
  in: 'query',
  schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
};
const errors = Object.fromEntries(
  [400, 401, 403, 404, 409, 429, 503].map((code) => [
    String(code),
    {
      description: `Request failed (${code}); 429 includes Retry-After.`,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    },
  ]),
);
function operation(
  summary: string,
  scope: string,
  response: object,
  parameters: object[] = [],
  body?: string,
  status = '200',
): object {
  return {
    summary,
    description: `Required scope: ${scope}. Tenant is derived from the bearer token.`,
    security: [{ IntegrationKey: [] }],
    parameters,
    ...(body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: `#/components/schemas/${body}` } } },
          },
        }
      : {}),
    responses: {
      ...errors,
      [status]: { description: 'Success', content: { 'application/json': { schema: response } } },
    },
  };
}
const ref = (name: string): object => ({ $ref: `#/components/schemas/${name}` });

/** Setup API: the dashboard's configuration contracts, for keys with setup:read or setup:write. */
const anyBody = { type: 'object', description: 'See docs/api/setup.md for the fields.' };
function setupOperation(summary: string, write: boolean, status = '200'): object {
  return {
    ...operation(summary, write ? 'setup:write' : 'setup:read', anyBody, [], undefined, status),
    ...(write
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: anyBody } },
          },
        }
      : {}),
  };
}
const setupId = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};
const setupPaths: Record<string, object> = Object.fromEntries(
  (['departments', 'skills', 'topics', 'intake-forms'] as const).flatMap(
    (resource): [string, object][] => [
      [
        `/setup/${resource}`,
        {
          get: setupOperation(`List ${resource}`, false),
          post: setupOperation(`Create one of the ${resource}`, true, '201'),
        },
      ],
      [
        `/setup/${resource}/{id}`,
        {
          patch: {
            ...setupOperation(`Update one of the ${resource}`, true),
            parameters: [setupId],
          },
        },
      ],
    ],
  ),
);
export const integrationOpenApi = {
  openapi: '3.1.0',
  info: {
    title: 'BizChat Integration API',
    version: '1.0.0',
    description:
      'Server-to-server API. Create keys and webhook subscriptions in Dashboard → Integrations. Browser secrets are prohibited. Quotas: 120 requests/key/minute, 600/tenant/minute, plus shared IP abuse limits.',
  },
  servers: [{ url: '/api/v1/integrations' }],
  paths: {
    '/conversations': {
      get: operation(
        'List conversations',
        'conversations:read',
        {
          type: 'object',
          properties: {
            conversations: { type: 'array', items: ref('Conversation') },
            nextCursor: { type: ['string', 'null'] },
          },
        },
        [limit, { name: 'cursor', in: 'query', schema: { type: 'string', format: 'uuid' } }],
      ),
      post: operation(
        'Create a customer conversation and initial inbound message',
        'conversations:write',
        {
          type: 'object',
          properties: { conversation: ref('Conversation'), message: ref('Message') },
        },
        [retry],
        'Start',
        '201',
      ),
    },
    '/conversations/{id}': {
      get: operation('Read a conversation', 'conversations:read', ref('Conversation'), [id]),
    },
    '/conversations/{id}/messages': {
      get: operation(
        'Read public messages in ascending sequence order',
        'messages:read',
        {
          type: 'object',
          properties: {
            messages: { type: 'array', items: ref('Message') },
            hasMore: { type: 'boolean' },
            nextSequence: { type: 'string' },
          },
        },
        [
          id,
          limit,
          {
            name: 'afterSequence',
            in: 'query',
            schema: { type: 'string', pattern: '^\\d{1,18}$', default: '0' },
          },
        ],
      ),
      post: operation(
        'Send an outbound message attributed to the integration',
        'messages:write',
        ref('Message'),
        [id, retry],
        'Send',
        '201',
      ),
    },
    '/conversations/{id}/resolve': {
      post: operation(
        'Resolve and release routing capacity',
        'conversations:write',
        ref('Conversation'),
        [id, retry],
        'Resolve',
      ),
    },
    '/availability': {
      get: operation(
        'Whether a new chat would reach a consultant now, overall and per department',
        'availability:read',
        {
          type: 'object',
          required: ['open', 'availability', 'onlineAgents', 'availableAgents', 'departments'],
          properties: {
            open: {
              type: 'boolean',
              description: 'Inside business hours (always true without hours)',
            },
            availability: { type: 'string', enum: ['ONLINE', 'OFFLINE'] },
            onlineAgents: { type: 'integer' },
            availableAgents: { type: 'integer', description: 'Online and below their chat limit' },
            departments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  publicId: { type: 'string' },
                  name: { type: 'string' },
                  onlineAgents: { type: 'integer' },
                  availableAgents: { type: 'integer' },
                },
              },
            },
            checkedAt: { type: 'string', format: 'date-time' },
          },
        },
      ),
    },
    ...setupPaths,
    '/setup/topics/test': {
      post: setupOperation('Preview how a message would be classified', false),
    },
    '/setup/routing-settings': {
      get: setupOperation('Read routing settings', false),
      put: setupOperation('Update routing settings', true),
    },
    '/setup/business-hours': {
      get: setupOperation('Read business hours', false),
      put: setupOperation('Replace the weekly business hours', true),
    },
    '/setup/consultants': {
      get: setupOperation('List consultants and how they are routed', false),
    },
    '/setup/consultants/{id}': {
      patch: {
        ...setupOperation(
          "Set a consultant's departments, skills, capacity, or routing switch",
          true,
        ),
        parameters: [setupId],
      },
    },
    '/customers/identify': {
      post: operation(
        'Issue a five-minute customer identity proof',
        'customers:identify',
        {
          type: 'object',
          required: ['identityToken', 'expiresAt'],
          properties: {
            identityToken: { type: 'string' },
            expiresAt: { type: 'string', format: 'date-time' },
          },
        },
        [],
        'Customer',
        '201',
      ),
    },
  },
  components: {
    securitySchemes: {
      IntegrationKey: { type: 'http', scheme: 'bearer', bearerFormat: 'bzc_<secret>' },
    },
    schemas: {
      Customer: schema(identifySchema),
      Start: schema(startSchema),
      Send: schema(sendSchema),
      Resolve: schema(resolveSchema),
      Conversation: {
        type: 'object',
        required: ['id', 'status', 'source', 'createdAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          status: {
            type: 'string',
            enum: [
              'NEW',
              'QUEUED',
              'OFFERED',
              'ASSIGNED',
              'ACTIVE',
              'WAITING_FOR_CUSTOMER',
              'WAITING_FOR_AGENT',
              'RESOLVED',
              'CLOSED',
            ],
          },
          source: { type: 'string' },
          subject: { type: ['string', 'null'] },
          priority: { type: 'string', enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] },
          departmentId: { type: ['string', 'null'], format: 'uuid' },
          topicId: { type: ['string', 'null'], format: 'uuid' },
          overflowLevel: { type: 'integer' },
          followUpRequested: { type: 'boolean' },
          followUp: {
            type: ['object', 'null'],
            description: 'With intake:read only: when and how the visitor asked to be contacted',
          },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          resolvedAt: { type: ['string', 'null'], format: 'date-time' },
        },
      },
      Message: {
        type: 'object',
        required: [
          'id',
          'conversationId',
          'sequenceNumber',
          'senderType',
          'messageType',
          'content',
          'createdAt',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          conversationId: { type: 'string', format: 'uuid' },
          sequenceNumber: {
            type: 'string',
            description: '64-bit sequence serialized as a decimal string',
          },
          senderType: {
            type: 'string',
            enum: ['VISITOR', 'CUSTOMER', 'AGENT', 'SYSTEM', 'INTEGRATION'],
          },
          integrationKeyId: { type: ['string', 'null'], format: 'uuid' },
          messageType: { type: 'string' },
          content: { type: ['string', 'null'] },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              requestId: { type: 'string' },
            },
          },
        },
      },
    },
  },
};
