import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { RedisService } from '../src/realtime/redis.service';
import { WebhookService, webhookSignature } from '../src/integrations/webhook.service';
import { WebhookTransport } from '../src/integrations/webhook-transport';
import type { AuthContext } from '../src/common/http.types';

interface Key {
  id: string;
  token: string;
}
interface Created {
  conversation: { id: string };
  message: { id: string };
}
describe('Integration API (real PostgreSQL and Redis)', () => {
  let app: NestExpressApplication;
  let server: Server;
  let prisma: PrismaService;
  let redis: RedisService;
  let owner: string;
  let otherOwner: string;
  let auth: AuthContext;
  let key: Key;
  let otherKey: Key;
  let conversationId: string;
  let webhookId: string;
  let webhookSecret: string;
  const transport = {
    validate: jest.fn().mockResolvedValue({}),
    send: jest.fn<Promise<number>, [string, string, string, string]>().mockResolvedValue(204),
  };
  async function register(): Promise<{ cookie: string; auth: AuthContext }> {
    const response = await request(server)
      .post('/api/v1/auth/register')
      .send({
        businessName: 'API Integration Test',
        displayName: 'Owner',
        email: `integration-${randomUUID()}@example.test`,
        password: 'correct-horse-battery',
        timezone: 'UTC',
      })
      .expect(201);
    const cookie = (response.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const me = await request(server).get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
    return { cookie, auth: me.body as AuthContext };
  }
  async function issue(
    cookie: string,
    scopes = [
      'conversations:read',
      'conversations:write',
      'messages:read',
      'messages:write',
      'customers:identify',
    ],
  ): Promise<Key> {
    const response = await request(server)
      .post('/api/v1/integration-settings/keys')
      .set('Cookie', cookie)
      .send({ name: 'Website', scopes })
      .expect(201);
    expect(response.headers['cache-control']).toBe('no-store');
    return response.body as Key;
  }
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WebhookTransport)
      .useValue(transport)
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureApplication(app);
    app.useLogger(false);
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    // Explicit sweeps make delivery/retry assertions deterministic.
    await app.get(WebhookService).onModuleDestroy();
    const first = await register();
    owner = first.cookie;
    auth = first.auth;
    otherOwner = (await register()).cookie;
    key = await issue(owner);
    otherKey = await issue(otherOwner);
    const response = await request(server)
      .post('/api/v1/integration-settings/webhooks')
      .set('Cookie', owner)
      .send({
        url: 'https://receiver.example.com/events',
        events: ['conversation.created', 'message.created', 'conversation.resolved'],
      })
      .expect(201);
    const endpoint = response.body as { id: string; secret: string };
    webhookId = endpoint.id;
    webhookSecret = endpoint.secret;
  }, 90_000);
  afterAll(async () => {
    await app?.close();
  });

  it('serves its specification and real middleware security headers', async () => {
    const response = await request(server).get('/api/v1/integrations/openapi.json').expect(200);
    expect(response.body).toMatchObject({ openapi: '3.1.0' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-request-id']).toBeDefined();
  });
  it('requires machine credentials, scopes and trusted management origins', async () => {
    await request(server)
      .get('/api/v1/integrations/conversations')
      .set('Cookie', owner)
      .expect(401);
    const readOnly = await issue(owner, ['conversations:read']);
    await request(server)
      .post('/api/v1/integrations/conversations')
      .auth(readOnly.token, { type: 'bearer' })
      .send({ externalId: 'x', content: 'hi' })
      .expect(403);
    await request(server)
      .post('/api/v1/integration-settings/keys')
      .set('Cookie', owner)
      .set('Origin', 'https://untrusted.example')
      .send({ name: 'Invalid', scopes: ['conversations:read'] })
      .expect(403);
  });
  it('creates a single conversation for concurrent retries and persists transactional outbox events', async () => {
    const retry = randomUUID();
    const make = (): request.Test =>
      request(server)
        .post('/api/v1/integrations/conversations')
        .auth(key.token, { type: 'bearer' })
        .set('Idempotency-Key', retry)
        .send({ externalId: 'customer-42', content: 'Hello from my website' });
    const responses = await Promise.all([make(), make()]);
    expect(responses.map((result) => result.status)).toEqual([201, 201]);
    expect(responses[0].body).toEqual(responses[1].body);
    const created = responses[0].body as Created;
    conversationId = created.conversation.id;
    expect(await prisma.message.count({ where: { id: created.message.id } })).toBe(1);
    const outbox = await prisma.webhookDelivery.findMany({ where: { endpointId: webhookId } });
    expect(outbox.some((item) => JSON.stringify(item.payload).includes(created.message.id))).toBe(
      true,
    );
    await request(server)
      .post('/api/v1/integrations/conversations')
      .auth(key.token, { type: 'bearer' })
      .set('Idempotency-Key', retry)
      .send({ externalId: 'customer-42', content: 'Different body' })
      .expect(409);
  });
  it('enforces tenant ownership on reads, writes, pagination, keys and webhooks', async () => {
    await request(server)
      .get(`/api/v1/integrations/conversations/${conversationId}`)
      .auth(otherKey.token, { type: 'bearer' })
      .expect(404);
    await request(server)
      .post(`/api/v1/integrations/conversations/${conversationId}/messages`)
      .auth(otherKey.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ content: 'wrong tenant' })
      .expect(404);
    await request(server)
      .post(`/api/v1/integration-settings/keys/${key.id}/revoke`)
      .set('Cookie', otherOwner)
      .expect(404);
    await request(server)
      .get(`/api/v1/integration-settings/webhooks/${webhookId}/deliveries`)
      .set('Cookie', otherOwner)
      .expect(404);
    const list = await request(server)
      .get('/api/v1/integrations/conversations')
      .auth(otherKey.token, { type: 'bearer' })
      .query({ cursor: conversationId })
      .expect(200);
    expect(list.body).toMatchObject({ conversations: [] });
  });
  it('attributes outbound messages to the key and rejects missing retry keys', async () => {
    await request(server)
      .post(`/api/v1/integrations/conversations/${conversationId}/messages`)
      .auth(key.token, { type: 'bearer' })
      .send({ content: 'reply' })
      .expect(400);
    const result = await request(server)
      .post(`/api/v1/integrations/conversations/${conversationId}/messages`)
      .auth(key.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ content: 'Automated reply' })
      .expect(201);
    expect(result.body).toMatchObject({ senderType: 'INTEGRATION' });
    const row = await prisma.message.findUniqueOrThrow({
      where: { id: (result.body as { id: string }).id },
    });
    expect(row.integrationKeyId).toBe(key.id);
    expect(row.senderUserId).toBeNull();
  });
  it('does not expose internal notes through message history or webhooks', async () => {
    await prisma.$transaction(async (tx) => {
      const row = await tx.conversation.update({
        where: { id: conversationId },
        data: { nextSequence: { increment: 1 } },
      });
      await tx.message.create({
        data: {
          businessId: auth.business.id,
          conversationId,
          senderType: 'AGENT',
          clientMessageId: randomUUID(),
          sequenceNumber: row.nextSequence,
          messageType: 'INTERNAL_NOTE',
          content: 'PRIVATE-NOTE-DO-NOT-EXPORT',
        },
      });
    });
    const history = await request(server)
      .get(`/api/v1/integrations/conversations/${conversationId}/messages`)
      .auth(key.token, { type: 'bearer' })
      .expect(200);
    expect(JSON.stringify(history.body)).not.toContain('PRIVATE-NOTE');
    const deliveries = await prisma.webhookDelivery.findMany({ where: { endpointId: webhookId } });
    expect(JSON.stringify(deliveries)).not.toContain('PRIVATE-NOTE');
  });
  it('rolls back outbox events with their original database transaction', async () => {
    const id = randomUUID();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.conversation.create({ data: { id, businessId: auth.business.id } });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await prisma.conversation.findUnique({ where: { id } })).toBeNull();
    expect(
      JSON.stringify(await prisma.webhookDelivery.findMany({ where: { endpointId: webhookId } })),
    ).not.toContain(id);
  });
  it('signs deliveries, persists failures and replays with a stable event id', async () => {
    const service = app.get(WebhookService);
    transport.send.mockResolvedValue(500);
    await service.sweep();
    const delivery = await prisma.webhookDelivery.findFirstOrThrow({
      where: { endpointId: webhookId, attempts: { gt: 0 } },
    });
    expect(delivery.lastStatus).toBe(500);
    expect(delivery.deliveredAt).toBeNull();
    const call = transport.send.mock.calls.find((args) => args[3] === delivery.eventId)!;
    const timestamp = Number(call[2].match(/t=(\d+)/)![1]);
    expect(call[2]).toBe(webhookSignature(webhookSecret, call[1], timestamp));
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { attempts: 10, nextAttemptAt: new Date(0) },
    });
    await service.sweep();
    await request(server)
      .post(`/api/v1/integration-settings/deliveries/${delivery.id}/replay`)
      .set('Cookie', otherOwner)
      .expect(404);
    await request(server)
      .post(`/api/v1/integration-settings/deliveries/${delivery.id}/replay`)
      .set('Cookie', owner)
      .expect(204);
    transport.send.mockResolvedValue(204);
    await service.sweep();
    const delivered = await prisma.webhookDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    expect(delivered.eventId).toBe(delivery.eventId);
    expect(delivered.deliveredAt).not.toBeNull();
  });
  it('issues tenant-bound identity proofs and resumes that customer in the widget', async () => {
    // Domains are unique across tenants; a previous run against the same database may own it.
    await prisma.businessDomain.deleteMany({ where: { domain: 'localhost' } });
    await prisma.businessDomain.create({
      data: {
        businessId: auth.business.id,
        domain: 'localhost',
        status: 'VERIFIED',
        verificationTokenHash: 'test-hash',
      },
    });
    const issued = await request(server)
      .post('/api/v1/integrations/customers/identify')
      .auth(key.token, { type: 'bearer' })
      .send({ externalId: 'customer-42' })
      .expect(201);
    const proof = (issued.body as { identityToken: string }).identityToken;
    const bootstrap = await request(server)
      .post('/api/v1/widget/bootstrap')
      .set('Origin', 'http://localhost:3000')
      .send({ businessPublicId: auth.business.publicId, identityToken: proof })
      .expect(201);
    expect(bootstrap.body).toMatchObject({ conversationId });
    await request(server)
      .post('/api/v1/widget/bootstrap')
      .set('Origin', 'http://localhost:3000')
      .send({ businessPublicId: auth.business.publicId, identityToken: `${proof}x` })
      .expect(401);
    const foreign = await request(server)
      .post('/api/v1/integrations/customers/identify')
      .auth(otherKey.token, { type: 'bearer' })
      .send({ externalId: 'customer-42' })
      .expect(201);
    await request(server)
      .post('/api/v1/widget/bootstrap')
      .set('Origin', 'http://localhost:3000')
      .send({
        businessPublicId: auth.business.publicId,
        identityToken: (foreign.body as { identityToken: string }).identityToken,
      })
      .expect(401);
  });
  it('resolves the conversation, removes queued work, and blocks subsequent sends', async () => {
    await request(server)
      .post(`/api/v1/integrations/conversations/${conversationId}/resolve`)
      .auth(key.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(200);
    expect(
      (await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).status,
    ).toBe('RESOLVED');
    expect(
      await prisma.conversationQueueEntry.count({ where: { conversationId, removedAt: null } }),
    ).toBe(0);
    await request(server)
      .post(`/api/v1/integrations/conversations/${conversationId}/messages`)
      .auth(key.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ content: 'too late' })
      .expect(409);
  });
  it('applies machine-key quotas and returns a retry hint', async () => {
    await redis.set(`integration:{${auth.business.id}}:key:${key.id}`, '120', 'EX', 60);
    const response = await request(server)
      .get('/api/v1/integrations/conversations')
      .auth(key.token, { type: 'bearer' })
      .expect(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    await redis.del(`integration:{${auth.business.id}}:key:${key.id}`);
  });
  it('lists only key metadata, rotates atomically, rejects revoked and expired keys', async () => {
    const list = await request(server)
      .get('/api/v1/integration-settings/keys')
      .set('Cookie', owner)
      .expect(200);
    expect(JSON.stringify(list.body)).not.toContain(key.token);
    expect(JSON.stringify(list.body)).not.toContain('tokenHash');
    const rotated = await request(server)
      .post(`/api/v1/integration-settings/keys/${key.id}/rotate`)
      .set('Cookie', owner)
      .expect(201);
    await request(server)
      .get('/api/v1/integrations/conversations')
      .auth(key.token, { type: 'bearer' })
      .expect(401);
    const newKey = rotated.body as Key;
    await request(server)
      .get('/api/v1/integrations/conversations')
      .auth(newKey.token, { type: 'bearer' })
      .expect(200);
    await prisma.integrationKey.update({
      where: { id: newKey.id },
      data: { expiresAt: new Date(0) },
    });
    await request(server)
      .get('/api/v1/integrations/conversations')
      .auth(newKey.token, { type: 'bearer' })
      .expect(401);
  });
});
