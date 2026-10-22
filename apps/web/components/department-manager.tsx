'use client';

import type {
  AgentProfileResponse,
  AuthSessionResponse,
  DepartmentResponse,
  WidgetSettingsResponse,
} from '@bizchat/types';
import { Building2, LoaderCircle, Plus, Save, UsersRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { Button } from './ui/button';

export function DepartmentManager() {
  const [departments, setDepartments] = useState<DepartmentResponse[]>([]);
  const [profile, setProfile] = useState<AgentProfileResponse>();
  const [session, setSession] = useState<AuthSessionResponse>();
  const [settings, setSettings] = useState<WidgetSettingsResponse>();
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState<string>();

  const canManage = session?.membership.role === 'OWNER' || session?.membership.role === 'ADMIN';

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiRequest<DepartmentResponse[]>('/departments'),
      apiRequest<AgentProfileResponse>('/agent-profile/me'),
      apiRequest<AuthSessionResponse>('/auth/me'),
      apiRequest<WidgetSettingsResponse>('/widget-settings').catch(() => undefined),
    ])
      .then(([departmentList, ownProfile, currentSession, widgetSettings]) => {
        if (!active) return;
        setDepartments(departmentList);
        setProfile(ownProfile);
        setSelected(ownProfile.departmentIds);
        setSession(currentSession);
        setSettings(widgetSettings);
        setBusy(false);
      })
      .catch((cause: unknown) => {
        if (active) {
          setNotice(cause instanceof Error ? cause.message : 'Departments unavailable');
          setBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function create(): Promise<void> {
    if (!name.trim()) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const created = await apiRequest<DepartmentResponse>('/departments', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description: description || null,
          isDefault: departments.length === 0,
        }),
      });
      setDepartments((current) => [...current, created]);
      setName('');
      setDescription('');
      setNotice(`${created.name} created.`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Department could not be created');
    } finally {
      setBusy(false);
    }
  }

  async function saveMemberships(): Promise<void> {
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await apiRequest<{ departmentIds: string[] }>('/departments/mine', {
        method: 'PUT',
        body: JSON.stringify({ departmentIds: selected }),
      });
      setSelected(result.departmentIds);
      setProfile((current) =>
        current ? { ...current, departmentIds: result.departmentIds } : current,
      );
      setNotice('Your routing departments were saved.');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Assignments could not be saved');
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(): Promise<void> {
    if (!settings) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const updated = await apiRequest<WidgetSettingsResponse>('/widget-settings', {
        method: 'PATCH',
        body: JSON.stringify({
          departmentSelectionEnabled: settings.departmentSelectionEnabled,
          preferPreviousConsultant: settings.preferPreviousConsultant,
          queueMessage: settings.queueMessage,
          reopenWindowMinutes: settings.reopenWindowMinutes,
          agentDisconnectGraceSeconds: settings.agentDisconnectGraceSeconds,
        }),
      });
      setSettings(updated);
      setNotice('Routing settings saved.');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Settings could not be saved');
    } finally {
      setBusy(false);
    }
  }

  async function updateDepartment(
    department: DepartmentResponse,
    input: Record<string, unknown>,
  ): Promise<void> {
    setBusy(true);
    setNotice(undefined);
    try {
      const updated = await apiRequest<DepartmentResponse>(`/departments/${department.id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
      setDepartments((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setNotice(`${updated.name} updated.`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Department could not be updated');
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string): void {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  if (busy && !profile)
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
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {departments.map((department) => (
          <article
            key={department.id}
            className="rounded-3xl border border-line bg-white p-5 shadow-sm"
          >
            <div className="flex items-start gap-3">
              <span className="grid size-11 place-items-center rounded-2xl bg-mint text-moss">
                <Building2 size={20} />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{department.name}</h3>
                  {department.isDefault ? (
                    <span className="rounded-full bg-cream px-2 py-0.5 text-[10px] font-semibold uppercase text-moss">
                      Default
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {department.description ?? 'No description'}
                </p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2 text-center">
              <Metric label="Agents" value={department.agentProfileIds.length} />
              <Metric label="Active" value={department.activeConversations} />
              <Metric label="Queued" value={department.queuedConversations} />
            </div>
            <label className="mt-5 flex cursor-pointer items-center gap-3 border-t border-line pt-4 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(department.id)}
                onChange={() => toggle(department.id)}
                className="size-4 accent-[#155f43]"
              />
              <span>Route my conversations here</span>
            </label>
            {canManage ? (
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || department.isDefault}
                  onClick={() => void updateDepartment(department, { isDefault: true })}
                >
                  Make default
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || department.isDefault}
                  onClick={() =>
                    void updateDepartment(department, {
                      status: department.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
                    })
                  }
                >
                  {department.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                </Button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-line bg-white p-6">
          <div className="flex items-center gap-3">
            <UsersRound className="text-moss" />
            <div>
              <h3 className="font-semibold">My department membership</h3>
              <p className="text-sm text-slate-500">
                A conversation with a selected department only considers its member consultants.
              </p>
            </div>
          </div>
          <Button className="mt-5 gap-2" onClick={() => void saveMemberships()} disabled={busy}>
            <Save size={16} /> Save memberships
          </Button>
        </div>
        {canManage ? (
          <div className="rounded-3xl border border-line bg-white p-6">
            <h3 className="font-semibold">Create a department</h3>
            <div className="mt-4 grid gap-3">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Department name"
                maxLength={100}
                className="h-11 rounded-xl border border-line px-3 outline-none focus:border-moss"
              />
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Description (optional)"
                maxLength={500}
                rows={3}
                className="rounded-xl border border-line p-3 outline-none focus:border-moss"
              />
            </div>
            <Button
              className="mt-4 gap-2"
              onClick={() => void create()}
              disabled={busy || !name.trim()}
            >
              <Plus size={16} /> Create department
            </Button>
          </div>
        ) : null}
      </section>
      {canManage && settings ? (
        <section className="rounded-3xl border border-line bg-white p-6">
          <h3 className="font-semibold">Routing preferences</h3>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Toggle
              label="Ask visitors to choose a department"
              checked={settings.departmentSelectionEnabled}
              onChange={(checked) =>
                setSettings({ ...settings, departmentSelectionEnabled: checked })
              }
            />
            <Toggle
              label="Prefer a visitor's previous consultant"
              checked={settings.preferPreviousConsultant}
              onChange={(checked) =>
                setSettings({ ...settings, preferPreviousConsultant: checked })
              }
            />
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-[1fr_220px_220px]">
            <label className="block">
              <span className="text-sm font-medium">Queue message</span>
              <textarea
                value={settings.queueMessage}
                onChange={(event) => setSettings({ ...settings, queueMessage: event.target.value })}
                maxLength={240}
                rows={2}
                className="mt-2 w-full rounded-xl border border-line p-3 outline-none focus:border-moss"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Reopen window (minutes)</span>
              <input
                type="number"
                min={1}
                max={43200}
                value={settings.reopenWindowMinutes}
                onChange={(event) =>
                  setSettings({ ...settings, reopenWindowMinutes: Number(event.target.value) })
                }
                className="mt-2 h-11 w-full rounded-xl border border-line px-3 outline-none focus:border-moss"
              />
              <span className="mt-1 block text-xs text-slate-400">Default: 1440 (24 hours)</span>
            </label>
            <label className="block">
              <span className="text-sm font-medium">Disconnect grace (seconds)</span>
              <input
                type="number"
                min={1}
                max={900}
                value={settings.agentDisconnectGraceSeconds}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    agentDisconnectGraceSeconds: Number(event.target.value),
                  })
                }
                className="mt-2 h-11 w-full rounded-xl border border-line px-3 outline-none focus:border-moss"
              />
              <span className="mt-1 block text-xs text-slate-400">Wait before reassignment</span>
            </label>
          </div>
          <Button className="mt-4 gap-2" onClick={() => void saveSettings()} disabled={busy}>
            <Save size={16} /> Save routing settings
          </Button>
        </section>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-cream px-2 py-3">
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-2xl border border-line p-4 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-[#155f43]"
      />
      <span>{label}</span>
    </label>
  );
}
