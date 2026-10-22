import { WebhookTransport } from './webhook-transport';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { EventEmitter } from 'node:events';
jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
jest.mock('node:https', () => ({ request: jest.fn() }));

const mockLookup = lookup as unknown as jest.Mock<
  Promise<{ address: string; family: number }[]>,
  [string, object]
>;
describe('Webhook transport DNS pinning', () => {
  beforeEach(() => jest.clearAllMocks());
  it('rejects a mixed public/private DNS answer before connecting', async () => {
    mockLookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(
      new WebhookTransport().send('https://receiver.example.com/events', '{}', 'sig', 'id'),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it('connects to the checked IP with the original TLS hostname and does not follow redirects', async () => {
    mockLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    const outgoing = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
    const response = { statusCode: 302, destroy: jest.fn() };
    jest.mocked(request).mockImplementation((...args: unknown[]) => {
      const callback = args[1] as (value: typeof response) => void;
      outgoing.end = (): void => {
        callback(response);
        outgoing.emit('close');
      };
      outgoing.destroy = (): void => {
        outgoing.emit('close');
      };
      return outgoing as ReturnType<typeof request>;
    });
    await expect(
      new WebhookTransport().send('https://receiver.example.com/events', '{}', 'sig', 'id'),
    ).resolves.toBe(302);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: '8.8.8.8',
        servername: 'receiver.example.com',
        path: '/events',
        port: 443,
      }),
      expect.any(Function),
    );
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
