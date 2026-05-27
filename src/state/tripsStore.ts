import { create } from 'zustand';
import { loadCatalog } from '@/infrastructure/catalog/catalogClient';
import { generateAutoTrips } from '@/domains/trips/generator';
import { DEFAULT_FUEL_PRICE_REAIS } from '@/domains/catalog/cost';
import { getSavedTripsRepo } from '@/infrastructure/db/savedTripsRepository';
import type { AutoTrip, SavedTrip } from '@/domains/trips/types';
import {
  findOvernightsNear,
  type OvernightOption,
} from '@/infrastructure/trips/overnightFinder';
import { selectActiveMotorcycle, useMotorcycleStore } from './motorcycleStore';

/**
 * F35.6 — Store das Trips auto-geradas. Cache simples: a primeira
 * chamada `load()` computa e armazena. Subsequentes voltam o cache —
 * trips dependem so do catalogo, que e estatico no boot.
 *
 * Sem TTL: como o catalogo nao muda em runtime, recomputar e desperdicio.
 * `refresh(force=true)` permite recomputar quando o catalogo mudar (ex:
 * fetch remoto futuro).
 */

/** Chave do mapa de pernoites: `${tripId}|${dayNumber}`. Esse padrao
 *  permite cachear independente por dia do roteiro. */
type OvernightKey = string;

export interface OvernightFetchState {
  loading: boolean;
  error: string | null;
  results: OvernightOption[];
}

interface TripsStoreState {
  trips: AutoTrip[];
  /** F35.7 — Trips salvas manualmente pelo piloto via TripBuilder.
   *  Carregadas com `loadSavedTrips()`. Aparecem acima dos auto-gerados
   *  na TripsScreen. */
  savedTrips: SavedTrip[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  /** Pernoites buscados sob demanda por dia de cada trip. */
  overnightsByDay: Record<OvernightKey, OvernightFetchState>;
  load: (force?: boolean) => void;
  /** Le `saved_trips` do SQLite e popula `savedTrips`. Chamado pela
   *  TripsScreen no foco da tela. */
  loadSavedTrips: () => Promise<void>;
  /** Busca hoteis + pousadas perto do `coordenada_fim` da rota do dia
   *  dado e cacheia o resultado. No-op se ja temos resultado pra essa
   *  chave (passar `force=true` pra refazer). */
  loadOvernightsFor: (
    tripId: string,
    dayNumber: number,
    force?: boolean,
  ) => Promise<void>;
  reset: () => void;
}

function overnightKey(tripId: string, dayNumber: number): OvernightKey {
  return `${tripId}|${dayNumber}`;
}

export const useTripsStore = create<TripsStoreState>((set, get) => ({
  trips: [],
  savedTrips: [],
  loaded: false,
  loading: false,
  error: null,
  overnightsByDay: {},

  load: (force = false) => {
    const state = get();
    if (!force && state.loaded) return;
    set({ loading: true, error: null });
    try {
      const catalog = loadCatalog();
      // F35.6 rev — Lê moto ativa pra calcular estimativa de combustivel
      // por trip. Sem moto ativa, o gerador omite os campos de
      // estimativa e a UI fallback no card mostra "—".
      const activeMoto = selectActiveMotorcycle(
        useMotorcycleStore.getState(),
      );
      const fuelEstimate =
        activeMoto && activeMoto.averageConsump > 0
          ? {
              consumoKmL: activeMoto.averageConsump,
              pricePerLiter: DEFAULT_FUEL_PRICE_REAIS,
            }
          : undefined;
      const trips = generateAutoTrips({
        catalog,
        ...(fuelEstimate !== undefined ? { fuelEstimate } : {}),
      });
      set({ trips, loaded: true, loading: false, error: null });
    } catch (err) {
      const message =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'Falha ao gerar trips';
      set({ trips: [], loaded: true, loading: false, error: message });
    }
  },

  loadSavedTrips: async () => {
    try {
      const repo = await getSavedTripsRepo();
      const savedTrips = await repo.list();
      set({ savedTrips });
    } catch {
      // best-effort: se SQLite falha, mantem a lista anterior
    }
  },

  loadOvernightsFor: async (tripId, dayNumber, force = false) => {
    const key = overnightKey(tripId, dayNumber);
    const existing = get().overnightsByDay[key];
    if (!force && existing && !existing.error && existing.results.length > 0) {
      return; // ja temos cache
    }
    if (existing && existing.loading) {
      return; // request in-flight
    }
    const trip = get().trips.find((t) => t.id === tripId);
    const day = trip?.days.find((d) => d.dayNumber === dayNumber);
    if (
      !day ||
      day.pernoiteLat === undefined ||
      day.pernoiteLng === undefined
    ) {
      return; // dia sem pernoite (ultimo dia) ou sem coords
    }
    set((prev) => ({
      overnightsByDay: {
        ...prev.overnightsByDay,
        [key]: { loading: true, error: null, results: [] },
      },
    }));
    try {
      const results = await findOvernightsNear({
        center: { latitude: day.pernoiteLat, longitude: day.pernoiteLng },
      });
      set((prev) => ({
        overnightsByDay: {
          ...prev.overnightsByDay,
          [key]: { loading: false, error: null, results },
        },
      }));
    } catch (err) {
      const message =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'Falha ao buscar pousadas';
      set((prev) => ({
        overnightsByDay: {
          ...prev.overnightsByDay,
          [key]: { loading: false, error: message, results: [] },
        },
      }));
    }
  },

  reset: () => {
    set({
      trips: [],
      savedTrips: [],
      loaded: false,
      loading: false,
      error: null,
      overnightsByDay: {},
    });
  },
}));
