import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Conversation, Topic } from '@prisma/client';
import type { AnalyticsOverviewResponse, ConsultantAnalyticsRow } from '@bizchat/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { RedisService } from '../src/realtime/redis.service';

describe('Analytics (real PostgreSQL and Redis)', () => {
  let app: NestExpressApplication;
  let server: Server;
  let prisma: PrismaService;
  let redis: RedisService;
  let owner: string;
  let otherOwner: string;

  async function register(): Promise<string> {
    const response = await request(server)
      .post('/api/v1/auth/register')
      .send({
        businessName: 'Analytics Test',
        displayName: 'Owner',
        email: `analytics-${randomUUID()}@example.test`,
        password: 'correct-horse-battery',
        // UTC+2, so a chat at 22:30 UTC belongs to the next local day.
        timezone: 'Africa/Johannesburg',
      })
      .expect(201);
    return (response.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  }

  async function resetThrottles(): Promise<void> {
    const keys = await redis.keys('bizchat:throttle:*');
    if (keys.length) await redis.del(...keys);
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureApplication(app);
    app.useLogger(false);
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    await resetThrottles();
    owner = await register();
    otherOwner = await register();
  }, 90_000);

  afterAll(async () => {
    await resetThrottles();
    await app?.close();
  });

  /** Writes a known history directly, so every figure can be checked exactly. */
  async function seed(): Promise<void> {
    const me = (await request(server).get('/api/v1/auth/me').set('Cookie', owner).expect(200))
      .body as { business: { id: string }; user: { id: string } };
    const businessId = me.business.id;
    const profile = await prisma.agentProfile.findFirstOrThrow({ where: { businessId } });
    const at = (iso: string, seconds = 0): Date => new Date(Date.parse(iso) + seconds * 1_000);
    const topic = (name: string): Promise<Topic> =>
      prisma.topic.create({
        data: { businessId, name, publicId: `topic_${randomUUID().slice(0, 12)}` },
      });
    const routed = await topic('Registrations');
    const chosen = await topic('Tax');
    const conversation = (
      createdAt: Date,
      data: Record<string, unknown> = {},
    ): Promise<Conversation> =>
      prisma.conversation.create({ data: { businessId, createdAt, status: 'QUEUED', ...data } });
    const assign = (conversationId: string, assignedAt: Date): Promise<unknown> =>
      prisma.conversationAssignment.create({
        data: { businessId, conversationId, agentProfileId: profile.id, assignedAt },
      });
    const offer = (
      conversationId: string,
      offeredAt: Date,
      outcome: 'ACCEPTED' | 'DECLINED' | 'EXPIRED',
    ): Promise<unknown> =>
      prisma.conversationOffer.create({
        data: {
          businessId,
          conversationId,
          agentProfileId: profile.id,
          offeredAt,
          expiresAt: at(offeredAt.toISOString(), 30),
          respondedAt: at(offeredAt.toISOString(), 10),
          outcome,
        },
      });

    // Resolved: assigned after 60 s, answered after 120 s, resolved 600 s after creation. The
    // classifier routed it, then the visitor changed the topic.
    const first = await conversation(at('2026-10-20T08:00:00Z'), {
      status: 'RESOLVED',
      resolvedAt: at('2026-10-20T08:00:00Z', 600),
      topicId: chosen.id,
    });
    await assign(first.id, at('2026-10-20T08:00:00Z', 60));
    await offer(first.id, at('2026-10-20T08:00:00Z', 50), 'ACCEPTED');
    await prisma.message.createMany({
      data: [
        {
          businessId,
          conversationId: first.id,
          senderType: 'AGENT',
          senderUserId: me.user.id,
          messageType: 'INTERNAL_NOTE',
          clientMessageId: randomUUID(),
          sequenceNumber: 1n,
          content: 'notes do not count as a response',
          createdAt: at('2026-10-20T08:00:00Z', 90),
        },
        {
          businessId,
          conversationId: first.id,
          senderType: 'AGENT',
          senderUserId: me.user.id,
          clientMessageId: randomUUID(),
          sequenceNumber: 2n,
          content: 'Hello',
          createdAt: at('2026-10-20T08:00:00Z', 120),
        },
      ],
    });
    await prisma.conversationClassification.createMany({
      data: [
        {
          businessId,
          conversationId: first.id,
          topicId: routed.id,
          method: 'KEYWORD',
          decision: 'ROUTE',
        },
        {
          businessId,
          conversationId: first.id,
          topicId: chosen.id,
          method: 'VISITOR_CHOICE',
          decision: 'ROUTE',
          createdAt: at('2026-10-20T08:00:00Z', 5),
        },
      ],
    });
    // Assigned after 180 s, never answered; one decline and one expiry first; default topic.
    const second = await conversation(at('2026-10-20T09:00:00Z'), { status: 'ASSIGNED' });
    await offer(second.id, at('2026-10-20T09:00:00Z', 10), 'DECLINED');
    await offer(second.id, at('2026-10-20T09:00:00Z', 60), 'EXPIRED');
    await assign(second.id, at('2026-10-20T09:00:00Z', 180));
    await prisma.conversationClassification.create({
      data: { businessId, conversationId: second.id, method: 'DEFAULT', decision: 'ASK' },
    });
    // Overflowed, then abandoned in the queue.
    const third = await conversation(at('2026-10-20T10:00:00Z'), {
      status: 'CLOSED',
      overflowLevel: 1,
    });
    await prisma.conversationEvent.create({
      data: {
        businessId,
        conversationId: third.id,
        type: 'CLOSED',
        actorType: 'SYSTEM',
        metadata: { reason: 'VISITOR_LEFT_QUEUE' },
      },
    });
    // 00:30 local on the 20th (included) and 23:30 local on the 19th (excluded).
    await conversation(at('2026-10-19T22:30:00Z'), {
      followUpRequestedAt: at('2026-10-19T22:40:00Z'),
    });
    await conversation(at('2026-10-19T21:30:00Z'));
  }

  it('reports volume, times, offers, and classification for local days', async () => {
    await seed();
    const overview = (
      await request(server)
        .get('/api/v1/analytics/overview?from=2026-10-20&to=2026-10-21')
        .set('Cookie', owner)
        .expect(200)
    ).body as AnalyticsOverviewResponse;

    expect(overview.timezone).toBe('Africa/Johannesburg');
    expect(overview.totals).toEqual({
      conversations: 4,
      assigned: 2,
      resolved: 1,
      abandoned: 1,
      followUps: 1,
      overflowed: 1,
    });
    expect(overview.daily).toEqual([
      { date: '2026-10-20', created: 4, resolved: 1, abandoned: 1 },
      { date: '2026-10-21', created: 0, resolved: 0, abandoned: 0 },
    ]);
    expect(overview.waitToAssignment).toEqual({
      count: 2,
      medianSeconds: 120,
      p90Seconds: 168,
      averageSeconds: 120,
    });
    expect(overview.firstResponse).toMatchObject({ count: 1, medianSeconds: 120 });
    expect(overview.handleTime).toMatchObject({ count: 1, medianSeconds: 540 });
    expect(overview.offers).toEqual({
      offered: 3,
      accepted: 1,
      declined: 1,
      expired: 1,
      cancelled: 0,
      acceptRate: 1 / 3,
    });
    expect(overview.classification).toEqual({
      classified: 1,
      autoRouted: 1,
      confirmed: 0,
      asked: 0,
      defaulted: 1,
      changedByVisitor: 1,
    });
    expect(overview.byTopic).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Tax', conversations: 1, medianWaitSeconds: 60 }),
        expect.objectContaining({ id: null, name: 'No topic', conversations: 3 }),
      ]),
    );

    const consultants = (
      await request(server)
        .get('/api/v1/analytics/consultants?from=2026-10-20&to=2026-10-21')
        .set('Cookie', owner)
        .expect(200)
    ).body as ConsultantAnalyticsRow[];
    expect(consultants).toEqual([
      expect.objectContaining({
        displayName: 'Owner',
        assigned: 2,
        resolved: 1,
        firstResponse: expect.objectContaining({ count: 1, medianSeconds: 120 }) as unknown,
        offers: { offered: 3, accepted: 1, declined: 1, expired: 1 },
      }),
    ]);
  });

  it('keeps each tenant to its own conversations and validates the range', async () => {
    const other = (
      await request(server)
        .get('/api/v1/analytics/overview?from=2026-10-20&to=2026-10-21')
        .set('Cookie', otherOwner)
        .expect(200)
    ).body as AnalyticsOverviewResponse;
    expect(other.totals.conversations).toBe(0);
    await request(server)
      .get('/api/v1/analytics/overview?from=2026-01-01&to=2026-06-01')
      .set('Cookie', owner)
      .expect(400);
    await request(server)
      .get('/api/v1/analytics/overview?from=2026-10-21&to=2026-10-20')
      .set('Cookie', owner)
      .expect(400);
    await request(server)
      .get('/api/v1/analytics/overview?from=2026-10-20&to=2026-10-21')
      .expect(401);
  });
});
