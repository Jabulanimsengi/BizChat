'use client';

import { CheckCircle2, LoaderCircle, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';

type State = 'verifying' | 'verified' | 'failed';

export function VerifyEmailPanel({ token }: { token: string }) {
  const [state, setState] = useState<State>(token ? 'verifying' : 'failed');
  const [message, setMessage] = useState<string | undefined>(
    token ? undefined : 'The verification link is missing its token.',
  );

  useEffect(() => {
    if (!token) return;
    let active = true;
    void apiRequest('/auth/email/verify', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then(() => {
        if (active) setState('verified');
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setState('failed');
        setMessage(cause instanceof Error ? cause.message : 'Unable to verify this email');
      });
    return () => {
      active = false;
    };
  }, [token]);

  if (state === 'verifying')
    return (
      <p className="flex items-center gap-3 text-sm text-slate-500">
        <LoaderCircle className="animate-spin" size={18} /> Verifying your email…
      </p>
    );

  if (state === 'verified')
    return (
      <div className="space-y-5 text-sm text-slate-600">
        <p className="flex items-center gap-3 rounded-xl bg-mint p-4 text-moss">
          <CheckCircle2 size={20} /> Your email address is verified.
        </p>
        <Link className="font-semibold text-moss hover:underline" href="/login">
          Continue to sign in
        </Link>
      </div>
    );

  return (
    <div className="space-y-5 text-sm text-slate-600">
      <p role="alert" className="flex items-center gap-3 rounded-xl bg-red-50 p-4 text-red-700">
        <XCircle size={20} /> {message ?? 'This verification link is invalid or has expired.'}
      </p>
      <Link className="font-semibold text-moss hover:underline" href="/login">
        Back to sign in
      </Link>
    </div>
  );
}
