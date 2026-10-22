import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ApiExceptionFilter } from '../src/common/api-exception.filter';

interface MeResponse {
  user: { email: string; emailVerified: boolean };
  membership: { role: string };
}

describe('HTTP integration (real Postgres + Redis)', () => {
  let app: INestApplication;
  let server: Server;
  const email = `owner-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    server = app.getHttpServer() as Server;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('reports ready when dependencies are reachable', async () => {
    await request(server).get('/api/v1/health/ready').expect(200);
  });

  it('rejects protected routes without a session', async () => {
    await request(server).get('/api/v1/domains').expect(401);
  });

  it('registers an owner, exposes the session, and logs out', async () => {
    const agent = request.agent(server);
    await agent
      .post('/api/v1/auth/register')
      .send({
        businessName: 'Integration Co',
        displayName: 'Integration Owner',
        email,
        password: 'correct-horse-battery',
        timezone: 'UTC',
      })
      .expect(201);

    const session = await agent.get('/api/v1/auth/me').expect(200);
    const body = session.body as MeResponse;
    expect(body.user.email).toBe(email);
    expect(body.user.emailVerified).toBe(false);
    expect(body.membership.role).toBe('OWNER');

    await agent.post('/api/v1/auth/password/forgot').send({ email }).expect(202);
    await agent
      .post('/api/v1/auth/email/verify')
      .send({ token: 'not-a-real-token-value-1234567890' })
      .expect(400);

    await agent.post('/api/v1/auth/logout').expect(204);
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('rejects a registration with an invalid timezone', async () => {
    await request(server)
      .post('/api/v1/auth/register')
      .send({
        businessName: 'Bad Timezone Co',
        displayName: 'Bad Owner',
        email: `bad-${Date.now()}@example.com`,
        password: 'correct-horse-battery',
        timezone: 'Mars/Olympus',
      })
      .expect(400);
  });
});
