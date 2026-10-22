import { AuthShell } from '../../components/auth-shell';
import { VerifyEmailPanel } from '../../components/verify-email-panel';

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <AuthShell
      title="Verify your email"
      description="Confirm your email address to secure your BizChat account."
      footer="You can close this tab once verification finishes."
    >
      <VerifyEmailPanel token={token ?? ''} />
    </AuthShell>
  );
}
