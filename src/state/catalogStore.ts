import { create } from 'zustand';
import { loadCatalog } from '@/infrastructure/catalog/catalogClient';
import { matchRoutes } from '@/domains/catalog/matcher';
import { osrmClient } from '@/infrastructure/routing/osrmClient';
import type {
  CatalogFilters,
  CatalogRouteMatch,
} from '@/domains/catalog/types';
import type { Route } from '@/domains/routing/types';

/**
 * Hard cap on the number of intermediate waypoints we forward to OSRM when
 * building the preview/full route from a catalog polyline. The public OSRM
 * demo server tolerates a handful of waypoints; we keep the budget tight so
 * a freshly-curated polyline with many vertices still produces a routable
 * request. The "start" stop counts against this budget — see
 * `pickWaypoints` below.
 */
const MAX_PREVIEW_WAYPOINTS = 6;
/**
 * Same cap, but for the combined "start to finish via polyline" request used
 * by `buildFullCatalogRoute`. Here `coordenada_inicio` is forwarded as a
 * waypoint (the OSRM call starts at the rider's GPS) so we keep one slot for
 * it and let `MAX_FULL_WAYPOINTS - 1` polyline vertices fill the remainder.
 */
const MAX_FULL_WAYPOINTS = 7;

export interface PreviewUserPosition {
  latitude: number;
  longitude: number;
}

export interface CatalogStoreState {
  filters: CatalogFilters | null;
  results: CatalogRouteMatch[];
  isSearching: boolean;
  lastError: string | null;
  /**
   * Route id that the user picked from the results list to preview on the
   * map. HomeScreen subscribes to this to render the polyline; cleared via
   * `setPreviewRoute(null)` or when the rider starts a real navigation.
   */
  previewRouteId: string | null;
  /**
   * OSRM-resolved leg from the rider's current position to the previewed
   * catalog route's `coordenada_inicio`. Drawn on the map in the brand
   * accent (orange) so the rider can see how far they are from the route
   * start. `null` while we have not yet fetched it (or the fetch failed —
   * see `previewError`).
   */
  approachRoute: Route | null;
  /**
   * OSRM-resolved trajectory along the catalog route itself: it starts at
   * `coordenada_inicio`, walks through the simplified polyline as waypoints,
   * and ends at `coordenada_fim`. Drawn in blue. Falls back to the raw
   * `polilinha_simplificada` on the consumer side when the OSRM call fails.
   */
  previewRoute: Route | null;
  /**
   * `true` while at least one of the two OSRM requests is in flight. We use
   * a single boolean (rather than per-leg flags) so the UI can render a
   * single "Calculando rota real..." indicator without juggling two
   * spinners.
   */
  isFetchingPreview: boolean;
  /**
   * Human-readable OSRM error captured while fetching either leg. Non-null
   * does NOT clear the existing `approachRoute`/`previewRoute` (so the UI
   * can keep showing whichever leg succeeded) — the consumer is expected to
   * fall back to the raw polyline for whatever is missing.
   */
  previewError: string | null;
  setFilters: (f: CatalogFilters) => void;
  runSearch: () => void;
  clearResults: () => void;
  setPreviewRoute: (id: string | null) => void;
  /**
   * Fetch the two OSRM legs (approach + along-route) for the currently
   * previewed catalog route. No-op when `previewRouteId` is null or the
   * corresponding match is missing. Sets `isFetchingPreview` while in
   * flight and writes `previewError` on failure WITHOUT throwing — the UI
   * can keep rendering the straight-line fallback.
   */
  loadPreviewRoutes: (userPosition: PreviewUserPosition) => Promise<void>;
  /**
   * Wipe every preview-related field at once. Used by HomeScreen when the
   * rider clears the preview or when "INICIAR ROTA" upgrades the preview
   * into a real navigation.
   */
  clearPreview: () => void;
}

/**
 * Pick at most `max` waypoints out of `polyline`, skipping the first and
 * last entries (the caller forwards those as `start`/`end` separately).
 * When the trimmed polyline already fits the budget we return it verbatim;
 * otherwise we walk it with a constant stride so the result is evenly
 * spread along the geometry. Centralised so both `loadPreviewRoutes` and
 * `buildFullCatalogRoute` share the same decimation policy.
 */
function pickWaypoints(
  polyline: ReadonlyArray<{ lat: number; lng: number }>,
  max: number,
): Array<{ latitude: number; longitude: number }> {
  if (polyline.length <= 2 || max <= 0) return [];
  const interior = polyline.slice(1, polyline.length - 1);
  if (interior.length <= max) {
    return interior.map((p) => ({ latitude: p.lat, longitude: p.lng }));
  }
  // Even decimation: pick indices [0, stride, 2*stride, ...] up to `max`.
  // Using a fractional stride avoids clustering near the start of the
  // polyline that a naive integer stride would cause when interior.length
  // is not a multiple of `max`.
  const stride = interior.length / max;
  const out: Array<{ latitude: number; longitude: number }> = [];
  for (let i = 0; i < max; i += 1) {
    const idx = Math.min(interior.length - 1, Math.floor(i * stride));
    const point = interior[idx];
    if (point) {
      out.push({ latitude: point.lat, longitude: point.lng });
    }
  }
  return out;
}

export const useCatalogStore = create<CatalogStoreState>((set, get) => ({
  filters: null,
  results: [],
  isSearching: false,
  lastError: null,
  previewRouteId: null,
  approachRoute: null,
  previewRoute: null,
  isFetchingPreview: false,
  previewError: null,

  setFilters: (f) => {
    set({ filters: f, lastError: null });
  },

  runSearch: () => {
    const { filters } = get();
    if (!filters) {
      set({
        lastError: 'Filtros não definidos',
        results: [],
        isSearching: false,
      });
      return;
    }
    set({ isSearching: true, lastError: null });
    try {
      const catalog = loadCatalog();
      const matches = matchRoutes(catalog, filters);
      set({ results: matches, isSearching: false, lastError: null });
    } catch (err) {
      const message =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'Falha ao carregar o catálogo';
      set({ lastError: message, results: [], isSearching: false });
    }
  },

  clearResults: () => {
    set({ results: [], lastError: null });
  },

  setPreviewRoute: (id) => {
    // Switching the previewed route invalidates any OSRM legs we had cached
    // in the store, so we mark the slot as "fetching" and drop the prior
    // routes. `loadPreviewRoutes` (triggered by HomeScreen) will refill
    // them. Clearing (id === null) goes through `clearPreview` instead.
    if (id === null) {
      set({
        previewRouteId: null,
        approachRoute: null,
        previewRoute: null,
        previewError: null,
        isFetchingPreview: false,
      });
      return;
    }
    set({
      previewRouteId: id,
      approachRoute: null,
      previewRoute: null,
      previewError: null,
      isFetchingPreview: true,
    });
  },

  loadPreviewRoutes: async (userPosition) => {
    const state = get();
    const id = state.previewRouteId;
    if (id === null) return;
    const match = state.results.find((m) => m.route.rota_id === id);
    if (!match) {
      set({
        isFetchingPreview: false,
        previewError: 'Rota não encontrada no catálogo',
      });
      return;
    }

    const start = {
      latitude: match.route.coordenada_inicio.latitude,
      longitude: match.route.coordenada_inicio.longitude,
    };
    const end = {
      latitude: match.route.coordenada_fim.latitude,
      longitude: match.route.coordenada_fim.longitude,
    };
    const polylineWaypoints = pickWaypoints(
      match.route.polilinha_simplificada,
      MAX_PREVIEW_WAYPOINTS,
    );

    set({ isFetchingPreview: true, previewError: null });

    // Fire both legs in parallel — they are independent OSRM lookups and
    // the rider only sees the map after both (or their fallbacks) are in
    // place. `Promise.allSettled` so a failure on one leg does not poison
    // the other.
    const [approachResult, previewResult] = await Promise.allSettled([
      osrmClient.getRoute({ start: userPosition, end: start }),
      osrmClient.getRoute({
        start,
        end,
        ...(polylineWaypoints.length > 0
          ? { waypoints: polylineWaypoints }
          : {}),
      }),
    ]);

    // The store may have moved on (rider tapped another card, cleared the
    // preview) while OSRM was responding. We compare the previewRouteId
    // captured at request time against the live one and drop the response
    // if it changed — this prevents flicker from a stale fetch.
    const livePreviewId = get().previewRouteId;
    if (livePreviewId !== id) return;

    const approachRoute =
      approachResult.status === 'fulfilled' ? approachResult.value : null;
    const previewRoute =
      previewResult.status === 'fulfilled' ? previewResult.value : null;
    let previewError: string | null = null;
    if (approachResult.status === 'rejected') {
      previewError =
        approachResult.reason instanceof Error
          ? approachResult.reason.message
          : 'Falha ao calcular o trecho de aproximação';
    } else if (previewResult.status === 'rejected') {
      previewError =
        previewResult.reason instanceof Error
          ? previewResult.reason.message
          : 'Falha ao calcular o trecho principal';
    }

    set({
      approachRoute,
      previewRoute,
      previewError,
      isFetchingPreview: false,
    });
  },

  clearPreview: () => {
    set({
      previewRouteId: null,
      approachRoute: null,
      previewRoute: null,
      previewError: null,
      isFetchingPreview: false,
    });
  },
}));

/**
 * Find the previewed route's full record (including polyline) given the
 * current store state. Defined as a free-standing selector so screens can
 * use it inside `useCatalogStore(selectPreviewRoute)` with stable identity
 * across renders.
 */
export function selectPreviewRoute(state: CatalogStoreState):
  | CatalogRouteMatch
  | null {
  if (state.previewRouteId === null) return null;
  return (
    state.results.find((m) => m.route.rota_id === state.previewRouteId) ?? null
  );
}

/**
 * Build the single OSRM route that the rider follows when they confirm the
 * preview ("INICIAR ROTA"). The request goes from `userPosition` to
 * `coordenada_fim`, with `coordenada_inicio` + decimated polyline vertices
 * forwarded as waypoints so the resulting `Route` covers user → start →
 * route → finish in one shot. Throws on OSRM failure — the caller is
 * expected to catch and surface an Alert.
 */
export async function buildFullCatalogRoute(
  match: CatalogRouteMatch,
  userPosition: PreviewUserPosition,
): Promise<Route> {
  const start = {
    latitude: match.route.coordenada_inicio.latitude,
    longitude: match.route.coordenada_inicio.longitude,
  };
  const end = {
    latitude: match.route.coordenada_fim.latitude,
    longitude: match.route.coordenada_fim.longitude,
  };
  // Reserve one slot for `coordenada_inicio` itself; the remainder gets
  // filled with evenly decimated polyline vertices so the OSRM trajectory
  // hugs the actual catalog route instead of taking a shortcut.
  const polylineWaypoints = pickWaypoints(
    match.route.polilinha_simplificada,
    Math.max(0, MAX_FULL_WAYPOINTS - 1),
  );
  const waypoints: Array<{ latitude: number; longitude: number }> = [
    start,
    ...polylineWaypoints,
  ];
  return osrmClient.getRoute({
    start: userPosition,
    end,
    waypoints,
  });
}
