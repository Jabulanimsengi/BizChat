'use client';

import type { PlanMetric, PlanUsageResponse } from '@bizchat/types';
import { Gauge } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { Card } from './ui/card';

const LABELS: Record<PlanMetric, string> = {
  conversations: 'Conversations this month',
  consultants: 'Active users',
  integrationKeys: 'Integration keys',
  webhookEndpoints: 'Webhook endpoints',
};

/** "12 of 200", or "12 (no limit)" when unlimited. */
export function usageText(used: number, limit: number | null): string {
  return limit === null ? `${used} (no limit)` : `${used} of ${limit}`;
}

/** The business's plan and what it has used, so limits are never a surprise. */
export function PlanUsage() {
  const [plan, setPlan] = useState<PlanUsageResponse>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void apiRequest<PlanUsageResponse>('/plan')
      .then(setPlan)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unavailable'));
  }, []);

  return (
    <Card className="p-6 shadow-none">
      <div className="flex items-center gap-2">
        <Gauge size={18} className="text-moss" />
        <h2 className="text-lg font-semibold">Plan and usage</h2>
      </div>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      {plan ? (
        <>
          <p className="mt-2 text-sm text-slate-600">
            {plan.plan ? `${plan.plan.name} plan.` : 'No plan limits apply.'} Conversations are
            counted per calendar month (UTC), currently {plan.period}. Contact support to change
            your plan.
          </p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            {(Object.keys(LABELS) as PlanMetric[]).map((metric) => {
              const { used, limit } = plan.usage[metric];
              const full = limit !== null && used >= limit;
              return (
                <div key={metric} className="rounded-xl border border-line p-3">
                  <dt className="text-xs text-slate-500">{LABELS[metric]}</dt>
                  <dd
                    className={`mt-1 font-semibold tabular-nums ${full ? 'text-red-700' : 'text-ink'}`}
                  >
                    {usageText(used, limit)}
                    {full ? <span className="ml-2 text-xs font-medium">limit reached</span> : null}
                  </dd>
                </div>
              );
            })}
          </dl>
        </>
      ) : null}
    </Card>
  );
}
