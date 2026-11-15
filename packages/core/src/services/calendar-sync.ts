import type { CalendarEntityType } from '@hostops/database';
import { LABELS, addMinutes } from '@hostops/shared';
import { sha256Hex } from '../crypto';
import type { CalendarEventInput, Core, TenantContext } from '../types';
import { STAY_STATUSES } from './cleaning';
import { getGoogleAccess } from './integrations';

export interface CalendarSyncResult {
  status: 'OK' | 'SKIPPED';
  reason?: string;
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  failed: number;
}

interface DesiredEvent {
  entityType: CalendarEntityType;
  entityId: string;
  event: Omit<CalendarEventInput, 'id'>;
}

/** ID determinístico aceito pelo Google (base32hex: a–v e 0–9). Mesma entidade => mesmo evento. */
export function calendarEventId(organizationId: string, entityType: string, entityId: string): string {
  return `ho${sha256Hex(`${organizationId}:${entityType}:${entityId}`).slice(0, 40)}`;
}

async function buildDesiredEvents(core: Core, organizationId: string): Promise<DesiredEvent[]> {
  const org = await core.db.organization.findUnique({ where: { id: organizationId } });
  const orgTz = org?.timezone ?? 'America/Sao_Paulo';
  const since = new Date(core.now().getTime() - 24 * 3600_000);
  const [reservations, tasks] = await Promise.all([
    core.db.reservation.findMany({
      where: { organizationId, status: { in: [...STAY_STATUSES] }, checkOut: { gte: since } },
      include: { property: true, guest: { select: { name: true } } },
    }),
    core.db.cleaningTask.findMany({
      where: { organizationId, status: { not: 'CANCELLED' }, windowEnd: { gte: since } },
      include: { property: true, cleaner: { select: { name: true } } },
    }),
  ]);

  const desired: DesiredEvent[] = [];
  for (const r of reservations) {
    const timezone = r.property.timezone ?? orgTz;
    // Privacidade: apenas o primeiro nome do hóspede vai para a agenda.
    const who = r.guest?.name.split(' ')[0] ?? LABELS.channel[r.channel];
    const location = `${r.property.addressLine}, ${r.property.city}`;
    const description = `Canal: ${LABELS.channel[r.channel]} · Hóspedes: ${r.guestCount} · Status: ${LABELS.reservationStatus[r.status]}`;
    desired.push(
      {
        entityType: 'RESERVATION',
        entityId: r.id,
        event: { summary: `Hospedagem · ${r.property.name} · ${who}`, description, location, start: r.checkIn, end: r.checkOut, timezone },
      },
      {
        entityType: 'CHECKIN',
        entityId: r.id,
        event: { summary: `Check-in · ${r.property.name} · ${who}`, description, location, start: r.checkIn, end: addMinutes(r.checkIn, 30), timezone },
      },
      {
        entityType: 'CHECKOUT',
        entityId: r.id,
        event: { summary: `Check-out · ${r.property.name} · ${who}`, description, location, start: r.checkOut, end: addMinutes(r.checkOut, 30), timezone },
      },
    );
  }
  for (const t of tasks) {
    desired.push({
      entityType: 'CLEANING',
      entityId: t.id,
      event: {
        summary: `Limpeza · ${t.property.name} · ${t.cleaner?.name ?? 'sem diarista'}`,
        description: `Status: ${LABELS.cleaningStatus[t.status]}${t.hasConflict ? ' · ATENÇÃO: janela apertada' : ''}`,
        location: `${t.property.addressLine}, ${t.property.city}`,
        start: t.windowStart,
        end: addMinutes(t.windowStart, t.estimatedMinutes),
        timezone: t.property.timezone ?? orgTz,
      },
    });
  }
  return desired;
}

/**
 * Sincronização controlada MariaDB -> Google Calendar (sentido único: o banco é a fonte oficial).
 *  - Sem duplicidade: cada entidade tem uma linha em CalendarSyncEvent (índice único) e um ID
 *    determinístico no Google; reexecutar não cria eventos novos.
 *  - Só chama a API quando o conteúdo mudou (hash).
 *  - Falhas são registradas por evento e reprocessadas na próxima execução, sem interromper as demais.
 */
export async function syncCalendarForOrg(core: Core, organizationId: string): Promise<CalendarSyncResult> {
  const result: CalendarSyncResult = { status: 'OK', created: 0, updated: 0, deleted: 0, unchanged: 0, failed: 0 };
  const access = await getGoogleAccess(core, organizationId);
  if (!access) return { ...result, status: 'SKIPPED', reason: 'Google Calendar não conectado.' };
  const calendarId = access.config.hostopsCalendarId;
  if (!calendarId) return { ...result, status: 'SKIPPED', reason: 'Calendário HostOps não definido.' };

  const desired = await buildDesiredEvents(core, organizationId);
  const rows = await core.db.calendarSyncEvent.findMany({ where: { organizationId } });
  const rowByKey = new Map(rows.map((r) => [`${r.entityType}:${r.entityId}`, r]));
  const desiredKeys = new Set<string>();
  const now = core.now();

  for (const item of desired) {
    const key = `${item.entityType}:${item.entityId}`;
    desiredKeys.add(key);
    const row = rowByKey.get(key);
    const contentHash = sha256Hex(JSON.stringify(item.event));
    if (row && row.status === 'SYNCED' && row.contentHash === contentHash && row.calendarId === calendarId) {
      result.unchanged++;
      continue;
    }
    const externalEventId = calendarEventId(organizationId, item.entityType, item.entityId);
    const where = { organizationId_entityType_entityId: { organizationId, entityType: item.entityType, entityId: item.entityId } };
    try {
      await core.calendar.upsertEvent(access.accessToken, calendarId, { id: externalEventId, ...item.event });
      const data = { calendarId, externalEventId, contentHash, status: 'SYNCED' as const, lastError: null, syncedAt: now };
      await core.db.calendarSyncEvent.upsert({
        where,
        create: { organizationId, entityType: item.entityType, entityId: item.entityId, ...data },
        update: data,
      });
      if (row && row.status !== 'DELETED') result.updated++;
      else result.created++;
    } catch (error) {
      result.failed++;
      const lastError = (error as Error).message.slice(0, 500);
      // contentHash vazio força nova tentativa na próxima execução.
      await core.db.calendarSyncEvent.upsert({
        where,
        create: { organizationId, entityType: item.entityType, entityId: item.entityId, calendarId, externalEventId, contentHash: '', status: 'FAILED', lastError },
        update: { status: 'FAILED', lastError, contentHash: '' },
      });
      core.logger.warn({ organizationId, key, err: lastError }, 'falha ao sincronizar evento com o Google Calendar');
    }
  }

  // Entidades canceladas/removidas: apaga o evento correspondente.
  for (const row of rows) {
    if (row.status === 'DELETED' || desiredKeys.has(`${row.entityType}:${row.entityId}`)) continue;
    try {
      await core.calendar.deleteEvent(access.accessToken, row.calendarId, row.externalEventId);
      await core.db.calendarSyncEvent.update({ where: { id: row.id }, data: { status: 'DELETED', lastError: null, syncedAt: now } });
      result.deleted++;
    } catch (error) {
      result.failed++;
      await core.db.calendarSyncEvent.update({ where: { id: row.id }, data: { lastError: (error as Error).message.slice(0, 500) } });
    }
  }
  return result;
}

/** Worker: agenda a sincronização de todas as organizações conectadas. */
export async function enqueueAllCalendarSyncs(core: Core): Promise<number> {
  const integrations = await core.db.integration.findMany({
    where: { provider: 'GOOGLE_CALENDAR', status: { in: ['CONNECTED', 'ERROR'] } },
    select: { organizationId: true },
  });
  for (const i of integrations) await core.queue.enqueue('calendar.sync-org', { organizationId: i.organizationId });
  return integrations.length;
}

/** Compromissos da agenda pessoal (somente leitura) para exibir no calendário do painel. */
export async function listPersonalEvents(core: Core, ctx: TenantContext, from: Date, to: Date) {
  const access = await getGoogleAccess(core, ctx.organizationId);
  if (!access?.config.personalCalendarId) return [];
  try {
    return await core.calendar.listEvents(access.accessToken, access.config.personalCalendarId, from, to);
  } catch (error) {
    core.logger.warn({ err: (error as Error).message }, 'falha ao ler agenda pessoal');
    return [];
  }
}
