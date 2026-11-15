/** Formatação de datas sempre no fuso da organização (nunca no fuso do navegador). */
const DEFAULT_TZ = 'America/Sao_Paulo';

export function fmtDateTime(value: string | Date | null | undefined, timeZone = DEFAULT_TZ): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function fmtDate(value: string | Date | null | undefined, timeZone = DEFAULT_TZ): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
}

export function fmtTime(value: string | Date | null | undefined, timeZone = DEFAULT_TZ): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function fmtWeekday(value: string | Date, timeZone = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'short' }).format(new Date(value)).replace('.', '');
}

/** AAAA-MM-DD no fuso informado. */
export function dayKey(value: string | Date, timeZone = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

export function addDays(key: string, days: number): string {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

export function fmtDayKey(key: string): string {
  const [, month, day] = key.split('-');
  return `${day}/${month}`;
}

export function relativeDay(value: string | Date, timeZone = DEFAULT_TZ): string {
  const diff = diffDays(dayKey(new Date(), timeZone), dayKey(value, timeZone));
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Amanhã';
  if (diff === -1) return 'Ontem';
  return fmtDayKey(dayKey(value, timeZone));
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter((w) => /^[A-Za-zÀ-ÿ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}
