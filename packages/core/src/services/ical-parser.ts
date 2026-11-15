import type { ReservationChannel } from '@hostops/shared';
import { localToUtc } from '@hostops/shared';
import { DateTime } from 'luxon';

/** Parser iCalendar (RFC 5545) mínimo e sem dependências: extrai VEVENTs de calendários de disponibilidade. */
export interface IcalDateValue {
  /** AAAA-MM-DD */
  date: string;
  /** HH:mm — ausente em eventos de dia inteiro (VALUE=DATE). */
  time?: string;
  utc?: boolean;
  tzid?: string;
}

export interface IcalEvent {
  uid: string;
  summary: string | null;
  status: string | null;
  start: IcalDateValue;
  end: IcalDateValue | null;
}

export class IcalParseError extends Error {}

function parseDateValue(raw: string, params: Record<string, string>): IcalDateValue | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(raw.trim());
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4]) return { date };
  return { date, time: `${m[4]}:${m[5]}`, utc: m[7] === 'Z', tzid: params.TZID };
}

function unescapeText(value: string): string {
  return value.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
}

export function parseIcal(text: string): IcalEvent[] {
  if (!/BEGIN:VCALENDAR/i.test(text) || !/END:VCALENDAR/i.test(text)) {
    throw new IcalParseError('O conteúdo não é um calendário iCal válido (VCALENDAR ausente).');
  }
  // "Unfolding": linhas continuadas começam com espaço ou tab.
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events: IcalEvent[] = [];
  let current: Partial<IcalEvent> | null = null;
  let depth = 0; // ignora componentes aninhados (VALARM etc.)

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^BEGIN:VEVENT$/i.test(trimmed)) {
      current = {};
      depth = 0;
      continue;
    }
    if (!current) continue;
    if (/^BEGIN:/i.test(trimmed)) {
      depth++;
      continue;
    }
    if (/^END:VEVENT$/i.test(trimmed)) {
      if (current.uid && current.start) {
        events.push({
          uid: current.uid,
          summary: current.summary ?? null,
          status: current.status ?? null,
          start: current.start,
          end: current.end ?? null,
        });
      }
      current = null;
      continue;
    }
    if (/^END:/i.test(trimmed)) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) continue;

    const colon = trimmed.indexOf(':');
    if (colon < 0) continue;
    const [name, ...paramParts] = trimmed.slice(0, colon).split(';');
    const value = trimmed.slice(colon + 1);
    const params: Record<string, string> = {};
    for (const part of paramParts) {
      const eq = part.indexOf('=');
      if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
    }
    switch (name!.toUpperCase()) {
      case 'UID':
        current.uid = value.trim().slice(0, 190);
        break;
      case 'SUMMARY':
        current.summary = unescapeText(value).slice(0, 190);
        break;
      case 'STATUS':
        current.status = value.trim().toUpperCase();
        break;
      case 'DTSTART':
        current.start = parseDateValue(value, params) ?? undefined;
        break;
      case 'DTEND':
        current.end = parseDateValue(value, params);
        break;
    }
  }
  return events;
}

function toInstant(value: IcalDateValue, defaultTime: string, timezone: string): Date {
  if (!value.time) return localToUtc(value.date, defaultTime, timezone);
  if (value.utc) return new Date(`${value.date}T${value.time}:00.000Z`);
  let zone = timezone;
  if (value.tzid && DateTime.local().setZone(value.tzid).isValid) zone = value.tzid;
  return localToUtc(value.date, value.time, zone);
}

/**
 * Converte um evento em estadia [checkIn, checkOut).
 * Eventos de dia inteiro (padrão em Airbnb/Booking) recebem os horários de check-in/out do imóvel.
 */
export function eventToStay(
  event: IcalEvent,
  property: { checkInTime: string; checkOutTime: string },
  timezone: string,
): { checkIn: Date; checkOut: Date } | null {
  const end =
    event.end ??
    (event.start.time
      ? null
      : { date: DateTime.fromISO(event.start.date, { zone: 'utc' }).plus({ days: 1 }).toFormat('yyyy-LL-dd') });
  if (!end) return null;
  const checkIn = toInstant(event.start, property.checkInTime, timezone);
  const checkOut = toInstant(end, property.checkOutTime, timezone);
  return checkOut.getTime() > checkIn.getTime() ? { checkIn, checkOut } : null;
}

/**
 * Distingue reserva de bloqueio de agenda.
 * - Airbnb exporta reservas como "Reserved" e indisponibilidades como "Airbnb (Not available)".
 * - Booking.com exporta tudo como "CLOSED - Not available": não há como diferenciar, então tratamos como reserva.
 */
export function classifyIcalEvent(channel: ReservationChannel, summary: string | null): 'CONFIRMED' | 'BLOCKED' {
  const s = (summary ?? '').toLowerCase();
  if (channel === 'AIRBNB' && s.includes('not available')) return 'BLOCKED';
  if (/\b(blocked|bloqueado|bloqueio|maintenance|manutenção)\b/.test(s)) return 'BLOCKED';
  return 'CONFIRMED';
}
