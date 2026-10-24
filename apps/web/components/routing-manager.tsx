'use client';

import type { RoutingSettingsResponse, RoutingStrategy, SkillResponse } from '@bizchat/types';
import { GraduationCap, LoaderCircle, Plus, Route } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { Button } from './ui/button';

const STRATEGIES: { value: RoutingStrategy; label: string; description: string }[] = [
  {
    value: 'LEAST_BUSY',
    label: 'Least busy first',
    description:
      'Spread chats evenly. Among equally busy consultants, the more proficient one is chosen.',
  },
  {
    value: 'BEST_SKILL',
    label: 'Best skill match first',
    description: 'Send chats to the most proficient available consultant, even if they are busier.',
  },
];

export function RoutingManager() {
  const [skills, setSkills] = useState<SkillResponse[]>([]);
  const [settings, setSettings] = useState<RoutingSettingsResponse>();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiRequest<SkillResponse[]>('/skills'),
      apiRequest<RoutingSettingsResponse>('/routing/settings'),
    ])
      .then(([skillList, current]) => {
        if (!active) return;
        setSkills(skillList);
        setSettings(current);
        setBusy(false);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setNotice(message(cause));
        setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function run(action: () => Promise<void>, success: string): Promise<void> {
    setBusy(true);
    setNotice(undefined);
    try {
      await action();
      setNotice(success);
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setBusy(false);
    }
  }

  function createSkill(): Promise<void> {
    return run(async () => {
      const created = await apiRequest<SkillResponse>('/skills', {
        method: 'POST',
        body: JSON.stringify({ name, description: description.trim() || null }),
      });
      setSkills((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      setName('');
      setDescription('');
    }, 'Skill created. Assign proficiency to consultants on the Users page.');
  }

  function toggleSkill(skill: SkillResponse): Promise<void> {
    const status = skill.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    return run(
      async () => {
        const updated = await apiRequest<SkillResponse>(`/skills/${skill.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        });
        setSkills((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      },
      status === 'ACTIVE' ? `${skill.name} enabled.` : `${skill.name} disabled.`,
    );
  }

  function saveStrategy(routingStrategy: RoutingStrategy): Promise<void> {
    return run(async () => {
      setSettings(
        await apiRequest<RoutingSettingsResponse>('/routing/settings', {
          method: 'PUT',
          body: JSON.stringify({ routingStrategy }),
        }),
      );
    }, 'Routing strategy saved.');
  }

  if (busy && !settings && !notice)
    return (
      <div className="grid min-h-64 place-items-center rounded-3xl border border-line bg-white">
        <LoaderCircle className="animate-spin text-moss" />
      </div>
    );
  return (
    <div className="space-y-6">
      {notice ? (
        <p className="rounded-2xl border border-line bg-white px-4 py-3 text-sm text-moss">
          {notice}
        </p>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-3xl border border-line bg-white p-6">
          <div className="flex items-center gap-3">
            <GraduationCap className="text-moss" />
            <div>
              <h3 className="font-semibold">Skills</h3>
              <p className="text-sm text-slate-500">
                Capabilities that topics can require. Disabling a skill stops routing from requiring
                it.
              </p>
            </div>
          </div>
          <ul className="mt-5 space-y-2">
            {skills.map((skill) => (
              <li
                key={skill.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3"
              >
                <div className="min-w-0">
                  <p className={`font-medium ${skill.status === 'ACTIVE' ? '' : 'text-slate-400'}`}>
                    {skill.name}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {skill.consultantCount} consultant{skill.consultantCount === 1 ? '' : 's'}
                    {skill.description ? ` · ${skill.description}` : ''}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void toggleSkill(skill)}
                >
                  {skill.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                </Button>
              </li>
            ))}
            {skills.length === 0 ? <p className="text-sm text-slate-400">No skills yet.</p> : null}
          </ul>
          <div className="mt-6 grid gap-2 border-t border-line pt-5 sm:grid-cols-[1fr_1.4fr_auto]">
            <input
              aria-label="Skill name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="New skill"
              maxLength={80}
              className="h-10 min-w-0 rounded-xl border border-line px-3 text-sm outline-none focus:border-moss"
            />
            <input
              aria-label="Skill description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Description (optional)"
              maxLength={240}
              className="h-10 min-w-0 rounded-xl border border-line px-3 text-sm outline-none focus:border-moss"
            />
            <Button
              className="h-10 gap-1.5 px-3"
              onClick={() => void createSkill()}
              disabled={busy || name.trim().length < 2}
            >
              <Plus size={15} /> Add
            </Button>
          </div>
        </section>
        <section className="rounded-3xl border border-line bg-white p-6">
          <div className="flex items-center gap-3">
            <Route className="text-moss" />
            <div>
              <h3 className="font-semibold">Routing strategy</h3>
              <p className="text-sm text-slate-500">
                How BizChat chooses between available consultants. A customer&apos;s previous
                consultant is always preferred when they are free.
              </p>
            </div>
          </div>
          <fieldset className="mt-5 space-y-3" disabled={busy}>
            {STRATEGIES.map((strategy) => (
              <label
                key={strategy.value}
                className={`flex cursor-pointer gap-3 rounded-2xl border px-4 py-3 ${settings?.routingStrategy === strategy.value ? 'border-moss bg-mint/40' : 'border-line'}`}
              >
                <input
                  type="radio"
                  name="routing-strategy"
                  className="mt-1 accent-[#155f43]"
                  checked={settings?.routingStrategy === strategy.value}
                  onChange={() => void saveStrategy(strategy.value)}
                />
                <span>
                  <span className="block text-sm font-medium">{strategy.label}</span>
                  <span className="block text-xs text-slate-500">{strategy.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </section>
      </div>
    </div>
  );
}

function message(value: unknown): string {
  return value instanceof Error ? value.message : 'The request could not be completed';
}
