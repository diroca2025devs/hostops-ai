'use client';

import { faCalendarPlus, faEye, faPen, faPlus, faRotate, faTrash } from '@fortawesome/free-solid-svg-icons';
import { LABELS, RESERVATION_CHANNELS } from '@hostops/shared';
import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, DataState, Field, FormGrid, Input, Modal, Muted, PageHeader, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { useSubmit } from '@/lib/useSubmit';
import type { IcalFeed, Member, Property } from '@/types/api';
import styles from './screens.module.css';

function PropertyModal({ property, cleaners, onClose, onSaved }: { property: Property | null; cleaners: Member[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: property?.name ?? '',
    code: property?.code ?? '',
    addressLine: property?.addressLine ?? '',
    city: property?.city ?? '',
    state: property?.state ?? '',
    checkInTime: property?.checkInTime ?? '15:00',
    checkOutTime: property?.checkOutTime ?? '11:00',
    cleaningDurationMinutes: String(property?.cleaningDurationMinutes ?? 180),
    maxGuests: String(property?.maxGuests ?? 2),
    wifiName: property?.wifiName ?? '',
    wifiPassword: '',
    accessCode: '',
    checkInInstructions: property?.checkInInstructions ?? '',
    houseRules: property?.houseRules ?? '',
    defaultCleanerId: property?.defaultCleanerId ?? '',
  });
  const { busy, error, run } = useSubmit();
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const { wifiPassword, accessCode, ...rest } = form;
    const payload = {
      ...rest,
      cleaningDurationMinutes: Number(form.cleaningDurationMinutes),
      maxGuests: Number(form.maxGuests),
      wifiName: form.wifiName || null,
      checkInInstructions: form.checkInInstructions || null,
      houseRules: form.houseRules || null,
      defaultCleanerId: form.defaultCleanerId || null,
      // Segredos só são enviados quando preenchidos (campo vazio = manter o valor atual).
      ...(wifiPassword ? { wifiPassword } : {}),
      ...(accessCode ? { accessCode } : {}),
    };
    const saved = await run(() => (property ? api.patch(`/properties/${property.id}`, payload) : api.post('/properties', payload)));
    if (saved) onSaved();
  };

  return (
    <Modal
      title={property ? `Editar ${property.name}` : 'Novo imóvel'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="property-form" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</Button>
        </>
      }
    >
      <form id="property-form" onSubmit={submit} className={styles.stack}>
        {error && <Alert>{error}</Alert>}
        <FormGrid>
          <Field label="Nome"><Input required value={form.name} onChange={set('name')} /></Field>
          <Field label="Código" hint="Identificador curto, único na organização"><Input required maxLength={20} value={form.code} onChange={set('code')} /></Field>
          <Field label="Endereço" span2><Input required value={form.addressLine} onChange={set('addressLine')} /></Field>
          <Field label="Cidade"><Input required value={form.city} onChange={set('city')} /></Field>
          <Field label="Estado"><Input required value={form.state} onChange={set('state')} /></Field>
          <Field label="Check-in a partir de"><Input type="time" required value={form.checkInTime} onChange={set('checkInTime')} /></Field>
          <Field label="Check-out até"><Input type="time" required value={form.checkOutTime} onChange={set('checkOutTime')} /></Field>
          <Field label="Duração da limpeza (min)" hint="Janela mínima entre check-out e check-in"><Input type="number" min={30} max={720} required value={form.cleaningDurationMinutes} onChange={set('cleaningDurationMinutes')} /></Field>
          <Field label="Capacidade (hóspedes)"><Input type="number" min={1} max={30} required value={form.maxGuests} onChange={set('maxGuests')} /></Field>
          <Field label="Diarista preferencial">
            <Select value={form.defaultCleanerId} onChange={set('defaultCleanerId')}>
              <option value="">Automático (menos ocupada)</option>
              {cleaners.filter((c) => c.isActive).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Rede Wi-Fi"><Input value={form.wifiName} onChange={set('wifiName')} /></Field>
          <Field label="Senha do Wi-Fi" hint={property?.hasWifiPassword ? 'Já cadastrada. Preencha apenas para trocar.' : 'Armazenada cifrada'}><Input type="password" autoComplete="new-password" value={form.wifiPassword} onChange={set('wifiPassword')} /></Field>
          <Field label="Código de acesso" hint={property?.hasAccessCode ? 'Já cadastrado. Preencha apenas para trocar.' : 'Armazenado cifrado'}><Input type="password" autoComplete="new-password" value={form.accessCode} onChange={set('accessCode')} /></Field>
          <Field label="Instruções de check-in" span2 hint="Usadas pelo assistente de IA — escreva exatamente o que o hóspede deve saber"><Textarea value={form.checkInInstructions} onChange={set('checkInInstructions')} /></Field>
          <Field label="Regras da casa" span2><Textarea value={form.houseRules} onChange={set('houseRules')} /></Field>
        </FormGrid>
      </form>
    </Modal>
  );
}

function FeedsModal({ property, onClose }: { property: Property; onClose: () => void }) {
  const { session } = useAuth();
  const feeds = useApi<IcalFeed[]>(`/ical-feeds?propertyId=${property.id}`);
  const [form, setForm] = useState({ name: '', channel: 'AIRBNB', url: '' });
  const [result, setResult] = useState<string | null>(null);
  const { busy, error, run } = useSubmit();

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await run(() => api.post('/ical-feeds', { ...form, propertyId: property.id }));
    if (saved) {
      setForm({ name: '', channel: 'AIRBNB', url: '' });
      feeds.reload();
    }
  };
  const sync = async (id: string) => {
    const r = await run(() => api.post<{ status: string; created: number; updated: number; cancelled: number; conflicts: number; error?: string }>(`/ical-feeds/${id}/sync`));
    if (r) setResult(r.status === 'OK' ? `Sincronizado: ${r.created} nova(s), ${r.updated} atualizada(s), ${r.cancelled} cancelada(s), ${r.conflicts} conflito(s).` : `Falha: ${r.error}`);
    feeds.reload();
  };
  const remove = async (id: string) => {
    if (!window.confirm('Remover este calendário? As reservas já importadas permanecem.')) return;
    await run(() => api.del(`/ical-feeds/${id}`));
    feeds.reload();
  };

  return (
    <Modal title={`Calendários iCal — ${property.name}`} onClose={onClose}>
      <div className={styles.stack}>
        <Alert tone="brand">
          Cole aqui o link de exportação de calendário (.ics) do anúncio no Airbnb ou na Booking.com. A sincronização roda a cada 15 minutos e nunca duplica reservas.
        </Alert>
        {error && <Alert>{error}</Alert>}
        {result && <Alert tone="green">{result}</Alert>}
        <DataState loading={feeds.loading} error={feeds.error} empty={feeds.data?.length === 0} emptyText="Nenhum calendário cadastrado para este imóvel.">
          <div className={styles.list}>
            {(feeds.data ?? []).map((feed) => (
              <div key={feed.id} className={styles.item}>
                <div className={styles.itemMain}>
                  <div className={styles.itemTitle}>{feed.name} · {LABELS.channel[feed.channel]}</div>
                  <div className={styles.itemSub}>
                    {feed.urlHost} · {feed.lastSyncAt ? `última sincronização ${fmtDateTime(feed.lastSyncAt, session?.organization.timezone)}` : 'nunca sincronizado'}
                  </div>
                  {feed.lastStatus === 'ERROR' && <div className={styles.itemSub} style={{ color: 'var(--ho-rose)' }}>{feed.lastError}</div>}
                </div>
                <Button size="small" variant="secondary" icon={faRotate} disabled={busy} onClick={() => void sync(feed.id)}>Sincronizar</Button>
                <Button size="small" variant="danger" icon={faTrash} disabled={busy} onClick={() => void remove(feed.id)} aria-label="Remover" />
              </div>
            ))}
          </div>
        </DataState>
        <form onSubmit={add}>
          <FormGrid>
            <Field label="Nome"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Airbnb principal" /></Field>
            <Field label="Canal">
              <Select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                {RESERVATION_CHANNELS.map((c) => (
                  <option key={c} value={c}>{LABELS.channel[c]}</option>
                ))}
              </Select>
            </Field>
            <Field label="URL do calendário (HTTPS)" span2><Input type="url" required value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…/calendar.ics" /></Field>
          </FormGrid>
          <div style={{ marginTop: 12 }}><Button type="submit" icon={faPlus} disabled={busy}>Adicionar calendário</Button></div>
        </form>
      </div>
    </Modal>
  );
}

export function PropertiesScreen() {
  const { can } = useAuth();
  const properties = useApi<Property[]>('/properties');
  const cleaners = useApi<Member[]>(can('cleaning:manage') ? '/cleaners' : null);
  const [editing, setEditing] = useState<Property | 'new' | null>(null);
  const [feedsFor, setFeedsFor] = useState<Property | null>(null);
  const [secrets, setSecrets] = useState<{ property: Property; wifiName: string | null; wifiPassword: string | null; accessCode: string | null } | null>(null);
  const reveal = useSubmit();

  const showSecrets = async (property: Property) => {
    const data = await reveal.run(() => api.post<{ wifiName: string | null; wifiPassword: string | null; accessCode: string | null }>(`/properties/${property.id}/secrets/reveal`));
    if (data) setSecrets({ property, ...data });
  };

  return (
    <div>
      <PageHeader
        title="Imóveis"
        subtitle={properties.data ? `${properties.data.length} imóvel(is) cadastrado(s)` : undefined}
        actions={can('property:write') && <Button icon={faPlus} onClick={() => setEditing('new')}>Novo imóvel</Button>}
      />
      {reveal.error && <Alert>{reveal.error}</Alert>}
      <DataState loading={properties.loading} error={properties.error} empty={properties.data?.length === 0} emptyText="Cadastre o primeiro imóvel para começar.">
        <div className={styles.cards}>
          {(properties.data ?? []).map((p) => (
            <Card key={p.id} className={styles.propertyCard}>
              <div className={styles.between}>
                <Badge tone="brand">{p.code}</Badge>
                <Badge tone={p.isActive ? 'green' : 'neutral'}>{p.isActive ? 'Ativo' : 'Inativo'}</Badge>
              </div>
              <h3>{p.name}</h3>
              <Muted>{p.addressLine} · {p.city}/{p.state}</Muted>
              <dl className={styles.kv}>
                <dt>Check-in / out</dt><dd>{p.checkInTime} / {p.checkOutTime}</dd>
                <dt>Limpeza</dt><dd>{p.cleaningDurationMinutes} min · {p.defaultCleaner?.name ?? 'diarista automática'}</dd>
                <dt>Capacidade</dt><dd>{p.maxGuests} hóspede(s)</dd>
                <dt>Wi-Fi</dt><dd>{p.wifiName ?? '—'} {p.hasWifiPassword ? '· senha cadastrada' : ''}</dd>
              </dl>
              <div className={styles.row}>
                {can('property:write') && <Button size="small" variant="secondary" icon={faPen} onClick={() => setEditing(p)}>Editar</Button>}
                {can('ical:manage') && <Button size="small" variant="secondary" icon={faCalendarPlus} onClick={() => setFeedsFor(p)}>iCal</Button>}
                {can('property:secrets') && <Button size="small" variant="ghost" icon={faEye} disabled={reveal.busy} onClick={() => void showSecrets(p)}>Ver acessos</Button>}
              </div>
            </Card>
          ))}
        </div>
      </DataState>
      {editing && (
        <PropertyModal
          property={editing === 'new' ? null : editing}
          cleaners={cleaners.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            properties.reload();
          }}
        />
      )}
      {feedsFor && <FeedsModal property={feedsFor} onClose={() => setFeedsFor(null)} />}
      {secrets && (
        <Modal title={`Acessos — ${secrets.property.name}`} onClose={() => setSecrets(null)}>
          <Alert tone="amber">Esta consulta ficou registrada na auditoria.</Alert>
          <dl className={styles.kv}>
            <dt>Rede Wi-Fi</dt><dd>{secrets.wifiName ?? '—'}</dd>
            <dt>Senha do Wi-Fi</dt><dd>{secrets.wifiPassword ?? '—'}</dd>
            <dt>Código de acesso</dt><dd>{secrets.accessCode ?? '—'}</dd>
          </dl>
        </Modal>
      )}
    </div>
  );
}
