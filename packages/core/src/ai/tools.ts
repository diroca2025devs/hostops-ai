import { GUEST_REQUEST_TYPES, HUMAN_APPROVAL_REQUEST_TYPES, LABELS, formatLocal } from '@hostops/shared';
import { z } from 'zod';
import { searchKnowledge } from '../services/knowledge';
import { openMaintenanceTicket } from '../services/maintenance';
import { notify } from '../services/notifications';
import { decryptPropertySecrets, resolveTimezone } from '../services/properties';
import type { Core } from '../types';
import type { AgentTool, AgentToolContext } from './types';

const tool = <S extends z.ZodType>(t: AgentTool<S>): AgentTool => t as unknown as AgentTool;
const noArgs = z.object({}).passthrough();
const emptyParams = { type: 'object', properties: {} };

/** Política de liberação de dados de acesso (Wi-Fi, instruções, código). Regra de servidor — o modelo não a contorna. */
export function accessRelease(
  reservation: { status: string; checkIn: Date; checkOut: Date } | null,
  now: Date,
  releaseHours: number,
): { allowed: true } | { allowed: false; reason: string } {
  if (!reservation) return { allowed: false, reason: 'Reserva não identificada para este telefone.' };
  if (reservation.status !== 'CONFIRMED' && reservation.status !== 'CHECKED_IN') {
    return { allowed: false, reason: 'A reserva não está confirmada.' };
  }
  if (now.getTime() >= reservation.checkOut.getTime()) return { allowed: false, reason: 'A estadia já foi encerrada.' };
  if (now.getTime() < reservation.checkIn.getTime() - releaseHours * 3600_000) {
    return { allowed: false, reason: `As informações de acesso são liberadas ${releaseHours} horas antes do check-in.` };
  }
  return { allowed: true };
}

async function loadScope(core: Core, ctx: AgentToolContext) {
  if (!ctx.reservationId) return null;
  const reservation = await core.db.reservation.findFirst({
    where: { id: ctx.reservationId, organizationId: ctx.organizationId },
    include: { property: true, guest: true },
  });
  if (!reservation) return null;
  return { reservation, property: reservation.property, timezone: await resolveTimezone(core, reservation.property) };
}

/**
 * Ferramentas autorizadas do assistente de hóspedes.
 * Nenhuma aceita identificadores de organização, imóvel ou reserva como argumento:
 * o escopo vem do AgentToolContext, resolvido no servidor.
 */
export function buildGuestTools(core: Core): AgentTool[] {
  const releaseHours = core.config.gemini.accessReleaseHours;

  return [
    tool({
      name: 'get_reservation_context',
      description: 'Retorna os dados da reserva do hóspede identificado: imóvel, datas e horários de check-in/check-out, status e quantidade de hóspedes.',
      parameters: emptyParams,
      schema: noArgs,
      async execute(_args, ctx) {
        const scope = await loadScope(core, ctx);
        if (!scope) return { found: false, message: 'Nenhuma reserva encontrada para este telefone.' };
        const { reservation, property, timezone } = scope;
        return {
          found: true,
          guestFirstName: reservation.guest?.name.split(' ')[0] ?? null,
          propertyName: property.name,
          city: property.city,
          checkIn: formatLocal(reservation.checkIn, timezone),
          checkOut: formatLocal(reservation.checkOut, timezone),
          status: LABELS.reservationStatus[reservation.status],
          guestCount: reservation.guestCount,
          maxGuests: property.maxGuests,
        };
      },
    }),

    tool({
      name: 'get_checkin_instructions',
      description: 'Retorna endereço, horário e instruções de check-in do imóvel da reserva (incluindo código de acesso, quando liberado).',
      parameters: emptyParams,
      schema: noArgs,
      redactKeys: ['accessCode'],
      async execute(_args, ctx) {
        const scope = await loadScope(core, ctx);
        const release = accessRelease(scope?.reservation ?? null, core.now(), releaseHours);
        if (!scope || !release.allowed) return { available: false, reason: release.allowed ? 'Reserva não identificada.' : release.reason };
        const { property, reservation, timezone } = scope;
        return {
          available: true,
          address: `${property.addressLine}, ${property.city} - ${property.state}`,
          checkInFrom: formatLocal(reservation.checkIn, timezone),
          checkOutUntil: formatLocal(reservation.checkOut, timezone),
          instructions: property.checkInInstructions ?? 'Sem instruções cadastradas.',
          accessCode: decryptPropertySecrets(core, property).accessCode,
          houseRules: property.houseRules,
        };
      },
    }),

    tool({
      name: 'get_wifi_info',
      description: 'Retorna o nome da rede e a senha do Wi-Fi do imóvel da reserva, quando liberado.',
      parameters: emptyParams,
      schema: noArgs,
      redactKeys: ['password'],
      async execute(_args, ctx) {
        const scope = await loadScope(core, ctx);
        const release = accessRelease(scope?.reservation ?? null, core.now(), releaseHours);
        if (!scope || !release.allowed) return { available: false, reason: release.allowed ? 'Reserva não identificada.' : release.reason };
        const secrets = decryptPropertySecrets(core, scope.property);
        if (!scope.property.wifiName || !secrets.wifiPassword) {
          return { available: false, reason: 'Wi-Fi não cadastrado para este imóvel.' };
        }
        return { available: true, network: scope.property.wifiName, password: secrets.wifiPassword };
      },
    }),

    tool({
      name: 'search_knowledge_base',
      description: 'Busca na base de conhecimento do imóvel (regras da casa, estacionamento, eletrodomésticos, região, etc.).',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Assunto da dúvida do hóspede, em poucas palavras.' } },
        required: ['query'],
      },
      schema: z.object({ query: z.string().trim().min(2).max(200) }),
      async execute(args, ctx) {
        const scope = await loadScope(core, ctx);
        if (!scope) return { results: [], message: 'Sem reserva identificada: base de conhecimento indisponível.' };
        const results = await searchKnowledge(core, ctx.organizationId, scope.property.id, args.query);
        return results.length ? { results } : { results: [], message: 'Nenhuma informação encontrada sobre este assunto.' };
      },
    }),

    tool({
      name: 'register_guest_request',
      description:
        'Registra uma solicitação do hóspede para a equipe. Obrigatório para pedidos de alteração de reserva, desconto, check-in antecipado, check-out tardio e assuntos financeiros (a IA não decide esses casos).',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...GUEST_REQUEST_TYPES] },
          description: { type: 'string', description: 'Resumo fiel do pedido do hóspede.' },
        },
        required: ['type', 'description'],
      },
      schema: z.object({ type: z.enum(GUEST_REQUEST_TYPES), description: z.string().trim().min(3).max(1500) }),
      async execute(args, ctx) {
        const requiresHumanApproval = HUMAN_APPROVAL_REQUEST_TYPES.includes(args.type);
        const request = await core.db.guestRequest.create({
          data: {
            organizationId: ctx.organizationId,
            conversationId: ctx.conversationId,
            reservationId: ctx.reservationId,
            propertyId: ctx.propertyId,
            guestId: ctx.guestId,
            type: args.type,
            description: args.description,
            requiresHumanApproval,
          },
        });
        await notify(core, {
          organizationId: ctx.organizationId,
          toPermission: 'conversation:write',
          type: 'guest_request.created',
          title: `Solicitação de hóspede: ${LABELS.requestType[args.type]}`,
          body: args.description.slice(0, 300),
          dedupeKey: `guest-request:${request.id}`,
        });
        return requiresHumanApproval
          ? {
              registered: true,
              requiresHumanApproval: true,
              escalated: true,
              reason: `Pedido de ${LABELS.requestType[args.type]} aguardando autorização humana.`,
              instruction: 'Informe que o pedido foi registrado e será analisado pela equipe. Não confirme nem prometa aprovação.',
            }
          : { registered: true, requiresHumanApproval: false };
      },
    }),

    tool({
      name: 'report_maintenance_issue',
      description: 'Abre um chamado de manutenção para um problema relatado pelo hóspede no imóvel.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Título curto do problema.' },
          description: { type: 'string', description: 'Descrição do que o hóspede relatou.' },
          urgency: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
        },
        required: ['title', 'description', 'urgency'],
      },
      schema: z.object({
        title: z.string().trim().min(3).max(160),
        description: z.string().trim().min(3).max(2000),
        urgency: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
      }),
      async execute(args, ctx) {
        if (!ctx.propertyId) return { opened: false, escalated: true, reason: 'Problema relatado sem imóvel identificado.' };
        const ticket = await openMaintenanceTicket(core, {
          organizationId: ctx.organizationId,
          propertyId: ctx.propertyId,
          reservationId: ctx.reservationId,
          title: args.title,
          description: args.description,
          priority: args.urgency,
          source: 'AI',
          actor: { type: 'AI' },
        });
        const urgent = args.urgency === 'HIGH' || args.urgency === 'CRITICAL';
        return {
          opened: true,
          ticketId: ticket.id,
          ...(urgent ? { escalated: true, reason: `Chamado urgente de manutenção: ${args.title}` } : {}),
          instruction: 'Informe que a equipe foi avisada. Não prometa prazo de solução.',
        };
      },
    }),

    tool({
      name: 'escalate_to_human',
      description: 'Encaminha a conversa para atendimento humano. Use quando não souber responder, quando o hóspede pedir ou em situações sensíveis.',
      parameters: {
        type: 'object',
        properties: { reason: { type: 'string', description: 'Motivo do encaminhamento.' } },
        required: ['reason'],
      },
      schema: z.object({ reason: z.string().trim().min(3).max(500) }),
      async execute(args) {
        return { escalated: true, reason: args.reason, instruction: 'Avise o hóspede que um atendente humano continuará a conversa.' };
      },
    }),
  ];
}
