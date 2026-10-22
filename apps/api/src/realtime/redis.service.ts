import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Environment } from '../config/environment';

@Injectable()
export class RedisService extends Redis implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  public constructor(config: ConfigService<Environment, true>) {
    super(config.get('REDIS_URL', { infer: true }), {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      connectTimeout: 3_000,
      retryStrategy: (attempt) => Math.min(attempt * 250, 5_000),
    });
  }

  public async onModuleInit(): Promise<void> {
    if (this.status !== 'wait') return;
    await this.connect().catch((error: unknown) => {
      this.logger.warn(
        `Redis started in degraded mode: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
  public async onModuleDestroy(): Promise<void> {
    if (this.status !== 'end') await this.quit();
  }
}
