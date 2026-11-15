import { addMinutes, minutesBetween } from './time';

export interface CleaningWindowInput {
  checkOut: Date;
  /** Check-in da próxima estadia no mesmo imóvel, se houver. */
  nextCheckIn?: Date | null;
  cleaningMinutes: number;
  /** Prazo padrão quando não há próxima reserva. */
  defaultWindowMinutes?: number;
}

export interface CleaningWindow {
  windowStart: Date;
  windowEnd: Date;
  availableMinutes: number;
  hasConflict: boolean;
  conflictReason: string | null;
}

export const DEFAULT_OPEN_WINDOW_MINUTES = 24 * 60;

/** Calcula a janela disponível para limpeza após um check-out. */
export function computeCleaningWindow(input: CleaningWindowInput): CleaningWindow {
  const windowStart = input.checkOut;
  const openMinutes = Math.max(input.defaultWindowMinutes ?? DEFAULT_OPEN_WINDOW_MINUTES, input.cleaningMinutes);
  const windowEnd = input.nextCheckIn ?? addMinutes(windowStart, openMinutes);
  const availableMinutes = minutesBetween(windowStart, windowEnd);

  if (availableMinutes <= 0) {
    return {
      windowStart,
      windowEnd,
      availableMinutes,
      hasConflict: true,
      conflictReason: 'Próximo check-in ocorre antes ou no mesmo horário do check-out: não há janela de limpeza.',
    };
  }
  if (availableMinutes < input.cleaningMinutes) {
    return {
      windowStart,
      windowEnd,
      availableMinutes,
      hasConflict: true,
      conflictReason: `Janela de ${availableMinutes} min é menor que os ${input.cleaningMinutes} min necessários para a limpeza.`,
    };
  }
  return { windowStart, windowEnd, availableMinutes, hasConflict: false, conflictReason: null };
}

export interface TimeSlot {
  start: Date;
  end: Date;
}

export function slotsOverlap(a: TimeSlot, b: TimeSlot): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

export interface CleanerCandidate {
  id: string;
  /** Compromissos já atribuídos (tarefas não canceladas). */
  busy: TimeSlot[];
}

/**
 * Escolhe a diarista para um intervalo: prioriza a preferencial do imóvel,
 * depois quem tem menos tarefas; nunca escolhe alguém com sobreposição de horário.
 */
export function pickCleaner(slot: TimeSlot, candidates: CleanerCandidate[], preferredId?: string | null): string | null {
  const free = candidates.filter((c) => !c.busy.some((b) => slotsOverlap(slot, b)));
  if (free.length === 0) return null;
  if (preferredId) {
    const preferred = free.find((c) => c.id === preferredId);
    if (preferred) return preferred.id;
  }
  free.sort((a, b) => a.busy.length - b.busy.length || a.id.localeCompare(b.id));
  return free[0]!.id;
}

export interface CompletionCheckItem {
  label: string;
  checked: boolean;
  requiresPhoto: boolean;
  photoCount: number;
}

/** Pendências que impedem a conclusão de uma limpeza. */
export function completionBlockers(items: CompletionCheckItem[]): string[] {
  const blockers: string[] = [];
  for (const item of items) {
    if (!item.checked) blockers.push(`Item não concluído: ${item.label}`);
    else if (item.requiresPhoto && item.photoCount === 0) blockers.push(`Foto obrigatória ausente: ${item.label}`);
  }
  return blockers;
}
