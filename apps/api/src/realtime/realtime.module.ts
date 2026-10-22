import { Global, Module } from '@nestjs/common';
import { PresenceService } from './presence.service';
import { RedisService } from './redis.service';
import { TypingService } from './typing.service';

@Global()
@Module({
  providers: [RedisService, PresenceService, TypingService],
  exports: [RedisService, PresenceService, TypingService],
})
export class RealtimeModule {}
