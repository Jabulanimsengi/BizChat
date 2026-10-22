'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@bizchat/validation';
import { ArrowRight, CheckCircle2, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { apiRequest } from '../lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';

export function ForgotPasswordForm() {
  const [serverError, setServerError] = useState<string>();
  const [sent, setSent] = useState(false);
  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  async function submit(values: ForgotPasswordInput): Promise<void> {
    setServerError(undefined);
    try {
      await apiRequest('/auth/password/forgot', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      setSent(true);
    } catch (cause) {
      setServerError(cause instanceof Error ? cause.message : 'Unable to continue');
    }
  }

  if (sent)
    return (
      <div className="space-y-5 text-sm text-slate-600">
        <p className="flex items-start gap-3 rounded-xl bg-mint p-4 text-moss">
          <CheckCircle2 size={20} className="mt-0.5 shrink-0" />
          If an account exists for that email, a password reset link is on its way. The link expires
          shortly, so use it soon.
        </p>
        <Link className="font-semibold text-moss hover:underline" href="/login">
          Back to sign in
        </Link>
      </div>
    );

  return (
    <form className="space-y-4" onSubmit={form.handleSubmit(submit)} noValidate>
      <label className="block">
        <span className="mb-2 block text-sm font-semibold">Work email</span>
        <Input type="email" autoComplete="email" {...form.register('email')} />
        {form.formState.errors.email && (
          <span className="mt-1 block text-xs text-red-600">
            {form.formState.errors.email.message}
          </span>
        )}
      </label>
      {serverError && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {serverError}
        </p>
      )}
      <Button className="mt-2 w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? (
          <LoaderCircle className="animate-spin" size={17} />
        ) : (
          <>
            Send reset link <ArrowRight size={17} />
          </>
        )}
      </Button>
    </form>
  );
}
