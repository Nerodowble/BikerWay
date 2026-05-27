import { create } from 'zustand';
import {
  GeoPosition,
  NavigationState,
  RouteSettings,
} from '../domains/navigation/types';
import type { Route } from '../domains/routing/types';
import type { FuelPoi } from '../domains/poi/types';
import { computeReserveStatus } from '../domains/fuel/autonomy';
import { findNearestPointOnRoute } from '../domains/navigation/engine';
import { haversineMeters } from '../shared/utils/haversine';
import { openDatabase } from '../infrastructure/db/sqlite';
import { getActiveRouteRepo } from '../infrastructure/db/activeRouteRepository';
import { osrmClient } from '../infrastructure/routing/osrmClient';
import {
  selectActiveMotorcycle,
  useMotorcycleStore,
} from './motorcycleStore';

export const SAMPLE_DISTANCE_METERS = 500;
const PERSIST_DEBOUNCE_MS = 2000;
const TRIP_DISTANCE_KEY = 'trip.distanceKm';
const TRIP_ANCHOR_KEY = 'trip.anchorPos';

export interface NavigationStoreState extends NavigationState {
  routeSettings: RouteSettings;
  activeRoute: Route | null;
  /**
   * Pending OSRM alternatives shown on the map between destination pick and
   * route confirmation. Cleared by `setActiveRoute(non-null)`,
   * `stopNavigation()`, and `setRouteAlternatives(null)`. `setActiveRoute(null)`
   * leaves it alone so the picker can survive a failed reroute.
   */
  routeAlternatives: Route[] | null;
  isFetchingRoute: boolean;
  routeError: string | null;
  lastReroutedAt: number | null;
  lastSamplePosition: GeoPosition | null;
  /**
   * Unix epoch ms marking when `startNavigation()` was last called.
   * Reset to `null` by `stopNavigation()`. Used by the top-left timer badge
   * to show "Pilotando há HH:MM" without storing a tick — the badge
   * recomputes the elapsed delta locally every minute.
   */
  tripStartedAt: number | null;
  /**
   * Coarse hint: index of the nearest route vertex to the rider, used by the
   * POI engine to slice the remaining route. Only recomputed when the 500m
   * sample threshold fires (sub-500m drift is irrelevant for a 1km buffer),
   * so this can lag the real position by up to one sample interval.
   * Reset to 0 by `resetTrip`, `stopNavigation`, and `setActiveRoute`.
   */
  currentRouteIndex: number;
  /**
   * Active fuel detour (RF05). Non-null while the rider is heading to a
   * fuel POI via an OSRM-injected waypoint. Cleared on arrival, manual
   * removal, navigation stop, or detour failure.
   */
  pendingFuelWaypoint: FuelPoi | null;
  /**
   * Destination captured at the moment the first detour was injected. Used
   * to restore the original trip once the rider finishes refueling. We
   * intentionally keep the FIRST saved destination across overlapping
   * `injectFuelWaypoint` calls so retries / detour swaps still return to
   * the rider's real destination.
   */
  originalDestination: GeoPosition | null;
  setCurrentPosition: (pos: GeoPosition) => void;
  setDestination: (pos: GeoPosition | null) => void;
  startNavigation: () => void;
  stopNavigation: () => void;
  resetTrip: () => void;
  hydrateTripState: () => Promise<void>;
  /** F36.1 — Restaura a rota ativa do SQLite no boot. Permite continuar
   *  navegando offline apos kill do app. Best-effort: se nao houver
   *  cache, mantem `activeRoute = null`. */
  hydrateActiveRoute: () => Promise<void>;
  setRouteSettings: (settings: Partial<RouteSettings>) => void;
  setActiveRoute: (route: Route | null) => void;
  /** Replace or clear the pending OSRM alternatives. */
  setRouteAlternatives: (routes: Route[] | null) => void;
  setRouteError: (msg: string | null) => void;
  setFetchingRoute: (b: boolean) => void;
  markReroutedNow: () => void;
  /**
   * RF05 — Inject a fuel POI as an intermediate waypoint on the active
   * trip and refetch the route as start -> poi -> originalDestination.
   * Idempotent on the saved original destination: a second call while a
   * detour is already pending does NOT overwrite `originalDestination`.
   */
  injectFuelWaypoint: (poi: FuelPoi) => Promise<void>;
  /**
   * RF05 — Drop the current fuel waypoint and refetch the original
   * straight route from `currentPosition` to the saved `originalDestination`.
   * No-op when no detour is pending.
   */
  removeFuelWaypoint: () => Promise<void>;
  /**
   * RF05 — User confirmed "tanque cheio". Resets the trip odometer to 0
   * (so reserve mode recalculates against a full tank) and then removes
   * the active fuel waypoint to resume the original route.
   */
  confirmFuelArrival: () => Promise<void>;
}

function evaluateReserve(state: NavigationStoreState): boolean {
  const moto = selectActiveMotorcycle(useMotorcycleStore.getState());
  if (!moto) return false;
  return computeReserveStatus({
    tankCapacity: moto.tankCapacity,
    averageConsump: moto.averageConsump,
    distanceTraveledKm: state.distanceTraveledKm,
    isNavigating: state.isNavigating,
  }).isReserveMode;
}

function evaluateReserveFromStores(state: NavigationStoreState): boolean {
  return evaluateReserve(state);
}

interface AppSettingRow {
  value: string;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDistanceKm: number = 0;
let pendingAnchor: GeoPosition | null = null;

async function writeTripSettings(
  distanceKm: number,
  anchor: GeoPosition | null,
): Promise<void> {
  try {
    const db = await openDatabase();
    const anchorValue = anchor ? JSON.stringify(anchor) : '';
    await db.runAsync(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [TRIP_DISTANCE_KEY, String(distanceKm)],
    );
    await db.runAsync(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [TRIP_ANCHOR_KEY, anchorValue],
    );
  } catch {
    // best-effort; must not break the watcher
  }
}

function persistTripState(
  distanceKm: number,
  anchor: GeoPosition | null,
): void {
  pendingDistanceKm = distanceKm;
  pendingAnchor = anchor;
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void writeTripSettings(pendingDistanceKm, pendingAnchor);
  }, PERSIST_DEBOUNCE_MS);
}

/**
 * Synchronously flush any pending debounced trip-state write to the DB.
 * Used on backgrounding and on explicit stop/reset so a fast OS kill cannot
 * lose the queued write. Best-effort: errors are swallowed inside
 * writeTripSettings so this function never throws.
 */
export async function flushTripStateNow(): Promise<void> {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    await writeTripSettings(pendingDistanceKm, pendingAnchor);
  } catch {
    // writeTripSettings already swallows; defensive guard for any future change.
  }
}

async function loadPersistedTripState(): Promise<
  { distanceKm: number; anchor: GeoPosition | null } | null
> {
  try {
    const db = await openDatabase();
    const distanceRow = await db.getFirstAsync<AppSettingRow>(
      'SELECT value FROM app_settings WHERE key = ?',
      [TRIP_DISTANCE_KEY],
    );
    const anchorRow = await db.getFirstAsync<AppSettingRow>(
      'SELECT value FROM app_settings WHERE key = ?',
      [TRIP_ANCHOR_KEY],
    );
    if (!distanceRow && !anchorRow) return null;
    const parsedDistance = distanceRow ? Number.parseFloat(distanceRow.value) : 0;
    const distanceKm = Number.isFinite(parsedDistance) ? parsedDistance : 0;
    let anchor: GeoPosition | null = null;
    if (anchorRow && anchorRow.value && anchorRow.value.length > 0) {
      try {
        const parsed = JSON.parse(anchorRow.value) as GeoPosition;
        if (
          parsed &&
          typeof parsed.latitude === 'number' &&
          typeof parsed.longitude === 'number'
        ) {
          anchor = parsed;
        }
      } catch {
        anchor = null;
      }
    }
    return { distanceKm, anchor };
  } catch {
    return null;
  }
}

export const useNavigationStore = create<NavigationStoreState>((set, get) => ({
  currentPosition: null,
  destination: null,
  isNavigating: false,
  tripStartedAt: null,
  distanceTraveledKm: 0,
  isReserveMode: false,
  routeSettings: { type: 'express', allowUnpaved: false },
  activeRoute: null,
  routeAlternatives: null,
  isFetchingRoute: false,
  routeError: null,
  lastReroutedAt: null,
  lastSamplePosition: null,
  currentRouteIndex: 0,
  pendingFuelWaypoint: null,
  originalDestination: null,

  setCurrentPosition: (pos) => {
    const state = get();
    // Dedup near-simultaneous fixes (within 250ms) so that the foreground
    // watcher and the background task delivering the same sample do not
    // double-count distance. Strictly less-than to keep the very first
    // timestamp through, and we also require a non-negative delta so a
    // re-played older sample never short-circuits a fresh one.
    const prevTs = state.currentPosition?.timestamp ?? 0;
    if (
      pos.timestamp > 0 &&
      pos.timestamp - prevTs < 250 &&
      pos.timestamp - prevTs >= 0
    ) {
      return;
    }
    if (!state.isNavigating) {
      set({ currentPosition: pos });
      return;
    }
    if (state.lastSamplePosition === null) {
      set({ currentPosition: pos, lastSamplePosition: pos });
      return;
    }
    const deltaMeters = haversineMeters(state.lastSamplePosition, pos);
    if (deltaMeters < SAMPLE_DISTANCE_METERS) {
      set({ currentPosition: pos });
      return;
    }
    const nextDistance = state.distanceTraveledKm + deltaMeters / 1000;
    const nextState: NavigationStoreState = {
      ...state,
      currentPosition: pos,
      distanceTraveledKm: nextDistance,
      lastSamplePosition: pos,
    };
    const isReserveMode = evaluateReserve(nextState);
    // Coarse route-index hint for the POI engine. Only recomputed here —
    // once per 500m sample tick — because sub-500m drift is irrelevant to
    // the 1km POI buffer and findNearestPointOnRoute is O(n) over the
    // route polyline.
    let nextRouteIndex = state.currentRouteIndex;
    if (state.activeRoute !== null) {
      const nearest = findNearestPointOnRoute(
        state.activeRoute.coordinates,
        { latitude: pos.latitude, longitude: pos.longitude },
      );
      if (nearest.index !== state.currentRouteIndex) {
        nextRouteIndex = nearest.index;
      }
    }
    set({
      currentPosition: pos,
      distanceTraveledKm: nextDistance,
      lastSamplePosition: pos,
      isReserveMode,
      currentRouteIndex: nextRouteIndex,
    });
    persistTripState(nextDistance, pos);
  },

  setDestination: (pos) => {
    set({ destination: pos });
  },

  startNavigation: () => {
    const state = get();
    const anchor = state.currentPosition ?? state.lastSamplePosition;
    const nextState: NavigationStoreState = { ...state, isNavigating: true };
    set({
      isNavigating: true,
      // Only stamp tripStartedAt when transitioning from idle → active.
      // A re-call while already navigating (e.g. catalog INICIAR ROTA on top
      // of an existing trip) preserves the original clock so the rider sees
      // total ride time, not per-segment time.
      tripStartedAt: state.tripStartedAt ?? Date.now(),
      lastSamplePosition: anchor,
      isReserveMode: evaluateReserve(nextState),
    });
    // Kick off background location tracking. We use `require()` (resolved
    // lazily by the bundler) instead of `import()` to dodge the
    // navigationStore <-> locationStore circular import AND keep the call
    // synchronous in Jest (where dynamic `import()` requires the
    // `--experimental-vm-modules` flag). RN's Metro/Babel handles `require`
    // the same way as a static import at runtime.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const m = require('./locationStore') as typeof import('./locationStore');
      void m.useLocationStore.getState().enableBackground();
    } catch {
      // best-effort — never crash navigation start because of background hook
    }
    // F36.1.1 — Re-persiste o snapshot da rota ativa com wasNavigating=true
    // + tripStartedAt atualizado. Sem isso, o cache ficaria com a flag de
    // navegacao desatualizada (false) e o hydrate da proxima sessao nao
    // retomaria o modo navegacao.
    const updatedState = get();
    if (updatedState.activeRoute !== null) {
      void (async () => {
        try {
          const repo = await getActiveRouteRepo();
          await repo.save({
            route: updatedState.activeRoute as Route,
            destination: updatedState.destination ?? null,
            wasNavigating: true,
            tripStartedAt: updatedState.tripStartedAt,
          });
        } catch {
          // best-effort
        }
      })();
    }
  },

  stopNavigation: () => {
    const nextState: NavigationStoreState = { ...get(), isNavigating: false };
    set({
      isNavigating: false,
      tripStartedAt: null,
      isReserveMode: evaluateReserve(nextState),
      activeRoute: null,
      routeAlternatives: null,
      routeError: null,
      lastReroutedAt: null,
      lastSamplePosition: null,
      currentRouteIndex: 0,
      pendingFuelWaypoint: null,
      originalDestination: null,
    });
    persistTripState(get().distanceTraveledKm, null);
    // Mirror startNavigation: tear down background tracking via lazy require
    // (see startNavigation for the Jest/circular-import rationale).
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const m = require('./locationStore') as typeof import('./locationStore');
      void m.useLocationStore.getState().disableBackground();
    } catch {
      // best-effort
    }
    // F35.2 — Tracker de conclusao acompanha o navigation lifecycle. Se o
    // piloto para no meio, o trip fica com `completed_at` NULL no SQLite
    // (interpretado como "abandonou"). Lazy require pra dodger o ciclo
    // import navigationStore <-> tripCompletionStore.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const m =
        require('./tripCompletionStore') as typeof import('./tripCompletionStore');
      m.useTripCompletionStore.getState().stopTracking();
    } catch {
      // best-effort
    }
    // F36.1 — Limpa o cache da rota ativa em SQLite. Sem isso, abrir o
    // app no dia seguinte ressuscitaria a rota de ontem.
    void (async () => {
      try {
        const repo = await getActiveRouteRepo();
        await repo.clear();
      } catch {
        // best-effort
      }
    })();
    // Flush any queued trip-state write immediately so a fast OS kill after
    // stop does not lose the final distance value.
    void flushTripStateNow();
  },

  resetTrip: () => {
    const nextState: NavigationStoreState = {
      ...get(),
      distanceTraveledKm: 0,
      lastSamplePosition: null,
    };
    set({
      distanceTraveledKm: 0,
      lastSamplePosition: null,
      isReserveMode: evaluateReserve(nextState),
      currentRouteIndex: 0,
    });
    persistTripState(0, null);
    void flushTripStateNow();
  },

  hydrateTripState: async () => {
    const loaded = await loadPersistedTripState();
    if (!loaded) return;
    // Restore only the cumulative distance. The anchor from a previous
    // session refers to a different physical location, so using it to seed
    // lastSamplePosition would compute a huge phantom delta against the
    // first fix of the new session. Always start the new session with a
    // null anchor — the first fix becomes the new baseline.
    set({
      distanceTraveledKm: loaded.distanceKm,
      lastSamplePosition: null,
    });
  },

  hydrateActiveRoute: async () => {
    try {
      const repo = await getActiveRouteRepo();
      const snapshot = await repo.load();
      if (!snapshot) return;
      // Re-hidrata sem o setter publico — o setter dispara um save no
      // SQLite que seria redundante (e poderia escrever timestamps novos
      // sobre os antigos). Tambem nao queremos disparar o isFetchingRoute
      // ou outros side effects.
      const baseState: Partial<NavigationStoreState> = {
        activeRoute: snapshot.route,
        destination: snapshot.destination,
        currentRouteIndex: 0,
      };
      // F36.1.1 — Se a sessao anterior estava em navegacao, retoma o modo
      // navegacao + tripStartedAt original + reativa background tracking.
      if (snapshot.wasNavigating) {
        baseState.isNavigating = true;
        if (snapshot.tripStartedAt !== null) {
          baseState.tripStartedAt = snapshot.tripStartedAt;
        }
        // Reavaliacao do reserve mode acontece naturalmente no proximo
        // setCurrentPosition; aqui so flippamos os flags principais.
        set(baseState);
        // Reativa background tracking (mesmo padrao do startNavigation).
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const m =
            require('./locationStore') as typeof import('./locationStore');
          void m.useLocationStore.getState().enableBackground();
        } catch {
          // best-effort
        }
      } else {
        set(baseState);
      }
    } catch {
      // best-effort
    }
  },

  setRouteSettings: (settings) => {
    set({ routeSettings: { ...get().routeSettings, ...settings } });
  },

  setActiveRoute: (route) => {
    // Setting a new (or null) route invalidates any cached vertex index.
    // The POI store will receive a separate subscribe callback to discard
    // its stale list — see poiStore.ts. A NON-null route also dismisses
    // any pending alternatives (the rider just picked one); a null route
    // intentionally leaves them alone so the picker can survive a failed
    // reroute.
    if (route !== null) {
      set({ activeRoute: route, currentRouteIndex: 0, routeAlternatives: null });
    } else {
      set({ activeRoute: null, currentRouteIndex: 0 });
    }
    // F36.1 — Persiste/limpa o cache de rota ativa em SQLite. Best-effort:
    // falha no SQLite nao quebra a navegacao (in-memory ainda funciona).
    // F36.1.1 — Persiste tambem isNavigating + tripStartedAt pra retomar
    // o modo navegacao corretamente apos kill do app.
    void (async () => {
      try {
        const repo = await getActiveRouteRepo();
        if (route !== null) {
          const st = get();
          await repo.save({
            route,
            destination: st.destination ?? null,
            wasNavigating: st.isNavigating,
            tripStartedAt: st.tripStartedAt,
          });
        } else {
          await repo.clear();
        }
      } catch {
        // best-effort
      }
    })();
  },

  setRouteAlternatives: (routes) => {
    set({ routeAlternatives: routes });
  },

  setRouteError: (msg) => {
    set({ routeError: msg });
  },

  setFetchingRoute: (b) => {
    set({ isFetchingRoute: b });
  },

  markReroutedNow: () => {
    set({ lastReroutedAt: Date.now() });
  },

  injectFuelWaypoint: async (poi) => {
    const state = get();
    if (!state.currentPosition || !state.destination) {
      set({ routeError: 'Sem posição ou destino para desviar' });
      return;
    }
    // Preserve the FIRST captured destination across repeated detour
    // attempts so retries / detour swaps still return to the real trip
    // destination after the rider finishes refueling.
    const preservedOriginal: GeoPosition =
      state.originalDestination ?? state.destination;

    set({
      pendingFuelWaypoint: poi,
      originalDestination: preservedOriginal,
      isFetchingRoute: true,
      routeError: null,
    });

    try {
      const newRoute = await osrmClient.getRoute({
        start: {
          latitude: state.currentPosition.latitude,
          longitude: state.currentPosition.longitude,
        },
        end: {
          latitude: preservedOriginal.latitude,
          longitude: preservedOriginal.longitude,
        },
        waypoints: [{ latitude: poi.latitude, longitude: poi.longitude }],
        settings: get().routeSettings,
      });
      // Use the public setter so it also resets currentRouteIndex (the
      // POI engine watches this exact write to invalidate its slice).
      get().setActiveRoute(newRoute);
      get().markReroutedNow();
    } catch (err) {
      const message =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'Falha ao calcular o desvio';
      // Clear the pending waypoint so the user can retry — but leave
      // `originalDestination` intact only if there is still a chance the
      // caller wants to retry against the same trip; the spec says clear
      // it back to null, so we mirror that.
      set({
        routeError: message,
        pendingFuelWaypoint: null,
      });
    } finally {
      set({ isFetchingRoute: false });
    }
  },

  removeFuelWaypoint: async () => {
    const state = get();
    if (state.pendingFuelWaypoint === null) {
      return;
    }
    const savedOriginal = state.originalDestination;
    // Clear the detour markers first so a concurrent caller cannot retry
    // against half-stale state, and so an early-return below still leaves
    // the store in a consistent post-detour shape.
    set({
      pendingFuelWaypoint: null,
      originalDestination: null,
    });
    if (!state.currentPosition || savedOriginal === null) {
      return;
    }
    set({ isFetchingRoute: true, routeError: null });
    try {
      const restored = await osrmClient.getRoute({
        start: {
          latitude: state.currentPosition.latitude,
          longitude: state.currentPosition.longitude,
        },
        end: {
          latitude: savedOriginal.latitude,
          longitude: savedOriginal.longitude,
        },
        settings: get().routeSettings,
      });
      get().setActiveRoute(restored);
      get().markReroutedNow();
    } catch (err) {
      const message =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'Falha ao restaurar a rota original';
      // Keep the waypoint cleared: the rider is no longer en route to the
      // fuel station and we do not want to strand them in a detour state.
      set({ routeError: message });
    } finally {
      set({ isFetchingRoute: false });
    }
  },

  confirmFuelArrival: async () => {
    // "Tanque cheio" — zero the odometer first so reserve-mode math
    // restarts against a full tank, then drop the detour.
    get().resetTrip();
    await get().removeFuelWaypoint();
  },
}));

/** Selector for the pending alternatives array. */
export function selectRouteAlternatives(
  state: NavigationStoreState,
): Route[] | null {
  return state.routeAlternatives;
}

// Recompute reserve mode when the active motorcycle changes, so the badge
// reflects the new bike's tank/consumption immediately.
useMotorcycleStore.subscribe((state, prev) => {
  if (state.activeMotorcycleId !== prev.activeMotorcycleId) {
    useNavigationStore.setState((s) => ({
      ...s,
      isReserveMode: evaluateReserveFromStores(s),
    }));
  }
});
