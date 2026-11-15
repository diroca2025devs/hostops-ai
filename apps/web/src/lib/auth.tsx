'use client';

import type { PermissionKey, RoleKey } from '@hostops/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';

export interface Session {
  user: { id: string; name: string; email: string };
  organization: { id: string; name: string; slug: string; timezone: string };
  role: RoleKey;
  permissions: PermissionKey[];
}

interface AuthValue {
  session: Session | null;
  loading: boolean;
  can: (permission: PermissionKey) => boolean;
  login: (email: string, password: string) => Promise<Session>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/**
 * Sessão do painel. As permissões aqui servem apenas para esconder itens da interface:
 * a autorização real é sempre feita pela API.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setSession(await api.get<Session>('/auth/me'));
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => setSession(null);
    window.addEventListener('hostops:unauthorized', onUnauthorized);
    return () => window.removeEventListener('hostops:unauthorized', onUnauthorized);
  }, [refresh]);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      loading,
      can: (permission) => !!session?.permissions.includes(permission),
      login: async (email, password) => {
        const result = await api.post<Session>('/auth/login', { email, password });
        setSession(result);
        return result;
      },
      logout: async () => {
        await api.post('/auth/logout').catch(() => undefined);
        setSession(null);
      },
      refresh,
    }),
    [session, loading, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth deve ser usado dentro de <AuthProvider>.');
  return value;
}

/** Página inicial de cada perfil. Diaristas têm um acesso simplificado e separado. */
export function homePathFor(session: Session): string {
  return session.permissions.includes('dashboard:read') ? '/visao-geral' : '/diarista';
}
