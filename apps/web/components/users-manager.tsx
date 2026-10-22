'use client';

import type { BusinessRole, BusinessUserResponse, DepartmentResponse } from '@bizchat/types';
import { LoaderCircle, Plus, ShieldCheck, UserRoundCog } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';

export function UsersManager() {
  const [users, setUsers] = useState<BusinessUserResponse[]>([]);
  const [departments, setDepartments] = useState<DepartmentResponse[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [draft, setDraft] = useState({
    displayName: '',
    email: '',
    password: '',
    role: 'CONSULTANT' as Exclude<BusinessRole, 'OWNER'>,
  });
  useEffect(() => {
    void Promise.all([
      apiRequest<BusinessUserResponse[]>('/users'),
      apiRequest<DepartmentResponse[]>('/departments'),
    ])
      .then(([members, groups]) => {
        setUsers(members);
        setDepartments(groups);
      })
      .catch((cause: unknown) => setNotice(messageOf(cause)));
  }, []);
  async function create(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setNotice(undefined);
    try {
      const created = await apiRequest<BusinessUserResponse>('/users', {
        method: 'POST',
        body: JSON.stringify({ ...draft, departmentIds: [] }),
      });
      setUsers((current) => [...current, created]);
      setDraft({ displayName: '', email: '', password: '', role: 'CONSULTANT' });
      setNotice(`${created.displayName} can now sign in.`);
    } catch (cause) {
      setNotice(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }
  async function update(user: BusinessUserResponse, input: Record<string, unknown>): Promise<void> {
    setBusy(true);
    setNotice(undefined);
    try {
      const updated = await apiRequest<BusinessUserResponse>(`/users/${user.membershipId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
      setUsers((current) =>
        current.map((item) => (item.membershipId === updated.membershipId ? updated : item)),
      );
      setNotice(`${updated.displayName} updated.`);
    } catch (cause) {
      setNotice(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }
  function toggleDepartment(user: BusinessUserResponse, departmentId: string): void {
    const departmentIds = user.departmentIds.includes(departmentId)
      ? user.departmentIds.filter((id) => id !== departmentId)
      : [...user.departmentIds, departmentId];
    void update(user, { departmentIds });
  }
  if (!users.length && !notice)
    return (
      <Card className="grid min-h-64 place-items-center shadow-none">
        <LoaderCircle className="animate-spin text-moss" />
      </Card>
    );
  return (
    <div className="space-y-6">
      {notice ? (
        <p className="rounded-2xl border border-line bg-white px-4 py-3 text-sm text-moss">
          {notice}
        </p>
      ) : null}
      <Card className="p-6 shadow-none">
        <div className="flex items-center gap-3">
          <UserRoundCog className="text-moss" />
          <div>
            <h3 className="font-semibold">Add a business user</h3>
            <p className="text-sm text-slate-500">
              Create a secure initial login. The user can reset their password after signing in.
            </p>
          </div>
        </div>
        <form
          className="mt-5 grid gap-3 md:grid-cols-[1fr_1.2fr_1fr_180px_auto]"
          onSubmit={(event) => void create(event)}
        >
          <Input
            aria-label="Display name"
            placeholder="Display name"
            value={draft.displayName}
            onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
            required
          />
          <Input
            aria-label="Email"
            type="email"
            placeholder="name@example.com"
            value={draft.email}
            onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            required
          />
          <Input
            aria-label="Initial password"
            type="password"
            minLength={12}
            placeholder="Initial password"
            value={draft.password}
            onChange={(event) => setDraft({ ...draft, password: event.target.value })}
            required
          />
          <select
            aria-label="Role"
            className="h-11 rounded-xl border border-line bg-white px-3 text-sm"
            value={draft.role}
            onChange={(event) =>
              setDraft({ ...draft, role: event.target.value as typeof draft.role })
            }
          >
            <option value="CONSULTANT">Consultant</option>
            <option value="SUPERVISOR">Supervisor</option>
            <option value="ADMIN">Admin</option>
          </select>
          <Button disabled={busy} className="gap-2">
            <Plus size={16} /> Add user
          </Button>
        </form>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        {users.map((user) => (
          <Card key={user.membershipId} className="p-5 shadow-none">
            <div className="flex items-start justify-between gap-4">
              <div className="flex gap-3">
                <span className="grid size-11 place-items-center rounded-2xl bg-mint text-moss">
                  <ShieldCheck size={20} />
                </span>
                <div>
                  <h3 className="font-semibold">{user.displayName}</h3>
                  <p className="text-sm text-slate-500">{user.email}</p>
                </div>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${user.status === 'ACTIVE' ? 'bg-mint text-moss' : 'bg-slate-100 text-slate-500'}`}
              >
                {user.status.toLowerCase()}
              </span>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <label className="text-xs font-medium text-slate-500">
                Role
                <select
                  className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink"
                  value={user.role}
                  disabled={busy}
                  onChange={(event) => void update(user, { role: event.target.value })}
                >
                  <option value="OWNER">Owner</option>
                  <option value="ADMIN">Admin</option>
                  <option value="SUPERVISOR">Supervisor</option>
                  <option value="CONSULTANT">Consultant</option>
                </select>
              </label>
              <label className="text-xs font-medium text-slate-500">
                Concurrent chats
                <Input
                  className="mt-1 h-10"
                  type="number"
                  min={1}
                  max={50}
                  value={user.maxConcurrentChats}
                  disabled={busy}
                  onChange={(event) =>
                    void update(user, { maxConcurrentChats: Number(event.target.value) })
                  }
                />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {departments
                .filter(({ status }) => status === 'ACTIVE')
                .map((department) => (
                  <label
                    key={department.id}
                    className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={user.departmentIds.includes(department.id)}
                      disabled={busy}
                      onChange={() => toggleDepartment(user, department.id)}
                      className="accent-[#155f43]"
                    />
                    {department.name}
                  </label>
                ))}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={user.routingEnabled}
                  disabled={busy || user.status !== 'ACTIVE'}
                  onChange={(event) => void update(user, { routingEnabled: event.target.checked })}
                  className="accent-[#155f43]"
                />
                Routing enabled
              </label>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void update(user, { status: user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' })
                }
              >
                {user.status === 'ACTIVE' ? 'Disable' : 'Reactivate'}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : 'The request could not be completed';
}
