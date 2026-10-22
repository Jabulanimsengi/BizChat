import Link from 'next/link';
import { AuthForm } from '../../components/auth-form';
import { AuthShell } from '../../components/auth-shell';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  const { reset } = await searchParams;
  return (
    <AuthShell
      title="Welcome back"
      description="Sign in to your business inbox and administration workspace."
      footer={
        <>
          New to BizChat?{' '}
          <Link className="font-semibold text-moss hover:underline" href="/register">
            Create a workspace
          </Link>
        </>
      }
    >
      {reset && (
        <p className="mb-4 rounded-xl bg-mint px-4 py-3 text-sm text-moss">
          Your password was reset. Sign in with your new password.
        </p>
      )}
      <AuthForm mode="login" />
    </AuthShell>
  );
}
