import { minutesBetween } from './time';

/**
 * Regras puras de conflito de hospedagem.
 * Uma estadia ocupa o intervalo semiaberto [checkIn, checkOut):
 * o instante do check-out NÃO pertence à estadia, portanto outra reserva
 * pode começar no mesmo dia — desde que caiba a janela de limpeza entre elas.
 */
export interface Stay {
  id?: string;
  checkIn: Date;
  checkOut: Date;
}

export type StayConflictKind = 'OVERLAP' | 'TURNOVER_TOO_SHORT';

export interface StayConflict {
  kind: StayConflictKind;
  withId?: string;
  /** Minutos disponíveis entre o check-out de uma e o check-in da outra (negativo/zero em sobreposição). */
  gapMinutes: number;
}

export function staysOverlap(a: Stay, b: Stay): boolean {
  return a.checkIn.getTime() < b.checkOut.getTime() && b.checkIn.getTime() < a.checkOut.getTime();
}

/** Minutos livres entre duas estadias que não se sobrepõem. */
export function turnoverGapMinutes(a: Stay, b: Stay): number {
  const [first, second] = a.checkIn.getTime() <= b.checkIn.getTime() ? [a, b] : [b, a];
  return minutesBetween(first!.checkOut, second!.checkIn);
}

/**
 * Compara a estadia candidata com as existentes no mesmo imóvel.
 * @param cleaningMinutes janela mínima exigida entre um check-out e o check-in seguinte.
 */
export function findStayConflicts(candidate: Stay, existing: Stay[], cleaningMinutes: number): StayConflict[] {
  const conflicts: StayConflict[] = [];
  for (const other of existing) {
    if (candidate.id && other.id === candidate.id) continue;
    if (staysOverlap(candidate, other)) {
      conflicts.push({ kind: 'OVERLAP', withId: other.id, gapMinutes: 0 });
      continue;
    }
    const gap = turnoverGapMinutes(candidate, other);
    if (gap < cleaningMinutes) {
      conflicts.push({ kind: 'TURNOVER_TOO_SHORT', withId: other.id, gapMinutes: gap });
    }
  }
  return conflicts;
}
