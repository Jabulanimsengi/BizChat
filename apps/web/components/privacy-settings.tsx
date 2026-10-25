'use client';

import type { PrivacySettingsResponse } from '@bizchat/types';
import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';

/** How long finished conversations are kept before they and their files are deleted. */
export function PrivacySettings() {
  const [days, setDays] = useState('');
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    void apiRequest<PrivacySettingsResponse>('/privacy/settings')
      .then((settings) => setDays(settings.conversationRetentionDays?.toString() ?? ''))
      .catch((cause: unknown) => setNotice(cause instanceof Error ? cause.message : 'Unavailable'))
      .finally(() => setBusy(false));
  }, []);

  async function save(): Promise<void> {
    setBusy(true);
    setNotice(undefined);
    try {
      const saved = await apiRequest<PrivacySettingsResponse>('/privacy/settings', {
        method: 'PUT',
        body: JSON.stringify({ conversationRetentionDays: days ? Number(days) : null }),
      });
      setDays(saved.conversationRetentionDays?.toString() ?? '');
      setNotice('Retention saved.');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6 shadow-none">
      <div className="flex items-center gap-2">
        <ShieldCheck size={18} className="text-moss" />
        <h2 className="text-lg font-semibold">Data retention</h2>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        Resolved and closed conversations, with their messages and files, are deleted this many days
        after they last changed. Leave empty to keep them. Visitors can also ask for their data to
        be exported or erased from a conversation in the inbox.
      </p>
      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="text-sm">
          Keep for (days, 30 to 3650)
          <Input
            type="number"
            min={30}
            max={3650}
            value={days}
            onChange={(event) => setDays(event.target.value)}
            placeholder="Keep forever"
            className="mt-1 w-48"
          />
        </label>
        <Button disabled={busy}>Save retention</Button>
      </form>
      {notice ? <p className="mt-3 text-sm text-slate-600">{notice}</p> : null}
    </Card>
  );
}
