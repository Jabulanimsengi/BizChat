import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type {
  BusinessUserResponse,
  DepartmentResponse,
  SkillResponse,
  TopicResponse,
} from '@bizchat/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import type { SetupConsultant } from '../src/integrations/setup.controller';
import { RedisService } from '../src/realtime/redis.service';

describe('Setup API (real PostgreSQL and Redis)', () => {
  let app: NestExpressApplication;
  let server: Server;
  let prisma: PrismaService;
  let redis: RedisService;
  let owner: string;
  let otherOwner: string;
  let writer: string;
  let reader: string;

  async function register(): Promise<string> {
    const response = await request(server)
      .post('/api/v1/auth/register')
      .send({
        businessName: 'Setup API Test',
        displayName: 'Owner',
        email: `setup-${randomUUID()}@example.test`,
        password: 'correct-horse-battery',
        timezone: 'UTC',
      })
      .expect(201);
    return (response.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  }

  async function key(cookie: string, scopes: string[]): Promise<string> {
    const response = await request(server)
      .post('/api/v1/integration-settings/keys')
      .set('Cookie', cookie)
      .send({ name: `Setup ${randomUUID().slice(0, 6)}`, scopes })
      .expect(201);
    return (response.body as { token: string }).token;
  }

  const setup = (
    method: 'get' | 'post' | 'patch' | 'put',
    path: string,
    token = writer,
  ): request.Test =>
    request(server)[method](`/api/v1/integrations/setup${path}`).auth(token, { type: 'bearer' });

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
    writer = await key(owner, ['setup:read', 'setup:write']);
    reader = await key(owner, ['setup:read']);
  }, 90_000);

  afterAll(async () => {
    await resetThrottles();
    await app?.close();
  });

  it('configures departments, skills, topics, settings, and hours from a backend', async () => {
    const department = (
      await setup('post', '/departments').send({ name: 'Company registration' }).expect(201)
    ).body as DepartmentResponse;
    // A key is nobody, so unlike a person it does not join the department it creates.
    expect(department.agentProfileIds).toEqual([]);
    const skill = (await setup('post', '/skills').send({ name: 'CIPC filings' }).expect(201))
      .body as SkillResponse;
    const topic = (
      await setup('post', '/topics')
        .send({
          name: 'Register a company',
          departmentId: department.id,
          requiredSkillId: skill.id,
          requiredSkillMinProficiency: 2,
          keywords: [
            { phrase: 'register', weight: 2 },
            { phrase: 'new company', weight: 3 },
          ],
          maxWaitSeconds: 300,
        })
        .expect(201)
    ).body as TopicResponse;
    expect(topic).toMatchObject({ departmentId: department.id, maxWaitSeconds: 300 });
    await setup('post', '/topics').send({ name: 'Register a company' }).expect(409);
    await setup('post', '/topics/test')
      .send({ message: 'I want to register a new company' })
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({ decision: 'ROUTE', topic: { id: topic.id } }),
      );
    await setup('patch', `/topics/${topic.id}`).send({ priority: 'HIGH' }).expect(200);
    await setup('put', '/routing-settings')
      .send({ routingStrategy: 'BEST_SKILL' })
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ routingStrategy: 'BEST_SKILL' }));
    const week = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      openingTime: '08:00',
      closingTime: '16:30',
      isClosed: weekday === 0,
    }));
    await setup('put', '/business-hours').send({ hours: week }).expect(200);
    await setup('get', '/business-hours', reader)
      .expect(200)
      .expect(({ body }) =>
        expect((body as { hours: { openingTime: string }[] }).hours[1]).toMatchObject({
          openingTime: '08:00',
        }),
      );

    // Every change is audited against the key, not a person.
    const audits = await prisma.auditLog.findMany({
      where: { targetId: { in: [department.id, skill.id, topic.id] } },
    });
    expect(audits.length).toBeGreaterThanOrEqual(4);
    for (const entry of audits) {
      expect(entry.actorUserId).toBeNull();
      expect(entry.metadata).toMatchObject({ integrationKeyId: expect.any(String) as unknown });
    }
  });

  it('sets how consultants are routed, but never roles, names, or owners', async () => {
    const department = (
      await setup('post', '/departments').send({ name: 'Annual returns' }).expect(201)
    ).body as DepartmentResponse;
    const skill = (await setup('post', '/skills').send({ name: 'Annual returns' }).expect(201))
      .body as SkillResponse;
    const created = (
      await request(server)
        .post('/api/v1/users')
        .set('Cookie', owner)
        .send({
          displayName: 'Sipho Consultant',
          email: `consultant-${randomUUID()}@example.test`,
          password: 'correct-horse-battery',
          role: 'CONSULTANT',
        })
        .expect(201)
    ).body as BusinessUserResponse;

    const updated = (
      await setup('patch', `/consultants/${created.membershipId}`)
        .send({
          departmentIds: [department.id],
          skills: [{ skillId: skill.id, proficiency: 4 }],
          maxConcurrentChats: 3,
        })
        .expect(200)
    ).body as SetupConsultant;
    expect(updated).toMatchObject({
      displayName: 'Sipho Consultant',
      departmentIds: [department.id],
      skills: [{ skillId: skill.id, proficiency: 4 }],
      maxConcurrentChats: 3,
    });
    await setup('patch', `/consultants/${created.membershipId}`)
      .send({ role: 'ADMIN' })
      .expect(400);

    const consultants = (await setup('get', '/consultants', reader).expect(200))
      .body as SetupConsultant[];
    const ownerRow = consultants.find((row) => row.role === 'OWNER')!;
    // The key has administrator rights, and administrators cannot change an owner.
    await setup('patch', `/consultants/${ownerRow.membershipId}`)
      .send({ maxConcurrentChats: 2 })
      .expect(403);
  });

  it('enforces scopes and tenant boundaries', async () => {
    await setup('post', '/skills', reader).send({ name: 'Read only' }).expect(403);
    await setup('get', '/topics', await key(owner, ['conversations:read'])).expect(403);
    const topics = (await setup('get', '/topics', reader).expect(200)).body as TopicResponse[];
    const foreign = await key(otherOwner, ['setup:read', 'setup:write']);
    await setup('patch', `/topics/${topics[0]!.id}`, foreign).send({ name: 'Taken' }).expect(404);
    await setup('get', '/topics', foreign).expect(200, []);
    const consultants = (await setup('get', '/consultants', reader).expect(200))
      .body as SetupConsultant[];
    await setup('patch', `/consultants/${consultants[0]!.membershipId}`, foreign)
      .send({ maxConcurrentChats: 2 })
      .expect(404);
  });
});
