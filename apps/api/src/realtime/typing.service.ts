import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TypingEvent } from '@bizchat/types';
import type { Environment } from '../config/environment';
import { RedisService } from './redis.service';

@Injectable()
export class TypingService {
  private readonly logger = new Logger(TypingService.name);
  private readonly ttlSeconds: number;
  public constructor(
    private readonly redis: RedisService,
    config: ConfigService<Environment, true>,
  ) {
    this.ttlSeconds = config.get('TYPING_TTL_SECONDS', { infer: true });
  }

  public async start(event: Omit<TypingEvent, 'typing' | 'expiresAt'>): Promise<TypingEvent> {
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000).toISOString();
    const result: TypingEvent = { ...event, typing: true, expiresAt };
    try {
      await this.redis.set(
        this.key(event.conversationId, event.participantType, event.participantId),
        JSON.stringify(result),
        'EX',
        this.ttlSeconds,
      );
    } catch (error) {
      this.logger.warn(
        `Redis typing unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return result;
  }

  public async stop(event: Omit<TypingEvent, 'typing' | 'expiresAt'>): Promise<TypingEvent> {
    try {
      await this.redis.del(
        this.key(event.conversationId, event.participantType, event.participantId),
      );
    } catch (error) {
      this.logger.warn(
        `Redis typing unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { ...event, typing: false, expiresAt: null };
  }

  private key(conversationId: string, type: string, id: string): string {
    return `typing:${conversationId}:${type}:${id}`;
  }
}
