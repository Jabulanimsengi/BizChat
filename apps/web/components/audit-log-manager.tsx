'use client';

import type { AuditLogPage, AuditLogResponse } from '@bizchat/types';
import { LoaderCircle, Search, ScrollText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';

export function AuditLogManager() {
  const [logs, setLogs] = useState<AuditLogResponse[]>([]);
  const [cursor, setCursor] = useState<string | null>();
  const [action, setAction] = useState('');
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState<string>();
  async function load(next?: string, replace = false): Promise<void> {
    setBusy(true);
    setNotice(undefined);
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (next) params.set('cursor', next);
      if (action.trim()) params.set('action', action.trim());
      const page = await apiRequest<AuditLogPage>(`/audit-logs?${params}`);
      setLogs((current) => (replace ? page.logs : [...current, ...page.logs]));
      setCursor(page.nextCursor);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Audit history unavailable');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void apiRequest<AuditLogPage>('/audit-logs?limit=30')
      .then((page) => {
        setLogs(page.logs);
        setCursor(page.nextCursor);
      })
      .catch((cause: unknown) =>
        setNotice(cause instanceof Error ? cause.message : 'Audit history unavailable'),
      )
      .finally(() => setBusy(false));
  }, []);
  return (
    <div className="space-y-5">
      <Card className="p-5 shadow-none">
        <form
          className="flex gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void load(undefined, true);
          }}
        >
          <Input
            value={action}
            onChange={(event) => setAction(event.target.value)}
            placeholder="Filter by action, for example user.updated"
          />
          <Button className="gap-2" disabled={busy}>
            <Search size={16} /> Filter
          </Button>
        </form>
      </Card>
      {notice ? (
        <p className="rounded-2xl border border-line bg-white px-4 py-3 text-sm text-red-700">
          {notice}
        </p>
      ) : null}
      <Card className="overflow-hidden shadow-none">
        {logs.length === 0 && busy ? (
          <div className="grid min-h-64 place-items-center">
            <LoaderCircle className="animate-spin text-moss" />
          </div>
        ) : logs.length === 0 ? (
          <div className="grid min-h-64 place-items-center text-center">
            <div>
              <ScrollText className="mx-auto text-slate-300" size={32} />
              <p className="mt-3 text-sm text-slate-500">No audit events match this filter.</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {logs.map((log) => (
              <article key={log.id} className="grid gap-3 p-5 md:grid-cols-[220px_1fr_220px]">
                <div>
                  <p className="font-mono text-sm font-semibold text-moss">{log.action}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {new Date(log.createdAt).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm">
                    {log.targetType ?? 'Tenant'}
                    {log.targetId ? (
                      <span className="ml-2 font-mono text-xs text-slate-400">{log.targetId}</span>
                    ) : null}
                  </p>
                  {log.metadata ? (
                    <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg bg-cream p-2 text-xs text-slate-500">
                      {JSON.stringify(log.metadata, null, 2)}
                    </pre>
                  ) : null}
                </div>
                <div className="text-sm">
                  <p>{log.actor?.displayName ?? 'System'}</p>
                  <p className="text-xs text-slate-400">
                    {log.actor?.email ?? log.ipAddress ?? 'Automated event'}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>
      {cursor ? (
        <Button
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={() => void load(cursor)}
        >
          {busy ? 'Loading…' : 'Load older events'}
        </Button>
      ) : null}
    </div>
  );
}
