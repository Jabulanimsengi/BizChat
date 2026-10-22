import { BadRequestException, Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';

export function publicIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number) as [number, number, number, number];
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
export function webhookUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    (url.port && url.port !== '443') ||
    url.username ||
    url.password ||
    url.hash ||
    isIP(url.hostname) ||
    url.hostname.includes(':') ||
    !url.hostname.includes('.')
  )
    throw new BadRequestException({
      code: 'WEBHOOK_URL_INVALID',
      message: 'Use a public HTTPS hostname on port 443 without credentials or fragments',
    });
  return url;
}

@Injectable()
export class WebhookTransport {
  public async validate(value: string): Promise<{ url: URL; address: string }> {
    const url = webhookUrl(value);
    let timer: NodeJS.Timeout | undefined;
    try {
      const addresses = await Promise.race([
        lookup(url.hostname, { all: true, family: 4 }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('DNS timeout')), 5000);
        }),
      ]);
      if (!addresses.length || addresses.some(({ address }) => !publicIPv4(address)))
        throw new Error('Non-public destination');
      return { url, address: addresses[0]!.address };
    } catch {
      throw new BadRequestException({
        code: 'WEBHOOK_URL_UNREACHABLE',
        message: 'Webhook hostname must resolve only to public IPv4 addresses',
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  public async send(
    value: string,
    body: string,
    signature: string,
    eventId: string,
  ): Promise<number> {
    // Resolve on every attempt and connect to that exact checked IP. No redirects or second DNS lookup.
    const { url, address } = await this.validate(value);
    return new Promise((resolve, reject) => {
      const outgoing = request(
        {
          hostname: address,
          servername: url.hostname,
          port: 443,
          path: `${url.pathname}${url.search}`,
          method: 'POST',
          agent: false,
          headers: {
            host: url.host,
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            'user-agent': 'BizChat-Webhooks/1.0',
            'x-bizchat-signature': signature,
            'x-bizchat-event-id': eventId,
          },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          response.destroy();
          resolve(status);
        },
      );
      const timer = setTimeout(() => outgoing.destroy(new Error('Webhook timeout')), 10_000);
      outgoing.once('close', () => clearTimeout(timer));
      outgoing.once('error', reject);
      outgoing.end(body);
    });
  }
}
