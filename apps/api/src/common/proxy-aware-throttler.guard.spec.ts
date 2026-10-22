import { normalizeClientAddress, ProxyAwareThrottlerGuard } from './proxy-aware-throttler.guard';

class ExposedThrottlerGuard extends ProxyAwareThrottlerGuard {
  public resolve(request: Record<string, unknown>): Promise<string> {
    return this.getTracker(request);
  }
}

describe('ProxyAwareThrottlerGuard', () => {
  const guard = new ExposedThrottlerGuard({} as never, {} as never, {} as never);

  it('prefers the first trusted forwarded address', async () => {
    await expect(guard.resolve({ ips: ['203.0.113.9', '10.0.0.2'], ip: '10.0.0.2' })).resolves.toBe(
      '203.0.113.9',
    );
  });

  it('falls back to the express-resolved address', async () => {
    await expect(guard.resolve({ ips: [], ip: '198.51.100.7' })).resolves.toBe('198.51.100.7');
  });

  it('falls back to the socket address and marks unknown clients', async () => {
    await expect(guard.resolve({ socket: { remoteAddress: '::ffff:192.0.2.55' } })).resolves.toBe(
      '192.0.2.55',
    );
    await expect(guard.resolve({})).resolves.toBe('unknown');
  });
});

describe('normalizeClientAddress', () => {
  it('unwraps IPv4-mapped IPv6 addresses', () => {
    expect(normalizeClientAddress('::ffff:127.0.0.1')).toBe('127.0.0.1');
  });

  it('leaves plain addresses untouched', () => {
    expect(normalizeClientAddress('2001:db8::1')).toBe('2001:db8::1');
    expect(normalizeClientAddress(undefined)).toBe('unknown');
  });
});
