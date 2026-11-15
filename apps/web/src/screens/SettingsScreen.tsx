'use client';

import { faPlus, faRotate } from '@fortawesome/free-solid-svg-icons';
import { ROLE_KEYS, ROLE_LABELS } from '@hostops/shared';
import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, DataState, Field, FormGrid, Input, Mono, Muted, PageHeader, Select, Table, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { useSubmit } from '@/lib/useSubmit';
import type { AuditEntry, Integrations, KnowledgeArticle, Member, Paginated, Property } from '@/types/api';
import styles from './screens.module.css';

const statusTone = (status: string) => (status === 'CONNECTED' ? 'green' : status === 'ERROR' ? 'rose' : 'neutral') as 'green' | 'rose' | 'neutral';
const statusLabel = (status: string) => (status === 'CONNECTED' ? 'Conectado' : status === 'ERROR' ? 'Erro' : 'Desconectado');

function IntegrationsTab({ googleResult }: { googleResult: string | null }) {
  const integrations = useApi<Integrations>('/integrations');
  const [whatsapp, setWhatsapp] = useState({ phoneNumberId: '', accessToken: '' });
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const { busy, error, run } = useSubmit();
  const data = integrations.data;

  const saveWhatsapp = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await run(() => api.put('/integrations/whatsapp', whatsapp));
    if (saved) {
      setWhatsapp({ phoneNumberId: '', accessToken: '' });
      integrations.reload();
    }
  };
  const connectGoogle = async () => {
    const result = await run(() => api.get<{ url: string }>('/integrations/google/authorize'));
    if (result) window.location.href = result.url;
  };
  const disconnect = async (provider: 'whatsapp' | 'google-calendar') => {
    if (!window.confirm('Desconectar esta integração? Os tokens serão apagados.')) return;
    await run(() => api.del(`/integrations/${provider}`));
    integrations.reload();
  };
  const syncGoogle = async () => {
    const r = await run(() => api.post<{ status: string; reason?: string; created: number; updated: number; deleted: number; failed: number }>('/integrations/google/sync'));
    if (r) setSyncResult(r.status === 'OK' ? `Agenda sincronizada: ${r.created} criado(s), ${r.updated} atualizado(s), ${r.deleted} removido(s), ${r.failed} falha(s).` : `Não sincronizado: ${r.reason}`);
  };

  return (
    <DataState loading={integrations.loading} error={integrations.error} empty={!data}>
      {data && (
        <div className={styles.stack}>
          {googleResult === 'conectado' && <Alert tone="green">Google Calendar conectado.</Alert>}
          {googleResult === 'negado' && <Alert tone="amber">A autorização do Google foi cancelada.</Alert>}
          {googleResult === 'erro' && <Alert>Não foi possível concluir a conexão com o Google. Tente novamente.</Alert>}
          {error && <Alert>{error}</Alert>}
          {syncResult && <Alert tone="brand">{syncResult}</Alert>}

          <div className={styles.grid3}>
            <Card title="Assistente Gemini" action={<Badge tone={data.gemini.configured ? 'green' : 'amber'}>{data.gemini.configured ? 'Configurado' : 'Sem chave'}</Badge>}>
              <p className={styles.sub}>Modelo: <Mono>{data.gemini.model}</Mono></p>
              <p className={styles.sub} style={{ marginTop: 8 }}>
                {data.gemini.configured
                  ? 'O assistente responde hóspedes usando apenas as ferramentas autorizadas.'
                  : 'Defina GEMINI_API_KEY no ambiente do servidor. Enquanto isso, o assistente não responde e as conversas vão para a equipe.'}
              </p>
            </Card>

            <Card title="WhatsApp Business" action={<Badge tone={statusTone(data.whatsapp.status)}>{statusLabel(data.whatsapp.status)}</Badge>}>
              {!data.whatsapp.appConfigured && <Alert tone="amber">Defina WHATSAPP_APP_SECRET e WHATSAPP_VERIFY_TOKEN no servidor: sem eles o webhook recusa todas as mensagens.</Alert>}
              {data.whatsapp.status === 'CONNECTED' ? (
                <div className={styles.stack} style={{ gap: 10 }}>
                  <p className={styles.sub}>Número (phone_number_id): <Mono>{data.whatsapp.phoneNumberId}</Mono></p>
                  <p className={styles.sub}>Webhook: <Mono>/api/v1/webhooks/whatsapp</Mono></p>
                  <Button size="small" variant="danger" disabled={busy} onClick={() => void disconnect('whatsapp')}>Desconectar</Button>
                </div>
              ) : (
                <form onSubmit={saveWhatsapp} className={styles.stack} style={{ gap: 10, marginTop: 8 }}>
                  <Field label="Phone Number ID"><Input required value={whatsapp.phoneNumberId} onChange={(e) => setWhatsapp({ ...whatsapp, phoneNumberId: e.target.value })} /></Field>
                  <Field label="Access token" hint="Armazenado cifrado; nunca é exibido novamente"><Input type="password" autoComplete="off" required value={whatsapp.accessToken} onChange={(e) => setWhatsapp({ ...whatsapp, accessToken: e.target.value })} /></Field>
                  <Button type="submit" disabled={busy}>Conectar</Button>
                </form>
              )}
            </Card>

            <Card title="Google Calendar" action={<Badge tone={statusTone(data.googleCalendar.status)}>{statusLabel(data.googleCalendar.status)}</Badge>}>
              {!data.googleCalendar.appConfigured && <Alert tone="amber">Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no servidor para habilitar a conexão.</Alert>}
              {data.googleCalendar.lastError && <Alert>{data.googleCalendar.lastError}</Alert>}
              <p className={styles.sub} style={{ margin: '8px 0' }}>
                O calendário <strong>HostOps</strong> recebe reservas, check-ins, check-outs e limpezas. A agenda pessoal é apenas lida (aparece como “Ocupado”).
              </p>
              <div className={styles.row}>
                {data.googleCalendar.status === 'CONNECTED' ? (
                  <>
                    <Button size="small" icon={faRotate} disabled={busy} onClick={() => void syncGoogle()}>Sincronizar agora</Button>
                    <Button size="small" variant="danger" disabled={busy} onClick={() => void disconnect('google-calendar')}>Desconectar</Button>
                  </>
                ) : (
                  <Button size="small" disabled={busy || !data.googleCalendar.appConfigured} onClick={() => void connectGoogle()}>Conectar com Google</Button>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
    </DataState>
  );
}

function UsersTab() {
  const { session } = useAuth();
  const users = useApi<Member[]>('/users');
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'MANAGER' });
  const { busy, error, run } = useSubmit();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await run(() => api.post('/users', form));
    if (saved) {
      setForm({ name: '', email: '', password: '', role: 'MANAGER' });
      users.reload();
    }
  };
  const update = async (id: string, payload: object) => {
    await run(() => api.patch(`/users/${id}`, payload));
    users.reload();
  };

  return (
    <div className={styles.stack}>
      {error && <Alert>{error}</Alert>}
      <Card pad={false}>
        <DataState loading={users.loading} error={users.error} empty={users.data?.length === 0}>
          <Table head={['Usuário', 'Papel', 'Último acesso', 'Situação']}>
            {(users.data ?? []).map((u) => {
              const self = u.id === session?.user.id;
              return (
                <tr key={u.id}>
                  <td>
                    <span className={styles.strong}>{u.name}</span>
                    <div><Muted>{u.email}</Muted></div>
                  </td>
                  <td>
                    <Select value={u.role} disabled={busy || self} onChange={(e) => void update(u.id, { role: e.target.value })} aria-label="Papel">
                      {ROLE_KEYS.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </Select>
                  </td>
                  <td>{fmtDateTime(u.lastLoginAt, session?.organization.timezone)}</td>
                  <td>
                    <Button size="small" variant={u.isActive ? 'secondary' : 'primary'} disabled={busy || self} onClick={() => void update(u.id, { isActive: !u.isActive })}>
                      {u.isActive ? 'Desativar' : 'Reativar'}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </Table>
        </DataState>
      </Card>
      <Card title="Novo usuário">
        <form onSubmit={submit}>
          <FormGrid>
            <Field label="Nome"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="E-mail"><Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Senha inicial" hint="Mínimo de 10 caracteres, com letras e números"><Input type="password" autoComplete="new-password" required minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            <Field label="Papel">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLE_KEYS.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </Select>
            </Field>
          </FormGrid>
          <div style={{ marginTop: 12 }}><Button type="submit" icon={faPlus} disabled={busy}>Criar usuário</Button></div>
        </form>
      </Card>
    </div>
  );
}

function KnowledgeTab() {
  const articles = useApi<KnowledgeArticle[]>('/knowledge');
  const properties = useApi<Property[]>('/properties');
  const [form, setForm] = useState({ title: '', category: '', content: '', propertyId: '' });
  const { busy, error, run } = useSubmit();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await run(() => api.post('/knowledge', { title: form.title, category: form.category || null, content: form.content, propertyId: form.propertyId || null }));
    if (saved) {
      setForm({ title: '', category: '', content: '', propertyId: '' });
      articles.reload();
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm('Excluir este artigo?')) return;
    await run(() => api.del(`/knowledge/${id}`));
    articles.reload();
  };

  return (
    <div className={styles.stack}>
      <Alert tone="brand">O assistente só responde dúvidas com o que estiver cadastrado aqui e nos dados do imóvel. O que não estiver escrito, ele encaminha para a equipe.</Alert>
      {error && <Alert>{error}</Alert>}
      <Card>
        <DataState loading={articles.loading} error={articles.error} empty={articles.data?.length === 0} emptyText="Nenhum artigo cadastrado.">
          <div className={styles.list}>
            {(articles.data ?? []).map((a) => (
              <div key={a.id} className={styles.item}>
                <div className={styles.itemMain}>
                  <div className={styles.itemTitle}>{a.title}</div>
                  <div className={styles.itemSub} style={{ whiteSpace: 'normal' }}>{a.content}</div>
                </div>
                <div className={styles.itemEnd}>
                  <Badge tone={a.property ? 'brand' : 'neutral'}>{a.property?.name ?? 'Todos os imóveis'}</Badge>
                  <Button size="small" variant="danger" disabled={busy} onClick={() => void remove(a.id)}>Excluir</Button>
                </div>
              </div>
            ))}
          </div>
        </DataState>
      </Card>
      <Card title="Novo artigo">
        <form onSubmit={submit}>
          <FormGrid>
            <Field label="Título"><Input required minLength={3} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Imóvel">
              <Select value={form.propertyId} onChange={(e) => setForm({ ...form, propertyId: e.target.value })}>
                <option value="">Todos os imóveis</option>
                {(properties.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Categoria"><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
            <Field label="Conteúdo" span2><Textarea required minLength={3} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></Field>
          </FormGrid>
          <div style={{ marginTop: 12 }}><Button type="submit" icon={faPlus} disabled={busy}>Adicionar</Button></div>
        </form>
      </Card>
    </div>
  );
}

function AuditTab() {
  const { session } = useAuth();
  const logs = useApi<Paginated<AuditEntry>>('/audit-logs?pageSize=100');
  return (
    <Card pad={false}>
      <DataState loading={logs.loading} error={logs.error} empty={logs.data?.items.length === 0}>
        <Table head={['Quando', 'Quem', 'Ação', 'Registro']}>
          {(logs.data?.items ?? []).map((l) => (
            <tr key={l.id}>
              <td>{fmtDateTime(l.createdAt, session?.organization.timezone)}</td>
              <td>{l.actorType === 'USER' ? (l.actorName ?? 'Usuário') : l.actorType === 'AI' ? 'Assistente IA' : 'Sistema'}</td>
              <td><Mono>{l.action}</Mono></td>
              <td><Muted>{l.entityType}</Muted></td>
            </tr>
          ))}
        </Table>
      </DataState>
    </Card>
  );
}

export function SettingsScreen({ googleResult }: { googleResult: string | null }) {
  const { can } = useAuth();
  const tabs = [
    { id: 'integrations', label: 'Integrações', show: can('integration:manage') },
    { id: 'users', label: 'Usuários', show: can('user:manage') },
    { id: 'knowledge', label: 'Base de conhecimento', show: can('knowledge:write') },
    { id: 'audit', label: 'Auditoria', show: can('audit:read') },
  ].filter((t) => t.show);
  const [tab, setTab] = useState(tabs[0]?.id ?? 'integrations');

  return (
    <div>
      <PageHeader title="Configurações" />
      <div className={styles.tabs}>
        {tabs.map((t) => (
          <button key={t.id} className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === 'integrations' && <IntegrationsTab googleResult={googleResult} />}
      {tab === 'users' && <UsersTab />}
      {tab === 'knowledge' && <KnowledgeTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  );
}
