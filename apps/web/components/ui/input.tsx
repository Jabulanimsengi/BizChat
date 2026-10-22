import type { InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-11 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none placeholder:text-slate-400 focus:border-moss focus:ring-2 focus:ring-mint',
        className,
      )}
      {...props}
    />
  );
}
