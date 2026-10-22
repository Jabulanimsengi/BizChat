'use client';

import type { BusinessDomainResponse, WidgetSettingsResponse } from '@bizchat/types';
import {
  Check,
  Clipboard,
  Globe2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiRequest, API_ORIGIN, WIDGET_SCRIPT_URL } from '../lib/api';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';

export function DomainsManager() {
  const [domains, setDomains] = useState<BusinessDomainResponse[]>([]);
  const [settings, setSettings] = useState<WidgetSettingsResponse>();
  const [domainInput, setDomainInput] = useState('');
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [challenge, setChallenge] = useState<BusinessDomainResponse['verification']>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void Promise.all([
      apiRequest<BusinessDomainResponse[]>('/domains'),
      apiRequest<WidgetSettingsResponse>('/widget-settings'),
    ])
      .then(([items, widget]) => {
        setDomains(items);
        setSettings(widget);
      })
      .catch((cause: unknown) => setError(messageOf(cause)));
  }, []);
  const verified = domains.some((domain) => domain.status === 'VERIFIED');
  const embed = useMemo(
    () =>
      settings
        ? `<script async src="${WIDGET_SCRIPT_URL}" data-business="${settings.businessPublicId}" data-api="${API_ORIGIN}"></script>`
        : '',
    [settings],
  );

  async function addDomain(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy('create');
    setError(undefined);
    try {
      const created = await apiRequest<BusinessDomainResponse>('/domains', {
        method: 'POST',
        body: JSON.stringify({ domain: domainInput }),
      });
      setDomains((items) => [...items, created]);
      setChallenge(created.verification);
      setDomainInput('');
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(undefined);
    }
  }
  async function verifyDomain(id: string): Promise<void> {
    setBusy(id);
    setError(undefined);
    try {
      const updated = await apiRequest<BusinessDomainResponse>(`/domains/${id}/verify`, {
        method: 'POST',
      });
      replace(updated);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(undefined);
    }
  }
  async function regenerate(id: string): Promise<void> {
    setBusy(id);
    setError(undefined);
    try {
      const updated = await apiRequest<BusinessDomainResponse>(`/domains/${id}/challenge`, {
        method: 'POST',
      });
      replace(updated);
      setChallenge(updated.verification);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(undefined);
    }
  }
  async function changeStatus(domain: BusinessDomainResponse): Promise<void> {
    setBusy(domain.id);
    setError(undefined);
    const status = domain.status === 'DISABLED' ? 'PENDING' : 'DISABLED';
    try {
      replace(
        await apiRequest<BusinessDomainResponse>(`/domains/${domain.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        }),
      );
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(undefined);
    }
  }
  async function updateBranding(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!settings) return;
    setBusy('settings');
    const form = new FormData(event.currentTarget);
    try {
      const updated = await apiRequest<WidgetSettingsResponse>('/widget-settings', {
        method: 'PATCH',
        body: JSON.stringify({
          greeting: form.get('greeting'),
          primaryColor: form.get('primaryColor'),
        }),
      });
      setSettings(updated);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(undefined);
    }
  }
  function replace(updated: BusinessDomainResponse): void {
    setDomains((items) => items.map((item) => (item.id === updated.id ? updated : item)));
  }
  async function copy(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
      <div className="space-y-6">
        <Card className="p-6 shadow-none">
          <h3 className="font-semibold">Register a website</h3>
          <p className="mt-1 text-sm text-slate-500">
            Only verified hostnames may initialize this tenant’s widget.
          </p>
          <form className="mt-5 flex gap-3" onSubmit={(event) => void addDomain(event)}>
            <Input
              value={domainInput}
              onChange={(event) => setDomainInput(event.target.value)}
              placeholder="example.com"
              aria-label="Website domain"
              required
            />
            <Button disabled={busy === 'create'}>
              {busy === 'create' ? (
                <LoaderCircle className="animate-spin" size={17} />
              ) : (
                'Add website'
              )}
            </Button>
          </form>
          {error && (
            <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}
        </Card>
        <Card className="overflow-hidden shadow-none">
          <div className="border-b border-line p-6">
            <h3 className="font-semibold">Authorized websites</h3>
            <p className="mt-1 text-sm text-slate-500">
              Hostname matching is exact; registering example.com does not implicitly permit
              www.example.com.
            </p>
          </div>
          {domains.length === 0 ? (
            <div className="grid place-items-center p-12 text-center">
              <Globe2 className="text-slate-300" size={32} />
              <p className="mt-3 text-sm text-slate-500">No websites registered yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {domains.map((domain) => (
                <div
                  key={domain.id}
                  className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`grid size-10 place-items-center rounded-xl ${domain.status === 'VERIFIED' ? 'bg-mint text-moss' : domain.status === 'DISABLED' ? 'bg-slate-100 text-slate-400' : 'bg-amber-50 text-amber-700'}`}
                    >
                      {domain.status === 'VERIFIED' ? (
                        <ShieldCheck size={19} />
                      ) : domain.status === 'DISABLED' ? (
                        <ShieldOff size={19} />
                      ) : (
                        <Globe2 size={19} />
                      )}
                    </span>
                    <div>
                      <p className="font-semibold">{domain.domain}</p>
                      <p className="text-xs capitalize text-slate-500">
                        {domain.status.toLowerCase()}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {domain.status === 'PENDING' && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void regenerate(domain.id)}
                          disabled={busy === domain.id}
                        >
                          <RefreshCw size={14} /> Challenge
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => void verifyDomain(domain.id)}
                          disabled={busy === domain.id}
                        >
                          Verify DNS
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void changeStatus(domain)}
                      disabled={busy === domain.id}
                    >
                      {domain.status === 'DISABLED' ? 'Reactivate' : 'Disable'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      <div className="space-y-6">
        {challenge && (
          <Card className="border-amber-200 p-6 shadow-none">
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-amber-700">
              DNS verification challenge
            </p>
            <h3 className="mt-2 font-semibold">Add this TXT record</h3>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Name</dt>
                <dd className="mt-1 break-all rounded-lg bg-cream p-2 font-mono text-xs">
                  {challenge.recordName}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Value</dt>
                <dd className="mt-1 break-all rounded-lg bg-cream p-2 font-mono text-xs">
                  {challenge.recordValue}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              This token is shown once. Generate a new challenge if you lose it.
            </p>
          </Card>
        )}
        {settings && (
          <Card className="p-6 shadow-none">
            <h3 className="font-semibold">Widget appearance</h3>
            <form className="mt-5 space-y-4" onSubmit={(event) => void updateBranding(event)}>
              <label className="block text-sm font-semibold">
                Greeting
                <Input className="mt-2" name="greeting" defaultValue={settings.greeting} />
              </label>
              <label className="block text-sm font-semibold">
                Brand color
                <div className="mt-2 flex gap-3">
                  <Input
                    className="w-20 p-1"
                    type="color"
                    name="primaryColor"
                    defaultValue={settings.primaryColor}
                  />
                  <Input value={settings.primaryColor} readOnly />
                </div>
              </label>
              <Button className="w-full" disabled={busy === 'settings'}>
                Save appearance
              </Button>
            </form>
          </Card>
        )}
        {verified && embed && (
          <Card className="p-6 shadow-none">
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-moss">
              Installation
            </p>
            <h3 className="mt-2 font-semibold">Add before your closing body tag</h3>
            <pre className="mt-4 overflow-x-auto rounded-xl bg-ink p-4 text-xs leading-5 text-white">
              <code>{embed}</code>
            </pre>
            <Button
              className="mt-3 w-full gap-2"
              variant="outline"
              onClick={() => void copy(embed)}
            >
              {copied ? <Check size={16} /> : <Clipboard size={16} />}
              {copied ? 'Copied' : 'Copy embed code'}
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}

function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : 'The request could not be completed';
}
