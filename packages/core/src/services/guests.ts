import type { DbOrTx } from '@hostops/database';
import type { GuestInput } from '@hostops/shared';
import { conflict, isUniqueViolation, notFound } from '../errors';
import type { Core, TenantContext } from '../types';
import { recordAudit, userActor } from './audit';

export async function listGuests(core: Core, ctx: TenantContext, query: { search?: string } = {}) {
  const search = query.search?.trim();
  return core.db.guest.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(search ? { OR: [{ name: { contains: search } }, { phone: { contains: search } }, { email: { contains: search } }] } : {}),
    },
    include: { _count: { select: { reservations: true } } },
    orderBy: { name: 'asc' },
    take: 500,
  });
}

export async function getGuest(core: Core, ctx: TenantContext, id: string) {
  const guest = await core.db.guest.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: {
      reservations: { include: { property: { select: { id: true, name: true } } }, orderBy: { checkIn: 'desc' }, take: 50 },
    },
  });
  if (!guest) throw notFound('Hóspede');
  return guest;
}

/** Cria o hóspede ou reutiliza o existente com o mesmo telefone na organização. */
export async function findOrCreateGuest(db: DbOrTx, organizationId: string, input: GuestInput) {
  if (input.phone) {
    const existing = await db.guest.findUnique({ where: { organizationId_phone: { organizationId, phone: input.phone } } });
    if (existing) return existing;
  }
  return db.guest.create({
    data: { organizationId, name: input.name, phone: input.phone ?? null, email: input.email ?? null, notes: input.notes ?? null },
  });
}

export async function createGuest(core: Core, ctx: TenantContext, input: GuestInput) {
  try {
    const guest = await core.db.guest.create({
      data: {
        organizationId: ctx.organizationId,
        name: input.name,
        phone: input.phone ?? null,
        email: input.email ?? null,
        notes: input.notes ?? null,
      },
    });
    await recordAudit(core.db, {
      organizationId: ctx.organizationId,
      actor: userActor(ctx),
      action: 'guest.create',
      entityType: 'Guest',
      entityId: guest.id,
    });
    return guest;
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('Já existe um hóspede com este telefone.', 'GUEST_PHONE_IN_USE');
    throw error;
  }
}

export async function updateGuest(core: Core, ctx: TenantContext, id: string, input: Partial<GuestInput>) {
  const existing = await core.db.guest.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!existing) throw notFound('Hóspede');
  try {
    const guest = await core.db.guest.update({ where: { id }, data: input });
    await recordAudit(core.db, {
      organizationId: ctx.organizationId,
      actor: userActor(ctx),
      action: 'guest.update',
      entityType: 'Guest',
      entityId: id,
      metadata: { fields: Object.keys(input) },
    });
    return guest;
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('Já existe um hóspede com este telefone.', 'GUEST_PHONE_IN_USE');
    throw error;
  }
}
