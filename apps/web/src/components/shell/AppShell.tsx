'use client';

import '@/lib/fontawesome';
import { faArrowRightFromBracket, faBars, faBell } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { ROLE_LABELS } from '@hostops/shared';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Avatar, Button } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { NAV_ITEMS } from '@/lib/nav';
import { useApi } from '@/lib/useApi';
import type { AppNotification } from '@/types/api';
import styles from './shell.module.css';

/** Moldura do painel: menu lateral (gaveta no celular), barra superior e notificações. */
export function AppShell({ pathname, children }: { pathname: string; children: ReactNode }) {
  const { session, can, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const notifications = useApi<{ items: AppNotification[]; unread: number }>(can('notification:read') ? '/notifications' : null, { refreshMs: 60_000 });
  if (!session) return null;

  const items = NAV_ITEMS.filter((item) => can(item.permission));
  const unread = notifications.data?.unread ?? 0;
  const markAllRead = async () => {
    await api.post('/notifications/all/read');
    notifications.reload();
  };

  return (
    <div className={styles.shell}>
      {menuOpen && <div className={styles.backdrop} onClick={() => setMenuOpen(false)} />}
      <aside className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.brand}>
          <img src="/logo.png" alt="HostOps AI" className={styles.brandLogo} />
        </div>
        <nav className={styles.nav} aria-label="Menu principal">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => setMenuOpen(false)}
              >
                <FontAwesomeIcon icon={item.icon} className={styles.navIcon} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className={styles.user}>
          <Avatar name={session.user.name} />
          <div className={styles.userInfo}>
            <div className={styles.userName}>{session.user.name}</div>
            <div className={styles.userRole}>{ROLE_LABELS[session.role]}</div>
          </div>
          <button className={styles.iconButton} onClick={() => void logout()} aria-label="Sair" title="Sair">
            <FontAwesomeIcon icon={faArrowRightFromBracket} />
          </button>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <button className={`${styles.iconButton} ${styles.menuButton}`} onClick={() => setMenuOpen(true)} aria-label="Abrir menu">
            <FontAwesomeIcon icon={faBars} />
          </button>
          <span className={styles.orgName}>{session.organization.name}</span>
          <span className={styles.spacer} />
          <button className={styles.iconButton} onClick={() => setBellOpen((v) => !v)} aria-label={`Notificações (${unread} não lidas)`}>
            <FontAwesomeIcon icon={faBell} />
            {unread > 0 && <span className={styles.dot}>{unread > 9 ? '9+' : unread}</span>}
          </button>
          {bellOpen && (
            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                Notificações
                {unread > 0 && (
                  <Button variant="ghost" size="small" onClick={() => void markAllRead()}>
                    Marcar como lidas
                  </Button>
                )}
              </div>
              {(notifications.data?.items ?? []).length === 0 && <div className={styles.notification}>Nenhuma notificação.</div>}
              {(notifications.data?.items ?? []).slice(0, 30).map((n) => (
                <div key={n.id} className={`${styles.notification} ${n.readAt ? '' : styles.notificationUnread}`}>
                  <div className={styles.notificationTitle}>{n.title}</div>
                  <div className={styles.notificationBody}>{n.body}</div>
                  <div className={styles.notificationBody}>{fmtDateTime(n.createdAt, session.organization.timezone)}</div>
                </div>
              ))}
            </div>
          )}
        </header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}

export function Splash({ text = 'Carregando…' }: { text?: string }) {
  return <div className={styles.splash}>{text}</div>;
}
