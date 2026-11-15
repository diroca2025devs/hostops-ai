'use client';

import { faArrowLeft, faCamera, faCircle, faCircleCheck, faFlagCheckered, faPlay, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { LABELS } from '@hostops/shared';
import { useRef, useState, type ChangeEvent } from 'react';
import { Alert, Button, Card, DataState, Field, Icon, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, fmtTime } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { useSubmit } from '@/lib/useSubmit';
import type { CleaningTask } from '@/types/api';
import styles from './screens.module.css';

export function CleanerTaskScreen({ taskId, onBack }: { taskId: string; onBack: () => void }) {
  const { session } = useAuth();
  const tz = session?.organization.timezone;
  const task = useApi<CleaningTask>(`/cleaning-tasks/${taskId}`);
  const { busy, error, run } = useSubmit();
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoItem, setPhotoItem] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState('');
  const [problemSent, setProblemSent] = useState(false);
  const t = task.data;

  const act = async (action: () => Promise<unknown>) => {
    await run(action);
    task.reload();
  };
  const pickPhoto = (itemId: string | null) => {
    setPhotoItem(itemId);
    fileRef.current?.click();
  };
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const form = new FormData();
    // Campos de texto precisam vir antes do arquivo no multipart.
    if (photoItem) form.append('checklistItemId', photoItem);
    form.append('file', file);
    await act(() => api.post(`/cleaning-tasks/${taskId}/photos`, form));
  };
  const complete = async () => {
    if (!window.confirm('Confirmar que a limpeza foi concluída?')) return;
    await act(() => api.post(`/cleaning-tasks/${taskId}/complete`, { confirm: true, notes: notes || null }));
  };
  const reportProblem = async () => {
    if (!t || problem.trim().length < 3) return;
    const sent = await run(() => api.post('/maintenance', { propertyId: t.propertyId, title: problem.trim().slice(0, 80), description: problem.trim(), priority: 'MEDIUM' }));
    if (sent) {
      setProblem('');
      setProblemSent(true);
    }
  };

  const percent = t && t.progress.total ? Math.round((t.progress.done / t.progress.total) * 100) : 0;
  const inProgress = t?.status === 'IN_PROGRESS';

  return (
    <div className={styles.cleanerPage}>
      <div>
        <Button variant="ghost" icon={faArrowLeft} onClick={onBack}>Minhas limpezas</Button>
      </div>
      <DataState loading={task.loading} error={task.error} empty={!t}>
        {t && (
          <>
            <div className={styles.taskHero}>
              <span style={{ fontSize: 12, opacity: 0.9 }}>{LABELS.cleaningStatus[t.status]} · {t.estimatedMinutes} min estimados</span>
              <h2>{t.property.name}</h2>
              <p style={{ fontSize: 13, opacity: 0.92 }}>{t.property.addressLine} · {t.property.city}</p>
              <p style={{ fontSize: 13, opacity: 0.92, marginTop: 6 }}>
                Janela: {fmtDateTime(t.windowStart, tz)} até {fmtDateTime(t.windowEnd, tz)}
              </p>
              <div className={styles.progress}><div className={styles.progressFill} style={{ width: `${percent}%` }} /></div>
              <p style={{ fontSize: 12, marginTop: 6 }}>{t.progress.done} de {t.progress.total} itens</p>
            </div>

            {t.hasConflict && <Alert tone="amber">Janela apertada: {t.conflictReason}</Alert>}
            {error && <Alert>{error}</Alert>}

            {t.status === 'ASSIGNED' && (
              <Button size="block" icon={faPlay} disabled={busy} onClick={() => void act(() => api.post(`/cleaning-tasks/${taskId}/start`))}>
                Iniciar limpeza
              </Button>
            )}
            {t.status === 'DONE' && <Alert tone="green">Limpeza concluída às {fmtTime(t.completedAt, tz)}. Obrigado!</Alert>}

            <Card pad={false} title={undefined}>
              {t.items.map((item) => {
                const done = !!item.checkedAt;
                return (
                  <div key={item.id} className={`${styles.check} ${done ? styles.checkDone : ''}`}>
                    <button
                      onClick={() => void act(() => api.patch(`/cleaning-tasks/${taskId}/items/${item.id}`, { checked: !done }))}
                      disabled={!inProgress || busy}
                      aria-pressed={done}
                      aria-label={`${done ? 'Desmarcar' : 'Marcar'}: ${item.label}`}
                      style={{ border: 'none', background: 'none', padding: 0 }}
                    >
                      <Icon icon={done ? faCircleCheck : faCircle} className={`${styles.checkIcon} ${done ? styles.checkIconDone : ''}`} />
                    </button>
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {item.requiresPhoto && (
                      <Button size="small" variant={item.photoCount ? 'secondary' : 'primary'} icon={faCamera} disabled={!inProgress || busy} onClick={() => pickPhoto(item.id)}>
                        {item.photoCount ? `${item.photoCount} foto(s)` : 'Foto'}
                      </Button>
                    )}
                  </div>
                );
              })}
            </Card>

            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className={styles.fileInput} onChange={(e) => void upload(e)} aria-hidden tabIndex={-1} />

            {inProgress && (
              <>
                <Button variant="secondary" icon={faCamera} disabled={busy} onClick={() => pickPhoto(null)}>Adicionar outra foto</Button>
                {t.photos.length > 0 && (
                  <div className={styles.photoRow}>
                    {t.photos.map((p) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={p.id} className={styles.photo} src={`/api/v1/cleaning-tasks/${t.id}/photos/${p.id}`} alt="Foto enviada" />
                    ))}
                  </div>
                )}
                <Field label="Observações (opcional)"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
                <Button size="block" variant="dark" icon={faFlagCheckered} disabled={busy} onClick={() => void complete()}>
                  Concluir limpeza
                </Button>
              </>
            )}

            <Card title="Encontrou algum problema?">
              {problemSent && <Alert tone="green">Problema enviado para a equipe.</Alert>}
              <div className={styles.stack} style={{ gap: 10, marginTop: problemSent ? 10 : 0 }}>
                <Textarea value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="Ex.: chuveiro não esquenta, lâmpada queimada…" aria-label="Descrição do problema" />
                <Button variant="secondary" icon={faTriangleExclamation} disabled={busy || problem.trim().length < 3} onClick={() => void reportProblem()}>
                  Avisar a equipe
                </Button>
              </div>
            </Card>
          </>
        )}
      </DataState>
    </div>
  );
}
