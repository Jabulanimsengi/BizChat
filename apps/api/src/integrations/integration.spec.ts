import { publicIPv4, webhookUrl } from './webhook-transport';
import { webhookSignature } from './webhook.service';
import { idempotencySchema, keySchema, startSchema } from './integration.contracts';
import { requestFingerprint } from './integration.service';
import { integrationOpenApi } from './integration.openapi';

describe('Integration contracts and outbound security', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.31.0.1',
    '192.168.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '198.19.1.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '192.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
  ])('rejects non-public destination %s', (address) => {
    expect(publicIPv4(address)).toBe(false);
  });
  it('accepts public IPv4 only', () => {
    expect(publicIPv4('8.8.8.8')).toBe(true);
  });
  it.each([
    'http://example.com',
    'https://user:pass@example.com',
    'https://example.com:8443',
    'https://127.0.0.1',
    'https://[::1]',
    'https://localhost',
    'https://example.com/#fragment',
  ])('rejects unsafe webhook URL %s', (url) => {
    expect(() => webhookUrl(url)).toThrow();
  });
  it('signs exact bytes and timestamps', () => {
    const signature = webhookSignature('test-secret', '{"a":1}', 123);
    expect(signature).toMatch(/^t=123,v1=[a-f0-9]{64}$/);
    expect(signature).not.toBe(webhookSignature('test-secret', '{ "a":1}', 123));
    expect(signature).not.toBe(webhookSignature('test-secret', '{"a":1}', 124));
  });
  it('validates scopes and rejects tenant overrides', () => {
    expect(keySchema.safeParse({ name: 'Site', scopes: ['admin'] }).success).toBe(false);
    expect(
      startSchema.safeParse({ externalId: 'customer-1', content: 'hello', businessId: 'other' })
        .success,
    ).toBe(false);
    expect(idempotencySchema.safeParse('bad key').success).toBe(false);
  });
  it('binds retry fingerprints to operation, resource and payload', () => {
    expect(requestFingerprint('send:one', { content: 'a' })).not.toBe(
      requestFingerprint('send:two', { content: 'a' }),
    );
    expect(requestFingerprint('send:one', { content: 'a' })).not.toBe(
      requestFingerprint('send:one', { content: 'b' }),
    );
  });
  it('publishes all integration resources and the same input constraints', () => {
    expect(Object.keys(integrationOpenApi.paths).sort()).toEqual([
      '/availability',
      '/conversations',
      '/conversations/{id}',
      '/conversations/{id}/messages',
      '/conversations/{id}/resolve',
      '/customers/identify',
    ]);
    expect(integrationOpenApi.components.schemas.Start).toMatchObject({
      additionalProperties: false,
      required: ['externalId', 'content'],
      properties: { content: { maxLength: 4000 } },
    });
  });
});
