import type { RedisService } from '../realtime/redis.service';
import { RedisThrottlerStorage } from './redis-throttler.storage';

describe('RedisThrottlerStorage', () => {
  it('maps the atomic Redis result to the throttler contract', async () => {
    const evalCommand = jest.fn().mockResolvedValue([6, 59_001, 1, 30_000]);
    const storage = new RedisThrottlerStorage({ eval: evalCommand } as unknown as RedisService);

    await expect(storage.increment('route:client', 10_000, 5, 30_000, 'default')).resolves.toEqual({
      totalHits: 6,
      timeToExpire: 60,
      isBlocked: true,
      timeToBlockExpire: 30,
    });
    expect(evalCommand).toHaveBeenCalledWith(
      expect.any(String),
      2,
      expect.stringMatching(/^bizchat:throttle:[a-f0-9]{64}:count$/),
      expect.stringMatching(/^bizchat:throttle:[a-f0-9]{64}:block$/),
      '10000',
      '5',
      '30000',
    );
  });

  it('fails closed when Redis returns an invalid result', async () => {
    const storage = new RedisThrottlerStorage({
      eval: jest.fn().mockResolvedValue(null),
    } as unknown as RedisService);

    await expect(storage.increment('route:client', 10_000, 5, 30_000, 'default')).rejects.toThrow(
      'invalid throttling result',
    );
  });

  it('fails open when the Redis connection is unavailable', async () => {
    const storage = new RedisThrottlerStorage({
      eval: jest.fn().mockRejectedValue(new Error('connection is closed')),
    } as unknown as RedisService);

    await expect(storage.increment('route:client', 10_000, 5, 30_000, 'default')).resolves.toEqual({
      totalHits: 1,
      timeToExpire: 0,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  it('fails closed when configured to do so and Redis is unavailable', async () => {
    const storage = new RedisThrottlerStorage(
      {
        eval: jest.fn().mockRejectedValue(new Error('connection is closed')),
      } as unknown as RedisService,
      'closed',
    );

    await expect(storage.increment('route:client', 10_000, 5, 30_000, 'default')).resolves.toEqual({
      totalHits: 6,
      timeToExpire: 10,
      isBlocked: true,
      timeToBlockExpire: 30,
    });
  });
});
