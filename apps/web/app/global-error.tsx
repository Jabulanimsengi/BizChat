'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main
          style={{
            display: 'grid',
            minHeight: '100vh',
            placeItems: 'center',
            fontFamily: 'system-ui, sans-serif',
            padding: '1.5rem',
          }}
        >
          <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Something went wrong</h1>
            <p style={{ marginTop: '0.5rem', color: '#64748b' }}>
              {error.message || 'An unexpected error occurred.'}
            </p>
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: '1.5rem',
                height: '2.75rem',
                padding: '0 1.25rem',
                borderRadius: '0.75rem',
                background: '#0f172a',
                color: '#ffffff',
                border: 'none',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
