import type { Conversation, ConversationStatus, GuestRequestStatus, MessageSender } from '@hostops/database';
import { formatLocal, normalizePhone } from '@hostops/shared';
import { z } from 'zod';
import { FALLBACK_REPLY, runAgent } from '../ai/agent';
import { buildSystemPrompt } from '../ai/prompt';
import { buildGuestTools } from '../ai/tools';
import type { LlmContent } from '../ai/types';
import { decryptSecret } from '../crypto';
import { isUniqueViolation, notFound, unprocessable } from '../errors';
import type { Core, TenantContext } from '../types';
import { recordAudit, userActor } from './audit';
import { notify } from './notifications';

// ---------------------------------------------------------------------------
// Entrada: webhook do WhatsApp Business Cloud API
// ---------------------------------------------------------------------------

const webhookSchema = z.object({
  object: z.string().optional(),
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              field: z.string().optional(),
              value: z
                .object({
                  metadata: z.object({ phone_number_id: z.string() }).optional(),
                  contacts: z.array(z.object({ wa_id: z.string().optional(), profile: z.object({ name: z.string().optional() }).optional() })).optional(),
                  messages: z
                    .array(
                      z.object({
                        id: z.string(),
                        from: z.string(),
                        type: z.string(),
                        text: z.object({ body: z.string() }).optional(),
                      }),
                    )
                    .optional(),
                })
                .passthrough(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

/**
 * No Brasil o WhatsApp pode entregar o número sem o nono dígito.
 * Geramos as variantes para casar com o telefone cadastrado do hóspede.
 */
export function phoneVariants(phone: string): string[] {
  const variants = new Set([phone]);
  const m = /^\+55(\d{2})(\d+)$/.exec(phone);
  if (m) {
    const [, ddd, rest] = m;
    if (rest!.length === 8) variants.add(`+55${ddd}9${rest}`);
    if (rest!.length === 9 && rest!.startsWith('9')) variants.add(`+55${ddd}${rest!.slice(1)}`);
  }
  return [...variants];
}

/** Identifica hóspede e reserva (atual ou próxima) a partir do telefone, sempre dentro da organização. */
export async function resolveGuestContext(core: Core, organizationId: string, phone: string) {
  const guest = await core.db.guest.findFirst({ where: { organizationId, phone: { in: phoneVariants(phone) } } });
  if (!guest) return { guest: null, reservation: null };
  const now = core.now();
  const reservation = await core.db.reservation.findFirst({
    where: {
      organizationId,
      guestId: guest.id,
      status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] },
      checkOut: { gte: new Date(now.getTime() - 12 * 3600_000) },
    },
    orderBy: { checkIn: 'asc' },
  });
  return { guest, reservation };
}

export interface WebhookResult {
  received: number;
  duplicates: number;
  ignored: number;
}

/**
 * Processa o payload (já com assinatura validada na borda HTTP).
 * Idempotente: o ID da mensagem (wamid) é único no banco; reentregas da Meta são descartadas.
 */
export async function handleWhatsAppWebhook(core: Core, payload: unknown): Promise<WebhookResult> {
  const result: WebhookResult = { received: 0, duplicates: 0, ignored: 0 };
  const parsed = webhookSchema.safeParse(payload);
  if (!parsed.success) return result;

  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      const { metadata, messages = [], contacts = [] } = change.value;
      if (!metadata || messages.length === 0) continue; // ex.: recibos de entrega (statuses)
      const integration = await core.db.integration.findFirst({
        where: { provider: 'WHATSAPP', externalAccountId: metadata.phone_number_id, status: 'CONNECTED' },
      });
      if (!integration) {
        result.ignored += messages.length;
        core.logger.warn({ phoneNumberId: metadata.phone_number_id }, 'webhook para número não vinculado a nenhuma organização');
        continue;
      }
      const organizationId = integration.organizationId;

      for (const message of messages) {
        const phone = normalizePhone(message.from);
        const { guest, reservation } = await resolveGuestContext(core, organizationId, phone);
        const contactName = contacts.find((c) => c.wa_id === message.from)?.profile?.name ?? contacts[0]?.profile?.name ?? null;
        const now = core.now();
        const conversation = await core.db.conversation.upsert({
          where: { organizationId_channel_contactPhone: { organizationId, channel: 'WHATSAPP', contactPhone: phone } },
          create: {
            organizationId,
            contactPhone: phone,
            contactName,
            guestId: guest?.id ?? null,
            reservationId: reservation?.id ?? null,
            propertyId: reservation?.propertyId ?? null,
            lastMessageAt: now,
          },
          update: {
            lastMessageAt: now,
            guestId: guest?.id ?? null,
            reservationId: reservation?.id ?? null,
            propertyId: reservation?.propertyId ?? null,
            ...(contactName ? { contactName } : {}),
          },
        });
        const body =
          message.type === 'text' && message.text?.body
            ? message.text.body.slice(0, 4000)
            : `[O hóspede enviou uma mensagem do tipo "${message.type}", que este canal não consegue ler]`;
        let saved;
        try {
          saved = await core.db.message.create({
            data: { organizationId, conversationId: conversation.id, direction: 'INBOUND', sender: 'GUEST', body, externalId: message.id, status: 'RECEIVED' },
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            result.duplicates++;
            continue;
          }
          throw error;
        }
        result.received++;

        if (conversation.status === 'CLOSED') {
          await core.db.conversation.update({ where: { id: conversation.id }, data: { status: 'BOT', handoffReason: null } });
        }
        if (conversation.status === 'HUMAN') {
          await notify(core, {
            organizationId,
            toPermission: 'conversation:write',
            type: 'conversation.message',
            title: `Nova mensagem de ${guest?.name ?? contactName ?? phone}`,
            body: body.slice(0, 200),
            dedupeKey: `conversation-msg:${saved.id}`,
          });
        } else {
          await core.queue.enqueue('ai.reply', { conversationId: conversation.id, messageId: saved.id }, { jobId: `ai-reply-${saved.id}` });
        }
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Saída e encaminhamento humano
// ---------------------------------------------------------------------------

async function sendOutbound(
  core: Core,
  conversation: Conversation,
  body: string,
  sender: Extract<MessageSender, 'AI' | 'HUMAN' | 'SYSTEM'>,
  sentById?: string,
) {
  const integration = await core.db.integration.findUnique({
    where: { organizationId_provider: { organizationId: conversation.organizationId, provider: 'WHATSAPP' } },
  });
  let status: 'SENT' | 'FAILED' = 'FAILED';
  let externalId: string | null = null;
  let errorMessage: string | null = null;
  if (!integration || integration.status !== 'CONNECTED' || !integration.accessTokenEnc || !integration.externalAccountId) {
    errorMessage = 'Integração WhatsApp não configurada: mensagem não enviada.';
  } else {
    try {
      const sent = await core.whatsapp.sendText(
        { phoneNumberId: integration.externalAccountId, accessToken: decryptSecret(integration.accessTokenEnc, core.config.encryptionKey) },
        conversation.contactPhone,
        body,
      );
      status = 'SENT';
      externalId = sent.externalId;
    } catch (error) {
      errorMessage = (error as Error).message.slice(0, 500);
      core.logger.error({ conversationId: conversation.id, err: errorMessage }, 'falha ao enviar mensagem WhatsApp');
    }
  }
  const message = await core.db.message.create({
    data: {
      organizationId: conversation.organizationId,
      conversationId: conversation.id,
      direction: 'OUTBOUND',
      sender,
      body,
      status,
      externalId,
      errorMessage,
      sentById: sentById ?? null,
    },
  });
  await core.db.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: core.now() } });
  return message;
}

async function handoffToHuman(core: Core, conversation: Conversation, reason: string) {
  await core.db.conversation.update({ where: { id: conversation.id }, data: { status: 'HUMAN', handoffReason: reason.slice(0, 500) } });
  await recordAudit(core.db, {
    organizationId: conversation.organizationId,
    actor: { type: 'AI' },
    action: 'conversation.handoff',
    entityType: 'Conversation',
    entityId: conversation.id,
    metadata: { reason },
  });
  await notify(core, {
    organizationId: conversation.organizationId,
    toPermission: 'conversation:write',
    type: 'conversation.handoff',
    title: `Atendimento humano solicitado (${conversation.contactName ?? conversation.contactPhone})`,
    body: reason.slice(0, 300),
    dedupeKey: `handoff:${conversation.id}:${core.now().toISOString().slice(0, 13)}`,
  });
}

// ---------------------------------------------------------------------------
// Worker: resposta do agente de IA
// ---------------------------------------------------------------------------

export type AiReplyOutcome = 'REPLIED' | 'ESCALATED' | 'FAILED' | 'NOT_CONFIGURED' | 'SKIPPED';

export async function processAiReply(core: Core, job: { conversationId: string; messageId: string }): Promise<AiReplyOutcome> {
  const message = await core.db.message.findFirst({ where: { id: job.messageId, conversationId: job.conversationId } });
  const conversation = await core.db.conversation.findUnique({ where: { id: job.conversationId }, include: { organization: true } });
  if (!message || !conversation || conversation.status !== 'BOT') return 'SKIPPED';

  // Trava de idempotência: no máximo uma execução por mensagem do hóspede.
  let interaction;
  try {
    interaction = await core.db.aiInteraction.create({
      data: {
        organizationId: conversation.organizationId,
        conversationId: conversation.id,
        triggerMessageId: message.id,
        model: core.llm?.model ?? 'none',
        outcome: 'STARTED',
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return 'SKIPPED';
    throw error;
  }
  const finish = (outcome: AiReplyOutcome, data: { toolCalls?: unknown; errorMessage?: string; latencyMs?: number } = {}) =>
    core.db.aiInteraction
      .update({
        where: { id: interaction.id },
        data: { outcome, toolCalls: (data.toolCalls as object) ?? undefined, errorMessage: data.errorMessage, latencyMs: data.latencyMs },
      })
      .then(() => outcome);

  if (!core.llm) {
    // Sem credencial não simulamos resposta: a conversa vai para uma pessoa.
    await handoffToHuman(core, conversation, 'Assistente de IA não configurado (GEMINI_API_KEY ausente).');
    return finish('NOT_CONFIGURED');
  }

  const { guest, reservation } = await resolveGuestContext(core, conversation.organizationId, conversation.contactPhone);
  const previous = await core.db.message.findMany({
    where: { conversationId: conversation.id, createdAt: { lt: message.createdAt }, status: { not: 'FAILED' } },
    orderBy: { createdAt: 'desc' },
    take: 12,
  });
  const history: LlmContent[] = [];
  for (const m of previous.reverse()) {
    const role = m.sender === 'GUEST' ? 'user' : 'model';
    const last = history[history.length - 1];
    if (last && last.role === role) last.parts.push({ text: m.body });
    else history.push({ role, parts: [{ text: m.body }] });
  }
  while (history.length && history[0]!.role !== 'user') history.shift();

  const startedAt = Date.now();
  try {
    const result = await runAgent({
      llm: core.llm,
      tools: buildGuestTools(core),
      system: buildSystemPrompt({
        organizationName: conversation.organization.name,
        hasReservation: !!reservation,
        nowLocal: formatLocal(core.now(), conversation.organization.timezone),
      }),
      history,
      userMessage: message.body,
      toolContext: {
        organizationId: conversation.organizationId,
        conversationId: conversation.id,
        guestId: guest?.id ?? null,
        reservationId: reservation?.id ?? null,
        propertyId: reservation?.propertyId ?? null,
      },
    });
    await sendOutbound(core, conversation, result.reply, 'AI');
    if (result.escalated) await handoffToHuman(core, conversation, result.escalationReason ?? 'Encaminhado pelo assistente.');
    return finish(result.escalated ? 'ESCALATED' : 'REPLIED', { toolCalls: result.toolCalls, latencyMs: Date.now() - startedAt });
  } catch (error) {
    const errorMessage = (error as Error).message.slice(0, 500);
    core.logger.error({ conversationId: conversation.id, err: errorMessage }, 'falha no agente de IA');
    await sendOutbound(core, conversation, FALLBACK_REPLY, 'SYSTEM');
    await handoffToHuman(core, conversation, `Falha no assistente de IA: ${errorMessage}`);
    return finish('FAILED', { errorMessage, latencyMs: Date.now() - startedAt });
  }
}

// ---------------------------------------------------------------------------
// Painel de atendimento
// ---------------------------------------------------------------------------

export async function listConversations(core: Core, ctx: TenantContext, status?: ConversationStatus) {
  return core.db.conversation.findMany({
    where: { organizationId: ctx.organizationId, ...(status ? { status } : {}) },
    include: {
      guest: { select: { id: true, name: true } },
      property: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true, sender: true, createdAt: true } },
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 200,
  });
}

export async function getConversation(core: Core, ctx: TenantContext, id: string) {
  const conversation = await core.db.conversation.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: {
      guest: { select: { id: true, name: true, phone: true } },
      property: { select: { id: true, name: true } },
      reservation: { select: { id: true, checkIn: true, checkOut: true, status: true } },
      messages: { orderBy: { createdAt: 'asc' }, take: 500 },
      guestRequests: { orderBy: { createdAt: 'desc' } },
      aiInteractions: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });
  if (!conversation) throw notFound('Conversa');
  return conversation;
}

export async function sendHumanMessage(core: Core, ctx: TenantContext, id: string, body: string) {
  const conversation = await core.db.conversation.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!conversation) throw notFound('Conversa');
  // Ao responder, a pessoa assume a conversa: a IA para de responder até ser reativada.
  if (conversation.status !== 'HUMAN') {
    await core.db.conversation.update({ where: { id }, data: { status: 'HUMAN', handoffReason: 'Assumida pela equipe.' } });
  }
  const message = await sendOutbound(core, conversation, body, 'HUMAN', ctx.userId);
  await recordAudit(core.db, {
    organizationId: ctx.organizationId,
    actor: userActor(ctx),
    action: 'conversation.reply',
    entityType: 'Conversation',
    entityId: id,
    metadata: { messageId: message.id, status: message.status },
  });
  return message;
}

export async function setConversationStatus(core: Core, ctx: TenantContext, id: string, status: ConversationStatus) {
  const conversation = await core.db.conversation.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!conversation) throw notFound('Conversa');
  const updated = await core.db.conversation.update({
    where: { id },
    data: { status, handoffReason: status === 'HUMAN' ? 'Assumida pela equipe.' : null },
  });
  await recordAudit(core.db, {
    organizationId: ctx.organizationId,
    actor: userActor(ctx),
    action: 'conversation.status',
    entityType: 'Conversation',
    entityId: id,
    metadata: { from: conversation.status, to: status },
  });
  return updated;
}

export async function listGuestRequests(core: Core, ctx: TenantContext, status?: GuestRequestStatus) {
  const requests = await core.db.guestRequest.findMany({
    where: { organizationId: ctx.organizationId, ...(status ? { status } : {}) },
    include: {
      conversation: { select: { id: true, contactName: true, contactPhone: true } },
      reservation: { select: { id: true, checkIn: true, checkOut: true, property: { select: { name: true } } } },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 300,
  });
  return requests;
}

/** Decisão humana sobre uma solicitação (aprovar, recusar ou concluir). */
export async function resolveGuestRequest(
  core: Core,
  ctx: TenantContext,
  id: string,
  input: { status: Exclude<GuestRequestStatus, 'OPEN'>; resolutionNote?: string | null },
) {
  const request = await core.db.guestRequest.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!request) throw notFound('Solicitação');
  if (request.status !== 'OPEN') throw unprocessable('Solicitação já resolvida.', 'INVALID_STATUS');
  const updated = await core.db.guestRequest.update({
    where: { id },
    data: { status: input.status, resolutionNote: input.resolutionNote ?? null, resolvedById: ctx.userId, resolvedAt: core.now() },
  });
  await recordAudit(core.db, {
    organizationId: ctx.organizationId,
    actor: userActor(ctx),
    action: 'guest_request.resolve',
    entityType: 'GuestRequest',
    entityId: id,
    metadata: { type: request.type, status: input.status },
  });
  return updated;
}
