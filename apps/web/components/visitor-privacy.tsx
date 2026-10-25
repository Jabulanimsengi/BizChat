'use client';

import type { AuthSessionResponse, VisitorErasureResponse } from '@bizchat/types';
import { Download, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';

let roleRequest: Promise<string | undefined> | undefined;
/** The viewer's role, fetched once per page load. */
function viewerRole(): Promise<string | undefined> {
  roleRequest ??= apiRequest<AuthSessionResponse>('/auth/me')
    .then((session) => session.membership.role)
    .catch(() => undefined);
  return roleRequest;
}

/**
 * Data subject requests for the visitor behind a conversation: export everything held about them,
 * or erase it. Owners and admins only; erasing cannot be undone.
 */
export function VisitorPrivacy({
  conversationId,
  status,
  onErased,
}: {
  conversationId: string;
  status: string;
  onErased: () => void;
}) {
  const [allowed, setAllowed] = useState(false);
  const [message, setMessage] = useState<{ conversationId: string; text: string }>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void viewerRole().then((role) => {
      if (active) setAllowed(role === 'OWNER' || role === 'ADMIN');
    });
    return () => {
      active = false;
    };
  }, []);

  if (!allowed) return null;
  const open = status !== 'RESOLVED' && status !== 'CLOSED';
  const notice = message?.conversationId === conversationId ? message.text : undefined;

  async function exportData(): Promise<void> {
    setBusy(true);
    try {
      const data = await apiRequest<unknown>(
        `/privacy/conversations/${conversationId}/visitor/export`,
      );
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `visitor-data-${conversationId.slice(0, 8)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setMessage({
        conversationId,
        text: cause instanceof Error ? cause.message : 'Export failed',
      });
    } finally {
      setBusy(false);
    }
  }

  async function erase(): Promise<void> {
    if (
      !window.confirm(
        'Erase everything about this visitor: all their conversations, messages, files, and form answers? This cannot be undone.',
      )
    )
      return;
    setBusy(true);
    try {
      const result = await apiRequest<VisitorErasureResponse>(
        `/privacy/conversations/${conversationId}/visitor/erase`,
        { method: 'POST', body: JSON.stringify({ confirm: true }) },
      );
      setMessage({
        conversationId,
        text: `Erased ${result.conversationsDeleted} conversation(s) and ${result.attachmentsDeleted} file(s).`,
      });
      onErased();
    } catch (cause) {
      setMessage({ conversationId, text: cause instanceof Error ? cause.message : 'Erase failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-line bg-white p-4">
      <p className="text-sm font-semibold">Visitor data</p>
      <p className="mt-1 text-xs text-slate-500">For access and deletion requests.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportData()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-moss disabled:opacity-50"
        >
          <Download size={13} /> Export
        </button>
        <button
          type="button"
          disabled={busy || open}
          title={open ? 'Resolve the conversation first' : undefined}
          onClick={() => void erase()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
        >
          <Trash2 size={13} /> Erase
        </button>
      </div>
      {notice ? <p className="mt-2 text-xs text-slate-600">{notice}</p> : null}
    </div>
  );
}
