'use client';

import { faBroom, faChartPie, faClock, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { LABELS } from '@hostops/shared';
import { useState } from 'react';
import { Card, DataState, Field, Input, PageHeader, StatCard, Table } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { addDays, dayKey } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import type { OccupancyReport } from '@/types/api';
import styles from './screens.module.css';

export function ReportsScreen() {
  const { session } = useAuth();
  const today = dayKey(new Date(), session?.organization.timezone);
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const report = useApi<OccupancyReport>(from && to ? `/reports/occupancy?from=${from}&to=${to}` : null);
  const data = report.data;

  return (
    <div>
      <PageHeader title="Relatórios" subtitle="Ocupação e desempenho operacional. Este MVP não possui módulo financeiro." />
      <div className={styles.toolbar}>
        <Field label="De"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Até"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <DataState loading={report.loading} error={report.error} empty={!data}>
        {data && (
          <div className={styles.stack}>
            <div className={styles.stats}>
              <StatCard icon={faChartPie} label={`Ocupação média (${data.days} dias)`} value={`${data.occupancyRate}%`} />
              <StatCard icon={faBroom} label="Limpezas concluídas" value={`${data.cleaning.done}/${data.cleaning.total}`} tone="green" />
              <StatCard icon={faClock} label="Duração média da limpeza" value={data.cleaning.averageDurationMinutes === null ? '—' : `${data.cleaning.averageDurationMinutes} min`} tone="teal" />
              <StatCard icon={faTriangleExclamation} label="Concluídas com atraso" value={data.cleaning.doneLate} tone={data.cleaning.doneLate ? 'amber' : 'neutral'} />
            </div>
            <div className={styles.grid2}>
              <Card title="Ocupação por imóvel" pad>
                <Table head={['Imóvel', 'Reservas', 'Noites', 'Ocupação', '']}>
                  {data.byProperty.map((p) => (
                    <tr key={p.propertyId}>
                      <td className={styles.strong}>{p.propertyName}</td>
                      <td>{p.reservations}</td>
                      <td>{p.occupiedNights}/{p.availableNights}</td>
                      <td>{p.occupancyRate}%</td>
                      <td>
                        <div className={styles.bar} role="img" aria-label={`${p.occupancyRate}% de ocupação`}>
                          <div className={styles.barFill} style={{ width: `${Math.min(100, p.occupancyRate)}%` }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </Table>
              </Card>
              <Card title="Reservas por canal">
                <Table head={['Canal', 'Reservas']}>
                  {data.byChannel.length === 0 && (
                    <tr><td colSpan={2}>Sem reservas no período.</td></tr>
                  )}
                  {data.byChannel.map((c) => (
                    <tr key={c.channel}>
                      <td>{LABELS.channel[c.channel]}</td>
                      <td>{c.count}</td>
                    </tr>
                  ))}
                </Table>
              </Card>
            </div>
          </div>
        )}
      </DataState>
    </div>
  );
}
