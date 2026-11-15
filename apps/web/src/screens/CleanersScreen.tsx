'use client';

import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { useState, type FormEvent } from 'react';
import { Alert, Avatar, Badge, Button, Card, DataState, Field, FormGrid, Input, Modal, Muted, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/useApi';
import { useSubmit } from '@/lib/useSubmit';
import type { Member } from '@/types/api';
import styles from './screens.module.css';

export function CleanersScreen() {
  const { can } = useAuth();
  const cleaners = useApi<Member[]>('/cleaners');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const { busy, error, run } = useSubmit();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await run(() => api.post('/users', { ...form, phone: form.phone || null, role: 'CLEANER' }));
    if (saved) {
      setCreating(false);
      setForm({ name: '', email: '', phone: '', password: '' });
      cleaners.reload();
    }
  };
  const toggle = async (member: Member) => {
    await run(() => api.patch(`/users/${member.id}`, { isActive: !member.isActive }));
    cleaners.reload();
  };

  return (
    <div>
      <PageHeader
        title="Diaristas"
        subtitle="Acesso simplificado: cada diarista vê apenas as próprias limpezas, sem dados administrativos ou financeiros."
        actions={can('user:manage') && <Button icon={faPlus} onClick={() => setCreating(true)}>Nova diarista</Button>}
      />
      {error && !creating && <Alert>{error}</Alert>}
      <DataState loading={cleaners.loading} error={cleaners.error} empty={cleaners.data?.length === 0} emptyText="Nenhuma diarista cadastrada.">
        <div className={styles.cards}>
          {(cleaners.data ?? []).map((c) => (
            <Card key={c.id}>
              <div className={styles.row}>
                <Avatar name={c.name} size={40} />
                <div className={styles.itemMain}>
                  <div className={styles.itemTitle}>{c.name}</div>
                  <div className={styles.itemSub}>{c.email}</div>
                </div>
                <Badge tone={c.isActive ? 'green' : 'neutral'}>{c.isActive ? 'Ativa' : 'Inativa'}</Badge>
              </div>
              <dl className={styles.kv}>
                <dt>WhatsApp</dt><dd>{c.phone ?? <Muted>não informado</Muted>}</dd>
                <dt>Limpezas abertas</dt><dd>{c.openTasks ?? 0}</dd>
                <dt>Próximas 24h</dt><dd>{c.tasksNext24h ?? 0}</dd>
              </dl>
              {can('user:manage') && (
                <Button size="small" variant="secondary" disabled={busy} onClick={() => void toggle(c)}>{c.isActive ? 'Desativar acesso' : 'Reativar acesso'}</Button>
              )}
            </Card>
          ))}
        </div>
      </DataState>
      {creating && (
        <Modal
          title="Nova diarista"
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setCreating(false)}>Cancelar</Button>
              <Button type="submit" form="cleaner-form" disabled={busy}>Criar acesso</Button>
            </>
          }
        >
          <form id="cleaner-form" onSubmit={submit} className={styles.stack}>
            {error && <Alert>{error}</Alert>}
            <FormGrid>
              <Field label="Nome" span2><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="E-mail de acesso"><Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
              <Field label="WhatsApp" hint="Para receber avisos de novas limpezas"><Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+55 31 90000-0000" /></Field>
              <Field label="Senha inicial" span2 hint="Mínimo de 10 caracteres, com letras e números"><Input type="password" autoComplete="new-password" required minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            </FormGrid>
          </form>
        </Modal>
      )}
    </div>
  );
}
