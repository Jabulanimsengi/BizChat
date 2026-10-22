import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApplication } from './configure-app';
import type { Environment } from './config/environment';
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  configureApplication(app);
  const config = app.get(ConfigService<Environment, true>);
  await app.listen(config.get('API_PORT', { infer: true }));
}
void bootstrap();
