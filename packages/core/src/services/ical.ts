import type { IcalFeedInput } from '@hostops/shared';
import { decryptSecret, encryptSecret } from '../crypto';
import { notFound, unprocessable } from '../errors';
import type { Core, TenantContext } from '../types';
import { recordAudit, userActor } from './audit';
import { classifyIcalEvent, eventToStay, parseIcal } from './ical-parser';
import { resolveTimezone } from './properties';
import { afterReservationChange, alertReservationConflicts, lockProperty } from './reservations';

export interface IcalSyncResult {
  feedId: string;
  status: 'OK' | 'ERROR';
  created: number;
  updated: number;
  cancelled: number;
  unchanged: number;
  skipped: number;
  conflicts: number;
  error?: string;
}

function maskUrl(url: string): string {
  try {
    return `${new URL(url).host}/…`;
  } catch {
    return '…';
  }
}

function assertFeedUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw unprocessable('URL do calendário inválida.', 'INVALID_ICAL_URL');
  }
  if (parsed.protocol !== 'https:') throw unprocessable('A URL do calendário deve usar HTTPS.', 'INVALID_ICAL_URL');
}

export async function listIcalFeeds(core: Core, ctx: TenantContext, propertyId?: string) {
  const feeds = await core.db.icalFeed.findMany({
    where: { organizationId: ctx.organizationId, ...(propertyId ? { propertyId } : {}) },
    include: { property: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  // A URL contém token secreto do canal: devolvemos apenas o host.
  return feeds.map(({ urlEnc, ...feed }) => ({ ...feed, urlHost: maskUrl(decryptSecret(urlEnc, core.config.encryptionKey)) }));
}

export async function createIcalFeed(core: Core, ctx: TenantContext, input: IcalFeedInput) {
  assertFeedUrl(input.url);
  const property = await core.db.property.findFirst({ where: { id: input.propertyId, organizationId: ctx.organizationId } });
  if (!property) throw notFound('Imóvel');
  const feed = await core.db.icalFeed.create({
    data: {
      organizationId: ctx.organizationId,
      propertyId: input.propertyId,
      channel: input.channel,
      name: input.name,
      urlEnc: encryptSecret(input.url, core.config.encryptionKey),
      isActive: input.isActive,
    },
  });
  await recordAudit(core.db, {
    organizationId: ctx.organizationId,
    actor: userActor(ctx),
    action: 'ical_feed.create',
    entityType: 'IcalFeed',
    entityId: feed.id,
    metadata: { propertyId: input.propertyId, channel: input.channel, host: maskUrl(input.url) },
  });
  const { urlEnc: _omit, ...rest } = feed;
  return { ...rest, urlHost: maskUrl(input.url) };
}

export async function deleteIcalFeed(core: Core, ctx: TenantContext, id: string) {
  const feed = await core.db.icalFeed.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!feed) throw notFound('Calendário iCal');
  await core.db.icalFeed.delete({ where: { id } }); // reservas já importadas permanecem (FK SET NULL)
  await recordAudit(core.db, {
    organizationId: ctx.organizationId,
    actor: userActor(ctx),
    action: 'ical_feed.delete',
    entityType: 'IcalFeed',
    entityId: id,
  });
}

export async function syncIcalFeedForUser(core: Core, ctx: TenantContext, id: string): Promise<IcalSyncResult> {
  const feed = await core.db.icalFeed.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!feed) throw notFound('Calendário iCal');
  return syncIcalFeed(core, id);
}

/**
 * Importa um calendário iCal de forma IDEMPOTENTE.
 * A chave (imóvel, canal, UID do evento) é única no banco: sincronizar N vezes o mesmo
 * calendário nunca duplica reservas — apenas cria as novas, atualiza as alteradas e
 * cancela as que sumiram do canal.
 */
export async function syncIcalFeed(core: Core, feedId: string): Promise<IcalSyncResult> {
  const result: IcalSyncResult = { feedId, status: 'OK', created: 0, updated: 0, cancelled: 0, unchanged: 0, skipped: 0, conflicts: 0 };
  const feed = await core.db.icalFeed.findUnique({ where: { id: feedId }, include: { property: true } });
  if (!feed || !feed.isActive) return { ...result, status: 'ERROR', error: 'Calendário inexistente ou inativo.' };

  const now = core.now();
  try {
    const text = await core.icalFetcher.fetch(decryptSecret(feed.urlEnc, core.config.encryptionKey));
    const events = parseIcal(text).filter((e) => e.status !== 'CANCELLED');
    const tz = await resolveTimezone(core, feed.property);
    const seen = new Set<string>();

    await core.db.$transaction(
      async (tx) => {
        await lockProperty(tx, feed.organizationId, feed.propertyId);
        for (const event of events) {
          const stay = eventToStay(event, feed.property, tz);
          if (!stay) {
            result.skipped++;
            continue;
          }
          seen.add(event.uid);
          const desiredStatus = classifyIcalEvent(feed.channel, event.summary);
          const existing = await tx.reservation.findUnique({
            where: { propertyId_channel_externalId: { propertyId: feed.propertyId, channel: feed.channel, externalId: event.uid } },
          });

          if (!existing) {
            if (stay.checkOut.getTime() < now.getTime() - 24 * 3600_000) {
              result.skipped++; // histórico antigo não é importado
              continue;
            }
            await tx.reservation.create({
              data: {
                organizationId: feed.organizationId,
                propertyId: feed.propertyId,
                icalFeedId: feed.id,
                channel: feed.channel,
                externalId: event.uid,
                checkIn: stay.checkIn,
                checkOut: stay.checkOut,
                status: desiredStatus,
                summary: event.summary,
              },
            });
            result.created++;
            continue;
          }
          if (existing.icalFeedId !== feed.id) {
            result.unchanged++; // criada manualmente com o mesmo código: não é sobrescrita
            continue;
          }
          const inProgress = existing.status === 'CHECKED_IN' || existing.status === 'CHECKED_OUT';
          const nextStatus = inProgress ? existing.status : desiredStatus;
          const changed =
            existing.checkIn.getTime() !== stay.checkIn.getTime() ||
            existing.checkOut.getTime() !== stay.checkOut.getTime() ||
            existing.status !== nextStatus ||
            existing.summary !== event.summary;
          if (!changed) {
            result.unchanged++;
            continue;
          }
          await tx.reservation.update({
            where: { id: existing.id },
            data: { checkIn: stay.checkIn, checkOut: stay.checkOut, status: nextStatus, summary: event.summary },
          });
          result.updated++;
        }

        // Eventos que saíram do calendário do canal = reservas canceladas na origem.
        const vanished = await tx.reservation.updateMany({
          where: {
            icalFeedId: feed.id,
            status: { in: ['PENDING', 'CONFIRMED', 'BLOCKED'] },
            checkOut: { gt: now },
            externalId: { notIn: [...seen] },
          },
          data: { status: 'CANCELLED' },
        });
        result.cancelled = vanished.count;
      },
      { timeout: 30_000 },
    );

    await core.db.icalFeed.update({ where: { id: feed.id }, data: { lastSyncAt: now, lastStatus: 'OK', lastError: null } });
    if (result.created + result.updated + result.cancelled > 0) {
      await recordAudit(core.db, {
        organizationId: feed.organizationId,
        actor: { type: 'SYSTEM' },
        action: 'ical_feed.sync',
        entityType: 'IcalFeed',
        entityId: feed.id,
        metadata: { created: result.created, updated: result.updated, cancelled: result.cancelled },
      });
      await afterReservationChange(core, feed.organizationId, feed.propertyId);
    }
    result.conflicts = await alertReservationConflicts(core, feed.organizationId);
    return result;
  } catch (error) {
    const message = (error as Error).message.slice(0, 500);
    core.logger.error({ feedId, err: message }, 'falha na sincronização iCal');
    await core.db.icalFeed.update({ where: { id: feed.id }, data: { lastSyncAt: now, lastStatus: 'ERROR', lastError: message } });
    return { ...result, status: 'ERROR', error: message };
  }
}

/** Worker: enfileira a sincronização de todos os calendários ativos. */
export async function enqueueAllIcalFeeds(core: Core): Promise<number> {
  const feeds = await core.db.icalFeed.findMany({ where: { isActive: true }, select: { id: true } });
  for (const feed of feeds) await core.queue.enqueue('ical.sync-feed', { feedId: feed.id });
  return feeds.length;
}
