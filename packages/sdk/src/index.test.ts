import { afterEach, describe, expect, it, vi } from 'vitest';
import { BizChatClient, BizChatError, backoff, parseWebhook, verifyWebhook } from './index';

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

function client(responses: Response[]): { sdk: BizChatClient; calls: [string, RequestInit][] } {
  const calls: [string, RequestInit][] = [];
  const fetcher = vi.fn((url: string, init: RequestInit) => {
    calls.push([url, init]);
    const next = responses.shift();
    return next ? Promise.resolve(next) : Promise.reject(new Error('no response queued'));
  });
  return {
    sdk: new BizChatClient({
      apiKey: 'bzc_test',
      baseUrl: 'https://api.example.test/',
      fetch: fetcher as unknown as typeof fetch,
    }),
    calls,
  };
}
const header = (init: RequestInit, name: string): string | undefined =>
  (init.headers as Record<string, string>)[name];

afterEach(() => vi.useRealTimers());

describe('BizChatClient', () => {
  it('authenticates with the key and builds integration URLs', async () => {
    const { sdk, calls } = client([json(200, { conversations: [], nextCursor: null })]);
    await sdk.conversations.list({ limit: 10 });
    expect(calls[0]![0]).toBe(
      'https://api.example.test/api/v1/integrations/conversations?limit=10',
    );
    expect(header(calls[0]![1], 'authorization')).toBe('Bearer bzc_test');
  });

  it('rejects anything but an integration key', () => {
    expect(() => new BizChatClient({ apiKey: 'sk_live', baseUrl: 'https://x.test' })).toThrow();
  });

  it('retries a write with the same idempotency key, honouring Retry-After', async () => {
    vi.useFakeTimers();
    const { sdk, calls } = client([
      json(503, { error: { code: 'UNAVAILABLE', message: 'Try again' } }, { 'retry-after': '1' }),
      json(201, { conversation: { id: 'c1' }, message: { id: 'm1' } }),
    ]);
    const pending = sdk.conversations.create({ externalId: 'customer-1', content: 'Hello' });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toMatchObject({ conversation: { id: 'c1' } });
    const keys = calls.map(([, init]) => header(init, 'idempotency-key'));
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it('uses a caller-supplied idempotency key', async () => {
    const { sdk, calls } = client([json(201, { id: 'm1' })]);
    await sdk.conversations.send('c1', 'Hi', { idempotencyKey: 'job-42-send' });
    expect(header(calls[0]![1], 'idempotency-key')).toBe('job-42-send');
    expect(calls[0]![1].body).toBe(JSON.stringify({ content: 'Hi' }));
  });

  it('does not retry a write that has no idempotency protection', async () => {
    const { sdk, calls } = client([json(503, { error: { code: 'UNAVAILABLE', message: 'Down' } })]);
    await expect(sdk.setup.skills.create({ name: 'Tax' })).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(1);
  });

  it('turns error responses into BizChatError with the code and request ID', async () => {
    const { sdk } = client([
      json(409, { error: { code: 'TOPIC_EXISTS', message: 'Exists', requestId: 'req-1' } }),
    ]);
    const failure = sdk.setup.topics.create({ name: 'Tax' });
    await expect(failure).rejects.toBeInstanceOf(BizChatError);
    await expect(failure).rejects.toMatchObject({
      status: 409,
      code: 'TOPIC_EXISTS',
      requestId: 'req-1',
    });
  });

  it('backs off exponentially with jitter, capped at eight seconds', () => {
    expect(backoff(0, () => 1)).toBe(500);
    expect(backoff(3, () => 1)).toBe(4_000);
    expect(backoff(10, () => 1)).toBe(8_000);
    expect(backoff(2, () => 0)).toBe(0);
  });
});

describe('webhooks', () => {
  // Produced by the API's own signing function, so the SDK is checked against the real format.
  const secret = 'whsec_test_vector';
  const rawBody = '{"id":"evt-1","type":"conversation.queued"}';
  const signature =
    't=1792915200,v1=64b69e06f0457ff5d4e65dd8d8b72d0682cbbe1798ac0e253c58cf5387a71b7f';
  const now = new Date(1_792_915_260_000);

  it('accepts a genuine signature within the time window', () => {
    expect(verifyWebhook({ rawBody, signature, secret, now })).toBe(true);
    expect(parseWebhook({ rawBody: Buffer.from(rawBody), signature, secret, now })).toEqual({
      id: 'evt-1',
      type: 'conversation.queued',
    });
  });

  it('rejects a changed body, another secret, an old timestamp, or a malformed header', () => {
    expect(
      verifyWebhook({ rawBody: rawBody.replace('evt-1', 'evt-2'), signature, secret, now }),
    ).toBe(false);
    expect(verifyWebhook({ rawBody, signature, secret: 'whsec_other', now })).toBe(false);
    expect(verifyWebhook({ rawBody, signature, secret, now: new Date(1_792_916_000_000) })).toBe(
      false,
    );
    expect(verifyWebhook({ rawBody, signature: 'v1=abc', secret, now })).toBe(false);
    expect(verifyWebhook({ rawBody, signature: undefined, secret, now })).toBe(false);
    expect(() => parseWebhook({ rawBody, signature: 'nope', secret, now })).toThrow(BizChatError);
  });
});
