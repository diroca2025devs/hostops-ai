'use client';

import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { LABELS, MAINTENANCE_PRIORITIES, MAINTENANCE_STATUSES } from '@hostops/shared';
import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, DataState, Field, FormGrid, Input, Modal, Muted, PageHeader, Select, Table, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { maintenanceTone, priorityTone } from '@/lib/tones';
import { useApi } from '@/lib/useApi';
import { useSubmit } from '@/lib/useSubmit';
import type { MaintenanceTicket, Property } from '@/types/api';
import styles from './screens.module.css';

const sourceLabel = { STAFF: 'Equipe', GUEST: 'Hóspede', AI: 'Assistente IA' } as const;

export function MaintenanceScreen() {
  const { session, can } = useAuth();
  const tz = session?.organization.timezone;
  const tickets = useApi<MaintenanceTicket[]>('/maintenance');
  const properties = useApi<Property[]>('/properties');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ propertyId: '', title: '', description: '', priority: 'MEDIUM' });
  const { busy, error, run } = useSubmit();
  const canWrite = can('maintenance:write');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await run(() => api.post('/maintenance', { ...form, propertyId: form.propertyId || properties.data?.[0]?.id }));
    if (saved) {
      setCreating(false);
      setForm({ propertyId: '', title: '', description: '', priority: 'MEDIUM' });
      tickets.reload();
    }
  };
  const setStatus = async (id: string, status: string) => {
    await run(() => api.patch(`/maintenance/${id}`, { status }));
    tickets.reload();
  };

  return (
    <div>
      <PageHeader title="Manutenção" actions={canWrite && <Button icon={faPlus} onClick={() => setCreating(true)}>Novo chamado</Button>} />
      {error && !creating && <Alert>{error}</Alert>}
      <Card pad={false}>
        <DataState loading={tickets.loading} error={tickets.error} empty={tickets.data?.length === 0} emptyText="Nenhum chamado de manutenção.">
          <Table head={['Chamado', 'Imóvel', 'Prioridade', 'Origem', 'Aberto em', 'Status']}>
            {(tickets.data ?? []).map((t) => (
              <tr key={t.id}>
                <td>
                  <span className={styles.strong}>{t.title}</span>
                  <div><Muted>{t.description.slice(0, 90)}</Muted></div>
                </td>
                <td>{t.property.name}</td>
                <td><Badge tone={priorityTone[t.priority]}>{LABELS.priority[t.priority]}</Badge></td>
                <td>{sourceLabel[t.source]}</td>
                <td>{fmtDateTime(t.createdAt, tz)}</td>
                <td>
                  {canWrite ? (
                    <Select value={t.status} disabled={busy} onChange={(e) => void setStatus(t.id, e.target.value)} aria-label="Status do chamado">
                      {MAINTENANCE_STATUSES.map((s) => (
                        <option key={s} value={s}>{LABELS.maintenanceStatus[s]}</option>
                      ))}
                    </Select>
                  ) : (
                    <Badge tone={maintenanceTone[t.status]}>{LABELS.maintenanceStatus[t.status]}</Badge>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </DataState>
      </Card>
      {creating && (
        <Modal
          title="Novo chamado"
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setCreating(false)}>Cancelar</Button>
              <Button type="submit" form="ticket-form" disabled={busy}>Abrir chamado</Button>
            </>
          }
        >
          <form id="ticket-form" onSubmit={submit} className={styles.stack}>
            {error && <Alert>{error}</Alert>}
            <FormGrid>
              <Field label="Imóvel">
                <Select value={form.propertyId || properties.data?.[0]?.id || ''} onChange={(e) => setForm({ ...form, propertyId: e.target.value })}>
                  {(properties.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Prioridade">
                <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  {MAINTENANCE_PRIORITIES.map((p) => (
                    <option key={p} value={p}>{LABELS.priority[p]}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Título" span2><Input required minLength={3} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
              <Field label="Descrição" span2><Textarea required minLength={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            </FormGrid>
          </form>
        </Modal>
      )}
    </div>
  );
}
