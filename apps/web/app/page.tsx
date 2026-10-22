import { ArrowRight, CheckCircle2, Radio, ShieldCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { Brand } from '../components/brand';

export default function HomePage() {
  return (
    <main className="min-h-screen overflow-hidden bg-cream">
      <div className="mx-auto max-w-7xl px-6">
        <header className="flex h-20 items-center justify-between">
          <Brand />
          <nav className="flex items-center gap-3">
            <Link
              href="/login"
              className="rounded-xl px-4 py-2 text-sm font-semibold hover:bg-white"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-moss"
            >
              Start free
            </Link>
          </nav>
        </header>
        <section className="grid min-h-[calc(100vh-5rem)] items-center gap-14 py-16 lg:grid-cols-[1.05fr_.95fr]">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[.14em] text-moss">
              <Radio size={14} />
              Communication infrastructure for growing teams
            </div>
            <h1 className="max-w-3xl text-5xl font-bold leading-[1.04] tracking-[-.055em] sm:text-7xl">
              Every customer conversation, routed and remembered.
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-slate-600">
              BizChat gives businesses a secure live inbox, durable conversation history, and the
              routing foundation for every channel that comes next.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                href="/register"
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-ink px-6 text-sm font-semibold text-white hover:bg-moss"
              >
                Create your workspace <ArrowRight size={17} />
              </Link>
              <Link
                href="/login"
                className="inline-flex h-12 items-center rounded-xl border border-line bg-white px-6 text-sm font-semibold hover:border-moss"
              >
                Open dashboard
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500">
              {['Tenant isolated', 'Durable by default', 'Built to scale'].map((item) => (
                <span key={item} className="flex items-center gap-2">
                  <CheckCircle2 className="text-moss" size={16} />
                  {item}
                </span>
              ))}
            </div>
          </div>
          <div className="relative">
            <div className="absolute -inset-20 -z-10 rounded-full bg-mint blur-3xl" />
            <div className="rounded-[2rem] border border-line bg-white p-4 shadow-panel">
              <div className="flex items-center justify-between border-b border-line p-4">
                <div>
                  <p className="text-sm font-bold">Team inbox</p>
                  <p className="text-xs text-slate-500">12 active conversations</p>
                </div>
                <span className="rounded-full bg-mint px-3 py-1 text-xs font-semibold text-moss">
                  7 online
                </span>
              </div>
              <div className="grid gap-3 p-3 sm:grid-cols-2">
                {[
                  [Users, 'Fair routing', 'Capacity-aware assignments'],
                  [ShieldCheck, 'Tenant security', 'Context on every request'],
                  [Radio, 'Live presence', 'Redis-backed heartbeats'],
                ].map(([Icon, title, body]) => {
                  const Glyph = Icon as typeof Users;
                  return (
                    <div
                      key={String(title)}
                      className="rounded-2xl border border-line p-5 last:sm:col-span-2"
                    >
                      <Glyph className="mb-8 text-moss" />
                      <p className="font-semibold">{String(title)}</p>
                      <p className="mt-1 text-sm text-slate-500">{String(body)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
