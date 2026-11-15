import type { Prisma, Tx } from '@hostops/database';
import {
  addMinutes,
  findStayConflicts,
  localToUtc,
  utcToLocalParts,
  type ReservationInput,
  type ReservationQuery,
  type UpdateReservationInput,
} from '@hostops/shared';
import { conflict, isUniqueViolation, notFound, unprocessable } from '../errors';
import type { Core, TenantContext } from '../types';
import { recordAudit, userActor } from './audit';
import { syncCleaningForProperty } from './cleaning';
import { findOrCreateGuest } from './guests';
import { notify } from './notifications';
import { getPropertyOrThrow, resolveTimezone } from './properties';

const reservationInclude = {
  property: { select: { id: true, name: true, code: true, timezone: true } },
  guest: { select: { id: true, name: true, phone: true } },
} satisfies Prisma.ReservationInclude;

/**
 * Serializa operações de reserva do mesmo imóvel: bloqueia a linha do imóvel
 * até o fim da transação (SELECT ... FOR UPDATE). Sem isso, duas requisições
 * simultâneas poderiam passar na verificação de conflito e gravar ambas.
 */
export async function lockProperty(tx: Tx, organizationId: string, propertyId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM Property WHERE id = ${propertyId} AND organizationId = ${organizationId} FOR UPDATE`;
  if (rows.length === 0) throw notFound('Imóvel');
}

/** Lança 409 se a estadia sobrepõe outra ou não respeita a janela de limpeza. */
export async function assertNoStayConflicts(
  tx: Tx,
  input: { organizationId: string; propertyId: string; checkIn: Date; checkOut: Date; cleaningMinutes: number; ignoreId?: string },
): Promise<void> {
  const nearby = await tx.reservation.findMany({
    where: {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      status: { not: 'CANCELLED' },
      ...(input.ignoreId ? { id: { not: input.ignoreId } } : {}),
      checkIn: { lt: addMinutes(input.checkOut, input.cleaningMinutes) },
      checkOut: { gt: addMinutes(input.checkIn, -input.cleaningMinutes) },
    },
    select: { id: true, checkIn: true, checkOut: true, channel: true, status: true },
  });
  const conflicts = findStayConflicts({ checkIn: input.checkIn, checkOut: input.checkOut }, nearby, input.cleaningMinutes);
  if (conflicts.length === 0) return;

  const details = conflicts.map((c) => {
    const other = nearby.find((n) => n.id === c.withId)!;
    return { reservationId: other.id, kind: c.kind, gapMinutes: c.gapMinutes, checkIn: other.checkIn, checkOut: other.checkOut, channel: other.channel };
  });
  if (conflicts.some((c) => c.kind === 'OVERLAP')) {
    throw conflict('O período conflita com outra reserva deste imóvel.', 'RESERVATION_OVERLAP', { conflicts: details });
  }
  throw conflict(
    `O intervalo entre as reservas é menor que a janela de limpeza do imóvel (${input.cleaningMinutes} min).`,
    'TURNOVER_WINDOW_TOO_SHORT',
    { conflicts: details },
  );
}

/** Efeitos posteriores a qualquer mudança de reserva: limpeza e agenda. */
export async function afterReservationChange(core: Core, organizationId: string, propertyId: string): Promise<void> {
  await syncCleaningForProperty(core, organizationId, propertyId);
  await core.queue.enqueue('calendar.sync-org', { organizationId });
}

export async function listReservations(core: Core, ctx: TenantContext, query: ReservationQuery) {
  const org = await core.db.organization.findUnique({ where: { id: ctx.organizationId }, select: { timezone: true } });
  const tz = org?.timezone ?? 'America/Sao_Paulo';
  const where: Prisma.ReservationWhereInput = {
    organizationId: ctx.organizationId,
    ...(query.propertyId ? { propertyId: query.propertyId } : {}),
    ...(query.status ? { status: query.status } : {}),
    // Interseção com o período consultado.
    ...(query.from ? { checkOut: { gt: localToUtc(query.from, '00:00', tz) } } : {}),
    ...(query.to ? { checkIn: { lt: addMinutes(localToUtc(query.to, '00:00', tz), 24 * 60) } } : {}),
  };
  const [items, total] = await Promise.all([
    core.db.reservation.findMany({
      where,
      include: reservationInclude,
      orderBy: { checkIn: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    core.db.reservation.count({ where }),
  ]);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

export async function getReservation(core: Core, ctx: TenantContext, id: string) {
  const reservation = await core.db.reservation.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: { ...reservationInclude, cleaningTask: { select: { id: true, status: true, windowStart: true, windowEnd: true } } },
  });
  if (!reservation) throw notFound('Reserva');
  return reservation;
}

export async function createReservation(core: Core, ctx: TenantContext, input: ReservationInput) {
  const property = await getPropertyOrThrow(core, ctx.organizationId, input.propertyId);
  if (!property.isActive) throw unprocessable('Imóvel inativo.', 'PROPERTY_INACTIVE');
  if (input.guestCount > property.maxGuests) {
    throw unprocessable(`O imóvel comporta no máximo ${property.maxGuests} hóspede(s).`, 'GUEST_LIMIT_EXCEEDED');
  }
  const tz = await resolveTimezone(core, property);
  const checkIn = localToUtc(input.checkInDate, input.checkInTime ?? property.checkInTime, tz);
  const checkOut = localToUtc(input.checkOutDate, input.checkOutTime ?? property.checkOutTime, tz);
  if (checkOut.getTime() <= checkIn.getTime()) {
    throw unprocessable('O check-out deve ser posterior ao check-in.', 'INVALID_PERIOD');
  }
  if (input.guestId) {
    const guest = await core.db.guest.findFirst({ where: { id: input.guestId, organizationId: ctx.organizationId } });
    if (!guest) throw notFound('Hóspede');
  }

  try {
    const reservation = await core.db.$transaction(async (tx) => {
      await lockProperty(tx, ctx.organizationId, property.id);
      await assertNoStayConflicts(tx, {
        organizationId: ctx.organizationId,
        propertyId: property.id,
        checkIn,
        checkOut,
        cleaningMinutes: property.cleaningDurationMinutes,
      });
      const guestId = input.guestId ?? (input.guest ? (await findOrCreateGuest(tx, ctx.organizationId, input.guest)).id : null);
      const created = await tx.reservation.create({
        data: {
          organizationId: ctx.organizationId,
          propertyId: property.id,
          guestId,
          channel: input.channel,
          externalId: input.externalId ?? null,
          checkIn,
          checkOut,
          guestCount: input.guestCount,
          status: input.status,
          notes: input.notes ?? null,
        },
        include: reservationInclude,
      });
      await recordAudit(tx, {
        organizationId: ctx.organizationId,
        actor: userActor(ctx),
        action: 'reservation.create',
        entityType: 'Reservation',
        entityId: created.id,
        metadata: { propertyId: property.id, channel: input.channel, checkIn, checkOut },
      });
      return created;
    });
    await afterReservationChange(core, ctx.organizationId, property.id);
    return reservation;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict('Já existe uma reserva com este código externo para o imóvel e canal.', 'DUPLICATE_EXTERNAL_ID');
    }
    throw error;
  }
}

export async function updateReservation(core: Core, ctx: TenantContext, id: string, input: UpdateReservationInput) {
  const current = await core.db.reservation.findFirst({ where: { id, organizationId: ctx.organizationId }, include: { property: true } });
  if (!current) throw notFound('Reserva');
  if (current.status === 'CANCELLED') throw unprocessable('Reserva cancelada não pode ser alterada.', 'INVALID_STATUS');

  const changesPeriod = ['checkInDate', 'checkOutDate', 'checkInTime', 'checkOutTime'].some((k) => (input as Record<string, unknown>)[k] !== undefined);
  if (current.icalFeedId && (changesPeriod || input.channel !== undefined || input.externalId !== undefined)) {
    throw unprocessable(
      'Reserva sincronizada por iCal: datas e canal são controlados pelo canal de origem.',
      'MANAGED_BY_ICAL',
    );
  }
  const tz = await resolveTimezone(core, current.property);
  const localIn = utcToLocalParts(current.checkIn, tz);
  const localOut = utcToLocalParts(current.checkOut, tz);
  const checkIn = localToUtc(input.checkInDate ?? localIn.date, input.checkInTime ?? localIn.time, tz);
  const checkOut = localToUtc(input.checkOutDate ?? localOut.date, input.checkOutTime ?? localOut.time, tz);
  if (checkOut.getTime() <= checkIn.getTime()) throw unprocessable('O check-out deve ser posterior ao check-in.', 'INVALID_PERIOD');
  const guestCount = input.guestCount ?? current.guestCount;
  if (guestCount > current.property.maxGuests) {
    throw unprocessable(`O imóvel comporta no máximo ${current.property.maxGuests} hóspede(s).`, 'GUEST_LIMIT_EXCEEDED');
  }
  if (input.guestId) {
    const guest = await core.db.guest.findFirst({ where: { id: input.guestId, organizationId: ctx.organizationId } });
    if (!guest) throw notFound('Hóspede');
  }
  if (input.status && !['PENDING', 'CONFIRMED', 'BLOCKED'].includes(current.status)) {
    throw unprocessable('O status atual não permite esta alteração.', 'INVALID_STATUS');
  }

  try {
    const updated = await core.db.$transaction(async (tx) => {
      await lockProperty(tx, ctx.organizationId, current.propertyId);
      if (changesPeriod) {
        await assertNoStayConflicts(tx, {
          organizationId: ctx.organizationId,
          propertyId: current.propertyId,
          checkIn,
          checkOut,
          cleaningMinutes: current.property.cleaningDurationMinutes,
          ignoreId: id,
        });
      }
      const result = await tx.reservation.update({
        where: { id },
        data: {
          checkIn,
          checkOut,
          guestCount,
          ...(input.guestId !== undefined ? { guestId: input.guestId } : {}),
          ...(input.channel ? { channel: input.channel } : {}),
          ...(input.externalId !== undefined ? { externalId: input.externalId } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
        include: reservationInclude,
      });
      await recordAudit(tx, {
        organizationId: ctx.organizationId,
        actor: userActor(ctx),
        action: 'reservation.update',
        entityType: 'Reservation',
        entityId: id,
        metadata: { fields: Object.keys(input), checkIn, checkOut },
      });
      return result;
    });
    await afterReservationChange(core, ctx.organizationId, current.propertyId);
    return updated;
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('Código externo já utilizado neste imóvel e canal.', 'DUPLICATE_EXTERNAL_ID');
    throw error;
  }
}

export async function cancelReservation(core: Core, ctx: TenantContext, id: string) {
  const current = await core.db.reservation.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!current) throw notFound('Reserva');
  if (current.status === 'CANCELLED') return getReservation(core, ctx, id);
  if (current.status === 'CHECKED_OUT') throw unprocessable('Reserva já finalizada.', 'INVALID_STATUS');
  await core.db.reservation.update({ where: { id }, data: { status: 'CANCELLED' } });
  await recordAudit(core.db, {
    organizationId: ctx.organizationId,
    actor: userActor(ctx),
    action: 'reservation.cancel',
    entityType: 'Reservation',
    entityId: id,
  });
  await afterReservationChange(core, ctx.organizationId, current.propertyId);
  return getReservation(core, ctx, id);
}

/** Registra a chegada ou a saída do hóspede. */
export async function transitionReservation(core: Core, ctx: TenantContext, id: string, action: 'check-in' | 'check-out') {
  const current = await core.db.reservation.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!current) throw notFound('Reserva');
  const expected = action === 'check-in' ? 'CONFIRMED' : 'CHECKED_IN';
  if (current.status !== expected) {
    throw unprocessable(
      action === 'check-in' ? 'Somente reservas confirmadas podem receber check-in.' : 'O check-out exige check-in realizado.',
      'INVALID_STATUS',
    );
  }
  await core.db.reservation.update({ where: { id }, data: { status: action === 'check-in' ? 'CHECKED_IN' : 'CHECKED_OUT' } });
  await recordAudit(core.db, {
    organizationId: ctx.organizationId,
    actor: userActor(ctx),
    action: `reservation.${action}`,
    entityType: 'Reservation',
    entityId: id,
  });
  await afterReservationChange(core, ctx.organizationId, current.propertyId);
  return getReservation(core, ctx, id);
}

export interface ReservationConflictPair {
  propertyId: string;
  propertyName: string;
  a: { id: string; channel: string; checkIn: Date; checkOut: Date; guestName: string | null };
  b: { id: string; channel: string; checkIn: Date; checkOut: Date; guestName: string | null };
}

/**
 * Pares de reservas ativas que se sobrepõem no mesmo imóvel.
 * Bloqueios de agenda (BLOCKED) ficam de fora: um canal costuma bloquear as datas
 * justamente porque outro canal vendeu o período — isso não é overbooking.
 * Podem surgir de importações iCal (o canal externo é a origem e não pode ser recusado).
 */
export async function listReservationConflicts(core: Core, organizationId: string): Promise<ReservationConflictPair[]> {
  const since = core.now();
  const pairs = await core.db.$queryRaw<Array<{ aId: string; bId: string }>>`
    SELECT a.id AS aId, b.id AS bId
    FROM Reservation a
    JOIN Reservation b
      ON a.propertyId = b.propertyId AND a.id < b.id
     AND a.checkIn < b.checkOut AND b.checkIn < a.checkOut
    WHERE a.organizationId = ${organizationId} AND b.organizationId = ${organizationId}
      AND a.status NOT IN ('CANCELLED', 'BLOCKED') AND b.status NOT IN ('CANCELLED', 'BLOCKED')
      AND GREATEST(a.checkOut, b.checkOut) >= ${since}
    LIMIT 200`;
  if (pairs.length === 0) return [];
  const ids = [...new Set(pairs.flatMap((p) => [p.aId, p.bId]))];
  const rows = await core.db.reservation.findMany({
    where: { id: { in: ids }, organizationId },
    include: { property: { select: { name: true } }, guest: { select: { name: true } } },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const side = (r: (typeof rows)[number]) => ({
    id: r.id,
    channel: r.channel,
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    guestName: r.guest?.name ?? r.summary ?? null,
  });
  return pairs.flatMap((p) => {
    const a = byId.get(p.aId);
    const b = byId.get(p.bId);
    return a && b ? [{ propertyId: a.propertyId, propertyName: a.property.name, a: side(a), b: side(b) }] : [];
  });
}

/** Avisa gestores sobre sobreposições detectadas (dedupe por par de reservas). */
export async function alertReservationConflicts(core: Core, organizationId: string): Promise<number> {
  const conflicts = await listReservationConflicts(core, organizationId);
  for (const c of conflicts) {
    await notify(core, {
      organizationId,
      toPermission: 'reservation:write',
      type: 'reservation.conflict',
      title: `Conflito de reservas: ${c.propertyName}`,
      body: `Duas reservas ativas se sobrepõem (${c.a.channel} e ${c.b.channel}). Verifique no calendário.`,
      dedupeKey: `reservation-conflict:${c.a.id}:${c.b.id}`,
    });
  }
  return conflicts.length;
}
