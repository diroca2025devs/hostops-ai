'use client';

import { faArrowRightFromBracket, faBroom, faChevronRight } from '@fortawesome/free-solid-svg-icons';
import { LABELS } from '@hostops/shared';
import { Alert, Avatar, Badge, Card, DataState, Icon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { fmtTime, relativeDay } from '@/lib/format';
import { cleaningTone } from '@/lib/tones';
import { useApi } from '@/lib/useApi';
import type { AppNotification, CleaningTask } from '@/types/api';
import styles from './screens.module.css';

/** Acesso simplificado da diarista: somente as próprias limpezas. Nenhum dado administrativo ou financeiro. */
export function CleanerHomeScreen({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const { session, logout } = useAuth();
  const tz = session?.organization.timezone;
  const tasks = useApi<CleaningTask[]>('/cleaning-tasks?mine=true', { refreshMs: 60_000 });
  const notifications = useApi<{ items: AppNotification[]; unread: number }>('/notifications?unread=true', { refreshMs: 60_000 });
  const open = (tasks.data ?? []).filter((t) => t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS');
  const done = (tasks.data ?? []).filter((t) => t.status === 'DONE').slice(-5).reverse();

  return (
    <div className={styles.cleanerPage}>
      <header className={styles.cleanerHeader}>
        <Avatar name={session?.user.name ?? '?'} size={42} />
        <div className={styles.itemMain}>
          <h1>Olá, {session?.user.name.split(' ')[0]}</h1>
          <p className={styles.sub}>{open.length} limpeza(s) na sua agenda</p>
        </div>
        <button onClick={() => void logout()} aria-label="Sair" style={{ border: 'none', background: 'none', fontSize: 18, color: 'var(--ho-sub)' }}>
          <Icon icon={faArrowRightFromBracket} />
        </button>
      </header>

      {(notifications.data?.unread ?? 0) > 0 && <Alert tone="brand">{notifications.data!.items[0]!.title}</Alert>}

      <DataState loading={tasks.loading} error={tasks.error} empty={open.length === 0} emptyText="Nenhuma limpeza agendada para você.">
        <div className={styles.list}>
          {open.map((t) => (
            <button key={t.id} onClick={() => onOpenTask(t.id)} className={styles.item} style={{ border: '1px solid var(--ho-line)', background: 'var(--ho-surface)', textAlign: 'left', padding: 14 }}>
              <span style={{ color: 'var(--ho-brand)', fontSize: 18 }}><Icon icon={faBroom} /></span>
              <div className={styles.itemMain}>
                <div className={styles.itemTitle}>{t.property.name}</div>
                <div className={styles.itemSub}>
                  {relativeDay(t.windowStart, tz)} · {fmtTime(t.windowStart, tz)} até {relativeDay(t.windowEnd, tz)} {fmtTime(t.windowEnd, tz)}
                </div>
                <div className={styles.itemSub}>{t.property.addressLine}</div>
              </div>
              <div className={styles.itemEnd}>
                <Badge tone={t.isOverdue ? 'rose' : cleaningTone[t.status]}>{t.isOverdue ? 'Atrasada' : LABELS.cleaningStatus[t.status]}</Badge>
                <Icon icon={faChevronRight} style={{ color: 'var(--ho-sub)' }} />
              </div>
            </button>
          ))}
        </div>
      </DataState>

      {done.length > 0 && (
        <Card title="Concluídas recentemente">
          <div className={styles.list}>
            {done.map((t) => (
              <div key={t.id} className={styles.item}>
                <div className={styles.itemMain}>
                  <div className={styles.itemTitle}>{t.property.name}</div>
                  <div className={styles.itemSub}>{relativeDay(t.completedAt ?? t.windowStart, tz)} · {fmtTime(t.completedAt, tz)}</div>
                </div>
                <Badge tone="green">Concluída</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
