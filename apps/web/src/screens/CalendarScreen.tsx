'use client';

import { faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons';
import { LABELS } from '@hostops/shared';
import { useMemo, useState } from 'react';
import { Button, Card, DataState, PageHeader } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { addDays, dayKey, diffDays, fmtDateTime, fmtDayKey, fmtWeekday } from '@/lib/format';
import { channelColor } from '@/lib/tones';
import { useApi } from '@/lib/useApi';
import type { CalendarView } from '@/types/api';
import styles from './screens.module.css';

const DAYS = 14;

/** Posição fracionária de um instante dentro da janela (0 = início do 1º dia). */
function position(instant: string, from: string, timeZone: string): number {
  const date = new Date(instant);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date).split(':');
  return diffDays(from, dayKey(date, timeZone)) + (Number(parts[0]) * 60 + Number(parts[1])) / 1440;
}

export function CalendarScreen() {
  const { session } = useAuth();
  const tz = session?.organization.timezone ?? 'America/Sao_Paulo';
  const today = dayKey(new Date(), tz);
  const [from, setFrom] = useState(() => addDays(today, -2));
  const to = addDays(from, DAYS - 1);
  const { data, loading, error } = useApi<CalendarView>(`/calendar?from=${from}&to=${to}`);
  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(from, i)), [from]);
  const columns = { gridTemplateColumns: `repeat(${DAYS}, minmax(0, 1fr))` };
  const clamp = (v: number) => Math.min(DAYS, Math.max(0, v));
  const span = (start: string, end: string) => {
    const a = clamp(position(start, from, tz));
    const b = clamp(position(end, from, tz));
    return { left: `${(a / DAYS) * 100}%`, width: `${(Math.max(b - a, 0.15) / DAYS) * 100}%` };
  };

  return (
    <div>
      <PageHeader
        title="Calendário"
        subtitle={`${fmtDayKey(from)} a ${fmtDayKey(to)} · reservas e limpezas por imóvel`}
        actions={
          <>
            <Button variant="secondary" icon={faChevronLeft} onClick={() => setFrom(addDays(from, -7))} aria-label="Semana anterior" />
            <Button variant="secondary" onClick={() => setFrom(addDays(today, -2))}>Hoje</Button>
            <Button variant="secondary" icon={faChevronRight} onClick={() => setFrom(addDays(from, 7))} aria-label="Próxima semana" />
          </>
        }
      />
      <Card pad={false}>
        <DataState loading={loading} error={error} empty={!data}>
          {data && (
            <div className={styles.calendarScroll}>
              <div className={styles.calendar}>
                <div className={styles.calRow}>
                  <div className={styles.calLabel}>Imóvel</div>
                  <div className={styles.calTrack} style={columns}>
                    {days.map((d) => (
                      <div key={d} className={`${styles.calCell} ${styles.calHead} ${d === today ? styles.calToday : ''}`}>
                        {fmtWeekday(`${d}T12:00:00Z`, 'UTC')}
                        <strong>{fmtDayKey(d)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
                {data.properties.map((property) => (
                  <div key={property.id} className={styles.calRow}>
                    <div className={styles.calLabel}>
                      {property.name}
                      <span className={styles.sub}>{property.code}</span>
                    </div>
                    <div className={styles.calTrack} style={columns}>
                      {days.map((d) => {
                        const weekday = new Date(`${d}T12:00:00Z`).getUTCDay();
                        return <div key={d} className={`${styles.calCell} ${weekday === 0 || weekday === 6 ? styles.calWeekend : ''} ${d === today ? styles.calToday : ''}`} />;
                      })}
                      {data.reservations
                        .filter((r) => r.propertyId === property.id)
                        .map((r) => {
                          const label = r.status === 'BLOCKED' ? 'Bloqueio' : (r.guest?.name ?? r.summary ?? LABELS.channel[r.channel]);
                          return (
                            <div
                              key={r.id}
                              className={`${styles.calBar} ${r.status === 'BLOCKED' ? styles.calBlocked : ''} ${r.status === 'PENDING' ? styles.calPending : ''}`}
                              style={{ ...span(r.checkIn, r.checkOut), background: channelColor[r.channel] }}
                              title={`${label} · ${LABELS.channel[r.channel]} · ${LABELS.reservationStatus[r.status]}\n${fmtDateTime(r.checkIn, tz)} → ${fmtDateTime(r.checkOut, tz)}`}
                            >
                              {label}
                            </div>
                          );
                        })}
                      {data.cleanings
                        .filter((c) => c.propertyId === property.id)
                        .map((c) => (
                          <div
                            key={c.id}
                            className={`${styles.calClean} ${c.status === 'DONE' ? styles.calCleanDone : ''} ${c.hasConflict ? styles.calCleanConflict : ''}`}
                            style={span(c.windowStart, c.windowEnd)}
                            title={`Limpeza (${LABELS.cleaningStatus[c.status]}) · ${c.cleaner?.name ?? 'sem diarista'}\n${fmtDateTime(c.windowStart, tz)} → ${fmtDateTime(c.windowEnd, tz)}`}
                          />
                        ))}
                    </div>
                  </div>
                ))}
                {data.personalEvents.length > 0 && (
                  <div className={styles.calRow}>
                    <div className={styles.calLabel}>
                      Agenda pessoal
                      <span className={styles.sub}>Google Calendar</span>
                    </div>
                    <div className={styles.calTrack} style={columns}>
                      {days.map((d) => (
                        <div key={d} className={styles.calCell} />
                      ))}
                      {data.personalEvents.map((e) => (
                        <div key={e.id} className={styles.calBar} style={{ ...span(e.start, e.end), background: 'var(--ho-sub)' }} title={`${fmtDateTime(e.start, tz)} → ${fmtDateTime(e.end, tz)}`}>
                          Ocupado
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </DataState>
      </Card>
      <div className={styles.legend}>
        {(['AIRBNB', 'BOOKING', 'DIRECT'] as const).map((c) => (
          <span key={c}>
            <i className={styles.legendDot} style={{ background: channelColor[c] }} />
            {LABELS.channel[c]}
          </span>
        ))}
        <span><i className={styles.legendDot} style={{ background: 'var(--ho-amber)' }} />Limpeza pendente</span>
        <span><i className={styles.legendDot} style={{ background: 'var(--ho-green)' }} />Limpeza concluída</span>
        <span><i className={styles.legendDot} style={{ background: 'var(--ho-rose)' }} />Janela de limpeza insuficiente</span>
      </div>
    </div>
  );
}
