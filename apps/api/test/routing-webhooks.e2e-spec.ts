import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { IntegrationAvailabilityResponse } from '@bizchat/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { WebhookService } from '../src/integrations/webhook.service';
import { WebhookTransport } from '../src/integrations/webhook-transport';
import { RedisService } from '../src/realtime/redis.service';

describe('Routing webhooks and availability (real PostgreSQL and Redis)', () => {
  let app: NestExpressApplication;
  let server: Server;
  let prisma: PrismaService;
  let redis: RedisService;
  let owner: string;
  let businessId: string;
  let membershipId: string;
  let endpointId: string;

  async function resetThrottles(): Promise<void> {
    const keys = await redis.keys('bizchat:throttle:*');
    if (keys.length) await redis.del(...keys);
  }

  async function key(scopes: string[]): Promise<string> {
    const response = await request(server)
      .post('/api/v1/integration-settings/keys')
      .set('Cookie', owner)
      .send({ name: `Key ${randomUUID().slice(0, 6)}`, scopes })
      .expect(201);
    return (response.body as { token: string }).token;
  }

  async function eventsFor(
    conversationId: string,
  ): Promise<{ type: string; data: Record<string, unknown> }[]> {
    const deliveries = await prisma.webhookDelivery.findMany({
      where: { endpointId },
      orderBy: { createdAt: 'asc' },
    });
    return deliveries
      .map(({ payload }) => payload as { type: string; data: Record<string, unknown> })
      .filter(({ data }) => data.id === conversationId);
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WebhookTransport)
      .useValue({
        validate: jest.fn().mockResolvedValue(undefined),
        send: jest.fn().mockResolvedValue(200),
      })
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureApplication(app);
    app.useLogger(false);
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    // Deliveries stay in the outbox so the test can read exactly what was enqueued.
    await app.get(WebhookService).onModuleDestroy();
    await resetThrottles();
    const registered = await request(server)
      .post('/api/v1/auth/register')
      .send({
        businessName: 'Routing Webhooks',
        displayName: 'Thandi Owner',
        email: `webhooks-${randomUUID()}@example.test`,
        password: 'correct-horse-battery',
        timezone: 'UTC',
      })
      .expect(201);
    owner = (registered.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const me = (await request(server).get('/api/v1/auth/me').set('Cookie', owner).expect(200))
      .body as { business: { id: string }; membership: { id: string } };
    businessId = me.business.id;
    membershipId = me.membership.id;
    const endpoint = await request(server)
      .post('/api/v1/integration-settings/webhooks')
      .set('Cookie', owner)
      .send({
        url: 'https://receiver.example.com/routing',
        // Every routing event except resolved, to show unsubscribed events are not enqueued.
        events: [
          'conversation.queued',
          'conversation.offered',
          'conversation.assigned',
          'conversation.overflowed',
          'conversation.follow_up_requested',
          'conversation.closed',
        ],
      })
      .expect(201);
    endpointId = (endpoint.body as { id: string }).id;
  }, 90_000);

  afterAll(async () => {
    await resetThrottles();
    await app?.close();
  });

  it('enqueues one event per routing change, in the changing transaction', async () => {
    const conversation = await prisma.conversation.create({ data: { businessId } });
    const update = (data: Record<string, unknown>): Promise<unknown> =>
      prisma.conversation.update({ where: { id: conversation.id }, data });

    await update({ status: 'QUEUED' });
    await update({ overflowLevel: 1 });
    await update({
      status: 'OFFERED',
      assignedAgentMembershipId: membershipId,
      offerExpiresAt: new Date('2026-10-25T10:00:30Z'),
    });
    await update({ status: 'ASSIGNED', assignedAt: new Date('2026-10-25T10:00:10Z') });
    await update({ subject: 'not a routing change' });
    await update({ status: 'RESOLVED', resolvedAt: new Date() });
    await expect(
      prisma.$transaction(async (transaction) => {
        await transaction.conversation.update({
          where: { id: conversation.id },
          data: { status: 'CLOSED' },
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    const events = await eventsFor(conversation.id);
    expect(events.map(({ type }) => type)).toEqual([
      'conversation.queued',
      'conversation.overflowed',
      'conversation.offered',
      'conversation.assigned',
    ]);
    expect(events[1]!.data).toMatchObject({ overflowLevel: 1, fromLevel: 0 });
    expect(events[2]!.data).toMatchObject({
      status: 'OFFERED',
      consultant: { membershipId, displayName: 'Thandi Owner' },
      offerExpiresAt: '2026-10-25T10:00:30.000Z',
    });
  });

  it('announces follow-ups and abandonment without contact details', async () => {
    const conversation = await prisma.conversation.create({
      data: { businessId, status: 'QUEUED' },
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        followUpRequestedAt: new Date(),
        followUpContact: { email: 'visitor@example.test', phone: null, name: null, note: null },
      },
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    const events = await eventsFor(conversation.id);
    expect(events.map(({ type }) => type)).toEqual([
      'conversation.follow_up_requested',
      'conversation.closed',
    ]);
    expect(JSON.stringify(events)).not.toContain('visitor@example.test');

    // The API returns the details only to keys allowed to read personal intake data.
    const reader = await key(['conversations:read']);
    const intakeReader = await key(['conversations:read', 'intake:read']);
    const plain = await request(server)
      .get(`/api/v1/integrations/conversations/${conversation.id}`)
      .auth(reader, { type: 'bearer' })
      .expect(200);
    expect(plain.body).toMatchObject({ followUpRequested: true });
    expect(plain.body).not.toHaveProperty('followUp');
    const detailed = await request(server)
      .get(`/api/v1/integrations/conversations/${conversation.id}`)
      .auth(intakeReader, { type: 'bearer' })
      .expect(200);
    expect(detailed.body).toMatchObject({
      followUp: { contact: { email: 'visitor@example.test' } },
    });
  });

  it('reports availability to keys with the availability scope', async () => {
    const token = await key(['availability:read']);
    const availability = (
      await request(server)
        .get('/api/v1/integrations/availability')
        .auth(token, { type: 'bearer' })
        .expect(200)
    ).body as IntegrationAvailabilityResponse;
    // Nobody is connected in this test, and a tenant without saved hours is open.
    expect(availability).toMatchObject({
      open: true,
      availability: 'OFFLINE',
      onlineAgents: 0,
      availableAgents: 0,
      departments: [
        expect.objectContaining({ name: 'General Support', onlineAgents: 0, availableAgents: 0 }),
      ],
    });
    await request(server)
      .get('/api/v1/integrations/availability')
      .auth(await key(['conversations:read']), { type: 'bearer' })
      .expect(403);
  });
});
