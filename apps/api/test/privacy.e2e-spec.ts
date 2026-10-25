import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { VisitorDataExport, VisitorErasureResponse } from '@bizchat/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-app';
import {
  ATTACHMENT_OBJECT_STORE,
  type AttachmentObjectStore,
} from '../src/attachments/attachment-object-store';
import { PrismaService } from '../src/database/prisma.service';
import { WebhookService } from '../src/integrations/webhook.service';
import { WebhookTransport } from '../src/integrations/webhook-transport';
import { PrivacyService } from '../src/privacy/privacy.service';
import { RedisService } from '../src/realtime/redis.service';

describe('Privacy: retention, access, and erasure (real PostgreSQL and Redis)', () => {
  let app: NestExpressApplication;
  let server: Server;
  let prisma: PrismaService;
  let redis: RedisService;
  let objects: AttachmentObjectStore;
  let owner: string;
  let otherOwner: string;
  let businessId: string;
  let token: string;

  async function register(): Promise<string> {
    const response = await request(server)
      .post('/api/v1/auth/register')
      .send({
        businessName: 'Privacy Test',
        displayName: 'Owner',
        email: `privacy-${randomUUID()}@example.test`,
        password: 'correct-horse-battery',
        timezone: 'UTC',
      })
      .expect(201);
    return (response.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  }

  async function resetThrottles(): Promise<void> {
    const keys = await redis.keys('bizchat:throttle:*');
    if (keys.length) await redis.del(...keys);
  }

  const api = (method: 'get' | 'post', path: string): request.Test =>
    request(server)[method](`/api/v1/integrations${path}`).auth(token, { type: 'bearer' });

  /** A customer conversation through the API, with an attachment object and a webhook copy. */
  async function customerConversation(externalId: string): Promise<{
    conversationId: string;
    storageKey: string;
  }> {
    const created = (
      await api('post', '/conversations')
        .set('Idempotency-Key', randomUUID())
        .send({ externalId, content: 'My ID number is 8001015009087' })
        .expect(201)
    ).body as { conversation: { id: string } };
    const conversationId = created.conversation.id;
    const storageKey = `attachments/${randomUUID()}`;
    await objects.put(storageKey, Buffer.from('certified copy'), 'text/plain');
    await prisma.attachment.create({
      data: {
        businessId,
        conversationId,
        uploadedByType: 'VISITOR',
        uploadedById: randomUUID(),
        originalFileName: 'id-copy.txt',
        storageKey,
        mimeType: 'text/plain',
        sizeBytes: 14,
        sha256: '0'.repeat(64),
        status: 'READY',
      },
    });
    await prisma.message.create({
      data: {
        businessId,
        conversationId,
        senderType: 'AGENT',
        messageType: 'INTERNAL_NOTE',
        clientMessageId: randomUUID(),
        sequenceNumber: 99n,
        content: 'staff only note',
      },
    });
    return { conversationId, storageKey };
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WebhookTransport)
      .useValue({ validate: jest.fn().mockResolvedValue({}), send: jest.fn() })
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureApplication(app);
    app.useLogger(false);
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    objects = app.get(ATTACHMENT_OBJECT_STORE);
    await app.get(WebhookService).onModuleDestroy();
    await resetThrottles();
    owner = await register();
    otherOwner = await register();
    businessId = (
      (await request(server).get('/api/v1/auth/me').set('Cookie', owner).expect(200)).body as {
        business: { id: string };
      }
    ).business.id;
    token = (
      (
        await request(server)
          .post('/api/v1/integration-settings/keys')
          .set('Cookie', owner)
          .send({
            name: 'Privacy',
            scopes: ['conversations:write', 'privacy:read', 'privacy:write'],
          })
          .expect(201)
      ).body as { token: string }
    ).token;
    // A subscribed endpoint, so message content is copied into the webhook outbox.
    await request(server)
      .post('/api/v1/integration-settings/webhooks')
      .set('Cookie', owner)
      .send({ url: 'https://receiver.example.com/privacy', events: ['message.created'] })
      .expect(201);
  }, 90_000);

  afterAll(async () => {
    await resetThrottles();
    await app?.close();
  });

  it('validates the retention setting', async () => {
    await request(server)
      .get('/api/v1/privacy/settings')
      .set('Cookie', owner)
      .expect(200, { conversationRetentionDays: null });
    await request(server)
      .put('/api/v1/privacy/settings')
      .set('Cookie', owner)
      .send({ conversationRetentionDays: 7 })
      .expect(400);
    await request(server)
      .put('/api/v1/privacy/settings')
      .set('Cookie', owner)
      .send({ conversationRetentionDays: 90 })
      .expect(200, { conversationRetentionDays: 90 });
  });

  it('exports a customer’s data without staff notes, then erases all of it', async () => {
    const externalId = `customer-${randomUUID()}`;
    const { conversationId, storageKey } = await customerConversation(externalId);

    const exported = (
      await api('post', '/privacy/customers/export').send({ externalId }).expect(200)
    ).body as VisitorDataExport;
    expect(exported.customer).toMatchObject({ externalId });
    expect(exported.conversations).toHaveLength(1);
    expect(exported.conversations[0]!.messages.map(({ content }) => content)).toEqual([
      'My ID number is 8001015009087',
    ]);
    expect(exported.conversations[0]!.attachments).toEqual([
      expect.objectContaining({ originalFileName: 'id-copy.txt' }),
    ]);

    // An open conversation blocks erasure, and the request must confirm explicitly.
    await api('post', '/privacy/customers/erase').send({ externalId, confirm: true }).expect(409);
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    await api('post', '/privacy/customers/erase').send({ externalId }).expect(400);
    const erased = (
      await api('post', '/privacy/customers/erase').send({ externalId, confirm: true }).expect(200)
    ).body as VisitorErasureResponse;
    expect(erased).toMatchObject({ conversationsDeleted: 1, attachmentsDeleted: 1 });

    expect(await prisma.conversation.count({ where: { id: conversationId } })).toBe(0);
    expect(await prisma.visitor.count({ where: { id: erased.visitorId } })).toBe(0);
    expect(await prisma.integrationCustomer.count({ where: { externalId } })).toBe(0);
    await expect(objects.get(storageKey)).rejects.toThrow();
    const leftovers = [
      ...(await prisma.webhookDelivery.findMany({ select: { payload: true } })),
      ...(await prisma.integrationRequest.findMany({ where: { businessId } })),
    ];
    // Copies of the content held for webhook retries and idempotent replays go too.
    expect(JSON.stringify(leftovers)).not.toContain(conversationId);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'privacy.visitor_erased', targetId: erased.visitorId },
    });
    expect(JSON.stringify(audit)).not.toContain(externalId);
    await api('post', '/privacy/customers/export').send({ externalId }).expect(404);
  });

  it('applies retention only to finished conversations older than the cutoff', async () => {
    const old = await customerConversation(`customer-${randomUUID()}`);
    const recent = await customerConversation(`customer-${randomUUID()}`);
    const stillOpen = await customerConversation(`customer-${randomUUID()}`);
    // The object behind this attachment is already gone; retention must still complete.
    await objects.delete(old.storageKey);
    await prisma.$executeRaw`UPDATE conversations SET status = 'RESOLVED', "updatedAt" = now() - interval '120 days' WHERE id = ${old.conversationId}::uuid`;
    await prisma.$executeRaw`UPDATE conversations SET status = 'RESOLVED' WHERE id = ${recent.conversationId}::uuid`;
    await prisma.$executeRaw`UPDATE conversations SET "updatedAt" = now() - interval '120 days' WHERE id = ${stillOpen.conversationId}::uuid`;

    const deleted = await app
      .get(PrivacyService)
      .expire(businessId, new Date(Date.now() - 90 * 86_400_000));
    expect(deleted).toBe(1);
    expect(await prisma.conversation.count({ where: { id: old.conversationId } })).toBe(0);
    expect(
      await prisma.conversation.count({
        where: { id: { in: [recent.conversationId, stillOpen.conversationId] } },
      }),
    ).toBe(2);
  });

  it('keeps privacy requests inside the tenant and the right roles', async () => {
    const conversation = await prisma.conversation.findFirstOrThrow({
      where: { businessId, visitorId: { not: null } },
    });
    const visitor = await prisma.visitor.findUniqueOrThrow({
      where: { id: conversation.visitorId! },
    });
    // From the inbox: the visitor behind a conversation.
    const byConversation = `/api/v1/privacy/conversations/${conversation.id}/visitor/export`;
    await request(server)
      .get(byConversation)
      .set('Cookie', owner)
      .expect(200)
      .expect(({ body }) => expect((body as VisitorDataExport).visitor.id).toBe(visitor.id));
    await request(server).get(byConversation).set('Cookie', otherOwner).expect(404);
    await request(server)
      .get(`/api/v1/privacy/visitors/${visitor.id}/export`)
      .set('Cookie', otherOwner)
      .expect(404);
    await request(server)
      .post(`/api/v1/privacy/visitors/${visitor.id}/erase`)
      .set('Cookie', otherOwner)
      .send({ confirm: true })
      .expect(404);
    const reader = (
      (
        await request(server)
          .post('/api/v1/integration-settings/keys')
          .set('Cookie', owner)
          .send({ name: 'Reader', scopes: ['privacy:read'] })
          .expect(201)
      ).body as { token: string }
    ).token;
    await request(server)
      .post('/api/v1/integrations/privacy/customers/erase')
      .auth(reader, { type: 'bearer' })
      .send({ externalId: 'anyone', confirm: true })
      .expect(403);
  });
});
