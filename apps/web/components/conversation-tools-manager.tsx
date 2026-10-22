'use client';

import type {
  AuthSessionResponse,
  CannedResponseResponse,
  DepartmentResponse,
  TagResponse,
} from '@bizchat/types';
import { LoaderCircle, MessageSquareQuote, Plus, Tags } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { Button } from './ui/button';

export function ConversationToolsManager() {
  const [session, setSession] = useState<AuthSessionResponse>();
  const [tags, setTags] = useState<TagResponse[]>([]);
  const [responses, setResponses] = useState<CannedResponseResponse[]>([]);
  const [departments, setDepartments] = useState<DepartmentResponse[]>([]);
  const [tagName, setTagName] = useState('');
  const [tagColor, setTagColor] = useState('#155f43');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [shortcut, setShortcut] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState<string>();
  const canManage = session?.membership.role === 'OWNER' || session?.membership.role === 'ADMIN';

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiRequest<AuthSessionResponse>('/auth/me'),
      apiRequest<TagResponse[]>('/tags'),
      apiRequest<CannedResponseResponse[]>('/canned-responses'),
      apiRequest<DepartmentResponse[]>('/departments'),
    ])
      .then(([current, tagList, canned, departmentList]) => {
        if (active) {
          setSession(current);
          setTags(tagList);
          setResponses(canned);
          setDepartments(departmentList.filter((item) => item.status === 'ACTIVE'));
          setBusy(false);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setNotice(cause instanceof Error ? cause.message : 'Conversation tools unavailable');
          setBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function createTag(): Promise<void> {
    if (!tagName.trim()) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const created = await apiRequest<TagResponse>('/tags', {
        method: 'POST',
        body: JSON.stringify({ name: tagName, color: tagColor }),
      });
      setTags((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      setTagName('');
      setNotice('Tag created.');
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setBusy(false);
    }
  }
  async function createResponse(): Promise<void> {
    if (!title.trim() || !content.trim()) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const created = await apiRequest<CannedResponseResponse>('/canned-responses', {
        method: 'POST',
        body: JSON.stringify({
          title,
          content,
          shortcut: shortcut || null,
          departmentId: departmentId || null,
        }),
      });
      setResponses((current) =>
        [...current, created].sort((a, b) => a.title.localeCompare(b.title)),
      );
      setTitle('');
      setContent('');
      setShortcut('');
      setDepartmentId('');
      setNotice('Canned response created.');
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setBusy(false);
    }
  }

  if (busy && !session)
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
            <Tags className="text-moss" />
            <div>
              <h3 className="font-semibold">Conversation tags</h3>
              <p className="text-sm text-slate-500">Visible only inside this business.</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span
                key={tag.id}
                className="rounded-full px-3 py-1.5 text-xs font-semibold text-white"
                style={{ backgroundColor: tag.color }}
              >
                {tag.name}
              </span>
            ))}
            {tags.length === 0 ? <p className="text-sm text-slate-400">No tags yet.</p> : null}
          </div>
          {canManage ? (
            <div className="mt-6 flex gap-2 border-t border-line pt-5">
              <input
                value={tagName}
                onChange={(event) => setTagName(event.target.value)}
                placeholder="New tag"
                maxLength={80}
                className="h-10 min-w-0 flex-1 rounded-xl border border-line px-3 text-sm outline-none focus:border-moss"
              />
              <input
                type="color"
                value={tagColor}
                onChange={(event) => setTagColor(event.target.value)}
                className="h-10 w-12 rounded-xl border border-line bg-white p-1"
              />
              <Button
                className="h-10 gap-1.5 px-3"
                onClick={() => void createTag()}
                disabled={busy || !tagName.trim()}
              >
                <Plus size={15} /> Add
              </Button>
            </div>
          ) : null}
        </section>
        <section className="rounded-3xl border border-line bg-white p-6">
          <div className="flex items-center gap-3">
            <MessageSquareQuote className="text-moss" />
            <div>
              <h3 className="font-semibold">Canned responses</h3>
              <p className="text-sm text-slate-500">Searchable from every conversation composer.</p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {responses.map((response) => (
              <article key={response.id} className="rounded-2xl border border-line p-4">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{response.title}</p>
                  {response.shortcut ? (
                    <code className="rounded bg-cream px-2 py-0.5 text-[10px] text-moss">
                      {response.shortcut}
                    </code>
                  ) : null}
                </div>
                <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-500">
                  {response.content}
                </p>
                <p className="mt-2 text-[10px] uppercase tracking-wide text-slate-400">
                  {response.departmentName ?? 'All departments'}
                </p>
              </article>
            ))}
            {responses.length === 0 ? (
              <p className="text-sm text-slate-400">No reusable responses yet.</p>
            ) : null}
          </div>
        </section>
      </div>
      {canManage ? (
        <section className="rounded-3xl border border-line bg-white p-6">
          <h3 className="font-semibold">Create canned response</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Title"
              maxLength={120}
              className="h-11 rounded-xl border border-line px-3 outline-none focus:border-moss"
            />
            <input
              value={shortcut}
              onChange={(event) => setShortcut(event.target.value)}
              placeholder="Shortcut (optional)"
              maxLength={40}
              className="h-11 rounded-xl border border-line px-3 outline-none focus:border-moss"
            />
            <select
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
              className="h-11 rounded-xl border border-line bg-white px-3 outline-none"
            >
              <option value="">All departments</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Response text"
              maxLength={4000}
              rows={4}
              className="rounded-xl border border-line p-3 outline-none focus:border-moss md:col-span-3"
            />
          </div>
          <Button
            className="mt-4 gap-2"
            onClick={() => void createResponse()}
            disabled={busy || !title.trim() || !content.trim()}
          >
            <Plus size={16} /> Create response
          </Button>
        </section>
      ) : null}
    </div>
  );
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The request could not be completed';
}
