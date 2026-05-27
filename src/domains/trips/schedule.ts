import type { SavedTrip } from './types';

/**
 * F35.8 — Utilitarios de agendamento de trip + selector da "proxima trip
 * pra alertar" pelo banner in-app.
 *
 * Convencao de janela: o banner pre-trip aparece pra trips cuja
 * `scheduledFor` cai dentro das proximas 48h, descontando trips ja
 * completadas. O dia D-1 (vespera) e D (dia da trip) ambos cabem nessa
 * janela, suficiente pra o piloto preparar bagagem / encher tanque.
 *
 * Pure: testavel sem store; o caller passa `now` quando precisar
 * controlar tempo determinacionalmente.
 */

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const DEFAULT_WINDOW_HOURS = 48;

/**
 * Tenta interpretar uma string "dd/mm/aaaa" como epoch ms na meia-noite
 * local. Retorna null se invalida ou impossivel (mes 13, dia 31 em
 * fevereiro, etc).
 */
export function parseDdMmYyyy(input: string): number | null {
  const trimmed = input.trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (!m) return null;
  const dayStr = m[1];
  const monthStr = m[2];
  const yearStr = m[3];
  if (
    dayStr === undefined ||
    monthStr === undefined ||
    yearStr === undefined
  ) {
    return null;
  }
  const day = Number.parseInt(dayStr, 10);
  const month = Number.parseInt(monthStr, 10);
  const year = Number.parseInt(yearStr, 10);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) {
    return null;
  }
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (year < 2000 || year > 2100) return null;
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  // Detecta overflow tipo "31/02" -> Date construtor reabsorve em marco
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date.getTime();
}

export function formatDdMmYyyy(epoch: number): string {
  const d = new Date(epoch);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** True quando a data e estritamente >= meia-noite de hoje. Util pra
 *  validacao do TripBuilder ("trips no passado nao fazem sentido"). */
export function isFutureOrTodayDate(epoch: number, now: number = Date.now()): boolean {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return epoch >= today.getTime();
}

export interface UpcomingTripPick {
  trip: SavedTrip;
  /** Numero de horas (arredondado pra baixo) ate `scheduledFor` a partir
   *  de `now`. Pode ser negativo se a trip ja "comecou" (D <= now < D+24h). */
  hoursUntil: number;
  /** True quando hoje e o proprio dia da trip (D) — banner muda de copy. */
  isToday: boolean;
}

/**
 * Seleciona a trip mais imediata cuja `scheduledFor` cai dentro da
 * janela `[now, now + windowHours)`, ou que ja esta no dia D (entre
 * meia-noite de hoje e meia-noite de amanha). Trips ja completadas
 * sao ignoradas. Retorna null se nao houver candidatas.
 */
export function selectUpcomingTrip(
  trips: ReadonlyArray<SavedTrip>,
  now: number = Date.now(),
  windowHours: number = DEFAULT_WINDOW_HOURS,
): UpcomingTripPick | null {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const startOfTodayMs = today.getTime();
  const endOfWindowMs = now + windowHours * MS_PER_HOUR;

  let best: UpcomingTripPick | null = null;
  for (const t of trips) {
    if (t.scheduledFor === undefined) continue;
    if (t.completedAt !== undefined) continue;
    const isToday =
      t.scheduledFor >= startOfTodayMs &&
      t.scheduledFor < startOfTodayMs + MS_PER_DAY;
    // Aceita: (a) hoje, OU (b) futuro dentro da janela
    if (!isToday && (t.scheduledFor < now || t.scheduledFor >= endOfWindowMs)) {
      continue;
    }
    const hoursUntil = Math.floor((t.scheduledFor - now) / MS_PER_HOUR);
    const candidate: UpcomingTripPick = { trip: t, hoursUntil, isToday };
    if (best === null) {
      best = candidate;
    } else if (
      // Prioriza isToday sobre futuro
      (candidate.isToday && !best.isToday) ||
      // Entre os mesmos status, prioriza o mais proximo no tempo
      (candidate.isToday === best.isToday &&
        Math.abs(candidate.hoursUntil) < Math.abs(best.hoursUntil))
    ) {
      best = candidate;
    }
  }
  return best;
}
