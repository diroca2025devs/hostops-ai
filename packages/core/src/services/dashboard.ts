import { addMinutes, localToUtc } from '@hostops/shared';
import { DateTime } from 'luxon';
import { unprocessable } from '../errors';
import type { Core, TenantContext } from '../types';
import { listPersonalEvents } from './calendar-sync';
import { STAY_STATUSES } from './cleaning';
import { listReservationConflicts } from './reservations';

const resSelect = {
  id: true,
  checkIn: true,
  checkOut: true,
  status: true,
  channel: true,
  guestCount: true,
  summary: true,
  property: { select: { id: true, name: true } },
  guest: { select: { id: true, name: true } },
} as const;

/** Indicadores da Visão geral. */
export async function getDashboardOverview(core: Core, ctx: TenantContext) {
  const organizationId = ctx.organizationId;
  const now = core.now();
  const in7days = new Date(now.getTime() + 7 * 24 * 3600_000);
  const active = { organizationId, status: { in: ['CONFIRMED', 'CHECKED_IN'] as ('CONFIRMED' | 'CHECKED_IN')[] } };

  const [currentGuests, upcomingCheckIns, upcomingCheckOuts, openCleanings, conflicts, guestRequests, maintenanceOpen, properties, handoffs, windowConflicts] =
    await Promise.all([
      core.db.reservation.findMany({
        where: { organizationId, OR: [{ status: 'CHECKED_IN' }, { status: 'CONFIRMED', checkIn: { lte: now }, checkOut: { gt: now } }] },
        select: resSelect,
        orderBy: { checkOut: 'asc' },
      }),
      core.db.reservation.findMany({
        where: { organizationId, status: { in: ['CONFIRMED', 'PENDING'] }, checkIn: { gt: now, lte: in7days } },
        select: resSelect,
        orderBy: { checkIn: 'asc' },
        take: 20,
      }),
      core.db.reservation.findMany({ where: { ...active, checkOut: { gt: now, lte: in7days } }, select: resSelect, orderBy: { checkOut: 'asc' }, take: 20 }),
      core.db.cleaningTask.findMany({
        where: { organizationId, status: { in: ['PENDING', 'ASSIGNED', 'IN_PROGRESS'] }, windowStart: { lte: in7days } },
        select: {
          id: true,
          status: true,
          windowStart: true,
          windowEnd: true,
          hasConflict: true,
          property: { select: { id: true, name: true } },
          cleaner: { select: { id: true, name: true } },
        },
        orderBy: { windowStart: 'asc' },
      }),
      listReservationConflicts(core, organizationId),
      core.db.guestRequest.findMany({
        where: { organizationId, status: 'OPEN' },
        select: { id: true, type: true, description: true, requiresHumanApproval: true, createdAt: true, conversationId: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      core.db.maintenanceTicket.count({ where: { organizationId, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      core.db.property.count({ where: { organizationId, isActive: true } }),
      core.db.conversation.count({ where: { organizationId, status: 'HUMAN' } }),
      // Conflitos de janela contam em qualquer horizonte: quanto antes forem vistos, melhor.
      core.db.cleaningTask.count({ where: { organizationId, status: { in: ['PENDING', 'ASSIGNED', 'IN_PROGRESS'] }, hasConflict: true } }),
    ]);

  const overdue = openCleanings.filter((t) => t.windowEnd.getTime() < now.getTime());
  const pending = openCleanings.filter((t) => t.windowEnd.getTime() >= now.getTime());
  return {
    generatedAt: now,
    counts: {
      properties,
      currentGuests: currentGuests.length,
      upcomingCheckIns: upcomingCheckIns.length,
      upcomingCheckOuts: upcomingCheckOuts.length,
      pendingCleanings: pending.length,
      overdueCleanings: overdue.length,
      cleaningWindowConflicts: windowConflicts,
      reservationConflicts: conflicts.length,
      openGuestRequests: guestRequests.length,
      openMaintenance: maintenanceOpen,
      humanHandoffs: handoffs,
    },
    currentGuests,
    upcomingCheckIns,
    upcomingCheckOuts,
    pendingCleanings: pending,
    overdueCleanings: overdue,
    reservationConflicts: conflicts,
    guestRequests,
  };
}

function parseRange(from: string, to: string, tz: string, maxDays: number) {
  const start = localToUtc(from, '00:00', tz);
  const end = addMinutes(localToUtc(to, '00:00', tz), 24 * 60);
  const days = Math.round((end.getTime() - start.getTime()) / (24 * 3600_000));
  if (days <= 0 || days > maxDays) throw unprocessable(`Período inválido (máximo de ${maxDays} dias).`, 'INVALID_RANGE');
  return { start, end, days };
}

/** Dados do calendário unificado: reservas, limpezas e (se conectado) agenda pessoal. */
export async function getCalendarView(core: Core, ctx: TenantContext, query: { from: string; to: string }) {
  const org = await core.db.organization.findUnique({ where: { id: ctx.organizationId } });
  const timezone = org?.timezone ?? 'America/Sao_Paulo';
  const { start, end } = parseRange(query.from, query.to, timezone, 93);
  const [properties, reservations, cleanings, personal] = await Promise.all([
    core.db.property.findMany({ where: { organizationId: ctx.organizationId, isActive: true }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
    core.db.reservation.findMany({
      where: { organizationId: ctx.organizationId, status: { not: 'CANCELLED' }, checkIn: { lt: end }, checkOut: { gt: start } },
      select: { ...resSelect, propertyId: true },
      orderBy: { checkIn: 'asc' },
    }),
    core.db.cleaningTask.findMany({
      where: { organizationId: ctx.organizationId, status: { not: 'CANCELLED' }, windowStart: { lt: end }, windowEnd: { gt: start } },
      select: { id: true, propertyId: true, status: true, windowStart: true, windowEnd: true, estimatedMinutes: true, hasConflict: true, cleaner: { select: { name: true } } },
    }),
    listPersonalEvents(core, ctx, start, end),
  ]);
  return { timezone, from: query.from, to: query.to, properties, reservations, cleanings, personalEvents: personal };
}

/** Relatório operacional: ocupação por imóvel, reservas por canal e desempenho de limpeza. */
export async function getOccupancyReport(core: Core, ctx: TenantContext, query: { from: string; to: string }) {
  const org = await core.db.organization.findUnique({ where: { id: ctx.organizationId } });
  const timezone = org?.timezone ?? 'America/Sao_Paulo';
  const { start, end, days } = parseRange(query.from, query.to, timezone, 366);
  const [properties, reservations, cleanings] = await Promise.all([
    core.db.property.findMany({ where: { organizationId: ctx.organizationId, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    core.db.reservation.findMany({
      where: { organizationId: ctx.organizationId, status: { in: [...STAY_STATUSES] }, checkIn: { lt: end }, checkOut: { gt: start } },
      select: { propertyId: true, channel: true, checkIn: true, checkOut: true },
    }),
    core.db.cleaningTask.findMany({
      where: { organizationId: ctx.organizationId, windowStart: { gte: start, lt: end } },
      select: { status: true, startedAt: true, completedAt: true, windowEnd: true, hasConflict: true },
    }),
  ]);

  const nightsIn = (checkIn: Date, checkOut: Date) => {
    const a = DateTime.fromJSDate(new Date(Math.max(checkIn.getTime(), start.getTime())), { zone: timezone }).startOf('day');
    const b = DateTime.fromJSDate(new Date(Math.min(checkOut.getTime(), end.getTime())), { zone: timezone }).startOf('day');
    return Math.max(0, Math.round(b.diff(a, 'days').days));
  };
  const byProperty = properties.map((p) => {
    const mine = reservations.filter((r) => r.propertyId === p.id);
    const nights = Math.min(days, mine.reduce((sum, r) => sum + nightsIn(r.checkIn, r.checkOut), 0));
    return { propertyId: p.id, propertyName: p.name, reservations: mine.length, occupiedNights: nights, availableNights: days, occupancyRate: Math.round((nights / days) * 1000) / 10 };
  });
  const byChannel = Object.entries(
    reservations.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.channel]: (acc[r.channel] ?? 0) + 1 }), {}),
  ).map(([channel, count]) => ({ channel, count }));

  const done = cleanings.filter((c) => c.status === 'DONE' && c.startedAt && c.completedAt);
  const avgMinutes = done.length
    ? Math.round(done.reduce((sum, c) => sum + (c.completedAt!.getTime() - c.startedAt!.getTime()) / 60_000, 0) / done.length)
    : null;
  const totalNights = byProperty.reduce((s, p) => s + p.occupiedNights, 0);
  return {
    from: query.from,
    to: query.to,
    days,
    occupancyRate: properties.length ? Math.round((totalNights / (days * properties.length)) * 1000) / 10 : 0,
    byProperty,
    byChannel,
    cleaning: {
      total: cleanings.length,
      done: cleanings.filter((c) => c.status === 'DONE').length,
      doneLate: done.filter((c) => c.completedAt!.getTime() > c.windowEnd.getTime()).length,
      withWindowConflict: cleanings.filter((c) => c.hasConflict).length,
      averageDurationMinutes: avgMinutes,
    },
  };
}
