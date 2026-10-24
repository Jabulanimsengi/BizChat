import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { BusinessUserResponse, SkillResponse } from '@bizchat/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { RedisService } from '../src/realtime/redis.service';

describe('Routing configuration (real PostgreSQL and Redis)', () => {
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
        businessName: 'Routing Config Test',
        displayName: 'Owner',
        email: `routing-${randomUUID()}@example.test`,
        password: 'correct-horse-battery',
        timezone: 'UTC',
      })
      .expect(201);
    return (response.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  }

  async function self(cookie: string): Promise<BusinessUserResponse> {
    const response = await request(server).get('/api/v1/users').set('Cookie', cookie).expect(200);
    return (response.body as BusinessUserResponse[])[0]!;
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
    // Leave the 5/min registration window as other suites found it, as tools/run-e2e.mjs does.
    await resetThrottles();
    await app?.close();
  });

  async function resetThrottles(): Promise<void> {
    const keys = await redis.keys('bizchat:throttle:*');
    if (keys.length) await redis.del(...keys);
  }

  it('manages a tenant skill catalogue and consultant proficiency', async () => {
    const created = await request(server)
      .post('/api/v1/skills')
      .set('Cookie', owner)
      .send({ name: 'Tax returns', description: 'Personal and company tax' })
      .expect(201);
    const skill = created.body as SkillResponse;
    expect(skill).toMatchObject({ name: 'Tax returns', status: 'ACTIVE', consultantCount: 0 });

    await request(server)
      .post('/api/v1/skills')
      .set('Cookie', owner)
      .send({ name: 'Tax returns' })
      .expect(409);

    const me = await self(owner);
    const updated = await request(server)
      .patch(`/api/v1/users/${me.membershipId}`)
      .set('Cookie', owner)
      .send({ skills: [{ skillId: skill.id, proficiency: 4 }] })
      .expect(200);
    expect((updated.body as BusinessUserResponse).skills).toEqual([
      { skillId: skill.id, proficiency: 4 },
    ]);

    const listed = await request(server).get('/api/v1/skills').set('Cookie', owner).expect(200);
    expect(listed.body).toEqual([expect.objectContaining({ id: skill.id, consultantCount: 1 })]);

    await request(server)
      .patch(`/api/v1/users/${me.membershipId}`)
      .set('Cookie', owner)
      .send({ skills: [{ skillId: skill.id, proficiency: 6 }] })
      .expect(400);
  });

  it('keeps skills and routing settings inside their tenant', async () => {
    const skill = (
      await request(server)
        .post('/api/v1/skills')
        .set('Cookie', owner)
        .send({ name: `Payroll ${randomUUID().slice(0, 8)}` })
        .expect(201)
    ).body as SkillResponse;

    const otherList = await request(server)
      .get('/api/v1/skills')
      .set('Cookie', otherOwner)
      .expect(200);
    expect(otherList.body).toEqual([]);
    await request(server)
      .patch(`/api/v1/skills/${skill.id}`)
      .set('Cookie', otherOwner)
      .send({ status: 'DISABLED' })
      .expect(404);
    const other = await self(otherOwner);
    await request(server)
      .patch(`/api/v1/users/${other.membershipId}`)
      .set('Cookie', otherOwner)
      .send({ skills: [{ skillId: skill.id, proficiency: 3 }] })
      .expect(404);

    await request(server)
      .get('/api/v1/routing/settings')
      .set('Cookie', owner)
      .expect(200, { routingStrategy: 'LEAST_BUSY' });
    await request(server)
      .put('/api/v1/routing/settings')
      .set('Cookie', owner)
      .send({ routingStrategy: 'BEST_SKILL' })
      .expect(200, { routingStrategy: 'BEST_SKILL' });
    await request(server)
      .get('/api/v1/routing/settings')
      .set('Cookie', otherOwner)
      .expect(200, { routingStrategy: 'LEAST_BUSY' });
  });

  it('enforces the proficiency range in the database as well as the API', async () => {
    const owned = await prisma.skill.findFirstOrThrow({ where: { name: 'Tax returns' } });
    const profile = await prisma.agentProfile.findFirstOrThrow({
      where: { businessId: owned.businessId },
    });
    await expect(
      prisma.agentSkill.create({
        data: {
          businessId: owned.businessId,
          agentProfileId: profile.id,
          skillId: owned.id,
          proficiency: 9,
        },
      }),
    ).rejects.toThrow();
  });
});
