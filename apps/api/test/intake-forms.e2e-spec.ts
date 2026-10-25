import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { IntakeFormResponse } from '@bizchat/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { RedisService } from '../src/realtime/redis.service';

describe('Pre-chat forms (real PostgreSQL and Redis)', () => {
  let app: NestExpressApplication;
  let server: Server;
  let prisma: PrismaService;
  let redis: RedisService;
  let owner: string;
  let otherOwner: string;
  let form: IntakeFormResponse;

  async function register(): Promise<string> {
    const response = await request(server)
      .post('/api/v1/auth/register')
      .send({
        businessName: 'Intake Form Test',
        displayName: 'Owner',
        email: `forms-${randomUUID()}@example.test`,
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

  async function key(scopes: string[]): Promise<string> {
    const response = await request(server)
      .post('/api/v1/integration-settings/keys')
      .set('Cookie', owner)
      .send({ name: `Forms ${randomUUID().slice(0, 6)}`, scopes })
      .expect(201);
    return (response.body as { token: string }).token;
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

  it('creates forms, versions content changes, and rejects invalid definitions', async () => {
    form = (
      await request(server)
        .post('/api/v1/intake-forms')
        .set('Cookie', owner)
        .send({
          name: 'Company details',
          consentText: 'I agree that my details may be used for this request.',
          fields: [
            {
              key: 'full_name',
              label: 'Full name',
              type: 'TEXT',
              required: true,
              prefillFrom: 'name',
            },
            { key: 'email', label: 'Email', type: 'EMAIL', required: true, prefillFrom: 'email' },
            {
              key: 'registration_number',
              label: 'Registration number',
              type: 'REFERENCE',
              required: false,
              mask: '####/######/##',
            },
          ],
        })
        .expect(201)
    ).body as IntakeFormResponse;
    expect(form.version).toBe(1);

    const relabelled = await request(server)
      .patch(`/api/v1/intake-forms/${form.id}`)
      .set('Cookie', owner)
      .send({ fields: form.fields.map((field) => ({ ...field, label: `${field.label} ` })) })
      .expect(200);
    expect((relabelled.body as IntakeFormResponse).version).toBe(2);
    const renamed = await request(server)
      .patch(`/api/v1/intake-forms/${form.id}`)
      .set('Cookie', owner)
      .send({ name: 'Company details' })
      .expect(200);
    expect((renamed.body as IntakeFormResponse).version).toBe(2);

    await request(server)
      .post('/api/v1/intake-forms')
      .set('Cookie', owner)
      .send({ name: 'Company details', fields: [{ key: 'a', label: 'A', type: 'TEXT' }] })
      .expect(409);
    await request(server)
      .post('/api/v1/intake-forms')
      .set('Cookie', owner)
      .send({ name: 'Broken', fields: [{ key: 'service', label: 'Service', type: 'SELECT' }] })
      .expect(400);
  });

  it('keeps forms inside their tenant', async () => {
    await request(server).get('/api/v1/intake-forms').set('Cookie', otherOwner).expect(200, []);
    await request(server)
      .patch(`/api/v1/intake-forms/${form.id}`)
      .set('Cookie', otherOwner)
      .send({ status: 'DISABLED' })
      .expect(404);
    await request(server)
      .put('/api/v1/routing/settings')
      .set('Cookie', otherOwner)
      .send({ defaultIntakeFormId: form.id })
      .expect(400);
    await request(server)
      .post('/api/v1/topics')
      .set('Cookie', otherOwner)
      .send({ name: 'Borrowed form', intakeFormId: form.id })
      .expect(404);
  });

  it('validates and stores answers sent through the integration API', async () => {
    await request(server)
      .put('/api/v1/routing/settings')
      .set('Cookie', owner)
      .send({ defaultIntakeFormId: form.id, intakeFormTiming: 'AFTER_TOPIC' })
      .expect(200);
    const writer = await key(['conversations:write', 'conversations:read', 'customers:identify']);
    const start = (body: object): request.Test =>
      request(server)
        .post('/api/v1/integrations/conversations')
        .auth(writer, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({ externalId: `customer-${randomUUID()}`, content: 'I need help', ...body });

    const invalid = await start({
      intake: { answers: { full_name: 'Thandi', email: 'nope' }, consent: true },
    }).expect(400);
    expect(invalid.body).toMatchObject({ error: { code: 'INTAKE_INVALID' } });

    const created = (
      await start({
        intake: {
          answers: {
            full_name: 'Thandi Mokoena',
            email: 'thandi@example.com',
            registration_number: '2019/123456/07',
          },
          consent: true,
        },
      }).expect(201)
    ).body as { conversation: { id: string } };

    const plain = await request(server)
      .get(`/api/v1/integrations/conversations/${created.conversation.id}`)
      .auth(writer, { type: 'bearer' })
      .expect(200);
    expect(plain.body).not.toHaveProperty('intake');

    const reader = await key(['conversations:read', 'intake:read']);
    const detailed = await request(server)
      .get(`/api/v1/integrations/conversations/${created.conversation.id}`)
      .auth(reader, { type: 'bearer' })
      .expect(200);
    expect(detailed.body).toMatchObject({
      intake: {
        formName: 'Company details',
        formVersion: 2,
        consentAt: expect.any(String) as unknown,
        answers: expect.arrayContaining([
          expect.objectContaining({ key: 'registration_number', value: '2019/123456/07' }),
        ]) as unknown,
      },
    });

    // Consultants see the same answers on the conversation.
    const forAgent = await request(server)
      .get(`/api/v1/conversations/${created.conversation.id}/intake`)
      .set('Cookie', owner)
      .expect(200);
    expect(forAgent.body).toMatchObject({ formName: 'Company details' });
    await request(server)
      .get(`/api/v1/conversations/${created.conversation.id}/intake`)
      .set('Cookie', otherOwner)
      .expect(403);
  });

  it('stores name and email claims from identity proofs for prefilling', async () => {
    const identifier = await key(['customers:identify']);
    const externalId = `customer-${randomUUID()}`;
    await request(server)
      .post('/api/v1/integrations/customers/identify')
      .auth(identifier, { type: 'bearer' })
      .send({ externalId, name: 'Thandi Mokoena', email: 'thandi@example.com' })
      .expect(201);
    const customer = await prisma.integrationCustomer.findFirstOrThrow({ where: { externalId } });
    expect(customer).toMatchObject({ displayName: 'Thandi Mokoena', email: 'thandi@example.com' });

    // Omitted claims keep what was stored.
    await request(server)
      .post('/api/v1/integrations/customers/identify')
      .auth(identifier, { type: 'bearer' })
      .send({ externalId })
      .expect(201);
    await expect(
      prisma.integrationCustomer.findFirstOrThrow({ where: { externalId } }),
    ).resolves.toMatchObject({ displayName: 'Thandi Mokoena' });
  });

  it('enforces the field limit in the database as well as the API', async () => {
    const businessId = (await prisma.intakeForm.findUniqueOrThrow({ where: { id: form.id } }))
      .businessId;
    await expect(
      prisma.intakeForm.create({ data: { businessId, name: 'Empty', fields: [] } }),
    ).rejects.toThrow();
  });
});
