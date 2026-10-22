import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class ProxyAwareThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(request: Record<string, unknown>): Promise<string> {
    const ips: unknown[] = Array.isArray(request['ips']) ? request['ips'] : [];
    const forwarded = typeof ips[0] === 'string' ? ips[0] : undefined;
    const direct = typeof request['ip'] === 'string' ? request['ip'] : undefined;
    const socket =
      typeof request['socket'] === 'object' && request['socket'] !== null
        ? (request['socket'] as { remoteAddress?: unknown })
        : undefined;
    const remote = typeof socket?.remoteAddress === 'string' ? socket.remoteAddress : undefined;
    return Promise.resolve(normalizeClientAddress(forwarded ?? direct ?? remote));
  }
}

export function normalizeClientAddress(value: string | undefined): string {
  if (!value) return 'unknown';
  const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  return mapped?.[1] ?? value;
}
