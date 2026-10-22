import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment';
import type { RedisService } from './redis.service';
import { TypingService } from './typing.service';

describe('TypingService', () => {
  const redis = { set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) };
  const config = { get: jest.fn().mockReturnValue(6) };
  const typing = new TypingService(
    redis as unknown as RedisService,
    config as unknown as ConfigService<Environment, true>,
  );
  const event = {
    conversationId: 'conversation-1',
    participantType: 'AGENT' as const,
    participantId: 'agent-1',
    displayName: 'Agent One',
  };

  beforeEach(() => jest.clearAllMocks());

  it('stores typing only as an expiring Redis value', async () => {
    const result = await typing.start(event);
    expect(result.typing).toBe(true);
    expect(result.expiresAt).not.toBeNull();
    expect(redis.set).toHaveBeenCalledWith(
      'typing:conversation-1:AGENT:agent-1',
      expect.any(String),
      'EX',
      6,
    );
  });

  it('deletes transient typing state when stopped', async () => {
    expect(await typing.stop(event)).toMatchObject({ typing: false, expiresAt: null });
    expect(redis.del).toHaveBeenCalledWith('typing:conversation-1:AGENT:agent-1');
  });
});
