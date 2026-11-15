'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { AppShell, Splash } from '@/components/shell/AppShell';
import { useAuth } from '@/lib/auth';

/** Guarda de rota do painel administrativo. Diaristas são levadas ao acesso simplificado. */
export default function PanelLayout({ children }: { children: ReactNode }) {
  const { session, loading, can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const allowed = !!session && can('dashboard:read');

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace('/login');
    else if (!allowed) router.replace('/diarista');
  }, [loading, session, allowed, router]);

  if (loading || !allowed) return <Splash />;
  return <AppShell pathname={pathname}>{children}</AppShell>;
}
