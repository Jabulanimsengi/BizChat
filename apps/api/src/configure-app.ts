import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';

import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import type { Request } from 'express';

import { ApiExceptionFilter } from './common/api-exception.filter';
import { JsonLogger } from './common/json-logger';
import { RequestLoggingMiddleware } from './common/request-logging.middleware';
import { requestIdMiddleware } from './common/request-id.middleware';
import { securityHeadersMiddleware } from './common/security-headers.middleware';
import { parseTrustedProxies, type Environment } from './config/environment';
import { MetricsService } from './metrics/metrics.service';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

export function configureApplication(app: NestExpressApplication): void {
  app.useLogger(new JsonLogger());
  app.disable('x-powered-by');
  const config = app.get(ConfigService<Environment, true>);
  const trustedProxies = parseTrustedProxies(config.get('TRUSTED_PROXIES', { infer: true }));
  app.set('trust proxy', trustedProxies.length > 0 ? trustedProxies : false);
  if (config.get('SOCKET_REDIS_ADAPTER_ENABLED', { infer: true })) {
    app.useWebSocketAdapter(new RedisIoAdapter(app, config.get('REDIS_URL', { infer: true })));
  }
  const allowedOrigins = [
    config.get('DASHBOARD_URL', { infer: true }),
    ...config
      .get('ALLOWED_DEV_ORIGINS', { infer: true })
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ];

  app.setGlobalPrefix('api/v1');
  app.use(securityHeadersMiddleware);
  app.use(requestIdMiddleware);
  const requestLogging = new RequestLoggingMiddleware(app.get(MetricsService));
  app.use(requestLogging.use.bind(requestLogging));
  app.use(cookieParser());
  app.use(
    cors((request: Request, callback) => {
      const origin = request.header('origin');
      const widgetRequest = request.path.startsWith('/api/v1/widget');
      if (widgetRequest && origin) {
        callback(null, { origin, credentials: false, methods: ['GET', 'POST', 'OPTIONS'] });
        return;
      }
      callback(null, {
        origin: origin ? allowedOrigins.includes(origin) : false,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      });
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
}
