import {
  formatDdMmYyyy,
  isFutureOrTodayDate,
  parseDdMmYyyy,
  selectUpcomingTrip,
} from '@/domains/trips/schedule';
import type { SavedTrip } from '@/domains/trips/types';

function makeTrip(partial: Partial<SavedTrip> & { id: number }): SavedTrip {
  return {
    id: partial.id,
    name: partial.name ?? `Trip ${partial.id}`,
    rotaIds: partial.rotaIds ?? ['a'],
    createdAt: partial.createdAt ?? 1000,
    ...(partial.scheduledFor !== undefined
      ? { scheduledFor: partial.scheduledFor }
      : {}),
    ...(partial.completedAt !== undefined
      ? { completedAt: partial.completedAt }
      : {}),
  };
}

describe('parseDdMmYyyy', () => {
  it('aceita formato valido', () => {
    const result = parseDdMmYyyy('25/06/2026');
    expect(result).not.toBeNull();
    const d = new Date(result!);
    expect(d.getDate()).toBe(25);
    expect(d.getMonth()).toBe(5); // junho = 5
    expect(d.getFullYear()).toBe(2026);
  });

  it('aceita dia/mes 1-digito', () => {
    expect(parseDdMmYyyy('5/6/2026')).not.toBeNull();
    expect(parseDdMmYyyy('05/06/2026')).not.toBeNull();
  });

  it('rejeita strings invalidas', () => {
    expect(parseDdMmYyyy('')).toBeNull();
    expect(parseDdMmYyyy('25-06-2026')).toBeNull();
    expect(parseDdMmYyyy('25/06/26')).toBeNull();
    expect(parseDdMmYyyy('abc')).toBeNull();
  });

  it('rejeita meses > 12 e dias > 31', () => {
    expect(parseDdMmYyyy('15/13/2026')).toBeNull();
    expect(parseDdMmYyyy('32/01/2026')).toBeNull();
  });

  it('rejeita datas impossiveis (31/02)', () => {
    expect(parseDdMmYyyy('31/02/2026')).toBeNull();
    expect(parseDdMmYyyy('29/02/2025')).toBeNull(); // 2025 nao e bissexto
  });

  it('aceita 29/02 em anos bissextos', () => {
    expect(parseDdMmYyyy('29/02/2024')).not.toBeNull();
  });

  it('rejeita anos fora do intervalo razoavel', () => {
    expect(parseDdMmYyyy('01/01/1999')).toBeNull();
    expect(parseDdMmYyyy('01/01/2101')).toBeNull();
  });
});

describe('formatDdMmYyyy', () => {
  it('formata pads zeros corretamente', () => {
    const epoch = new Date(2026, 0, 5).getTime();
    expect(formatDdMmYyyy(epoch)).toBe('05/01/2026');
  });
});

describe('isFutureOrTodayDate', () => {
  it('hoje conta como futuro', () => {
    const now = Date.now();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    expect(isFutureOrTodayDate(startOfToday.getTime(), now)).toBe(true);
  });

  it('ontem rejeita', () => {
    const now = Date.now();
    const yesterday = now - 25 * 60 * 60 * 1000;
    expect(isFutureOrTodayDate(yesterday, now)).toBe(false);
  });
});

describe('selectUpcomingTrip', () => {
  const now = new Date(2026, 5, 24, 14, 0).getTime(); // qua 24/jun/26 14h

  it('retorna null sem trips', () => {
    expect(selectUpcomingTrip([], now)).toBeNull();
  });

  it('retorna null se nenhuma tem scheduledFor', () => {
    const trips = [makeTrip({ id: 1 })];
    expect(selectUpcomingTrip(trips, now)).toBeNull();
  });

  it('seleciona trip do dia seguinte (D-1)', () => {
    const tomorrow = new Date(2026, 5, 25, 7, 0).getTime();
    const trips = [makeTrip({ id: 1, scheduledFor: tomorrow })];
    const pick = selectUpcomingTrip(trips, now);
    expect(pick?.trip.id).toBe(1);
    expect(pick?.isToday).toBe(false);
    expect(pick?.hoursUntil).toBeGreaterThan(0);
    expect(pick?.hoursUntil).toBeLessThanOrEqual(24);
  });

  it('seleciona trip de hoje mesmo (D, manha ainda nao chegou)', () => {
    const today8am = new Date(2026, 5, 24, 8, 0).getTime();
    const trips = [makeTrip({ id: 1, scheduledFor: today8am })];
    const pick = selectUpcomingTrip(trips, now);
    expect(pick?.trip.id).toBe(1);
    expect(pick?.isToday).toBe(true);
    expect(pick?.hoursUntil).toBeLessThan(0); // ja passou pelas 8 da manha
  });

  it('prioriza isToday sobre futuro proximo', () => {
    const today9am = new Date(2026, 5, 24, 9, 0).getTime();
    const tomorrow8am = new Date(2026, 5, 25, 8, 0).getTime();
    const trips = [
      makeTrip({ id: 1, scheduledFor: tomorrow8am }),
      makeTrip({ id: 2, scheduledFor: today9am }),
    ];
    const pick = selectUpcomingTrip(trips, now);
    expect(pick?.trip.id).toBe(2); // hoje
  });

  it('ignora trips ja completadas', () => {
    const tomorrow = new Date(2026, 5, 25, 7, 0).getTime();
    const trips = [
      makeTrip({ id: 1, scheduledFor: tomorrow, completedAt: 500 }),
    ];
    expect(selectUpcomingTrip(trips, now)).toBeNull();
  });

  it('ignora trips fora da janela de 48h', () => {
    const farFuture = new Date(2026, 5, 30, 8, 0).getTime();
    const trips = [makeTrip({ id: 1, scheduledFor: farFuture })];
    expect(selectUpcomingTrip(trips, now)).toBeNull();
  });

  it('ignora trips no passado distante', () => {
    const lastWeek = new Date(2026, 5, 17, 8, 0).getTime();
    const trips = [makeTrip({ id: 1, scheduledFor: lastWeek })];
    expect(selectUpcomingTrip(trips, now)).toBeNull();
  });

  it('quando ha varias futuras, prefere a mais proxima', () => {
    const tomorrow7am = new Date(2026, 5, 25, 7, 0).getTime();
    const tomorrow20pm = new Date(2026, 5, 25, 20, 0).getTime();
    const trips = [
      makeTrip({ id: 1, scheduledFor: tomorrow20pm }),
      makeTrip({ id: 2, scheduledFor: tomorrow7am }),
    ];
    const pick = selectUpcomingTrip(trips, now);
    expect(pick?.trip.id).toBe(2);
  });
});
