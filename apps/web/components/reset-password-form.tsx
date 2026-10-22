'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { resetPasswordSchema } from '@bizchat/validation';
import { LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { apiRequest } from '../lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';

const formSchema = resetPasswordSchema
  .extend({ confirm: z.string() })
  .refine((value) => value.password === value.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  });

type FormValues = z.infer<typeof formSchema>;

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string>();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { token, password: '', confirm: '' },
  });

  async function submit(values: FormValues): Promise<void> {
    setServerError(undefined);
    try {
      await apiRequest('/auth/password/reset', {
        method: 'POST',
        body: JSON.stringify({ token: values.token, password: values.password }),
      });
      router.replace('/login?reset=1');
      router.refresh();
    } catch (cause) {
      setServerError(cause instanceof Error ? cause.message : 'Unable to reset the password');
    }
  }

  return (
    <form className="space-y-4" onSubmit={form.handleSubmit(submit)} noValidate>
      <input type="hidden" {...form.register('token')} />
      <label className="block">
        <span className="mb-2 block text-sm font-semibold">New password</span>
        <Input type="password" autoComplete="new-password" {...form.register('password')} />
        <span className="mt-1 block text-xs text-slate-400">Use at least 12 characters.</span>
        {form.formState.errors.password && (
          <span className="mt-1 block text-xs text-red-600">
            {form.formState.errors.password.message}
          </span>
        )}
      </label>
      <label className="block">
        <span className="mb-2 block text-sm font-semibold">Confirm password</span>
        <Input type="password" autoComplete="new-password" {...form.register('confirm')} />
        {form.formState.errors.confirm && (
          <span className="mt-1 block text-xs text-red-600">
            {form.formState.errors.confirm.message}
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
          'Reset password'
        )}
      </Button>
    </form>
  );
}
