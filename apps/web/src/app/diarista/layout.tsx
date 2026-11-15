'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Splash } from '@/components/shell/AppShell';
import { useAuth } from '@/lib/auth';

/** Guarda do acesso simplificado: exige sessão com permissão de executar limpezas. */
export default function CleanerLayout({ children }: { children: ReactNode }) {
  const { session, loading, can } = useAuth();
  const router = useRouter();
  const allowed = !!session && can('cleaning:execute');
  useEffect(() => {
    if (loading) return;
    if (!session) router.replace('/login');
    else if (!allowed) router.replace('/visao-geral');
  }, [loading, session, allowed, router]);
  if (loading || !allowed) return <Splash />;
  return <>{children}</>;
}
