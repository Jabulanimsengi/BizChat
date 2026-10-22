import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { RedisService } from './redis.service';

@Module({ controllers: [HealthController], providers: [RedisService] })
export class HealthModule {}
