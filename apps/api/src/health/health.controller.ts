import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from './redis.service';

@SkipThrottle()
@Controller('health')
export class HealthController {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('live')
  public live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  public async ready(): Promise<{ status: 'ok'; checks: { postgres: 'ok'; redis: 'ok' } }> {
    try {
      await Promise.all([this.prisma.$queryRaw`SELECT 1`, this.redis.ping()]);
      return { status: 'ok', checks: { postgres: 'ok', redis: 'ok' } };
    } catch {
      throw new ServiceUnavailableException({
        code: 'NOT_READY',
        message: 'A required dependency is unavailable',
      });
    }
  }
}
