import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardFrame } from './dashboard-frame';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function sessionResponse(emailVerified: boolean): unknown {
  return {
    user: { id: 'user-1', email: 'owner@example.com', displayName: 'Owner', emailVerified },
    membership: { id: 'membership-1', role: 'OWNER' },
    business: {
      id: 'business-1',
      name: 'Acme',
      slug: 'acme',
      publicId: 'pub_acme',
      status: 'ACTIVE',
      timezone: 'UTC',
      defaultLocale: 'en',
    },
  };
}

function mockSession(emailVerified: boolean): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(sessionResponse(emailVerified)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('DashboardFrame', () => {
  it('renders navigation, a mobile menu trigger, and sign out', async () => {
    mockSession(true);
    render(
      <DashboardFrame eyebrow="Ops" title="Overview" description="Everything at a glance">
        <p>dashboard-content</p>
      </DashboardFrame>,
    );

    expect(await screen.findByText('dashboard-content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('does not link to the unimplemented analytics route', async () => {
    mockSession(true);
    render(
      <DashboardFrame eyebrow="Ops" title="Overview" description="Everything at a glance">
        <p>dashboard-content</p>
      </DashboardFrame>,
    );

    await screen.findByText('dashboard-content');
    expect(screen.queryByRole('link', { name: 'Analytics' })).not.toBeInTheDocument();
  });

  it('prompts unverified users to confirm their email', async () => {
    mockSession(false);
    render(
      <DashboardFrame eyebrow="Ops" title="Overview" description="Everything at a glance">
        <p>dashboard-content</p>
      </DashboardFrame>,
    );

    expect(await screen.findByText(/verify your email address/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resend email/i })).toBeInTheDocument();
  });
});
