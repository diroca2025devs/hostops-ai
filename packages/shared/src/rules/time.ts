import { DateTime } from 'luxon';

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Converte data + hora locais (no fuso do imóvel) para um instante UTC. */
export function localToUtc(date: string, time: string, timezone: string): Date {
  if (!DATE_RE.test(date)) throw new Error(`Data inválida: ${date}`);
  if (!TIME_RE.test(time)) throw new Error(`Horário inválido: ${time}`);
  const dt = DateTime.fromISO(`${date}T${time}:00`, { zone: timezone });
  if (!dt.isValid) throw new Error(`Data/hora inválida: ${date} ${time} (${timezone})`);
  return dt.toUTC().toJSDate();
}

export function utcToLocalParts(instant: Date, timezone: string): { date: string; time: string } {
  const dt = DateTime.fromJSDate(instant, { zone: timezone });
  return { date: dt.toFormat('yyyy-LL-dd'), time: dt.toFormat('HH:mm') };
}

export function formatLocal(instant: Date, timezone: string, format = "dd/LL/yyyy 'às' HH:mm"): string {
  return DateTime.fromJSDate(instant, { zone: timezone }).toFormat(format);
}

export function startOfLocalDay(instant: Date, timezone: string): Date {
  return DateTime.fromJSDate(instant, { zone: timezone }).startOf('day').toUTC().toJSDate();
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 60_000);
}
