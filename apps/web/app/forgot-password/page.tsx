import Link from 'next/link';
import { AuthShell } from '../../components/auth-shell';
import { ForgotPasswordForm } from '../../components/forgot-password-form';

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      description="Enter your work email and we'll send a secure link to set a new password."
      footer={
        <>
          Remembered it?{' '}
          <Link className="font-semibold text-moss hover:underline" href="/login">
            Sign in
          </Link>
        </>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
