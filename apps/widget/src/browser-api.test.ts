import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const socket = vi.hoisted(() => ({
  on: vi.fn(),
  io: { on: vi.fn() },
  disconnect: vi.fn(),
  emit: vi.fn(),
  connected: false,
}));
vi.mock('socket.io-client', () => ({ io: () => socket }));
import './loader';

const bootstrap = {
  visitorToken: 'visitor-secret-value',
  widgetSessionToken: 'widget-secret',
  widgetSessionExpiresAt: new Date(Date.now() + 300000).toISOString(),
  availability: 'UNKNOWN',
  config: {
    businessName: 'Shop',
    primaryColor: '#155f43',
    greeting: 'Hi',
    launcherPosition: 'BOTTOM_RIGHT',
    departmentSelectionEnabled: false,
    queueMessage: 'Wait',
    offlineMessage: 'Offline',
    resolvedMessage: 'Resolved',
  },
  departments: [],
};
describe('Website browser API', () => {
  const ready = vi.fn();
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve({ ok: true, json: () => Promise.resolve(bootstrap) }),
        ),
    );
    localStorage.clear();
    window.addEventListener('bizchat:ready', ready);
    const widget = document.createElement('bizchat-widget');
    widget.setAttribute('business-id', 'pub_12345678');
    widget.setAttribute('api-url', 'https://api.example.com');
    document.body.append(widget);
  });
  afterEach(() => {
    window.removeEventListener('bizchat:ready', ready);
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  it('exposes open/close and reports initialization', async () => {
    await vi.waitFor(() => expect(ready).toHaveBeenCalled());
    expect(() => {
      window.BizChat!.open();
      window.BizChat!.close();
    }).not.toThrow();
    window.removeEventListener('bizchat:ready', ready);
  });
  it('keeps customer proofs in memory and clears state on logout', async () => {
    await vi.waitFor(() =>
      expect(localStorage.getItem('bizchat:visitor:pub_12345678')).toBe(bootstrap.visitorToken),
    );
    const previous = document.querySelector('bizchat-widget');
    const proof = 'signed-customer-proof'.repeat(3);
    window.BizChat!.identify(proof);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(document.querySelector('bizchat-widget')).not.toBe(previous);
    const options = vi.mocked(fetch).mock.calls[1]![1]!;
    expect(JSON.parse(options.body as string)).toMatchObject({ identityToken: proof });
    expect(localStorage.getItem('bizchat:visitor:pub_12345678')).toBeNull();
    expect(document.body.innerHTML).not.toContain(proof);
    window.BizChat!.logout();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(JSON.parse(vi.mocked(fetch).mock.calls[2]![1]!.body as string)).not.toHaveProperty(
      'identityToken',
    );
  });
});
