import { create, type StoreApi } from 'zustand';
import { loadCatalog } from '@/infrastructure/catalog/catalogClient';
import { matchRoutes } from '@/domains/catalog/matcher';
import { osrmClient } from '@/infrastructure/routing/osrmClient';
import { calculateRouteCost, DEFAULT_FUEL_PRICE_REAIS } from '@/domains/catalog/cost';
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

// Top N matches receive the OSRM refinement pass — past 5 the rider
// rarely scrolls and each match costs 3 OSRM round-trips. Concurrency
// of 2 keeps the public OSRM demo server within its informal rate limit
// while still finishing the top 5 in under ~20 seconds on cellular.
const REFINE_TOP_N = 5;
const REFINE_CONCURRENCY = 2;
const REFINE_WAYPOINTS = 6;

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
  /**
   * Monotonic counter bumped every time the results array is replaced
   * (runSearch, clearResults). The background OSRM refine captures this
   * at start and re-checks before each `set` — mismatched epoch drops the
   * update. Held in state (not module-level) so test resets clear it too.
   */
  refineEpoch: number;
  /**
   * Awaitable handle to the most recent background refine pass. Tests use
   * it to drain microtasks; UI should rely on per-match `isRefining` /
   * `hasRealMetrics` instead of this single global handle.
   */
  pendingRefine: Promise<void> | null;
  setFilters: (f: CatalogFilters) => void;
  runSearch: () => void;
  /**
   * F35.0.C — Aplica filtros default e roda a busca. Usado quando o piloto
   * entra direto no catalogo via Home (sem passar pela tela de filtros).
   * Defaults: orcamento=0 (sem limite, convencao do matcher), preco
   * gasolina=DEFAULT_FUEL_PRICE_REAIS, sem restricao de pavimento/curvas.
   * `motoConsumoKmL` e `motoSafeAutonomyKm` vem do caller (que conhece a
   * moto ativa do piloto) — mantem o store agnostico do motorcycleStore.
   */
  runDefaultSearch: (input: {
    origin: { latitude: number; longitude: number };
    motoConsumoKmL: number;
    motoSafeAutonomyKm: number;
  }) => void;
  clearResults: () => void;
  /**
   * Fire OSRM lookups in the background to upgrade the top-N matches from
   * haversine approximations to real-road metrics. Resolves when every
   * refinement task settles. Production code ignores the return value
   * (runSearch kicks it off implicitly); tests await it. Cancellation is
   * via the `refineEpoch` counter — stale tasks drop their writes.
   */
  refineResultsWithOsrm: () => Promise<void>;
  /**
   * F35.0.D rev3/4 — On-demand OSRM lookup pra UMA rota especifica. Faz ate
   * 2 chamadas em paralelo: leg "rota" (start→polyline→end) sempre, e leg
   * "approach" (userPosition→start) quando `userPosition` e fornecido.
   * Escreve `realRouteCoordinates` e/ou `realApproachCoordinates` no match
   * correspondente. No-op por leg se ja existir coords no match. Idempotente
   * — chamadas concorrentes pro mesmo id sao deduped pelo cache LRU do
   * osrmClient.
   */
  fetchPreviewCoordinates: (
    rotaId: string,
    userPosition?: PreviewUserPosition,
  ) => Promise<void>;
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

/**
 * Refine ONE match: fire approach + route + return legs in parallel via
 * `Promise.allSettled`, then write a complete `real*` set when all three
 * succeed, or a `hasRealMetrics=false` flag drop when any fail. The
 * outcomes are all-or-nothing because mixing one real leg with two
 * haversine legs would confuse the rider. Cancellation: re-check
 * `refineEpoch` before every `set` so a stale response can never mutate
 * a newer results array.
 */
async function refineSingleMatch(
  match: CatalogRouteMatch,
  filters: CatalogFilters,
  epoch: number,
  set: StoreApi<CatalogStoreState>['setState'],
  get: StoreApi<CatalogStoreState>['getState'],
): Promise<void> {
  const start = {
    latitude: match.route.coordenada_inicio.latitude,
    longitude: match.route.coordenada_inicio.longitude,
  };
  const end = {
    latitude: match.route.coordenada_fim.latitude,
    longitude: match.route.coordenada_fim.longitude,
  };
  const waypoints = pickWaypoints(
    match.route.polilinha_simplificada,
    REFINE_WAYPOINTS,
  );

  const routeRequest =
    waypoints.length > 0
      ? { start, end, waypoints }
      : { start, end };

  const [approachResult, routeResult, returnResult] = await Promise.allSettled([
    osrmClient.getRoute({ start: filters.origin, end: start }),
    osrmClient.getRoute(routeRequest),
    osrmClient.getRoute({ start: end, end: filters.origin }),
  ]);

  if (get().refineEpoch !== epoch) return;

  // Defensive: a fulfilled-but-malformed response (missing `distanceMeters`)
  // collapses to the "leg failed" path so NaN cannot enter the cost math.
  const approachMeters =
    approachResult.status === 'fulfilled' &&
    typeof approachResult.value?.distanceMeters === 'number'
      ? approachResult.value.distanceMeters
      : null;
  const routeMeters =
    routeResult.status === 'fulfilled' &&
    typeof routeResult.value?.distanceMeters === 'number'
      ? routeResult.value.distanceMeters
      : null;
  const returnMeters =
    returnResult.status === 'fulfilled' &&
    typeof returnResult.value?.distanceMeters === 'number'
      ? returnResult.value.distanceMeters
      : null;

  // F35.0.D rev3/4 — Persistir as coordenadas das legs "rota" e "approach"
  // assim que cada uma resolve, INDEPENDENTE das outras. O modal de prévia
  // do RouteDetail precisa só dessas coords (rota + approach); antes elas
  // eram descartadas e o modal tinha que refazer o fetch.
  const routeCoordinates =
    routeResult.status === 'fulfilled' &&
    Array.isArray(routeResult.value?.coordinates) &&
    routeResult.value.coordinates.length > 0
      ? routeResult.value.coordinates.map((c) => ({
          latitude: c.latitude,
          longitude: c.longitude,
        }))
      : null;
  const approachCoordinates =
    approachResult.status === 'fulfilled' &&
    Array.isArray(approachResult.value?.coordinates) &&
    approachResult.value.coordinates.length > 0
      ? approachResult.value.coordinates.map((c) => ({
          latitude: c.latitude,
          longitude: c.longitude,
        }))
      : null;
  if (routeCoordinates !== null || approachCoordinates !== null) {
    set((prev) => {
      if (prev.refineEpoch !== epoch) return prev;
      return {
        results: prev.results.map((m) => {
          if (m.route.rota_id !== match.route.rota_id) return m;
          const patch: Partial<CatalogRouteMatch> = {};
          if (routeCoordinates !== null) {
            patch.realRouteCoordinates = routeCoordinates;
          }
          if (approachCoordinates !== null) {
            patch.realApproachCoordinates = approachCoordinates;
          }
          return { ...m, ...patch };
        }),
      };
    });
  }

  if (approachMeters === null || routeMeters === null || returnMeters === null) {
    // Drop the refining flag without metrics; card falls back to haversine.
    set((prev) => {
      if (prev.refineEpoch !== epoch) return prev;
      return {
        results: prev.results.map((m) =>
          m.route.rota_id === match.route.rota_id
            ? { ...m, isRefining: false, hasRealMetrics: false }
            : m,
        ),
      };
    });
    return;
  }

  // All three legs succeeded — rebuild the cost using `calculateRouteCost`
  // so pricing math stays consistent with the matcher's initial estimate.
  const realApproachDistanceKm = approachMeters / 1000;
  const realRouteDistanceKm = routeMeters / 1000;
  const realReturnDistanceKm = returnMeters / 1000;
  const realRoundTripDistanceKm =
    realApproachDistanceKm + realRouteDistanceKm + realReturnDistanceKm;
  const effectiveFuelPrice =
    filters.fuelPricePerLiter > 0
      ? filters.fuelPricePerLiter
      : DEFAULT_FUEL_PRICE_REAIS;
  const breakdown = calculateRouteCost(
    realRoundTripDistanceKm,
    filters.motoConsumoKmL,
    effectiveFuelPrice,
    match.route.total_pedagios_moto_reais,
  );

  set((prev) => {
    if (prev.refineEpoch !== epoch) return prev;
    return {
      results: prev.results.map((m) =>
        m.route.rota_id === match.route.rota_id
          ? {
              ...m,
              realApproachDistanceKm,
              realRouteDistanceKm,
              realReturnDistanceKm,
              realRoundTripDistanceKm,
              realRoundTripFuelLiters: breakdown.liters,
              realRoundTripFuelCostReais: breakdown.fuelCost,
              realRoundTripTotalCostReais: breakdown.totalCost,
              isRefining: false,
              hasRealMetrics: true,
            }
          : m,
      ),
    };
  });
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
  refineEpoch: 0,
  pendingRefine: null,

  setFilters: (f) => {
    set({ filters: f, lastError: null });
  },

  runDefaultSearch: ({ origin, motoConsumoKmL, motoSafeAutonomyKm }) => {
    // F35.0.C — defaults inteligentes: sem limite de orcamento (budget=0 e
    // convencao do matcher pra "sem limite"), sem filtro de pavimento/
    // curvas, preco padrao. Se uma busca anterior ja tinha filtros mais
    // restritivos, ela e SOBRESCRITA — runDefaultSearch e a entrada
    // "limpa" do catalogo.
    const defaults: CatalogFilters = {
      origin,
      budgetReais: 0,
      motoConsumoKmL,
      motoSafeAutonomyKm,
      pavimento: null,
      nivelCurvas: null,
      fuelPricePerLiter: DEFAULT_FUEL_PRICE_REAIS,
    };
    set({ filters: defaults, lastError: null });
    get().runSearch();
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
      // Bump the epoch as the new results land so any in-flight refine
      // from a previous search aborts before stamping stale `real*` fields.
      set((prev) => ({
        results: matches,
        isSearching: false,
        lastError: null,
        refineEpoch: prev.refineEpoch + 1,
      }));
      // Fire-and-forget; stash the promise so tests can drain microtasks.
      const refinePromise = get().refineResultsWithOsrm();
      set({ pendingRefine: refinePromise });
      void refinePromise;
    } catch (err) {
      const message =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'Falha ao carregar o catálogo';
      set((prev) => ({
        lastError: message,
        results: [],
        isSearching: false,
        refineEpoch: prev.refineEpoch + 1,
      }));
    }
  },

  clearResults: () => {
    // Bump the epoch so a pending refine cannot repopulate after a clear.
    set((prev) => ({
      results: [],
      lastError: null,
      refineEpoch: prev.refineEpoch + 1,
    }));
  },

  refineResultsWithOsrm: async () => {
    const startState = get();
    const filters = startState.filters;
    const epoch = startState.refineEpoch;
    if (!filters) return;
    // Keying by id (not index) keeps writes safe against concurrent
    // mutations that change the array length.
    const targets = startState.results.slice(0, REFINE_TOP_N);
    if (targets.length === 0) return;

    // Flip the top-N into the refining state synchronously so the UI shows
    // the placeholder immediately, before any OSRM call resolves.
    const refiningIds = new Set(targets.map((m) => m.route.rota_id));
    set((prev) => {
      if (prev.refineEpoch !== epoch) return prev;
      return {
        results: prev.results.map((m) =>
          refiningIds.has(m.route.rota_id)
            ? { ...m, isRefining: true, hasRealMetrics: false }
            : m,
        ),
      };
    });

    // Bounded-concurrency queue: REFINE_CONCURRENCY workers share a
    // monotonic index. Cheaper than pulling in p-limit and keeps the
    // epoch-check inline so cancellation stays local.
    let nextIndex = 0;
    const runWorker = async (): Promise<void> => {
      while (true) {
        const i = nextIndex;
        nextIndex += 1;
        if (i >= targets.length) return;
        const match = targets[i];
        if (!match) continue;
        if (get().refineEpoch !== epoch) return;
        await refineSingleMatch(match, filters, epoch, set, get);
      }
    };
    const workers: Array<Promise<void>> = [];
    for (let w = 0; w < REFINE_CONCURRENCY; w += 1) {
      workers.push(runWorker());
    }
    await Promise.all(workers);
  },

  fetchPreviewCoordinates: async (rotaId, userPosition) => {
    const state = get();
    const match = state.results.find((m) => m.route.rota_id === rotaId);
    if (!match) return;
    const epoch = state.refineEpoch;
    const start = {
      latitude: match.route.coordenada_inicio.latitude,
      longitude: match.route.coordenada_inicio.longitude,
    };
    const end = {
      latitude: match.route.coordenada_fim.latitude,
      longitude: match.route.coordenada_fim.longitude,
    };

    // Cada leg roda sob seu proprio guard de idempotencia. Se a refine
    // padrao ja gravou as coords da leg correspondente, nada acontece aqui.
    const needsRoute =
      !Array.isArray(match.realRouteCoordinates) ||
      match.realRouteCoordinates.length === 0;
    const needsApproach =
      userPosition !== undefined &&
      (!Array.isArray(match.realApproachCoordinates) ||
        match.realApproachCoordinates.length === 0);

    if (!needsRoute && !needsApproach) return;

    const waypoints = pickWaypoints(
      match.route.polilinha_simplificada,
      REFINE_WAYPOINTS,
    );
    const routeRequest =
      waypoints.length > 0 ? { start, end, waypoints } : { start, end };

    const tasks: Array<Promise<{
      leg: 'route' | 'approach';
      coords: Array<{ latitude: number; longitude: number }> | null;
    }>> = [];

    if (needsRoute) {
      tasks.push(
        osrmClient
          .getRoute(routeRequest)
          .then((r) => ({
            leg: 'route' as const,
            coords: r.coordinates.map((c) => ({
              latitude: c.latitude,
              longitude: c.longitude,
            })),
          }))
          .catch(() => ({ leg: 'route' as const, coords: null })),
      );
    }
    if (needsApproach && userPosition !== undefined) {
      tasks.push(
        osrmClient
          .getRoute({ start: userPosition, end: start })
          .then((r) => ({
            leg: 'approach' as const,
            coords: r.coordinates.map((c) => ({
              latitude: c.latitude,
              longitude: c.longitude,
            })),
          }))
          .catch(() => ({ leg: 'approach' as const, coords: null })),
      );
    }

    const results = await Promise.all(tasks);
    if (get().refineEpoch !== epoch) return;
    const routeCoords = results.find((r) => r.leg === 'route')?.coords ?? null;
    const approachCoords =
      results.find((r) => r.leg === 'approach')?.coords ?? null;
    if (routeCoords === null && approachCoords === null) return;
    set((prev) => {
      if (prev.refineEpoch !== epoch) return prev;
      return {
        results: prev.results.map((m) => {
          if (m.route.rota_id !== rotaId) return m;
          const patch: Partial<CatalogRouteMatch> = {};
          if (routeCoords !== null) patch.realRouteCoordinates = routeCoords;
          if (approachCoords !== null) {
            patch.realApproachCoordinates = approachCoords;
          }
          return { ...m, ...patch };
        }),
      };
    });
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
 * Curried selector factory: returns a state-only function that locates a
 * match by `rota_id` inside `results`. Used by `RouteDetailScreen` to
 * subscribe to a single match — the screen receives `rotaId` from the
 * navigation params, and Zustand calls the inner function on every store
 * change, returning the same reference until the underlying match mutates
 * (e.g. when OSRM refinement upgrades the `real*` fields, which is exactly
 * when we want the detail screen to re-render).
 */
export function selectMatchById(rotaId: string):
  (state: CatalogStoreState) => CatalogRouteMatch | null {
  return (state) =>
    state.results.find((m) => m.route.rota_id === rotaId) ?? null;
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
