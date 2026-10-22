import Link from 'next/link';
import { AuthForm } from '../../components/auth-form';
import { AuthShell } from '../../components/auth-shell';

export default function RegisterPage() {
  return (
    <AuthShell
      title="Create your workspace"
      description="Set up the secure tenant foundation for your team."
      footer={
        <>
          Already have a workspace?{' '}
          <Link className="font-semibold text-moss hover:underline" href="/login">
            Sign in
          </Link>
        </>
      }
    >
      <AuthForm mode="register" />
    </AuthShell>
  );
}
