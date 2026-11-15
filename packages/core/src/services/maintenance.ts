import type { MaintenancePriority, MaintenanceStatus, TicketSource } from '@hostops/database';
import type { MaintenanceInput, UpdateMaintenanceInput } from '@hostops/shared';
import { notFound, unprocessable } from '../errors';
import type { Core, TenantContext } from '../types';
import { recordAudit, userActor, type AuditActor } from './audit';
import { notify } from './notifications';

const ticketInclude = {
  property: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
} as const;

export async function listMaintenanceTickets(
  core: Core,
  ctx: TenantContext,
  query: { status?: MaintenanceStatus; propertyId?: string } = {},
) {
  return core.db.maintenanceTicket.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.propertyId ? { propertyId: query.propertyId } : {}),
    },
    include: ticketInclude,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 300,
  });
}

/** Criação compartilhada por equipe, diaristas e pelo agente de IA. */
export async function openMaintenanceTicket(
  core: Core,
  input: {
    organizationId: string;
    propertyId: string;
    reservationId?: string | null;
    title: string;
    description: string;
    priority: MaintenancePriority;
    source: TicketSource;
    reportedById?: string | null;
    assignedToId?: string | null;
    actor: AuditActor;
  },
) {
  const property = await core.db.property.findFirst({ where: { id: input.propertyId, organizationId: input.organizationId } });
  if (!property) throw notFound('Imóvel');
  if (input.reservationId) {
    const reservation = await core.db.reservation.findFirst({
      where: { id: input.reservationId, organizationId: input.organizationId, propertyId: input.propertyId },
    });
    if (!reservation) throw notFound('Reserva');
  }
  if (input.assignedToId) {
    const member = await core.db.organizationUser.findFirst({
      where: { organizationId: input.organizationId, userId: input.assignedToId, isActive: true },
    });
    if (!member) throw unprocessable('Responsável não pertence à organização.', 'INVALID_ASSIGNEE');
  }
  const ticket = await core.db.maintenanceTicket.create({
    data: {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      reservationId: input.reservationId ?? null,
      title: input.title,
      description: input.description,
      priority: input.priority,
      source: input.source,
      reportedById: input.reportedById ?? null,
      assignedToId: input.assignedToId ?? null,
    },
    include: ticketInclude,
  });
  await recordAudit(core.db, {
    organizationId: input.organizationId,
    actor: input.actor,
    action: 'maintenance.create',
    entityType: 'MaintenanceTicket',
    entityId: ticket.id,
    metadata: { propertyId: input.propertyId, priority: input.priority, source: input.source },
  });
  await notify(core, {
    organizationId: input.organizationId,
    toPermission: 'maintenance:write',
    type: 'maintenance.opened',
    title: `Novo chamado (${property.name}): ${input.title}`,
    body: input.description.slice(0, 300),
    dedupeKey: `maintenance-opened:${ticket.id}`,
  });
  return ticket;
}

export async function createMaintenanceTicket(core: Core, ctx: TenantContext, input: MaintenanceInput) {
  return openMaintenanceTicket(core, {
    ...input,
    organizationId: ctx.organizationId,
    source: 'STAFF',
    reportedById: ctx.userId,
    // Quem apenas reporta (diarista) não escolhe responsável.
    assignedToId: ctx.permissions.has('maintenance:write') ? input.assignedToId : null,
    actor: userActor(ctx),
  });
}

export async function updateMaintenanceTicket(core: Core, ctx: TenantContext, id: string, input: UpdateMaintenanceInput) {
  const current = await core.db.maintenanceTicket.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!current) throw notFound('Chamado');
  if (input.assignedToId) {
    const member = await core.db.organizationUser.findFirst({
      where: { organizationId: ctx.organizationId, userId: input.assignedToId, isActive: true },
    });
    if (!member) throw unprocessable('Responsável não pertence à organização.', 'INVALID_ASSIGNEE');
  }
  const resolvedAt =
    input.status === undefined ? undefined : input.status === 'RESOLVED' ? (current.resolvedAt ?? core.now()) : null;
  const ticket = await core.db.maintenanceTicket.update({
    where: { id },
    data: { ...input, ...(resolvedAt !== undefined ? { resolvedAt } : {}) },
    include: ticketInclude,
  });
  await recordAudit(core.db, {
    organizationId: ctx.organizationId,
    actor: userActor(ctx),
    action: 'maintenance.update',
    entityType: 'MaintenanceTicket',
    entityId: id,
    metadata: { ...input },
  });
  return ticket;
}
