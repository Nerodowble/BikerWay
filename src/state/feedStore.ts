import { create } from 'zustand';
import { loadCatalog } from '@/infrastructure/catalog/catalogClient';
import { getRideHistoryRepo } from '@/infrastructure/db/rideHistoryRepository';
import { computeFeed } from '@/domains/feed/ranker';
import type { FeedCard } from '@/domains/feed/types';
import { useRiderStore } from './riderStore';

/**
 * F35.5 — Estado do feed "Fim de Semana Perfeito".
 *
 * Cache TTL de 30 minutos (decisao do brainstorm): cards sao gerados a
 * cada abertura mas reusados quando o piloto navega rapido entre telas.
 * `refresh()` chamado pelo CatalogResults no mount; usa o cache se ainda
 * fresh, recalcula caso contrario.
 *
 * Sem persistencia: o feed vive na memoria. Reinicio do app gera novo.
 */

const CACHE_TTL_MS = 30 * 60 * 1000;

interface FeedStoreState {
  cards: FeedCard[];
  generatedAt: number | null;
  loading: boolean;
  error: string | null;
  refresh: (input: {
    userPosition: { latitude: number; longitude: number };
    /** Forca recomputacao mesmo dentro do TTL. Util pro pull-to-refresh
     *  futuro. Default false. */
    force?: boolean;
    /** Override do clock pra testes determinacionais. */
    now?: number;
  }) => Promise<void>;
  reset: () => void;
}

export const useFeedStore = create<FeedStoreState>((set, get) => ({
  cards: [],
  generatedAt: null,
  loading: false,
  error: null,

  refresh: async ({ userPosition, force = false, now = Date.now() }) => {
    const state = get();
    if (
      !force &&
      state.generatedAt !== null &&
      now - state.generatedAt < CACHE_TTL_MS &&
      state.cards.length > 0
    ) {
      return; // Cache fresco — nao recomputa.
    }
    set({ loading: true, error: null });
    try {
      const repo = await getRideHistoryRepo();
      const trips = await repo.listTrips();
      const catalog = loadCatalog();

      // Conta aberturas por rota no `route_history`. Em vez de N queries,
      // uma so query — listRouteEvents nao tem versao "all routes", entao
      // iteramos por rota do catalogo. Pra 15 rotas isso e barato.
      const routeOpenCounts = new Map<string, number>();
      for (const route of catalog) {
        const count = await repo.getRouteOpenCount(route.rota_id);
        if (count > 0) routeOpenCounts.set(route.rota_id, count);
      }
      const completedRotaIds = new Set<string>();
      for (const t of trips) {
        if (t.completedAt !== undefined && t.completedAt > 0) {
          completedRotaIds.add(t.rotaId);
        }
      }
      const profile = useRiderStore.getState().profile;
      const profileInput =
        profile !== null
          ? {
              ...(profile.estiloPilotagem !== undefined
                ? { estiloPilotagem: profile.estiloPilotagem }
                : {}),
              ...(profile.preferenciaTempo !== undefined
                ? { preferenciaTempo: profile.preferenciaTempo }
                : {}),
              ...(profile.anosPilotando !== undefined
                ? { anosPilotando: profile.anosPilotando }
                : {}),
            }
          : undefined;
      const cards = computeFeed({
        catalog,
        userPosition,
        routeOpenCounts,
        completedRotaIds,
        ...(profileInput !== undefined ? { profile: profileInput } : {}),
        now,
      });
      set({ cards, generatedAt: now, loading: false, error: null });
    } catch (err) {
      const message =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'Falha ao gerar o feed';
      set({ cards: [], loading: false, error: message });
    }
  },

  reset: () => {
    set({ cards: [], generatedAt: null, loading: false, error: null });
  },
}));
