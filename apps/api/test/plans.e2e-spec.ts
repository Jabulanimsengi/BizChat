import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { PlanResponse, PlanUsageResponse, PlatformTenantResponse } from '@bizchat/types';
import { configureApplication } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { RedisService } from '../src/realtime/redis.service';

describe('Plans, usage, and platform administration (real PostgreSQL and Redis)', () => {
  const adminEmail = `platform-${randomUUID()}@example.test`;
  let app: NestExpressApplication;
  let server: Server;
  let prisma: PrismaService;
  let redis: RedisService;
  let admin: string;
  let customer: string;
  let customerId: string;
  let tiny: PlanResponse;

  async function register(email: string): Promise<string> {
    const response = await request(server)
      .post('/api/v1/auth/register')
      .send({
        businessName: 'Plans Test',
        displayName: 'Owner',
        email,
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

  const createKey = (): request.Test =>
    request(server)
      .post('/api/v1/integration-settings/keys')
      .set('Cookie', customer)
      .send({ name: `Key ${randomUUID().slice(0, 6)}`, scopes: ['conversations:write'] });

  beforeAll(async () => {
    process.env.PLATFORM_ADMIN_EMAILS = `someone-else@example.test, ${adminEmail.toUpperCase()}`;
    process.env.NEW_TENANT_PLAN_CODE = 'starter';
    // Configuration is read when the app module is first loaded, so load it after the allowlist.
    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureApplication(app);
    app.useLogger(false);
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    await resetThrottles();
    admin = await register(adminEmail);
    customer = await register(`customer-${randomUUID()}@example.test`);
    customerId = (
      (await request(server).get('/api/v1/auth/me').set('Cookie', customer).expect(200)).body as {
        business: { id: string };
      }
    ).business.id;
  }, 90_000);

  afterAll(async () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    delete process.env.NEW_TENANT_PLAN_CODE;
    await resetThrottles();
    await app?.close();
  });

  it('admits only verified allowlisted accounts to platform administration', async () => {
    await request(server).get('/api/v1/platform/plans').set('Cookie', admin).expect(403);
    await prisma.user.update({
      where: { email: adminEmail },
      data: { emailVerifiedAt: new Date() },
    });
    await request(server)
      .get('/api/v1/auth/me')
      .set('Cookie', admin)
      .expect(({ body }) => expect(body).toMatchObject({ platformAdmin: true }));
    await request(server)
      .get('/api/v1/auth/me')
      .set('Cookie', customer)
      .expect(({ body }) => expect(body).toMatchObject({ platformAdmin: false }));
    await request(server).get('/api/v1/platform/plans').set('Cookie', customer).expect(403);
    const plans = (
      await request(server).get('/api/v1/platform/plans').set('Cookie', admin).expect(200)
    ).body as PlanResponse[];
    expect(plans.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['free', 'starter', 'business']),
    );
  });

  it('creates a plan and assigns it to a tenant, which sees its usage', async () => {
    // New registrations start on the configured plan.
    await request(server)
      .get('/api/v1/plan')
      .set('Cookie', customer)
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ plan: { code: 'starter' } }));
    tiny = (
      await request(server)
        .post('/api/v1/platform/plans')
        .set('Cookie', admin)
        .send({
          code: `tiny-${randomUUID().slice(0, 6)}`,
          name: 'Tiny',
          maxConsultants: 1,
          maxConversationsPerMonth: 1,
          maxIntegrationKeys: 1,
          maxWebhookEndpoints: 1,
        })
        .expect(201)
    ).body as PlanResponse;
    await request(server)
      .post('/api/v1/platform/plans')
      .set('Cookie', admin)
      .send({ code: tiny.code, name: 'Duplicate' })
      .expect(409);
    const assigned = (
      await request(server)
        .patch(`/api/v1/platform/tenants/${customerId}`)
        .set('Cookie', admin)
        .send({ planId: tiny.id })
        .expect(200)
    ).body as PlatformTenantResponse;
    expect(assigned).toMatchObject({
      planId: tiny.id,
      usage: { consultants: { used: 1, limit: 1 } },
    });
    const usage = (await request(server).get('/api/v1/plan').set('Cookie', customer).expect(200))
      .body as PlanUsageResponse;
    expect(usage).toMatchObject({
      plan: { name: 'Tiny' },
      usage: { conversations: { used: 0, limit: 1 }, integrationKeys: { used: 0, limit: 1 } },
    });
    // The tenant's owners can see what the platform changed.
    expect(
      await prisma.auditLog.count({
        where: { businessId: customerId, action: 'platform.tenant_updated' },
      }),
    ).toBe(1);
  });

  it('enforces the limits wherever tenants create things', async () => {
    const token = ((await createKey().expect(201)).body as { token: string }).token;
    await createKey()
      .expect(403)
      .expect(({ body }) => expect(body).toMatchObject({ error: { code: 'PLAN_LIMIT_REACHED' } }));
    const start = (): request.Test =>
      request(server)
        .post('/api/v1/integrations/conversations')
        .auth(token, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({ externalId: `customer-${randomUUID()}`, content: 'Hello' });
    await start().expect(201);
    await start().expect(403);
    // Counted by the database trigger, so every creation path meters the same way.
    const usage = (await request(server).get('/api/v1/plan').set('Cookie', customer).expect(200))
      .body as PlanUsageResponse;
    expect(usage.usage.conversations).toEqual({ used: 1, limit: 1 });
    await request(server)
      .post('/api/v1/users')
      .set('Cookie', customer)
      .send({
        displayName: 'One Too Many',
        email: `extra-${randomUUID()}@example.test`,
        password: 'correct-horse-battery',
        role: 'CONSULTANT',
      })
      .expect(403);

    // Removing the plan removes the limits.
    await request(server)
      .patch(`/api/v1/platform/tenants/${customerId}`)
      .set('Cookie', admin)
      .send({ planId: null })
      .expect(200);
    await start().expect(201);
  });

  it('suspends and restores a tenant', async () => {
    await request(server)
      .patch(`/api/v1/platform/tenants/${customerId}`)
      .set('Cookie', admin)
      .send({ status: 'SUSPENDED' })
      .expect(200);
    await request(server).get('/api/v1/auth/me').set('Cookie', customer).expect(401);
    await request(server)
      .patch(`/api/v1/platform/tenants/${customerId}`)
      .set('Cookie', admin)
      .send({ status: 'ACTIVE' })
      .expect(200);
    await request(server).get('/api/v1/auth/me').set('Cookie', customer).expect(200);
    const tenants = (
      await request(server)
        .get('/api/v1/platform/tenants?search=plans test&limit=100')
        .set('Cookie', admin)
        .expect(200)
    ).body as PlatformTenantResponse[];
    expect(tenants.some(({ id }) => id === customerId)).toBe(true);
  });
});
