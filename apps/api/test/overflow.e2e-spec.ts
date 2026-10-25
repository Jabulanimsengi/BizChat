import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { TopicResponse } from '@bizchat/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { RedisService } from '../src/realtime/redis.service';
import { QueueWaitService } from '../src/routing/queue-wait.service';

describe('Overflow and maximum wait (real PostgreSQL and Redis)', () => {
  let app: NestExpressApplication;
  let server: Server;
  let prisma: PrismaService;
  let redis: RedisService;
  let waits: QueueWaitService;
  let owner: string;
  let otherOwner: string;

  async function register(): Promise<string> {
    const response = await request(server)
      .post('/api/v1/auth/register')
      .send({
        businessName: 'Overflow Test',
        displayName: 'Owner',
        email: `overflow-${randomUUID()}@example.test`,
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

  async function department(cookie: string, name: string): Promise<string> {
    const response = await request(server)
      .post('/api/v1/departments')
      .set('Cookie', cookie)
      .send({ name: `${name} ${randomUUID().slice(0, 6)}` })
      .expect(201);
    return (response.body as { id: string }).id;
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
    waits = app.get(QueueWaitService);
    await resetThrottles();
    owner = await register();
    otherOwner = await register();
  }, 90_000);

  afterAll(async () => {
    await resetThrottles();
    await app?.close();
  });

  it('stores overflow steps and a maximum wait, checking departments belong to the tenant', async () => {
    const sales = await department(owner, 'Sales');
    const general = await department(owner, 'General');
    const foreign = await department(otherOwner, 'Elsewhere');
    const steps = [
      { afterSeconds: 60, addDepartmentIds: [general], relaxSkill: false, anyConsultant: false },
      { afterSeconds: 300, addDepartmentIds: [], relaxSkill: false, anyConsultant: true },
    ];
    const topic = (
      await request(server)
        .post('/api/v1/topics')
        .set('Cookie', owner)
        .send({
          name: 'Registrations',
          departmentId: sales,
          overflowSteps: steps,
          maxWaitSeconds: 600,
        })
        .expect(201)
    ).body as TopicResponse;
    expect(topic).toMatchObject({ overflowSteps: steps, maxWaitSeconds: 600 });

    await request(server)
      .patch(`/api/v1/topics/${topic.id}`)
      .set('Cookie', owner)
      .send({ overflowSteps: [{ afterSeconds: 60, addDepartmentIds: [foreign] }] })
      .expect(404);
    await request(server)
      .patch(`/api/v1/topics/${topic.id}`)
      .set('Cookie', owner)
      .send({ overflowSteps: [{ afterSeconds: 60 }] })
      .expect(400);
    await expect(
      prisma.topic.update({ where: { id: topic.id }, data: { maxWaitSeconds: 5 } }),
    ).rejects.toThrow();
  });

  it('schedules overflow when a conversation queues and advances it once the wait is due', async () => {
    const support = await department(owner, 'Support');
    const backup = await department(owner, 'Backup');
    await request(server)
      .post('/api/v1/topics')
      .set('Cookie', owner)
      .send({
        name: 'Tax help',
        departmentId: support,
        keywords: [{ phrase: 'tax return', weight: 3 }],
        overflowSteps: [
          { afterSeconds: 60, addDepartmentIds: [backup] },
          { afterSeconds: 120, relaxSkill: true },
        ],
      })
      .expect(201);
    const token = (
      await request(server)
        .post('/api/v1/integration-settings/keys')
        .set('Cookie', owner)
        .send({ name: 'Overflow', scopes: ['conversations:write'] })
        .expect(201)
    ).body as { token: string };
    const created = (
      await request(server)
        .post('/api/v1/integrations/conversations')
        .auth(token.token, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({ externalId: `customer-${randomUUID()}`, content: 'Help with my tax return please' })
        .expect(201)
    ).body as { conversation: { id: string } };

    // Nobody is online, so routing queues it and schedules the first step from the queue time.
    let row = await prisma.conversation.findUniqueOrThrow({
      where: { id: created.conversation.id },
      include: { queueEntry: true },
    });
    for (let attempt = 0; attempt < 50 && row.status !== 'QUEUED'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      row = await prisma.conversation.findUniqueOrThrow({
        where: { id: created.conversation.id },
        include: { queueEntry: true },
      });
    }
    expect(row.status).toBe('QUEUED');
    expect(row.nextOverflowAt?.getTime()).toBe(row.queueEntry!.enqueuedAt.getTime() + 60_000);
    // Integration conversations have nobody to offer a follow-up to.
    expect(row.maxWaitAt).toBeNull();

    // Two and a half minutes later both steps are due; the sweep applies them in one move.
    const later = new Date(row.queueEntry!.enqueuedAt.getTime() + 150_000);
    await expect(waits.advanceOverflow(later)).resolves.toBeGreaterThanOrEqual(1);
    const advanced = await prisma.conversation.findUniqueOrThrow({
      where: { id: created.conversation.id },
      include: { events: { where: { type: 'OVERFLOWED' } } },
    });
    expect(advanced).toMatchObject({
      overflowLevel: 2,
      nextOverflowAt: null,
      routingCycleStartedAt: later,
    });
    expect(advanced.events).toEqual([
      expect.objectContaining({ metadata: { fromLevel: 0, toLevel: 2 } }),
    ]);

    // Running the step again changes nothing.
    await waits.advanceOverflow(later);
    expect(
      await prisma.conversationEvent.count({
        where: { conversationId: created.conversation.id, type: 'OVERFLOWED' },
      }),
    ).toBe(1);
  });
});
