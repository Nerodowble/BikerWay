import { create } from 'zustand';
import {
  evaluateTripProgress,
  type LatLng,
} from '@/domains/rideHistory/completionDetector';
import { getRideHistoryRepo } from '@/infrastructure/db/rideHistoryRepository';
import { useNavigationStore } from './navigationStore';

/**
 * F35.2 — Estado de tracking de conclusao da viagem ativa.
 *
 * F35.2 rev — Persistencia em SQLite (`trip_progress`) + cobertura por
 * segmento + margem de completion no stopTracking. O detector e puro;
 * este store orquestra: lifecycle, persistencia, e interpretacao de
 * "stop com margem".
 *
 * Lifecycle:
 *   - `handleStartNavigation` chama `startTracking(...)` (async) — hydrata
 *     `coveredIndices` do SQLite se um trip pendente da mesma rota foi
 *     restaurado pelo `recordTripStarted` (resume window 24h).
 *   - Subscribe global ao `navigationStore.currentPosition` pra alimentar
 *     `onPosition`. Cada novo indice coberto e gravado em fire-and-forget.
 *   - `navigationStore.stopNavigation` chama `stopTracking()`. Se o
 *     tracker estava ativo, com >=80% cobertura E posicao final ate 5km
 *     do fim, ainda assim persiste como completado.
 *   - Em completion, `recordTripCompleted` recebe o `distanceTraveledKm`
 *     REAL do navigationStore (nao a curada do JSON).
 */

export interface CompletedStamp {
  rotaId: string;
  completedAt: number;
  durationMinutes: number;
  distanceKm: number;
}

/** Margem extra de proximidade ao fim usada SO no stopTracking. O fluxo
 *  normal (`onPosition`) usa `DEFAULT_FINISH_PROXIMITY_KM=2`; quando o
 *  piloto para a navegacao MANUALMENTE depois de cobrir >=80%, tolera
 *  ficar ate 5km do fim (cenario: parou no posto perto, vai encontrar
 *  o amigo). */
export const STOP_FINISH_MARGIN_KM = 5;

export interface TripCompletionState {
  active: boolean;
  tripId: number | null;
  rotaId: string | null;
  polyline: ReadonlyArray<LatLng>;
  coordenadaFim: LatLng | null;
  routeDistanceKm: number;
  startedAt: number | null;
  coveredIndices: ReadonlySet<number>;
  completionRatio: number;
  lastCompletedStamp: CompletedStamp | null;

  startTracking: (input: {
    tripId: number;
    rotaId: string;
    polyline: ReadonlyArray<LatLng>;
    coordenadaFim: LatLng;
    routeDistanceKm: number;
    startedAt?: number;
  }) => Promise<void>;
  stopTracking: () => void;
  onPosition: (pos: LatLng) => void;
  acknowledgeStamp: () => void;
}

const EMPTY_SET: ReadonlySet<number> = new Set<number>();

/**
 * Roda o write final de uma viagem: calcula duracao, le `distanceTraveledKm`
 * real do navigationStore, persiste via repo e atualiza `lastCompletedStamp`.
 * Extraido pra que `onPosition` (auto-complete) e `stopTracking`
 * (complete-com-margem) compartilhem o mesmo caminho.
 */
function completeTripNow(
  args: {
    tripId: number;
    rotaId: string;
    startedAt: number;
    fallbackDistanceKm: number;
  },
  set: (
    update: Partial<TripCompletionState> | ((s: TripCompletionState) => Partial<TripCompletionState>),
  ) => void,
): void {
  const completedAt = Date.now();
  const durationMinutes = Math.max(
    0,
    Math.round((completedAt - args.startedAt) / 60_000),
  );
  // F35.2 rev — distancia REAL do navigationStore (haversine acumulado a
  // cada 500m). Fallback pro valor curado do JSON se ainda nao acumulou
  // nada (cenario: trip super curto, ou app sem GPS confiavel).
  const navDistance = useNavigationStore.getState().distanceTraveledKm;
  const distanceKm = navDistance > 0 ? navDistance : args.fallbackDistanceKm;

  void getRideHistoryRepo()
    .then(async (repo) => {
      await repo.recordTripCompleted(
        args.tripId,
        completedAt,
        durationMinutes,
        distanceKm,
      );
      // Limpa trip_progress agora que o trip ja completou — pra nao
      // ressuscitar nada caso o user reabra a mesma rota no futuro
      // (trip novo, set zero).
      await repo.clearCoveredIndicesForTrip(args.tripId);
    })
    .catch(() => {
      // Best-effort. Sem persistir, o stamp UI ainda flicka.
    });

  set({
    lastCompletedStamp: {
      rotaId: args.rotaId,
      completedAt,
      durationMinutes,
      distanceKm,
    },
    active: false,
    tripId: null,
    rotaId: null,
    polyline: [],
    coordenadaFim: null,
    routeDistanceKm: 0,
    startedAt: null,
    coveredIndices: EMPTY_SET,
    completionRatio: 0,
  });
}

export const useTripCompletionStore = create<TripCompletionState>(
  (set, get) => ({
    active: false,
    tripId: null,
    rotaId: null,
    polyline: [],
    coordenadaFim: null,
    routeDistanceKm: 0,
    startedAt: null,
    coveredIndices: EMPTY_SET,
    completionRatio: 0,
    lastCompletedStamp: null,

    startTracking: async ({
      tripId,
      rotaId,
      polyline,
      coordenadaFim,
      routeDistanceKm,
      startedAt,
    }) => {
      // F35.2 rev — Hidrata `coveredIndices` do SQLite. Cobre o caso
      // "piloto fechou o app, abriu de novo e iniciou a mesma rota" —
      // `recordTripStarted` reusou o trip id e os indices ja cobertos
      // continuam la.
      let hydrated: ReadonlyArray<number> = [];
      try {
        const repo = await getRideHistoryRepo();
        hydrated = await repo.getCoveredIndicesForTrip(tripId);
      } catch {
        // Best-effort — se SQLite falhar, comeca do zero.
      }
      const coveredIndices = new Set<number>(hydrated);
      const completionRatio =
        polyline.length > 0 ? coveredIndices.size / polyline.length : 0;
      set({
        active: true,
        tripId,
        rotaId,
        polyline,
        coordenadaFim,
        routeDistanceKm,
        startedAt: startedAt ?? Date.now(),
        coveredIndices,
        completionRatio,
      });
    },

    stopTracking: () => {
      const state = get();
      // F35.2 rev — Complete-with-margin: se o piloto para a navegacao
      // depois de cobrir >=80% da polyline E esta dentro de 5km do fim
      // (margem mais generosa que os 2km do auto-complete), ainda assim
      // persiste como completado. Cobre "parou no posto 1km do fim,
      // amigos chegaram, encerrou navegacao".
      if (
        state.active &&
        state.tripId !== null &&
        state.rotaId !== null &&
        state.coordenadaFim !== null &&
        state.completionRatio >= 0.8
      ) {
        const navPos = useNavigationStore.getState().currentPosition;
        if (navPos !== null) {
          const dx =
            (state.coordenadaFim.longitude - navPos.longitude) *
            Math.cos((navPos.latitude * Math.PI) / 180);
          const dy = state.coordenadaFim.latitude - navPos.latitude;
          // Aproximacao linear em graus (suficiente pra cutoff de 5km).
          const approxKm = Math.sqrt(dx * dx + dy * dy) * 111.32;
          if (approxKm <= STOP_FINISH_MARGIN_KM) {
            completeTripNow(
              {
                tripId: state.tripId,
                rotaId: state.rotaId,
                startedAt: state.startedAt ?? Date.now(),
                fallbackDistanceKm: state.routeDistanceKm,
              },
              set,
            );
            return;
          }
        }
      }
      // Caminho normal: stop sem completar. trip_history fica com
      // completed_at NULL (interpretado como "iniciado mas nao completou")
      // — o cleanup de 24h no bootstrap removera se passar do prazo.
      set({
        active: false,
        tripId: null,
        rotaId: null,
        polyline: [],
        coordenadaFim: null,
        routeDistanceKm: 0,
        startedAt: null,
        coveredIndices: EMPTY_SET,
        completionRatio: 0,
      });
    },

    onPosition: (pos) => {
      const state = get();
      if (
        !state.active ||
        state.tripId === null ||
        state.rotaId === null ||
        state.coordenadaFim === null
      ) {
        return;
      }
      if (state.polyline.length === 0) return;

      const result = evaluateTripProgress({
        polyline: state.polyline,
        coveredIndices: state.coveredIndices,
        position: pos,
        coordenadaFim: state.coordenadaFim,
      });

      // F35.2 rev — Persiste so os indices NOVOS (delta entre o Set
      // anterior e o atual). Fire-and-forget: se o sample for muito
      // rapido e o write ainda nao terminou, o proximo sample so
      // adiciona o que faltou (PRIMARY KEY composto previne duplicates).
      const newlyAdded: number[] = [];
      for (const idx of result.coveredIndices) {
        if (!state.coveredIndices.has(idx)) newlyAdded.push(idx);
      }
      if (newlyAdded.length > 0) {
        const tripId = state.tripId;
        void getRideHistoryRepo()
          .then(async (repo) => {
            for (const idx of newlyAdded) {
              await repo.recordCoveredIndex(tripId, idx);
            }
          })
          .catch(() => {
            // best-effort
          });
      }

      set({
        coveredIndices: result.coveredIndices,
        completionRatio: result.completionRatio,
      });

      if (!result.isCompleted) return;

      completeTripNow(
        {
          tripId: state.tripId,
          rotaId: state.rotaId,
          startedAt: state.startedAt ?? Date.now(),
          fallbackDistanceKm: state.routeDistanceKm,
        },
        set,
      );
    },

    acknowledgeStamp: () => {
      set({ lastCompletedStamp: null });
    },
  }),
);

// Subscribe global ao navigationStore — uma instancia por JS runtime.
useNavigationStore.subscribe((state, prev) => {
  const pos = state.currentPosition;
  if (pos === null) return;
  if (prev.currentPosition !== null && pos === prev.currentPosition) return;
  useTripCompletionStore.getState().onPosition({
    latitude: pos.latitude,
    longitude: pos.longitude,
  });
});
