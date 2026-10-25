'use client';

import type { ConversationIntakeResponse, IntakeAnswer } from '@bizchat/types';
import { ClipboardList } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';

/** The visitor's pre-chat answers for the open conversation, loaded when it changes. */
export function IntakeAnswers({ conversationId }: { conversationId: string }) {
  // Keyed by conversation so switching threads never shows the previous visitor's answers.
  const [loaded, setLoaded] = useState<{
    conversationId: string;
    intake: ConversationIntakeResponse | null;
  }>();

  useEffect(() => {
    let active = true;
    apiRequest<ConversationIntakeResponse | null>(`/conversations/${conversationId}/intake`)
      .then((result) => {
        if (active) setLoaded({ conversationId, intake: result });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [conversationId]);

  const intake = loaded?.conversationId === conversationId ? loaded.intake : null;
  if (!intake) return null;
  return (
    <div className="mt-6 rounded-2xl border border-line bg-white p-4">
      <div className="flex items-center gap-2">
        <ClipboardList size={16} className="text-moss" />
        <p className="text-sm font-semibold">{intake.formName ?? 'Pre-chat details'}</p>
      </div>
      <AnswerList answers={intake.answers} />
      {intake.consentAt ? <p className="mt-3 text-xs text-slate-500">Consent given</p> : null}
    </div>
  );
}

export function AnswerList({ answers, limit }: { answers: IntakeAnswer[]; limit?: number }) {
  const shown = limit ? answers.slice(0, limit) : answers;
  return (
    <dl className="mt-3 space-y-2 text-sm">
      {shown.map((answer) => (
        <div key={answer.key}>
          <dt className="text-xs text-slate-500">{answer.label}</dt>
          <dd className="break-words font-medium">{answer.value}</dd>
        </div>
      ))}
    </dl>
  );
}
