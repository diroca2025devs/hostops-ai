'use client';

import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { useState, type FormEvent } from 'react';
import { Alert, Avatar, Button, Card, DataState, Field, FormGrid, Input, Modal, Muted, PageHeader, Table, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/useApi';
import { useSubmit } from '@/lib/useSubmit';
import type { Guest } from '@/types/api';
import styles from './screens.module.css';

export function GuestsScreen() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '' });
  const guests = useApi<Guest[]>(`/guests${search.trim().length >= 2 ? `?search=${encodeURIComponent(search.trim())}` : ''}`);
  const { busy, error, run } = useSubmit();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await run(() => api.post('/guests', { name: form.name, phone: form.phone || null, email: form.email || null, notes: form.notes || null }));
    if (saved) {
      setCreating(false);
      setForm({ name: '', phone: '', email: '', notes: '' });
      guests.reload();
    }
  };

  return (
    <div>
      <PageHeader title="Hóspedes" actions={can('guest:write') && <Button icon={faPlus} onClick={() => setCreating(true)}>Novo hóspede</Button>} />
      <div className={styles.toolbar}>
        <Field label="Buscar por nome, telefone ou e-mail">
          <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Digite ao menos 2 caracteres" />
        </Field>
      </div>
      <Card pad={false}>
        <DataState loading={guests.loading} error={guests.error} empty={guests.data?.length === 0} emptyText="Nenhum hóspede encontrado.">
          <Table head={['Hóspede', 'Telefone', 'E-mail', 'Reservas']}>
            {(guests.data ?? []).map((g) => (
              <tr key={g.id}>
                <td>
                  <div className={styles.row}>
                    <Avatar name={g.name} size={28} />
                    <span className={styles.strong}>{g.name}</span>
                  </div>
                </td>
                <td>{g.phone ?? <Muted>—</Muted>}</td>
                <td>{g.email ?? <Muted>—</Muted>}</td>
                <td>{g._count?.reservations ?? 0}</td>
              </tr>
            ))}
          </Table>
        </DataState>
      </Card>
      {creating && (
        <Modal
          title="Novo hóspede"
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setCreating(false)}>Cancelar</Button>
              <Button type="submit" form="guest-form" disabled={busy}>Salvar</Button>
            </>
          }
        >
          <form id="guest-form" onSubmit={submit} className={styles.stack}>
            {error && <Alert>{error}</Alert>}
            <FormGrid>
              <Field label="Nome" span2><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Telefone (WhatsApp)" hint="É por ele que o assistente identifica a reserva"><Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+55 31 90000-0000" /></Field>
              <Field label="E-mail"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
              <Field label="Observações" span2><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            </FormGrid>
          </form>
        </Modal>
      )}
    </div>
  );
}
