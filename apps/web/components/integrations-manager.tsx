'use client';
import { useEffect, useState } from 'react';
import { apiRequest, API_ORIGIN } from '../lib/api';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';

const scopes = [
  'conversations:read',
  'conversations:write',
  'messages:read',
  'messages:write',
  'customers:identify',
  'intake:read',
  'availability:read',
  'setup:read',
  'setup:write',
];
export const webhookEvents = [
  'conversation.created',
  'message.created',
  'conversation.resolved',
  'conversation.queued',
  'conversation.offered',
  'conversation.assigned',
  'conversation.overflowed',
  'conversation.follow_up_requested',
  'conversation.closed',
];
interface Key {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}
interface Endpoint {
  id: string;
  url: string;
  enabled: boolean;
  events: string[];
}
interface Delivery {
  id: string;
  eventId: string;
  attempts: number;
  deliveredAt: string | null;
  failedAt: string | null;
  lastStatus: number | null;
}
export function IntegrationsManager() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>();
  const [secret, setSecret] = useState<{ label: string; value: string }>();
  const [name, setName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>([
    'conversations:read',
    'messages:read',
  ]);
  const [days, setDays] = useState(90);
  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>(webhookEvents);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function refresh(): Promise<void> {
    const [k, e] = await Promise.all([
      apiRequest<Key[]>('/integration-settings/keys'),
      apiRequest<Endpoint[]>('/integration-settings/webhooks'),
    ]);
    setKeys(k);
    setEndpoints(e);
  }
  useEffect(() => {
    void Promise.all([
      apiRequest<Key[]>('/integration-settings/keys'),
      apiRequest<Endpoint[]>('/integration-settings/webhooks'),
    ])
      .then(([k, e]) => {
        setKeys(k);
        setEndpoints(e);
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Unable to load integrations'),
      );
  }, []);
  async function act(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }
  async function loadDeliveries(id: string): Promise<void> {
    setDeliveries(await apiRequest<Delivery[]>(`/integration-settings/webhooks/${id}/deliveries`));
    setSelectedEndpoint(id);
  }
  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {secret && (
        <Card className="space-y-3 border-moss p-5">
          <h2 className="font-semibold">Save your {secret.label}</h2>
          <p className="text-sm">This secret is shown once. Store it securely on your server.</p>
          <code className="block break-all rounded bg-cream p-3">{secret.value}</code>
          <Button
            onClick={() => {
              void navigator.clipboard
                .writeText(secret.value)
                .catch(() => setError('Copy failed. Select and copy the secret manually.'));
            }}
          >
            Copy secret
          </Button>{' '}
          <Button variant="ghost" onClick={() => setSecret(undefined)}>
            Dismiss
          </Button>
        </Card>
      )}
      <Card className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">API keys</h2>
        <p className="text-sm text-slate-600">
          Use bearer authentication from your server. Browser integrations use the public widget.
          Keys can access the selected resources across your business.
        </p>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              const result = await apiRequest<{ token: string }>('/integration-settings/keys', {
                method: 'POST',
                body: JSON.stringify({ name, scopes: selectedScopes, expiresInDays: days }),
              });
              setSecret({ label: 'API key', value: result.token });
              setName('');
            });
          }}
        >
          <label className="block text-sm">
            Key name
            <Input
              required
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="My website backend"
            />
          </label>
          <label className="block text-sm">
            Expires in days
            <Input
              type="number"
              min={1}
              max={365}
              required
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
            />
          </label>
          <fieldset className="flex flex-wrap gap-4">
            <legend className="mb-2 text-sm font-medium">Permissions</legend>
            {scopes.map((scope) => (
              <label key={scope} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedScopes.includes(scope)}
                  onChange={(event) =>
                    setSelectedScopes((items) =>
                      event.target.checked
                        ? [...items, scope]
                        : items.filter((item) => item !== scope),
                    )
                  }
                />
                {scope}
              </label>
            ))}
          </fieldset>
          <Button disabled={busy || selectedScopes.length === 0}>Create key</Button>
        </form>
        <ul className="divide-y">
          {keys.map((key) => (
            <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">
                  {key.name} <span className="text-sm text-slate-500">{key.prefix}…</span>
                </p>
                <p className="text-sm text-slate-500">
                  {key.revokedAt
                    ? 'Revoked'
                    : `Expires ${new Date(key.expiresAt).toLocaleDateString()}`}{' '}
                  · Last used {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : 'never'}
                </p>
              </div>
              {!key.revokedAt && (
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const result = await apiRequest<{ token: string }>(
                          `/integration-settings/keys/${key.id}/rotate`,
                          { method: 'POST' },
                        );
                        setSecret({
                          label: 'replacement API key (previous key is revoked)',
                          value: result.token,
                        });
                      })
                    }
                  >
                    Rotate
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        apiRequest<void>(`/integration-settings/keys/${key.id}/revoke`, {
                          method: 'POST',
                        }),
                      )
                    }
                  >
                    Revoke
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">Webhooks</h2>
        <p className="text-sm text-slate-600">
          Choose the events to receive. Verify the signature before processing events. Internal
          notes and follow-up contact details are never sent.
        </p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              const result = await apiRequest<{ secret: string }>(
                '/integration-settings/webhooks',
                {
                  method: 'POST',
                  body: JSON.stringify({
                    url,
                    events: selectedEvents,
                  }),
                },
              );
              setSecret({ label: 'webhook signing secret', value: result.secret });
              setUrl('');
            });
          }}
        >
          <label className="min-w-64 flex-1 text-sm">
            Public HTTPS endpoint
            <Input
              type="url"
              required
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://your-site.com/webhooks/bizchat"
            />
          </label>
          <fieldset className="flex w-full flex-wrap gap-x-4 gap-y-2">
            <legend className="mb-2 text-sm font-medium">Events</legend>
            {webhookEvents.map((item) => (
              <label key={item} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedEvents.includes(item)}
                  onChange={(event) =>
                    setSelectedEvents((items) =>
                      event.target.checked
                        ? [...items, item]
                        : items.filter((entry) => entry !== item),
                    )
                  }
                />
                {item}
              </label>
            ))}
          </fieldset>
          <Button disabled={busy || selectedEvents.length === 0}>Add webhook</Button>
        </form>
        <ul className="divide-y">
          {endpoints.map((endpoint) => (
            <li
              key={endpoint.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <p className="break-all text-sm">
                {endpoint.url} · {endpoint.enabled ? 'Enabled' : 'Disabled'}
                <span className="block text-xs text-slate-500">{endpoint.events.join(', ')}</span>
              </p>
              <div>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void act(() => loadDeliveries(endpoint.id))}
                >
                  Deliveries
                </Button>
                {endpoint.enabled && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        apiRequest<void>(`/integration-settings/webhooks/${endpoint.id}/disable`, {
                          method: 'POST',
                        }),
                      )
                    }
                  >
                    Disable
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {selectedEndpoint && (
          <div>
            <h3 className="font-medium">Recent deliveries</h3>
            {deliveries.length === 0 && <p className="text-sm">No deliveries yet.</p>}
            <ul>
              {deliveries.map((delivery) => (
                <li key={delivery.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                  <span>
                    {delivery.eventId} ·{' '}
                    {delivery.deliveredAt ? 'Delivered' : delivery.failedAt ? 'Failed' : 'Pending'}{' '}
                    · {delivery.attempts} attempts · HTTP {delivery.lastStatus ?? '—'}
                  </span>
                  {delivery.failedAt && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await apiRequest(
                            `/integration-settings/deliveries/${delivery.id}/replay`,
                            { method: 'POST' },
                          );
                          await loadDeliveries(selectedEndpoint);
                        })
                      }
                    >
                      Replay
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
      <Card className="space-y-3 p-6">
        <h2 className="font-semibold">Developer reference</h2>
        <a
          className="text-moss underline"
          href={`${API_ORIGIN}/api/v1/integrations/openapi.json`}
          target="_blank"
          rel="noreferrer"
        >
          OpenAPI specification
        </a>
        <p className="text-sm">
          Base URL: <code>{API_ORIGIN}/api/v1/integrations</code>
        </p>
        <p className="text-sm">
          Send <code>Authorization: Bearer YOUR_KEY</code>. Chat writes require an{' '}
          <code>Idempotency-Key</code>; reuse it when retrying the same request.
        </p>
      </Card>
    </div>
  );
}
