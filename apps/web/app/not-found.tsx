import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-cream p-6">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold uppercase tracking-[.14em] text-moss">404</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm text-slate-500">
          The page you are looking for does not exist or has moved.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-ink px-5 text-sm font-semibold text-white hover:bg-moss"
        >
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
