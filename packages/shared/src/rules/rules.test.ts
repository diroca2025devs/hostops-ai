import { describe, expect, it } from 'vitest';
import { completionBlockers, computeCleaningWindow, pickCleaner } from './cleaning';
import { findStayConflicts, staysOverlap } from './intervals';
import { localToUtc, utcToLocalParts } from './time';

const TZ = 'America/Sao_Paulo';
const at = (date: string, time: string) => localToUtc(date, time, TZ);

describe('fuso horário', () => {
  it('converte data/hora local do imóvel para UTC e de volta', () => {
    const utc = at('2026-12-10', '15:00');
    expect(utc.toISOString()).toBe('2026-12-10T18:00:00.000Z');
    expect(utcToLocalParts(utc, TZ)).toEqual({ date: '2026-12-10', time: '15:00' });
  });
  it('rejeita datas inválidas', () => {
    expect(() => localToUtc('2026-02-31', '15:00', TZ)).toThrow();
    expect(() => localToUtc('2026-12-10', '25:00', TZ)).toThrow();
  });
});

describe('conflito de reservas — intervalo [check-in, check-out)', () => {
  const existing = { id: 'a', checkIn: at('2026-12-10', '15:00'), checkOut: at('2026-12-14', '11:00') };

  it('detecta sobreposição parcial, total e contida', () => {
    for (const [ci, co] of [
      ['2026-12-12', '2026-12-16'],
      ['2026-12-08', '2026-12-11'],
      ['2026-12-11', '2026-12-12'],
      ['2026-12-01', '2026-12-30'],
    ] as const) {
      const c = findStayConflicts({ checkIn: at(ci, '15:00'), checkOut: at(co, '11:00') }, [existing], 180);
      expect(c[0]?.kind).toBe('OVERLAP');
    }
  });

  it('permite check-in no mesmo dia do check-out quando cabe a janela de limpeza', () => {
    const next = { checkIn: at('2026-12-14', '15:00'), checkOut: at('2026-12-18', '11:00') };
    expect(staysOverlap(next, existing)).toBe(false);
    expect(findStayConflicts(next, [existing], 180)).toEqual([]); // 11:00 -> 15:00 = 240 min
  });

  it('o instante do check-out não pertence à estadia (semiaberto)', () => {
    const touching = { checkIn: existing.checkOut, checkOut: at('2026-12-18', '11:00') };
    expect(staysOverlap(touching, existing)).toBe(false);
  });

  it('bloqueia quando a janela de limpeza não é respeitada', () => {
    const tight = { checkIn: at('2026-12-14', '12:00'), checkOut: at('2026-12-18', '11:00') };
    const c = findStayConflicts(tight, [existing], 180);
    expect(c).toEqual([{ kind: 'TURNOVER_TOO_SHORT', withId: 'a', gapMinutes: 60 }]);
  });

  it('também valida a janela antes da reserva existente', () => {
    const before = { checkIn: at('2026-12-07', '15:00'), checkOut: at('2026-12-10', '14:00') };
    expect(findStayConflicts(before, [existing], 180)[0]?.kind).toBe('TURNOVER_TOO_SHORT');
  });

  it('ignora a própria reserva em edições', () => {
    expect(findStayConflicts({ ...existing }, [existing], 180)).toEqual([]);
  });
});

describe('janela de limpeza', () => {
  const checkOut = at('2026-12-14', '11:00');
  it('usa o próximo check-in como limite', () => {
    const w = computeCleaningWindow({ checkOut, nextCheckIn: at('2026-12-14', '15:00'), cleaningMinutes: 180 });
    expect(w.availableMinutes).toBe(240);
    expect(w.hasConflict).toBe(false);
  });
  it('sem próxima reserva, abre janela padrão de 24h', () => {
    const w = computeCleaningWindow({ checkOut, cleaningMinutes: 180 });
    expect(w.availableMinutes).toBe(1440);
  });
  it('sinaliza conflito quando a janela é curta ou inexistente', () => {
    expect(computeCleaningWindow({ checkOut, nextCheckIn: at('2026-12-14', '12:00'), cleaningMinutes: 180 }).hasConflict).toBe(true);
    expect(computeCleaningWindow({ checkOut, nextCheckIn: at('2026-12-14', '10:00'), cleaningMinutes: 180 }).hasConflict).toBe(true);
  });
});

describe('atribuição de diarista', () => {
  const slot = { start: at('2026-12-14', '11:00'), end: at('2026-12-14', '14:00') };
  it('prioriza a preferencial quando está livre', () => {
    expect(pickCleaner(slot, [{ id: 'x', busy: [] }, { id: 'y', busy: [] }], 'y')).toBe('y');
  });
  it('nunca atribui quem tem sobreposição; escolhe a menos carregada', () => {
    const busy = [{ start: at('2026-12-14', '10:00'), end: at('2026-12-14', '12:00') }];
    const other = [{ start: at('2026-12-15', '10:00'), end: at('2026-12-15', '12:00') }];
    expect(pickCleaner(slot, [{ id: 'x', busy }, { id: 'y', busy: other }, { id: 'z', busy: [] }], 'x')).toBe('z');
    expect(pickCleaner(slot, [{ id: 'x', busy }])).toBeNull();
  });
});

describe('conclusão de limpeza', () => {
  it('exige todos os itens e as fotos obrigatórias', () => {
    const blockers = completionBlockers([
      { label: 'Trocar roupa de cama', checked: true, requiresPhoto: false, photoCount: 0 },
      { label: 'Foto da sala', checked: true, requiresPhoto: true, photoCount: 0 },
      { label: 'Banheiro', checked: false, requiresPhoto: false, photoCount: 0 },
    ]);
    expect(blockers).toHaveLength(2);
    expect(completionBlockers([{ label: 'ok', checked: true, requiresPhoto: true, photoCount: 1 }])).toEqual([]);
  });
});
