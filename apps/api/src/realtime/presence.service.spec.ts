import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment';
import type { RedisService } from './redis.service';
import { PresenceService } from './presence.service';

describe('PresenceService', () => {
  function setup(socketCount: number): {
    service: PresenceService;
    redis: {
      multi: jest.Mock;
      expire: jest.Mock;
      zremrangebyscore: jest.Mock;
      zcard: jest.Mock;
      get: jest.Mock;
      zrem: jest.Mock;
      set: jest.Mock;
    };
    chain: {
      zremrangebyscore: jest.Mock;
      zadd: jest.Mock;
      expire: jest.Mock;
      set: jest.Mock;
      exec: jest.Mock;
    };
  } {
    const chain = {
      zremrangebyscore: jest.fn(),
      zadd: jest.fn(),
      expire: jest.fn(),
      set: jest.fn(),
      exec: jest.fn().mockResolvedValue([]),
    };
    chain.zremrangebyscore.mockReturnValue(chain);
    chain.zadd.mockReturnValue(chain);
    chain.expire.mockReturnValue(chain);
    chain.set.mockReturnValue(chain);
    const redis = {
      multi: jest.fn().mockReturnValue(chain),
      expire: jest.fn().mockResolvedValue(1),
      zremrangebyscore: jest.fn().mockResolvedValue(0),
      zcard: jest.fn().mockResolvedValue(socketCount),
      get: jest.fn().mockResolvedValue('AWAY'),
      zrem: jest.fn().mockResolvedValue(1),
      set: jest.fn().mockResolvedValue('OK'),
    };
    const config = { get: jest.fn().mockReturnValue(45) };
    return {
      service: new PresenceService(
        redis as unknown as RedisService,
        config as unknown as ConfigService<Environment, true>,
      ),
      redis,
      chain,
    };
  }

  it('refreshes an agent connection with a TTL-backed socket lease', async () => {
    const { service, chain } = setup(1);
    expect(await service.refreshAgent('business-1', 'profile-1', 'socket-1', 'ONLINE')).toBe(
      'AWAY',
    );
    expect(chain.zadd).toHaveBeenCalledWith(
      'presence:agent:business-1:profile-1:sockets',
      expect.any(Number),
      'socket-1',
    );
    expect(chain.expire).toHaveBeenCalledWith('presence:agent:business-1:profile-1:sockets', 90);
  });

  it('reports offline when no unexpired sockets remain', async () => {
    const { service } = setup(0);
    expect(await service.getAgentState('business-1', 'profile-1')).toBe('OFFLINE');
  });
});
