'use client';

import type { AgentProfileResponse } from '@bizchat/types';
import { LoaderCircle, Save, UserRoundCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { Button } from './ui/button';

export function AgentProfileManager() {
  const [profile, setProfile] = useState<AgentProfileResponse>();
  const [maximum, setMaximum] = useState(5);
  const [routingEnabled, setRoutingEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    let active = true;
    void apiRequest<AgentProfileResponse>('/agent-profile/me')
      .then((result) => {
        if (active) {
          setProfile(result);
          setMaximum(result.maxConcurrentChats);
          setRoutingEnabled(result.routingEnabled);
        }
      })
      .catch((cause: unknown) => {
        if (active) setNotice(cause instanceof Error ? cause.message : 'Profile unavailable');
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(): Promise<void> {
    setSaving(true);
    setNotice(undefined);
    try {
      const result = await apiRequest<AgentProfileResponse>('/agent-profile/me', {
        method: 'PATCH',
        body: JSON.stringify({ maxConcurrentChats: maximum, routingEnabled }),
      });
      setProfile(result);
      setNotice('Consultant preferences saved.');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'The profile could not be saved');
    } finally {
      setSaving(false);
    }
  }

  if (!profile)
    return (
      <div className="grid min-h-64 place-items-center rounded-3xl border border-line bg-white">
        <div className="text-center">
          <LoaderCircle className="mx-auto animate-spin text-moss" />
          <p className="mt-3 text-sm text-slate-500">{notice ?? 'Loading consultant profile…'}</p>
        </div>
      </div>
    );
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section className="rounded-3xl border border-line bg-white p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <span className="grid size-12 place-items-center rounded-2xl bg-mint text-moss">
            <UserRoundCheck />
          </span>
          <div>
            <h3 className="font-semibold">{profile.user.displayName}</h3>
            <p className="text-sm text-slate-500">{profile.user.email}</p>
          </div>
          <span className="ml-auto rounded-full bg-mint px-3 py-1 text-xs font-semibold capitalize text-moss">
            {profile.status.toLowerCase()}
          </span>
        </div>
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium">Maximum simultaneous chats</span>
            <input
              type="number"
              min={1}
              max={50}
              value={maximum}
              onChange={(event) => setMaximum(Number(event.target.value))}
              className="mt-2 h-11 w-full rounded-xl border border-line px-3 outline-none focus:border-moss focus:ring-2 focus:ring-mint"
            />
            <span className="mt-1 block text-xs text-slate-400">
              Used by capacity-aware routing in Phase 5.
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-2xl border border-line p-4">
            <input
              type="checkbox"
              checked={routingEnabled}
              onChange={(event) => setRoutingEnabled(event.target.checked)}
              className="mt-1 size-4 accent-[#155f43]"
            />
            <span>
              <span className="block text-sm font-medium">Eligible for routing</span>
              <span className="mt-1 block text-xs leading-relaxed text-slate-400">
                Makes this profile available to the routing engine when presence and capacity allow.
              </span>
            </span>
          </label>
        </div>
        {notice ? <p className="mt-5 text-sm text-moss">{notice}</p> : null}
        <Button className="mt-6 gap-2" onClick={() => void save()} disabled={saving}>
          {saving ? <LoaderCircle size={17} className="animate-spin" /> : <Save size={17} />} Save
          preferences
        </Button>
      </section>
      <aside className="rounded-3xl border border-line bg-ink p-6 text-white">
        <p className="text-sm text-white/60">Current workload</p>
        <p className="mt-3 text-4xl font-bold">
          {profile.activeChats}{' '}
          <span className="text-xl font-normal text-white/40">/ {profile.maxConcurrentChats}</span>
        </p>
        <p className="mt-4 text-sm capitalize text-white/70">
          Presence: {profile.presence.toLowerCase().replaceAll('_', ' ')}
        </p>
        <p className="mt-2 text-sm text-white/70">
          Routing: {profile.routingEnabled ? 'enabled' : 'disabled'}
        </p>
        <p className="mt-8 text-xs leading-relaxed text-white/45">
          Online state is deliberately ephemeral and expires from Redis when heartbeats stop.
          Profile preferences remain durable in PostgreSQL.
        </p>
      </aside>
    </div>
  );
}
