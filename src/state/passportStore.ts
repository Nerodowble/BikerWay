import { create } from 'zustand';
import { loadCatalog } from '@/infrastructure/catalog/catalogClient';
import { getRideHistoryRepo } from '@/infrastructure/db/rideHistoryRepository';
import { computeBadges } from '@/domains/passport/badges';
import type {
  Badge,
  PassportData,
  PassportStats,
  RouteTripCard,
  StateProgress,
} from '@/domains/passport/types';
import type { CatalogRoute } from '@/domains/catalog/types';
import type { TripHistoryEntry } from '@/domains/rideHistory/types';

/**
 * F35.3 — Store do Passaporte. Lazy: PassportScreen chama `load()` no mount
 * e a tela mostra `data` enquanto fica subscribed. Re-load apos cada stamp
 * novo seria ideal, mas como o user volta pra Home dismissado o banner,
 * ele tipicamente abre o passaporte de novo manualmente.
 */

interface PassportStoreState {
  data: PassportData | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  reset: () => void;
}

const EMPTY_STATS: PassportStats = {
  trips: 0,
  km: 0,
  uniqueStates: 0,
  currentYear: new Date().getFullYear(),
  tripsInCurrentYear: 0,
};

function getStateFromRoute(route: CatalogRoute): string | null {
  const m = /\b([A-Z]{2})\b/.exec(route.estado_pais);
  return m ? m[1] ?? null : null;
}

function computePerState(
  trips: ReadonlyArray<TripHistoryEntry>,
  catalog: ReadonlyArray<CatalogRoute>,
): StateProgress[] {
  // Total de rotas curadas por estado (denominador)
  const totalByUf = new Map<string, number>();
  for (const r of catalog) {
    const uf = getStateFromRoute(r);
    if (!uf) continue;
    totalByUf.set(uf, (totalByUf.get(uf) ?? 0) + 1);
  }
  // Trips completadas por estado (numerador, deduplicado por rota_id)
  const completedByUf = new Map<string, Set<string>>();
  const catalogById = new Map(catalog.map((r) => [r.rota_id, r]));
  for (const t of trips) {
    if (!t.completedAt) continue;
    const route = catalogById.get(t.rotaId);
    if (!route) continue;
    const uf = getStateFromRoute(route);
    if (!uf) continue;
    const set = completedByUf.get(uf) ?? new Set<string>();
    set.add(t.rotaId);
    completedByUf.set(uf, set);
  }
  // Resultado: estados visitados (= com >=1 completed) em ordem alfabetica
  return Array.from(totalByUf.entries())
    .map(([uf, total]) => ({
      uf,
      total,
      completed: completedByUf.get(uf)?.size ?? 0,
    }))
    .filter((e) => e.completed > 0)
    .sort((a, b) => a.uf.localeCompare(b.uf));
}

function computeStats(
  trips: ReadonlyArray<TripHistoryEntry>,
  catalog: ReadonlyArray<CatalogRoute>,
): PassportStats {
  const completed = trips.filter((t) => t.completedAt);
  const km = completed.reduce(
    (acc, t) => acc + (t.distanceKm ?? 0),
    0,
  );
  const catalogById = new Map(catalog.map((r) => [r.rota_id, r]));
  const states = new Set<string>();
  const currentYear = new Date().getFullYear();
  let tripsInCurrentYear = 0;
  for (const t of completed) {
    const route = catalogById.get(t.rotaId);
    if (route) {
      const uf = getStateFromRoute(route);
      if (uf) states.add(uf);
    }
    const completedAt = t.completedAt ?? 0;
    if (new Date(completedAt).getFullYear() === currentYear) {
      tripsInCurrentYear += 1;
    }
  }
  return {
    trips: completed.length,
    km: Math.round(km),
    uniqueStates: states.size,
    currentYear,
    tripsInCurrentYear,
  };
}

function computeHistory(
  trips: ReadonlyArray<TripHistoryEntry>,
  catalog: ReadonlyArray<CatalogRoute>,
): RouteTripCard[] {
  const catalogById = new Map(catalog.map((r) => [r.rota_id, r]));
  return trips
    .filter((t) => t.completedAt !== undefined)
    .map((trip) => {
      const route = catalogById.get(trip.rotaId);
      return route ? { trip, route } : { trip };
    });
}

export const usePassportStore = create<PassportStoreState>((set) => ({
  data: null,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const repo = await getRideHistoryRepo();
      const trips = await repo.listTrips();
      const catalog = loadCatalog();
      const stats = computeStats(trips, catalog);
      const perState = computePerState(trips, catalog);
      const badges: Badge[] = computeBadges(trips, catalog);
      const history = computeHistory(trips, catalog);
      set({
        data: { stats, perState, badges, history },
        loading: false,
        error: null,
      });
    } catch (err) {
      const message =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'Falha ao carregar o passaporte';
      set({
        data: { stats: EMPTY_STATS, perState: [], badges: [], history: [] },
        loading: false,
        error: message,
      });
    }
  },

  reset: () => {
    set({ data: null, loading: false, error: null });
  },
}));
