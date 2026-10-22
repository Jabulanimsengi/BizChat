'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { UNAUTHORIZED_EVENT } from '../lib/api';

export function SessionWatcher() {
  const router = useRouter();
  useEffect(() => {
    const onUnauthorized = () => {
      router.replace('/login');
      router.refresh();
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [router]);
  return null;
}
