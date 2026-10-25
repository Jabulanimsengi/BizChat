'use client';

import type { PlanResponse, PlatformTenantResponse } from '@bizchat/types';
import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { usageText } from './plan-usage';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';

const LIMITS = [
  ['maxConsultants', 'Users'],
  ['maxConversationsPerMonth', 'Conversations / month'],
  ['maxIntegrationKeys', 'Keys'],
  ['maxWebhookEndpoints', 'Webhooks'],
] as const;

/** Empty means unlimited. */
export function limitValue(value: string): number | null {
  return value.trim() === '' ? null : Number(value);
}

async function fetchAll(search: string): Promise<[PlanResponse[], PlatformTenantResponse[]]> {
  const query = search ? `&search=${encodeURIComponent(search)}` : '';
  return Promise.all([
    apiRequest<PlanResponse[]>('/platform/plans'),
    apiRequest<PlatformTenantResponse[]>(`/platform/tenants?limit=100${query}`),
  ]);
}

/** Platform administration: plans and the tenants on them. Visible to platform admins only. */
export function PlatformManager() {
  const [plans, setPlans] = useState<PlanResponse[]>([]);
  const [tenants, setTenants] = useState<PlatformTenantResponse[]>([]);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({ code: '', name: '' });
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchAll('')
      .then(([planList, tenantList]) => {
        if (!active) return;
        setPlans(planList);
        setTenants(tenantList);
      })
      .catch((cause: unknown) => {
        if (active) setNotice(cause instanceof Error ? cause.message : 'Unavailable');
      });
    return () => {
      active = false;
    };
  }, []);

  async function act(action: () => Promise<unknown>, success: string): Promise<void> {
    setBusy(true);
    setNotice(undefined);
    try {
      await action();
      const [planList, tenantList] = await fetchAll(search);
      setPlans(planList);
      setTenants(tenantList);
      setNotice(success);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  const patchTenant = (id: string, body: object): Promise<unknown> =>
    apiRequest(`/platform/tenants/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

  return (
    <div className="space-y-6">
      {notice ? <p className="rounded-xl bg-white p-3 text-sm text-slate-700">{notice}</p> : null}
      <Card className="p-6 shadow-none">
        <h2 className="text-lg font-semibold">Plans</h2>
        <p className="mt-1 text-sm text-slate-600">
          Empty limits are unlimited. No billing is involved.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-2 font-medium">Plan</th>
                {LIMITS.map(([, label]) => (
                  <th key={label} className="py-2 font-medium">
                    {label}
                  </th>
                ))}
                <th className="py-2 font-medium">Tenants</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id} className="border-t border-line">
                  <td className="py-2">
                    {plan.name} <span className="text-xs text-slate-400">{plan.code}</span>
                  </td>
                  {LIMITS.map(([field, label]) => (
                    <td key={field} className="py-2">
                      <Input
                        type="number"
                        min={1}
                        defaultValue={plan[field] ?? ''}
                        placeholder="No limit"
                        className="w-28"
                        aria-label={`${plan.name}: ${label}`}
                        onBlur={(event) => {
                          const value = limitValue(event.target.value);
                          if (value === plan[field]) return;
                          void act(
                            () =>
                              apiRequest(`/platform/plans/${plan.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ [field]: value }),
                              }),
                            `${plan.name} updated.`,
                          );
                        }}
                      />
                    </td>
                  ))}
                  <td className="py-2 tabular-nums">{plan.tenants}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              await apiRequest('/platform/plans', {
                method: 'POST',
                body: JSON.stringify({
                  code: draft.code,
                  name: draft.name,
                  ...Object.fromEntries(
                    LIMITS.map(([field]) => [field, limitValue(draft[field] ?? '')]),
                  ),
                }),
              });
              setDraft({ code: '', name: '' });
            }, 'Plan created.');
          }}
        >
          <Input
            placeholder="code"
            aria-label="New plan code"
            value={draft.code}
            onChange={(event) => setDraft({ ...draft, code: event.target.value })}
            className="w-32"
          />
          <Input
            placeholder="Name"
            aria-label="New plan name"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            className="w-40"
          />
          {LIMITS.map(([field, label]) => (
            <Input
              key={field}
              type="number"
              min={1}
              placeholder={label}
              aria-label={`New plan: ${label}`}
              value={draft[field] ?? ''}
              onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
              className="w-36"
            />
          ))}
          <Button disabled={busy || !draft.code || !draft.name}>Add plan</Button>
        </form>
      </Card>

      <Card className="p-6 shadow-none">
        <h2 className="text-lg font-semibold">Tenants</h2>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void act(() => Promise.resolve(), 'Search updated.');
          }}
        >
          <Input
            placeholder="Search by name or slug"
            aria-label="Search tenants"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-72"
          />
          <Button variant="ghost" disabled={busy}>
            Search
          </Button>
        </form>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-2 font-medium">Business</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium">Plan</th>
                <th className="py-2 font-medium">Conversations this month</th>
                <th className="py-2 font-medium">Users</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr key={tenant.id} className="border-t border-line">
                  <td className="py-2">
                    {tenant.name} <span className="text-xs text-slate-400">{tenant.slug}</span>
                  </td>
                  <td className="py-2">
                    <select
                      value={tenant.status}
                      disabled={busy}
                      aria-label={`${tenant.name} status`}
                      onChange={(event) => {
                        const status = event.target.value;
                        const confirmed =
                          status !== 'SUSPENDED' ||
                          window.confirm(
                            `Suspend ${tenant.name}? Its users, widgets, and keys stop working.`,
                          );
                        if (!confirmed) return;
                        void act(
                          () => patchTenant(tenant.id, { status }),
                          `${tenant.name} is now ${status.toLowerCase()}.`,
                        );
                      }}
                      className="rounded-lg border border-line px-2 py-1"
                    >
                      {['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED'].map((status) => (
                        <option key={status} value={status}>
                          {status.toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2">
                    <select
                      value={tenant.planId ?? ''}
                      disabled={busy}
                      aria-label={`${tenant.name} plan`}
                      onChange={(event) =>
                        void act(
                          () => patchTenant(tenant.id, { planId: event.target.value || null }),
                          `${tenant.name} plan changed.`,
                        )
                      }
                      className="rounded-lg border border-line px-2 py-1"
                    >
                      <option value="">No limits</option>
                      {plans.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 tabular-nums">
                    {usageText(tenant.usage.conversations.used, tenant.usage.conversations.limit)}
                  </td>
                  <td className="py-2 tabular-nums">
                    {usageText(tenant.usage.consultants.used, tenant.usage.consultants.limit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
