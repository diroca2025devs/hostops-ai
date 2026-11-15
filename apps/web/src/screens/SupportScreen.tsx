'use client';

import { faPaperPlane, faRobot, faUserTie } from '@fortawesome/free-solid-svg-icons';
import { LABELS } from '@hostops/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, DataState, EmptyState, Input, Muted, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, fmtTime } from '@/lib/format';
import { conversationTone } from '@/lib/tones';
import { useApi } from '@/lib/useApi';
import { useSubmit } from '@/lib/useSubmit';
import type { ConversationDetail, ConversationSummary, GuestRequest, Integrations } from '@/types/api';
import styles from './screens.module.css';

const senderLabel = { GUEST: 'Hóspede', AI: 'Assistente IA', HUMAN: 'Equipe', SYSTEM: 'Sistema' } as const;

function Thread({ id, timeZone, onChanged }: { id: string; timeZone?: string; onChanged: () => void }) {
  const { can } = useAuth();
  const conversation = useApi<ConversationDetail>(`/conversations/${id}`, { refreshMs: 15_000 });
  const [text, setText] = useState('');
  const { busy, error, run } = useSubmit();
  const endRef = useRef<HTMLDivElement>(null);
  const count = conversation.data?.messages.length ?? 0;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [count]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    const sent = await run(() => api.post(`/conversations/${id}/messages`, { body: text.trim() }));
    if (sent) setText('');
    conversation.reload();
    onChanged();
  };
  const setStatus = async (status: 'BOT' | 'HUMAN' | 'CLOSED') => {
    await run(() => api.patch(`/conversations/${id}/status`, { status }));
    conversation.reload();
    onChanged();
  };
  const c = conversation.data;

  return (
    <Card
      title={c ? (c.guest?.name ?? c.contactName ?? c.contactPhone) : 'Conversa'}
      action={c && <Badge tone={conversationTone[c.status]}>{LABELS.conversationStatus[c.status]}</Badge>}
    >
      <DataState loading={conversation.loading} error={conversation.error} empty={!c}>
        {c && (
          <div className={styles.stack} style={{ gap: 12 }}>
            <Muted>
              {c.contactPhone}
              {c.property ? ` · ${c.property.name}` : ' · sem reserva identificada'}
              {c.reservation ? ` · ${fmtDateTime(c.reservation.checkIn, timeZone)} → ${fmtDateTime(c.reservation.checkOut, timeZone)}` : ''}
            </Muted>
            {c.status === 'HUMAN' && c.handoffReason && <Alert tone="amber">Encaminhada para atendimento humano: {c.handoffReason}</Alert>}
            <div className={styles.thread}>
              {c.messages.map((m) => (
                <div key={m.id} className={`${styles.bubble} ${m.sender === 'HUMAN' ? styles.bubbleOut : ''} ${m.sender === 'AI' || m.sender === 'SYSTEM' ? styles.bubbleAi : ''}`}>
                  {m.body}
                  <span className={styles.bubbleMeta}>
                    {senderLabel[m.sender]} · {fmtTime(m.createdAt, timeZone)}
                    {m.status === 'FAILED' ? ` · NÃO ENVIADA${m.errorMessage ? `: ${m.errorMessage}` : ''}` : ''}
                  </span>
                </div>
              ))}
              <div ref={endRef} />
            </div>
            {error && <Alert>{error}</Alert>}
            {can('conversation:write') && (
              <>
                <form className={styles.composer} onSubmit={send}>
                  <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Responder ao hóspede pelo WhatsApp…" maxLength={4000} aria-label="Mensagem" />
                  <Button type="submit" icon={faPaperPlane} disabled={busy || !text.trim()}>Enviar</Button>
                </form>
                <div className={styles.row}>
                  {c.status !== 'BOT' && <Button size="small" variant="secondary" icon={faRobot} disabled={busy} onClick={() => void setStatus('BOT')}>Devolver para a IA</Button>}
                  {c.status === 'BOT' && <Button size="small" variant="secondary" icon={faUserTie} disabled={busy} onClick={() => void setStatus('HUMAN')}>Assumir conversa</Button>}
                  {c.status !== 'CLOSED' && <Button size="small" variant="ghost" disabled={busy} onClick={() => void setStatus('CLOSED')}>Encerrar</Button>}
                </div>
              </>
            )}
            {c.aiInteractions.length > 0 && (
              <details>
                <summary className={styles.sub}>Histórico do assistente ({c.aiInteractions.length})</summary>
                <div className={styles.list} style={{ marginTop: 8 }}>
                  {c.aiInteractions.map((i) => (
                    <div key={i.id} className={styles.item}>
                      <div className={styles.itemMain}>
                        <div className={styles.itemTitle}>{i.outcome} · {i.model}</div>
                        <div className={styles.itemSub}>
                          {fmtDateTime(i.createdAt, timeZone)} · ferramentas: {(i.toolCalls ?? []).map((t) => t.name).join(', ') || 'nenhuma'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </DataState>
    </Card>
  );
}

function Requests({ timeZone }: { timeZone?: string }) {
  const { can } = useAuth();
  const requests = useApi<GuestRequest[]>('/guest-requests');
  const { busy, error, run } = useSubmit();
  const resolve = async (id: string, status: 'APPROVED' | 'REJECTED' | 'DONE') => {
    const note = status === 'DONE' ? null : window.prompt(status === 'APPROVED' ? 'Observação da aprovação (opcional):' : 'Motivo da recusa (opcional):');
    await run(() => api.post(`/guest-requests/${id}/resolve`, { status, resolutionNote: note || null }));
    requests.reload();
  };
  return (
    <Card title="Solicitações de hóspedes">
      {error && <Alert>{error}</Alert>}
      <DataState loading={requests.loading} error={requests.error} empty={requests.data?.length === 0} emptyText="Nenhuma solicitação registrada.">
        <div className={styles.list}>
          {(requests.data ?? []).map((r) => (
            <div key={r.id} className={styles.item}>
              <div className={styles.itemMain}>
                <div className={styles.itemTitle}>
                  {LABELS.requestType[r.type]} {r.requiresHumanApproval && <Badge tone="amber">exige autorização humana</Badge>}
                </div>
                <div className={styles.itemSub} style={{ whiteSpace: 'normal' }}>{r.description}</div>
                <div className={styles.itemSub}>
                  {r.conversation?.contactName ?? r.conversation?.contactPhone ?? '—'}
                  {r.reservation ? ` · ${r.reservation.property.name}` : ''} · {fmtDateTime(r.createdAt, timeZone)}
                  {r.resolutionNote ? ` · ${r.resolutionNote}` : ''}
                </div>
              </div>
              {r.status === 'OPEN' && can('conversation:write') ? (
                <div className={styles.row}>
                  {r.requiresHumanApproval ? (
                    <>
                      <Button size="small" disabled={busy} onClick={() => void resolve(r.id, 'APPROVED')}>Aprovar</Button>
                      <Button size="small" variant="danger" disabled={busy} onClick={() => void resolve(r.id, 'REJECTED')}>Recusar</Button>
                    </>
                  ) : (
                    <Button size="small" variant="secondary" disabled={busy} onClick={() => void resolve(r.id, 'DONE')}>Concluir</Button>
                  )}
                </div>
              ) : (
                <Badge tone={r.status === 'APPROVED' || r.status === 'DONE' ? 'green' : r.status === 'REJECTED' ? 'rose' : 'amber'}>{LABELS.requestStatus[r.status]}</Badge>
              )}
            </div>
          ))}
        </div>
      </DataState>
    </Card>
  );
}

export function SupportScreen() {
  const { session, can } = useAuth();
  const tz = session?.organization.timezone;
  const [tab, setTab] = useState<'conversations' | 'requests'>('conversations');
  const [selected, setSelected] = useState<string | null>(null);
  const conversations = useApi<ConversationSummary[]>('/conversations', { refreshMs: 20_000 });
  const integrations = useApi<Integrations>(can('integration:manage') ? '/integrations' : null);
  const list = conversations.data ?? [];
  const active = selected ?? list[0]?.id ?? null;

  return (
    <div>
      <PageHeader title="Atendimento IA" subtitle="Conversas do WhatsApp atendidas pelo assistente Gemini, com encaminhamento humano." />
      {integrations.data && (!integrations.data.gemini.configured || integrations.data.whatsapp.status !== 'CONNECTED') && (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="amber">
            {!integrations.data.gemini.configured && 'Gemini não configurado (GEMINI_API_KEY): o assistente não responde e toda conversa é encaminhada para a equipe. '}
            {integrations.data.whatsapp.status !== 'CONNECTED' && 'WhatsApp não conectado: mensagens enviadas pelo painel ficam marcadas como não enviadas. '}
            Ajuste em Configurações → Integrações.
          </Alert>
        </div>
      )}
      <div className={styles.tabs}>
        <button className={`${styles.tab} ${tab === 'conversations' ? styles.tabActive : ''}`} onClick={() => setTab('conversations')}>Conversas</button>
        <button className={`${styles.tab} ${tab === 'requests' ? styles.tabActive : ''}`} onClick={() => setTab('requests')}>Solicitações</button>
      </div>
      {tab === 'requests' ? (
        <Requests timeZone={tz} />
      ) : (
        <div className={styles.support}>
          <Card title="Conversas">
            <DataState loading={conversations.loading} error={conversations.error} empty={list.length === 0} emptyText="Nenhuma conversa ainda. Elas aparecem aqui quando um hóspede escreve no WhatsApp.">
              <div className={styles.list}>
                {list.map((c) => (
                  <button key={c.id} className={`${styles.item} ${styles.convItem} ${active === c.id ? styles.convActive : ''}`} onClick={() => setSelected(c.id)}>
                    <div className={styles.itemMain}>
                      <div className={styles.itemTitle}>{c.guest?.name ?? c.contactName ?? c.contactPhone}</div>
                      <div className={styles.itemSub}>{c.messages[0]?.body.slice(0, 60) ?? '—'}</div>
                    </div>
                    <div className={styles.itemEnd}>
                      <Badge tone={conversationTone[c.status]}>{c.status === 'BOT' ? 'IA' : c.status === 'HUMAN' ? 'Humano' : 'Encerrada'}</Badge>
                      <span className={styles.sub}>{fmtDateTime(c.lastMessageAt, tz)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </DataState>
          </Card>
          {active ? <Thread key={active} id={active} timeZone={tz} onChanged={conversations.reload} /> : <Card><EmptyState>Selecione uma conversa.</EmptyState></Card>}
        </div>
      )}
    </div>
  );
}
