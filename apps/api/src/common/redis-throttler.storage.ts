import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { RedisService } from '../realtime/redis.service';

const INCREMENT_SCRIPT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  local current = tonumber(redis.call('GET', KEYS[1])) or (tonumber(ARGV[2]) + 1)
  local countTtl = redis.call('PTTL', KEYS[1])
  return {current, countTtl, 1, blockTtl}
end

local hitsfinder = redis.call('INCR', KEYS[1])
if hitsfinder == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local countTtl = redis.call('PTTL', KEYS[1])
if hitsfinder > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return {hitsfinder, countTtl, 1, tonumber(ARGV[3])}
end
return {hitsfinder, countTtl, 0, 0}
`;

export type ThrottlerFailMode = 'open' | 'closed';

export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  public constructor(
    private readonly redis: RedisService,
    private readonly failMode: ThrottlerFailMode = 'open',
  ) {}

  public async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<{
    totalHits: number;
    timeToExpire: number;
    isBlocked: boolean;
    timeToBlockExpire: number;
  }> {
    const digest = createHash('sha256').update(`${throttlerName}:${key}`).digest('hex');
    const prefix = `bizchat:throttle:${digest}`;
    let raw: unknown;
    try {
      raw = await this.redis.eval(
        INCREMENT_SCRIPT,
        2,
        `${prefix}:count`,
        `${prefix}:block`,
        String(ttl),
        String(limit),
        String(blockDuration),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      if (this.failMode === 'closed') {
        this.logger.error(`Throttling storage unavailable, blocking request: ${reason}`);
        return {
          totalHits: limit + 1,
          timeToExpire: millisecondsToSeconds(ttl),
          isBlocked: true,
          timeToBlockExpire: millisecondsToSeconds(blockDuration),
        };
      }
      this.logger.warn(`Throttling storage unavailable, allowing request: ${reason}`);
      return { totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }
    if (!isThrottleResult(raw)) {
      throw new Error('Redis returned an invalid throttling result');
    }
    const [totalHits, expiresInMs, blocked, blockExpiresInMs] = raw;
    return {
      totalHits,
      timeToExpire: millisecondsToSeconds(expiresInMs),
      isBlocked: blocked === 1,
      timeToBlockExpire: millisecondsToSeconds(blockExpiresInMs),
    };
  }
}

function millisecondsToSeconds(value: number): number {
  return value > 0 ? Math.ceil(value / 1_000) : 0;
}

function isThrottleResult(value: unknown): value is [number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((item: unknown) => typeof item === 'number')
  );
}
