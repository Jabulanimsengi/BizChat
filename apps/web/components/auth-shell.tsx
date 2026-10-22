import type { ReactNode } from 'react';
import { Brand } from './brand';
import { Card } from './ui/card';

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="grid min-h-screen bg-cream lg:grid-cols-[.85fr_1.15fr]">
      <aside className="hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <BrandInvert />
        <blockquote className="max-w-md text-3xl font-semibold leading-tight tracking-tight">
          “The inbox should make the right work obvious, without ever gambling with customer
          history.”
        </blockquote>
        <p className="text-sm text-white/55">
          Durable messages · Atomic routing · Tenant isolation
        </p>
      </aside>
      <section className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md p-7 sm:p-10">
          <div className="mb-8 lg:hidden">
            <Brand />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
          <div className="mt-8">{children}</div>
          <div className="mt-7 border-t border-line pt-6 text-center text-sm text-slate-500">
            {footer}
          </div>
        </Card>
      </section>
    </main>
  );
}

function BrandInvert() {
  return (
    <div className="[&_a]:text-white">
      <Brand />
    </div>
  );
}
