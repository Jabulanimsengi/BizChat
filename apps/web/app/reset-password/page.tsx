import Link from 'next/link';
import { AuthShell } from '../../components/auth-shell';
import { ResetPasswordForm } from '../../components/reset-password-form';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <AuthShell
      title="Choose a new password"
      description="Set a new password for your BizChat account."
      footer={
        <Link className="font-semibold text-moss hover:underline" href="/login">
          Back to sign in
        </Link>
      }
    >
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          This reset link is missing its token. Request a new password reset email.
        </p>
      )}
    </AuthShell>
  );
}
