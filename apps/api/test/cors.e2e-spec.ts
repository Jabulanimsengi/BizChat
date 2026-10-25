import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-app';

describe('CORS policies (real application)', () => {
  const dashboard = process.env.DASHBOARD_URL ?? 'http://127.0.0.1:3000';
  let app: NestExpressApplication;
  let server: Server;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureApplication(app);
    app.useLogger(false);
    await app.init();
    server = app.getHttpServer();
  }, 90_000);

  afterAll(async () => {
    await app?.close();
  });

  it('gives dashboard routes named like the widget the credentialed dashboard policy', async () => {
    // Regression: /api/v1/widget-settings used to match the public widget policy by prefix.
    const preflight = await request(server)
      .options('/api/v1/widget-settings')
      .set('Origin', dashboard)
      .set('Access-Control-Request-Method', 'PATCH')
      .expect(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(dashboard);
    expect(preflight.headers['access-control-allow-credentials']).toBe('true');
    expect(preflight.headers['access-control-allow-methods']).toContain('PATCH');
  });

  it('keeps public widget routes open to any site, without credentials', async () => {
    const preflight = await request(server)
      .options('/api/v1/widget/bootstrap')
      .set('Origin', 'https://customer-site.example')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('https://customer-site.example');
    expect(preflight.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('refuses dashboard routes to other origins', async () => {
    const preflight = await request(server)
      .options('/api/v1/widget-settings')
      .set('Origin', 'https://customer-site.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });
});
