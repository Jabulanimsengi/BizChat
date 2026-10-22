'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  loginSchema,
  registerSchema,
  type LoginInput,
  type RegisterInput,
} from '@bizchat/validation';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { apiRequest } from '../lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string>();
  const isRegister = mode === 'register';
  const form = useForm<LoginInput | RegisterInput>({
    resolver: zodResolver(isRegister ? registerSchema : loginSchema),
    defaultValues: isRegister
      ? {
          businessName: '',
          displayName: '',
          email: '',
          password: '',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        }
      : { email: '', password: '' },
  });
  async function submit(values: LoginInput | RegisterInput) {
    setServerError(undefined);
    try {
      await apiRequest(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(values) });
      router.push('/dashboard');
      router.refresh();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Unable to continue');
    }
  }
  const fieldError = (name: string) =>
    form.formState.errors[name as keyof typeof form.formState.errors]?.message;
  return (
    <form className="space-y-4" onSubmit={form.handleSubmit(submit)} noValidate>
      {isRegister && (
        <>
          <Field label="Business name" error={fieldError('businessName')}>
            <Input autoComplete="organization" {...form.register('businessName' as 'email')} />
          </Field>
          <Field label="Your name" error={fieldError('displayName')}>
            <Input autoComplete="name" {...form.register('displayName' as 'email')} />
          </Field>
        </>
      )}
      <Field label="Work email" error={fieldError('email')}>
        <Input type="email" autoComplete="email" {...form.register('email')} />
      </Field>
      <Field
        label="Password"
        hint={isRegister ? 'Use at least 12 characters.' : undefined}
        error={fieldError('password')}
      >
        <Input
          type="password"
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          {...form.register('password')}
        />
      </Field>
      {!isRegister && (
        <div className="text-right">
          <Link className="text-sm font-semibold text-moss hover:underline" href="/forgot-password">
            Forgot password?
          </Link>
        </div>
      )}
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
            {isRegister ? 'Create workspace' : 'Sign in'} <ArrowRight size={17} />
          </>
        )}
      </Button>
    </form>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: unknown;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between text-sm font-semibold">
        {label}
        {hint && <span className="font-normal text-slate-400">{hint}</span>}
      </span>
      {children}
      {typeof error === 'string' && (
        <span className="mt-1 block text-xs text-red-600">{error}</span>
      )}
    </label>
  );
}
