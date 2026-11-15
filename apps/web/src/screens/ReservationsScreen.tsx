'use client';

import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { LABELS, RESERVATION_CHANNELS, RESERVATION_STATUSES } from '@hostops/shared';
import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, DataState, Field, FormGrid, Input, Modal, Mono, Muted, PageHeader, Select, Table, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { reservationTone } from '@/lib/tones';
import { useApi } from '@/lib/useApi';
import { useSubmit } from '@/lib/useSubmit';
import type { Paginated, Property, Reservation } from '@/types/api';
import styles from './screens.module.css';

const emptyForm = { propertyId: '', channel: 'DIRECT', checkInDate: '', checkOutDate: '', checkInTime: '', checkOutTime: '', guestCount: '1', guestName: '', guestPhone: '', externalId: '', notes: '' };

function NewReservationModal({ properties, onClose, onSaved }: { properties: Property[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ ...emptyForm, propertyId: properties[0]?.id ?? '' });
  const { busy, error, run } = useSubmit();
  const set = (key: keyof typeof emptyForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const property = properties.find((p) => p.id === form.propertyId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await run(() =>
      api.post('/reservations', {
        propertyId: form.propertyId,
        channel: form.channel,
        checkInDate: form.checkInDate,
        checkOutDate: form.checkOutDate,
        ...(form.checkInTime ? { checkInTime: form.checkInTime } : {}),
        ...(form.checkOutTime ? { checkOutTime: form.checkOutTime } : {}),
        guestCount: Number(form.guestCount),
        ...(form.externalId ? { externalId: form.externalId } : {}),
        ...(form.guestName ? { guest: { name: form.guestName, ...(form.guestPhone ? { phone: form.guestPhone } : {}) } } : {}),
        ...(form.notes ? { notes: form.notes } : {}),
      }),
    );
    if (saved) onSaved();
  };

  return (
    <Modal
      title="Nova reserva"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="reservation-form" disabled={busy}>{busy ? 'Salvando…' : 'Criar reserva'}</Button>
        </>
      }
    >
      <form id="reservation-form" onSubmit={submit} className={styles.stack}>
        {error && <Alert>{error}</Alert>}
        <FormGrid>
          <Field label="Imóvel">
            <Select required value={form.propertyId} onChange={set('propertyId')}>
              {properties.filter((p) => p.isActive).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Canal de origem">
            <Select value={form.channel} onChange={set('channel')}>
              {RESERVATION_CHANNELS.map((c) => (
                <option key={c} value={c}>{LABELS.channel[c]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Check-in"><Input type="date" required value={form.checkInDate} onChange={set('checkInDate')} /></Field>
          <Field label="Check-out"><Input type="date" required value={form.checkOutDate} onChange={set('checkOutDate')} /></Field>
          <Field label="Horário de check-in" hint={`Padrão do imóvel: ${property?.checkInTime ?? '15:00'}`}><Input type="time" value={form.checkInTime} onChange={set('checkInTime')} /></Field>
          <Field label="Horário de check-out" hint={`Padrão do imóvel: ${property?.checkOutTime ?? '11:00'}`}><Input type="time" value={form.checkOutTime} onChange={set('checkOutTime')} /></Field>
          <Field label="Hóspede (nome)"><Input value={form.guestName} onChange={set('guestName')} /></Field>
          <Field label="Telefone (WhatsApp)" hint="Com DDI e DDD. Ex.: +55 31 90000-0000"><Input type="tel" value={form.guestPhone} onChange={set('guestPhone')} /></Field>
          <Field label="Quantidade de hóspedes" hint={`Máximo do imóvel: ${property?.maxGuests ?? '—'}`}><Input type="number" min={1} max={30} required value={form.guestCount} onChange={set('guestCount')} /></Field>
          <Field label="Código externo" hint="Código da reserva no canal, se houver"><Input value={form.externalId} onChange={set('externalId')} /></Field>
          <Field label="Observações" span2><Textarea value={form.notes} onChange={set('notes')} /></Field>
        </FormGrid>
      </form>
    </Modal>
  );
}

export function ReservationsScreen() {
  const { session, can } = useAuth();
  const tz = session?.organization.timezone;
  const [status, setStatus] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [creating, setCreating] = useState(false);
  const action = useSubmit();
  const query = new URLSearchParams({ pageSize: '100', ...(status ? { status } : {}), ...(propertyId ? { propertyId } : {}) });
  const reservations = useApi<Paginated<Reservation>>(`/reservations?${query}`);
  const properties = useApi<Property[]>('/properties');
  const canWrite = can('reservation:write');

  const act = async (id: string, verb: 'check-in' | 'check-out' | 'cancel') => {
    if (verb === 'cancel' && !window.confirm('Cancelar esta reserva? A limpeza pendente também será cancelada.')) return;
    await action.run(() => api.post(`/reservations/${id}/${verb}`));
    reservations.reload();
  };

  return (
    <div>
      <PageHeader
        title="Reservas"
        subtitle={reservations.data ? `${reservations.data.total} reserva(s)` : undefined}
        actions={canWrite && <Button icon={faPlus} onClick={() => setCreating(true)} disabled={!properties.data?.length}>Nova reserva</Button>}
      />
      <div className={styles.toolbar}>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option>
            {RESERVATION_STATUSES.map((s) => (
              <option key={s} value={s}>{LABELS.reservationStatus[s]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Imóvel">
          <Select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
            <option value="">Todos</option>
            {(properties.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </Field>
      </div>
      {action.error && <div style={{ marginBottom: 12 }}><Alert>{action.error}</Alert></div>}
      <Card pad={false}>
        <DataState loading={reservations.loading} error={reservations.error} empty={reservations.data?.items.length === 0} emptyText="Nenhuma reserva encontrada.">
          <Table head={['Imóvel', 'Hóspede', 'Canal', 'Check-in', 'Check-out', 'Hósp.', 'Status', '']}>
            {(reservations.data?.items ?? []).map((r) => (
              <tr key={r.id}>
                <td className={styles.strong}>{r.property.name}</td>
                <td>{r.guest?.name ?? <Muted>{r.summary ?? 'Não informado'}</Muted>}</td>
                <td>
                  {LABELS.channel[r.channel]}
                  {r.externalId && <div><Mono>{r.externalId.slice(0, 22)}</Mono></div>}
                </td>
                <td>{fmtDateTime(r.checkIn, tz)}</td>
                <td>{fmtDateTime(r.checkOut, tz)}</td>
                <td>{r.guestCount}</td>
                <td>
                  <Badge tone={reservationTone[r.status]}>{LABELS.reservationStatus[r.status]}</Badge>
                  {r.icalFeedId && <div><Muted>via iCal</Muted></div>}
                </td>
                <td>
                  {canWrite && (
                    <div className={styles.row}>
                      {r.status === 'CONFIRMED' && <Button size="small" variant="secondary" disabled={action.busy} onClick={() => void act(r.id, 'check-in')}>Check-in</Button>}
                      {r.status === 'CHECKED_IN' && <Button size="small" variant="secondary" disabled={action.busy} onClick={() => void act(r.id, 'check-out')}>Check-out</Button>}
                      {['PENDING', 'CONFIRMED', 'BLOCKED'].includes(r.status) && <Button size="small" variant="danger" disabled={action.busy} onClick={() => void act(r.id, 'cancel')}>Cancelar</Button>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </DataState>
      </Card>
      {creating && properties.data && (
        <NewReservationModal
          properties={properties.data}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            reservations.reload();
          }}
        />
      )}
    </div>
  );
}
