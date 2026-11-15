'use client';

import {
  faBed,
  faBroom,
  faClockRotateLeft,
  faDoorOpen,
  faHeadset,
  faKey,
  faScrewdriverWrench,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { LABELS } from '@hostops/shared';
import type { ReactNode } from 'react';
import { Alert, Avatar, Badge, Card, DataState, EmptyState, PageHeader, StatCard } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, fmtTime, relativeDay } from '@/lib/format';
import { cleaningTone } from '@/lib/tones';
import { useApi } from '@/lib/useApi';
import type { Overview } from '@/types/api';
import styles from './screens.module.css';

function Row({ title, sub, end, avatar }: { title: string; sub: string; end?: ReactNode; avatar?: string }) {
  return (
    <div className={styles.item}>
      {avatar && <Avatar name={avatar} size={34} />}
      <div className={styles.itemMain}>
        <div className={styles.itemTitle}>{title}</div>
        <div className={styles.itemSub}>{sub}</div>
      </div>
      {end && <div className={styles.itemEnd}>{end}</div>}
    </div>
  );
}

export function OverviewScreen() {
  const { session } = useAuth();
  const tz = session?.organization.timezone;
  const { data, loading, error } = useApi<Overview>('/dashboard/overview', { refreshMs: 60_000 });
  const guestName = (r: Overview['currentGuests'][number]) => r.guest?.name ?? r.summary ?? LABELS.channel[r.channel];

  return (
    <div>
      <PageHeader title="Visão geral" subtitle={data ? `Atualizado às ${fmtTime(data.generatedAt, tz)}` : 'Situação da operação agora'} />
      <DataState loading={loading} error={error} empty={!data}>
        {data && (
          <div className={styles.stack}>
            {data.counts.reservationConflicts > 0 && (
              <Alert>
                <strong>{data.counts.reservationConflicts} conflito(s) de reservas.</strong>{' '}
                {data.reservationConflicts.map((c) => `${c.propertyName}: ${LABELS.channel[c.a.channel]} × ${LABELS.channel[c.b.channel]} (${fmtDateTime(c.b.checkIn, tz)})`).join(' · ')}
              </Alert>
            )}
            {data.counts.cleaningWindowConflicts > 0 && (
              <Alert tone="amber">{data.counts.cleaningWindowConflicts} limpeza(s) com janela insuficiente entre check-out e check-in.</Alert>
            )}

            <div className={styles.stats}>
              <StatCard icon={faBed} label="Hóspedes hospedados" value={data.counts.currentGuests} tone="green" />
              <StatCard icon={faKey} label="Check-ins (7 dias)" value={data.counts.upcomingCheckIns} tone="brand" />
              <StatCard icon={faDoorOpen} label="Check-outs (7 dias)" value={data.counts.upcomingCheckOuts} tone="teal" />
              <StatCard icon={faBroom} label="Limpezas pendentes" value={data.counts.pendingCleanings} tone="amber" />
              <StatCard icon={faClockRotateLeft} label="Limpezas atrasadas" value={data.counts.overdueCleanings} tone={data.counts.overdueCleanings ? 'rose' : 'neutral'} />
              <StatCard icon={faTriangleExclamation} label="Conflitos de reservas" value={data.counts.reservationConflicts} tone={data.counts.reservationConflicts ? 'rose' : 'neutral'} />
              <StatCard icon={faHeadset} label="Solicitações de hóspedes" value={data.counts.openGuestRequests} tone={data.counts.openGuestRequests ? 'amber' : 'neutral'} />
              <StatCard icon={faScrewdriverWrench} label="Chamados abertos" value={data.counts.openMaintenance} tone="neutral" />
            </div>

            <div className={styles.grid3}>
              <Card title="Hospedados agora">
                {data.currentGuests.length === 0 && <EmptyState>Nenhum hóspede no momento.</EmptyState>}
                <div className={styles.list}>
                  {data.currentGuests.map((r) => (
                    <Row key={r.id} avatar={guestName(r)} title={guestName(r)} sub={`${r.property.name} · sai ${relativeDay(r.checkOut, tz)} ${fmtTime(r.checkOut, tz)}`} end={<Badge tone="green">{r.guestCount} hósp.</Badge>} />
                  ))}
                </div>
              </Card>
              <Card title="Próximos check-ins">
                {data.upcomingCheckIns.length === 0 && <EmptyState>Sem check-ins nos próximos 7 dias.</EmptyState>}
                <div className={styles.list}>
                  {data.upcomingCheckIns.map((r) => (
                    <Row key={r.id} avatar={guestName(r)} title={guestName(r)} sub={`${r.property.name} · ${LABELS.channel[r.channel]}`} end={<><span className={styles.strong}>{relativeDay(r.checkIn, tz)}</span><span className={styles.sub}>{fmtTime(r.checkIn, tz)}</span></>} />
                  ))}
                </div>
              </Card>
              <Card title="Próximos check-outs">
                {data.upcomingCheckOuts.length === 0 && <EmptyState>Sem check-outs nos próximos 7 dias.</EmptyState>}
                <div className={styles.list}>
                  {data.upcomingCheckOuts.map((r) => (
                    <Row key={r.id} avatar={guestName(r)} title={guestName(r)} sub={r.property.name} end={<><span className={styles.strong}>{relativeDay(r.checkOut, tz)}</span><span className={styles.sub}>{fmtTime(r.checkOut, tz)}</span></>} />
                  ))}
                </div>
              </Card>
            </div>

            <div className={styles.grid2}>
              <Card title="Limpezas">
                {data.overdueCleanings.length + data.pendingCleanings.length === 0 && <EmptyState>Nenhuma limpeza pendente.</EmptyState>}
                <div className={styles.list}>
                  {[...data.overdueCleanings, ...data.pendingCleanings].map((t) => {
                    const overdue = data.overdueCleanings.some((o) => o.id === t.id);
                    return (
                      <Row
                        key={t.id}
                        title={t.property.name}
                        sub={`${fmtDateTime(t.windowStart, tz)} → ${fmtDateTime(t.windowEnd, tz)} · ${t.cleaner?.name ?? 'sem diarista'}`}
                        end={
                          <>
                            <Badge tone={overdue ? 'rose' : cleaningTone[t.status]}>{overdue ? 'Atrasada' : LABELS.cleaningStatus[t.status]}</Badge>
                            {t.hasConflict && <Badge tone="amber">janela curta</Badge>}
                          </>
                        }
                      />
                    );
                  })}
                </div>
              </Card>
              <Card title="Solicitações de hóspedes">
                {data.guestRequests.length === 0 && <EmptyState>Nenhuma solicitação aberta.</EmptyState>}
                <div className={styles.list}>
                  {data.guestRequests.map((g) => (
                    <Row key={g.id} title={LABELS.requestType[g.type]} sub={g.description} end={g.requiresHumanApproval ? <Badge tone="amber">requer aprovação</Badge> : <Badge>informativa</Badge>} />
                  ))}
                </div>
              </Card>
            </div>
          </div>
        )}
      </DataState>
    </div>
  );
}
