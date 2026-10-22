import type { Metadata } from 'next';
import { SessionWatcher } from '../components/session-watcher';
import './globals.css';

export const metadata: Metadata = {
  title: 'BizChat',
  description: 'Real-time customer conversations, routed to the right people.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <SessionWatcher />
        {children}
      </body>
    </html>
  );
}
