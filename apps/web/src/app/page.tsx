'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Splash } from '@/components/shell/AppShell';
import { homePathFor, useAuth } from '@/lib/auth';

export default function IndexPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading) router.replace(session ? homePathFor(session) : '/login');
  }, [loading, session, router]);
  return <Splash />;
}
