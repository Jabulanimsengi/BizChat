'use client';

import type { AuthSessionResponse } from '@bizchat/types';
import {
  BarChart3,
  Building2,
  Globe2,
  Headphones,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  MailWarning,
  Menu,
  MessageSquareQuote,
  MessageSquareText,
  Route,
  ScrollText,
  Settings,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { Brand } from './brand';
import { Button } from './ui/button';

const navigation = [
  { icon: LayoutDashboard, label: 'Overview', href: '/dashboard' },
  { icon: MessageSquareText, label: 'Conversations', href: '/dashboard/conversations' },
  { icon: Headphones, label: 'Consultants', href: '/dashboard/consultants' },
  { icon: Users, label: 'Departments', href: '/dashboard/departments' },
  { icon: BarChart3, label: 'Analytics', href: '/dashboard/analytics', supervisor: true },
  { icon: Route, label: 'Routing', href: '/dashboard/routing', admin: true },
  { icon: MessageSquareQuote, label: 'Conversation tools', href: '/dashboard/conversation-tools' },
  { icon: Globe2, label: 'Websites', href: '/dashboard/domains', admin: true },
  { icon: Globe2, label: 'Integrations', href: '/dashboard/integrations', admin: true },
  { icon: UserCog, label: 'Users', href: '/dashboard/users', admin: true },
  { icon: ScrollText, label: 'Audit logs', href: '/dashboard/audit-logs', admin: true },
  { icon: Settings, label: 'Settings', href: '/dashboard/settings', admin: true },
  { icon: Building2, label: 'Platform', href: '/dashboard/platform', platform: true },
] as const;

export function DashboardFrame({
  children,
  eyebrow,
  title,
  description,
}: {
  children: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<AuthSessionResponse>();
  const [error, setError] = useState<string>();
  const [navOpen, setNavOpen] = useState(false);
  const [resending, setResending] = useState(false);
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    void apiRequest<AuthSessionResponse>('/auth/me')
      .then(setSession)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Session unavailable');
        router.replace('/login');
      });
  }, [router]);

  async function logout(): Promise<void> {
    try {
      await apiRequest<void>('/auth/logout', { method: 'POST' });
    } catch {
      // The session may already be invalid; fall through to the redirect.
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }

  async function resendVerification(): Promise<void> {
    setResending(true);
    setNotice(undefined);
    try {
      await apiRequest('/auth/email/resend', { method: 'POST' });
      setNotice('Verification email sent. Check your inbox.');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Unable to send the email');
    } finally {
      setResending(false);
    }
  }

  if (!session)
    return (
      <main className="grid min-h-screen place-items-center bg-cream">
        <div className="text-center">
          <LoaderCircle className="mx-auto animate-spin text-moss" />
          <p className="mt-3 text-sm text-slate-500">{error ?? 'Opening your workspace…'}</p>
        </div>
      </main>
    );

  // Mirrors the API: analytics:view for supervisors and above, administration for owners and admins.
  const items = navigation.filter((item) =>
    'platform' in item
      ? session.platformAdmin === true
      : 'admin' in item
        ? ['OWNER', 'ADMIN'].includes(session.membership.role)
        : 'supervisor' in item
          ? ['OWNER', 'ADMIN', 'SUPERVISOR'].includes(session.membership.role)
          : true,
  );

  return (
    <div className="min-h-screen bg-cream lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="hidden border-r border-line bg-white p-5 lg:flex lg:flex-col">
        <Brand />
        <div className="mt-8 rounded-2xl bg-cream p-4">
          <p className="truncate text-sm font-semibold">{session.business.name}</p>
          <p className="mt-1 text-xs capitalize text-slate-500">
            {session.membership.role.toLowerCase()}
          </p>
        </div>
        <NavLinks items={items} pathname={pathname} authenticated />
        <Button
          variant="ghost"
          className="mt-auto justify-start gap-3"
          onClick={() => void logout()}
        >
          <LogOut size={17} /> Sign out
        </Button>
      </aside>

      {navOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-ink/40"
            onClick={() => setNavOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Dashboard navigation"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[80%] flex-col bg-white p-5 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <Brand />
              <button
                type="button"
                aria-label="Close navigation"
                className="rounded-lg p-2 text-slate-500 hover:bg-cream"
                onClick={() => setNavOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            <p className="mt-6 truncate text-sm font-semibold">{session.business.name}</p>
            <NavLinks items={items} pathname={pathname} onNavigate={() => setNavOpen(false)} />
            <Button
              variant="ghost"
              className="mt-auto justify-start gap-3"
              onClick={() => void logout()}
            >
              <LogOut size={17} /> Sign out
            </Button>
          </div>
        </div>
      )}

      <main>
        <header className="flex h-20 items-center justify-between gap-3 border-b border-line bg-white px-4 sm:px-6 lg:px-10">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Open navigation"
              aria-expanded={navOpen}
              className="rounded-lg p-2 text-slate-600 hover:bg-cream lg:hidden"
              onClick={() => setNavOpen(true)}
            >
              <Menu size={22} />
            </button>
            <div className="lg:hidden">
              <Brand />
            </div>
            <div className="hidden lg:block">
              <p className="text-sm text-slate-500">{session.business.name}</p>
              <h1 className="font-semibold">{title}</h1>
            </div>
          </div>
          <div className="grid size-10 place-items-center rounded-full bg-ink text-sm font-semibold text-white">
            {initials(session.user.displayName)}
          </div>
        </header>
        <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-10">
          {!session.user.emailVerified && (
            <div
              role="status"
              className="mb-6 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="flex items-center gap-2">
                <MailWarning size={18} />
                Verify your email address to secure your account.
              </span>
              <span className="flex items-center gap-3">
                {notice && <span className="text-xs">{notice}</span>}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={resending}
                  onClick={() => void resendVerification()}
                >
                  {resending ? <LoaderCircle className="animate-spin" size={15} /> : 'Resend email'}
                </Button>
              </span>
            </div>
          )}
          <div className="mb-8">
            <p className="text-sm font-semibold uppercase tracking-[.14em] text-moss">{eyebrow}</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">{title}</h2>
            <p className="mt-2 max-w-2xl text-slate-500">{description}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

function NavLinks({
  items,
  pathname,
  onNavigate,
  authenticated,
}: {
  items: (typeof navigation)[number][];
  pathname: string;
  onNavigate?: () => void;
  authenticated?: boolean;
}) {
  return (
    <nav className={authenticated ? 'mt-6 space-y-1' : 'mt-6 space-y-1'}>
      {items.map(({ icon: Icon, label, href }) => {
        const active = href === '/dashboard' ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={label}
            href={href}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${
              active ? 'bg-mint text-moss' : 'text-slate-600 hover:bg-cream hover:text-ink'
            }`}
          >
            <Icon size={18} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}
