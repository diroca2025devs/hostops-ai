'use client';

import { CLEANING_STATUSES, LABELS } from '@hostops/shared';
import { useState } from 'react';
import { Alert, Badge, Button, Card, DataState, Field, Modal, Muted, PageHeader, Select, Table } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { cleaningTone } from '@/lib/tones';
import { useApi } from '@/lib/useApi';
import { useSubmit } from '@/lib/useSubmit';
import type { CleaningTask, Member } from '@/types/api';
import styles from './screens.module.css';

function TaskModal({ task, timeZone, onClose }: { task: CleaningTask; timeZone?: string; onClose: () => void }) {
  return (
    <Modal title={`Limpeza — ${task.property.name}`} onClose={onClose}>
      <div className={styles.stack}>
        {task.hasConflict && <Alert tone="amber">{task.conflictReason}</Alert>}
        <dl className={styles.kv}>
          <dt>Janela</dt><dd>{fmtDateTime(task.windowStart, timeZone)} → {fmtDateTime(task.windowEnd, timeZone)}</dd>
          <dt>Diarista</dt><dd>{task.cleaner?.name ?? 'Não atribuída'}</dd>
          <dt>Início</dt><dd>{fmtDateTime(task.startedAt, timeZone)}</dd>
          <dt>Conclusão</dt><dd>{fmtDateTime(task.completedAt, timeZone)}</dd>
          {task.notes && (<><dt>Observações</dt><dd>{task.notes}</dd></>)}
        </dl>
        <div className={styles.list}>
          {task.items.map((item) => (
            <div key={item.id} className={styles.item}>
              <div className={styles.itemMain}>
                <div className={styles.itemTitle}>{item.label}</div>
                <div className={styles.itemSub}>
                  {item.checkedAt ? `Feito às ${fmtDateTime(item.checkedAt, timeZone)}` : 'Pendente'}
                  {item.requiresPhoto ? ` · foto obrigatória (${item.photoCount})` : ''}
                </div>
              </div>
              <Badge tone={item.checkedAt ? 'green' : 'neutral'}>{item.checkedAt ? 'ok' : '—'}</Badge>
            </div>
          ))}
        </div>
        {task.photos.length > 0 && (
          <div className={styles.photoRow}>
            {task.photos.map((photo) => (
              <a key={photo.id} href={`/api/v1/cleaning-tasks/${task.id}/photos/${photo.id}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={styles.photo} src={`/api/v1/cleaning-tasks/${task.id}/photos/${photo.id}`} alt="Foto da limpeza" />
              </a>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

export function CleaningsScreen() {
  const { session, can } = useAuth();
  const tz = session?.organization.timezone;
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<CleaningTask | null>(null);
  const tasks = useApi<CleaningTask[]>(`/cleaning-tasks${status ? `?status=${status}` : ''}`, { refreshMs: 60_000 });
  const cleaners = useApi<Member[]>(can('cleaning:manage') ? '/cleaners' : null);
  const { busy, error, run } = useSubmit();

  const assign = async (taskId: string, cleanerId: string) => {
    await run(() => api.post(`/cleaning-tasks/${taskId}/assign`, { cleanerId: cleanerId || null }));
    tasks.reload();
  };

  return (
    <div>
      <PageHeader title="Limpezas" subtitle="Geradas automaticamente após cada check-out. A conclusão exige confirmação da diarista." />
      <div className={styles.toolbar}>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option>
            {CLEANING_STATUSES.map((s) => (
              <option key={s} value={s}>{LABELS.cleaningStatus[s]}</option>
            ))}
          </Select>
        </Field>
      </div>
      {error && <div style={{ marginBottom: 12 }}><Alert>{error}</Alert></div>}
      <Card pad={false}>
        <DataState loading={tasks.loading} error={tasks.error} empty={tasks.data?.length === 0} emptyText="Nenhuma limpeza neste filtro.">
          <Table head={['Imóvel', 'Janela disponível', 'Diarista', 'Checklist', 'Status', '']}>
            {(tasks.data ?? []).map((t) => (
              <tr key={t.id}>
                <td>
                  <span className={styles.strong}>{t.property.name}</span>
                  {t.hasConflict && <div><Badge tone="amber">janela insuficiente</Badge></div>}
                </td>
                <td>
                  {fmtDateTime(t.windowStart, tz)} → {fmtDateTime(t.windowEnd, tz)}
                  <div><Muted>{t.estimatedMinutes} min estimados</Muted></div>
                </td>
                <td>
                  {can('cleaning:manage') && (t.status === 'PENDING' || t.status === 'ASSIGNED') ? (
                    <Select value={t.cleanerId ?? ''} disabled={busy} onChange={(e) => void assign(t.id, e.target.value)} aria-label="Diarista responsável">
                      <option value="">Sem diarista</option>
                      {(cleaners.data ?? []).filter((c) => c.isActive).map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </Select>
                  ) : (
                    (t.cleaner?.name ?? <Muted>—</Muted>)
                  )}
                </td>
                <td>{t.progress.done}/{t.progress.total} · {t.photos.length} foto(s)</td>
                <td>
                  <Badge tone={t.isOverdue ? 'rose' : cleaningTone[t.status]}>{t.isOverdue ? 'Atrasada' : LABELS.cleaningStatus[t.status]}</Badge>
                </td>
                <td><Button size="small" variant="secondary" onClick={() => setSelected(t)}>Detalhes</Button></td>
              </tr>
            ))}
          </Table>
        </DataState>
      </Card>
      {selected && <TaskModal task={selected} timeZone={tz} onClose={() => setSelected(null)} />}
    </div>
  );
}
