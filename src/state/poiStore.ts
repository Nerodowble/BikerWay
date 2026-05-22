import { create } from 'zustand';
import type { FilteredFuelPoi } from '@/domains/poi/geometry';
import {
  fallbackBoundingBox,
  findPoisAlongRoute,
  routeBoundingBox,
} from '@/domains/poi/geometry';
import { overpassClient } from '@/infrastructure/poi/overpassClient';
import { haversineMeters } from '@/shared/utils/haversine';
import type { PoiCategory } from '@/domains/poi/types';
import { useNavigationStore } from './navigationStore';

/** Fallback radius used when the active route is empty or trivial. */
const FALLBACK_HALF_WIDTH_METERS = 5000;
/** Keep POIs within this distance of the rider when in fallback mode. */
const FALLBACK_KEEP_RADIUS_METERS = 3000;
/** Search radius for the explicit "nearby" mode (no route filter). */
const NEARBY_HALF_WIDTH_METERS = 6000;
const NEARBY_KEEP_RADIUS_METERS = 5000;

export type PoiSearchMode = 'along-route' | 'nearby';

/**
 * Zustand store that owns the in-memory POI list (currently fuel stations,
 * tyre shops, or mechanic workshops — selected via `searchCategory`).
 * Designed to be cheap to subscribe to — a single `fetchAlongRoute` /
 * `fetchNearby` mutates `pois`, `isFetching`, `lastError` and
 * `lastFetchedAt`. The store is intentionally route-agnostic in its API:
 * callers don't pass the route; we read it off `useNavigationStore` so
 * triggering a refetch is always a one-liner.
 *
 * Failure semantics:
 *   - No active route or no current position → set `lastError` to a
 *     user-friendly Portuguese string and return early (no Overpass call).
 *   - Overpass / geometry throws → `lastError = err.message`, `pois` left
 *     untouched (we keep the last good list so a transient network blip does
 *     not blank the UI). `isFetching` is ALWAYS cleared in finally.
 */
export interface PoiStoreState {
  pois: FilteredFuelPoi[];
  isFetching: boolean;
  lastError: string | null;
  lastFetchedAt: number | null;
  selectedPoiId: string | null;
  searchMode: PoiSearchMode;
  /**
   * Which category the rider is currently browsing (POSTOS / BORRACHEIROS
   * / OFICINAS). Switching this clears `pois` and triggers a refetch using
   * the current `searchMode`.
   */
  searchCategory: PoiCategory;
  fetchAlongRoute: () => Promise<void>;
  fetchNearby: () => Promise<void>;
  setSearchMode: (mode: PoiSearchMode) => Promise<void>;
  setSearchCategory: (category: PoiCategory) => Promise<void>;
  selectPoi: (id: string | null) => void;
  clearPois: () => void;
}

export const usePoiStore = create<PoiStoreState>((set, get) => ({
  pois: [],
  isFetching: false,
  lastError: null,
  lastFetchedAt: null,
  selectedPoiId: null,
  searchMode: 'along-route',
  searchCategory: 'fuel',

  fetchAlongRoute: async () => {
    set({ searchMode: 'along-route' });
    const category = get().searchCategory;
    const navState = useNavigationStore.getState();
    const activeRoute = navState.activeRoute;
    const currentPosition = navState.currentPosition;
    const currentRouteIndex = navState.currentRouteIndex;

    if (!currentPosition) {
      set({ lastError: 'Nenhuma rota ativa' });
      return;
    }

    // Degenerate route: <2 vertices means findPoisAlongRoute would filter
    // everything out (nearest-vertex distance is +Infinity for an empty
    // route, and a single-point route effectively requires the POI to
    // sit on top of that point). Fall back to a BBOX centered on the
    // rider and rank by haversine distance from the rider.
    const isDegenerate =
      !activeRoute || activeRoute.coordinates.length < 2;
    if (isDegenerate) {
      set({ isFetching: true, lastError: null });
      try {
        const bbox = fallbackBoundingBox(
          currentPosition,
          FALLBACK_HALF_WIDTH_METERS,
        );
        const result = await overpassClient.fetchPoisInBox(bbox, category);
        const userPos = {
          latitude: currentPosition.latitude,
          longitude: currentPosition.longitude,
          timestamp: 0,
        };
        const filtered: FilteredFuelPoi[] = [];
        for (const poi of result) {
          const distanceFromUserMeters = haversineMeters(userPos, {
            latitude: poi.latitude,
            longitude: poi.longitude,
            timestamp: 0,
          });
          if (distanceFromUserMeters > FALLBACK_KEEP_RADIUS_METERS) continue;
          filtered.push({
            ...poi,
            distanceFromUserMeters,
            // No meaningful route to measure against — surface the
            // distance from the rider so the UI still has a useful value.
            distanceToRouteMeters: distanceFromUserMeters,
          });
        }
        filtered.sort(
          (a, b) => a.distanceFromUserMeters - b.distanceFromUserMeters,
        );
        set({ pois: filtered, lastFetchedAt: Date.now() });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({ lastError: message });
      } finally {
        set({ isFetching: false });
      }
      return;
    }

    set({ isFetching: true, lastError: null });

    try {
      const bbox = routeBoundingBox(activeRoute.coordinates);
      const result = await overpassClient.fetchPoisInBox(bbox, category);
      const filtered = findPoisAlongRoute({
        route: activeRoute.coordinates,
        remainingFromIndex: currentRouteIndex,
        currentPosition: {
          latitude: currentPosition.latitude,
          longitude: currentPosition.longitude,
        },
        pois: result,
      });
      set({ pois: filtered, lastFetchedAt: Date.now() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ lastError: message });
    } finally {
      set({ isFetching: false });
    }
  },

  fetchNearby: async () => {
    set({ searchMode: 'nearby' });
    const category = get().searchCategory;
    const navState = useNavigationStore.getState();
    const currentPosition = navState.currentPosition;
    if (!currentPosition) {
      set({ lastError: 'Posição atual desconhecida — habilite o GPS' });
      return;
    }
    set({ isFetching: true, lastError: null });
    try {
      const bbox = fallbackBoundingBox(currentPosition, NEARBY_HALF_WIDTH_METERS);
      const result = await overpassClient.fetchPoisInBox(bbox, category);
      const userPos = {
        latitude: currentPosition.latitude,
        longitude: currentPosition.longitude,
        timestamp: 0,
      };
      const filtered: FilteredFuelPoi[] = [];
      for (const poi of result) {
        const distanceFromUserMeters = haversineMeters(userPos, {
          latitude: poi.latitude,
          longitude: poi.longitude,
          timestamp: 0,
        });
        if (distanceFromUserMeters > NEARBY_KEEP_RADIUS_METERS) continue;
        filtered.push({
          ...poi,
          distanceFromUserMeters,
          distanceToRouteMeters: distanceFromUserMeters,
        });
      }
      filtered.sort(
        (a, b) => a.distanceFromUserMeters - b.distanceFromUserMeters,
      );
      set({ pois: filtered, lastFetchedAt: Date.now() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ lastError: message });
    } finally {
      set({ isFetching: false });
    }
  },

  setSearchMode: async (mode) => {
    if (get().searchMode === mode) return;
    if (mode === 'nearby') {
      await get().fetchNearby();
    } else {
      await get().fetchAlongRoute();
    }
  },

  setSearchCategory: async (category) => {
    if (get().searchCategory === category) return;
    // Wipe the previous category's POIs immediately so the UI does not
    // briefly show borracheiros under a "Postos próximos" header during
    // the next Overpass round-trip. The fetch below will repopulate
    // `pois` once the network call resolves.
    set({
      searchCategory: category,
      pois: [],
      selectedPoiId: null,
      lastError: null,
    });
    const mode = get().searchMode;
    if (mode === 'nearby') {
      await get().fetchNearby();
    } else {
      await get().fetchAlongRoute();
    }
  },

  selectPoi: (id) => {
    set({ selectedPoiId: id });
  },

  clearPois: () => {
    set({
      pois: [],
      selectedPoiId: null,
      lastError: null,
      lastFetchedAt: null,
    });
  },
}));

// Discard cached POIs whenever the active route reference changes (new
// search, reroute, or cleared). Without this, a fresh route would briefly
// show the previous trip's stations until the next fetchAlongRoute() call
// completes. Uses zustand's basic `(state, prev)` subscribe signature —
// mirrors the motorcycle-change subscription at the bottom of
// navigationStore.ts.
useNavigationStore.subscribe((state, prev) => {
  if (state.activeRoute !== prev.activeRoute) {
    usePoiStore.getState().clearPois();
  }
});
