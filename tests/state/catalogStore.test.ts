import type {
  CatalogFilters,
  CatalogPolylinePoint,
  CatalogRoute,
  CatalogRouteMatch,
} from '../../src/domains/catalog/types';
import type { Route } from '../../src/domains/routing/types';

function makeRoute(
  id: string,
  startLat: number,
  startLng: number,
  polyline: CatalogPolylinePoint[] = [],
): CatalogRoute {
  return {
    rota_id: id,
    nome_rota: id,
    estado_pais: 'SP, Brasil',
    coordenada_inicio: { cidade: 'X', latitude: startLat, longitude: startLng },
    coordenada_fim: { cidade: 'Y', latitude: 0, longitude: 0 },
    distancia_total_km: 50,
    total_pedagios_moto_reais: 0,
    caracteristicas: {
      tipo_pavimento: 'asfalto',
      nivel_curvas: 'medio',
      trecho_critico_sem_posto_km: 10,
    },
    interconexoes_ids: [],
    pontos_apoio_homologados: [],
    polilinha_simplificada: polyline,
  };
}

function makeMockRoute(
  distanceMeters: number = 1000,
  durationSeconds: number = 60,
): Route {
  return {
    coordinates: [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
    ],
    distanceMeters,
    durationSeconds,
    steps: [],
    fetchedAt: 0,
    cacheHit: false,
  };
}

const fakeCatalog = [
  makeRoute('near', -23.51, -46.61),
  makeRoute('far', -28.0, -49.0),
];

// We mock the catalog client so the store doesn't depend on the bundled JSON
// during unit tests. This also lets us simulate the validation-failure branch.
const mockLoadCatalog = jest.fn<CatalogRoute[], []>(() => fakeCatalog);
jest.mock('@/infrastructure/catalog/catalogClient', () => ({
  __esModule: true,
  loadCatalog: () => mockLoadCatalog(),
}));

// OSRM stub. Exposed as a jest.fn so each test can configure its return /
// reject behavior independently. Both `getRoute` and (unused here)
// `getRouteAlternatives` route through the same spy for parity with the
// other store tests in the suite.
const mockGetRoute = jest.fn();
jest.mock('@/infrastructure/routing/osrmClient', () => ({
  __esModule: true,
  osrmClient: {
    getRoute: (...args: unknown[]) => mockGetRoute(...args),
    getRouteAlternatives: jest.fn(),
    clearCache: () => {},
  },
  createOsrmClient: () => ({
    getRoute: (...args: unknown[]) => mockGetRoute(...args),
    getRouteAlternatives: jest.fn(),
    clearCache: () => {},
  }),
}));

import {
  selectPreviewRoute,
  useCatalogStore,
} from '../../src/state/catalogStore';

function resetStore(): void {
  useCatalogStore.setState({
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
  });
}

const defaultFilters: CatalogFilters = {
  origin: { latitude: -23.5, longitude: -46.6 },
  budgetReais: 0,
  motoConsumoKmL: 25,
  motoSafeAutonomyKm: 200,
  pavimento: null,
  nivelCurvas: null,
  fuelPricePerLiter: 6.0,
};

describe('catalogStore', () => {
  beforeEach(() => {
    resetStore();
    mockLoadCatalog.mockReset();
    mockLoadCatalog.mockReturnValue(fakeCatalog);
    mockGetRoute.mockReset();
  });

  it('runSearch populates results sorted by proximity', () => {
    const store = useCatalogStore.getState();
    store.setFilters(defaultFilters);
    store.runSearch();

    const state = useCatalogStore.getState();
    expect(state.isSearching).toBe(false);
    expect(state.lastError).toBeNull();
    expect(state.results.length).toBe(2);
    expect(state.results[0]?.route.rota_id).toBe('near');
    expect(state.results[1]?.route.rota_id).toBe('far');
  });

  it('runSearch surfaces an error when no filters are set', () => {
    const store = useCatalogStore.getState();
    store.runSearch();
    const state = useCatalogStore.getState();
    expect(state.lastError).toBe('Filtros não definidos');
    expect(state.results).toEqual([]);
  });

  it('runSearch captures catalog client failures', () => {
    mockLoadCatalog.mockImplementation(() => {
      throw new Error('boom');
    });
    const store = useCatalogStore.getState();
    store.setFilters(defaultFilters);
    store.runSearch();
    const state = useCatalogStore.getState();
    expect(state.lastError).toBe('boom');
    expect(state.results).toEqual([]);
    expect(state.isSearching).toBe(false);
  });

  it('clearResults wipes the results array and error state', () => {
    const store = useCatalogStore.getState();
    store.setFilters(defaultFilters);
    store.runSearch();
    expect(useCatalogStore.getState().results.length).toBe(2);
    store.clearResults();
    expect(useCatalogStore.getState().results).toEqual([]);
    expect(useCatalogStore.getState().lastError).toBeNull();
  });

  it('setPreviewRoute toggles the previewed id and works with the selector', () => {
    const store = useCatalogStore.getState();
    store.setFilters(defaultFilters);
    store.runSearch();
    store.setPreviewRoute('near');
    let state = useCatalogStore.getState();
    expect(state.previewRouteId).toBe('near');
    const preview = selectPreviewRoute(state);
    expect(preview?.route.rota_id).toBe('near');
    store.setPreviewRoute(null);
    state = useCatalogStore.getState();
    expect(state.previewRouteId).toBeNull();
    expect(selectPreviewRoute(state)).toBeNull();
  });

  describe('loadPreviewRoutes', () => {
    const polylineCatalog = [
      makeRoute('with-poly', -23.51, -46.61, [
        { lat: -23.51, lng: -46.61 },
        { lat: -23.52, lng: -46.62 },
        { lat: -23.53, lng: -46.63 },
        { lat: -23.54, lng: -46.64 },
        { lat: -23.55, lng: -46.65 },
      ]),
    ];

    beforeEach(() => {
      mockLoadCatalog.mockReturnValue(polylineCatalog);
    });

    it('populates approachRoute and previewRoute on success and toggles isFetchingPreview', async () => {
      const approachRoute = makeMockRoute(5000, 600);
      const mainRoute = makeMockRoute(32000, 2400);
      // runSearch now auto-fires `refineResultsWithOsrm` in the background,
      // which consumes 3 OSRM calls per top-N match. We give those calls a
      // generic resolved value (its identity is irrelevant to this test),
      // then drain the refine via `pendingRefine` before queueing the
      // specific approach/main fixtures for `loadPreviewRoutes`.
      mockGetRoute.mockResolvedValue(makeMockRoute(1, 1));

      const store = useCatalogStore.getState();
      store.setFilters(defaultFilters);
      store.runSearch();
      // Drain the auto-fired refine so the call counter starts fresh below.
      await useCatalogStore.getState().pendingRefine;
      mockGetRoute.mockReset();
      mockGetRoute
        .mockResolvedValueOnce(approachRoute)
        .mockResolvedValueOnce(mainRoute);

      store.setPreviewRoute('with-poly');
      // After setPreviewRoute we expect the fetching flag to be true and
      // the prior routes wiped so the UI shows a loading state.
      expect(useCatalogStore.getState().isFetchingPreview).toBe(true);
      expect(useCatalogStore.getState().approachRoute).toBeNull();
      expect(useCatalogStore.getState().previewRoute).toBeNull();

      await useCatalogStore.getState().loadPreviewRoutes({
        latitude: -23.5,
        longitude: -46.6,
      });

      const state = useCatalogStore.getState();
      expect(state.approachRoute).toBe(approachRoute);
      expect(state.previewRoute).toBe(mainRoute);
      expect(state.isFetchingPreview).toBe(false);
      expect(state.previewError).toBeNull();
      // Sanity check the OSRM contract: the approach leg uses the rider's
      // position as start and the catalog start coordinate as end, while
      // the main leg ships the decimated polyline as waypoints.
      expect(mockGetRoute).toHaveBeenCalledTimes(2);
      const approachCall = mockGetRoute.mock.calls[0]?.[0] as {
        start: { latitude: number };
        end: { latitude: number };
      };
      expect(approachCall.start.latitude).toBe(-23.5);
      expect(approachCall.end.latitude).toBe(-23.51);
      const mainCall = mockGetRoute.mock.calls[1]?.[0] as {
        start: { latitude: number };
        end: { latitude: number };
        waypoints?: Array<{ latitude: number; longitude: number }>;
      };
      expect(mainCall.start.latitude).toBe(-23.51);
      expect(mainCall.waypoints?.length ?? 0).toBeGreaterThan(0);
      // Polyline had 5 points: 2 endpoints + 3 interior; with the budget
      // of 6 waypoints we keep all 3 interior ones.
      expect(mainCall.waypoints?.length).toBe(3);
    });

    it('captures OSRM failure as previewError without crashing or clearing the previewed id', async () => {
      mockGetRoute.mockRejectedValue(new Error('OSRM offline'));
      const store = useCatalogStore.getState();
      store.setFilters(defaultFilters);
      store.runSearch();
      store.setPreviewRoute('with-poly');

      await useCatalogStore.getState().loadPreviewRoutes({
        latitude: -23.5,
        longitude: -46.6,
      });

      const state = useCatalogStore.getState();
      expect(state.previewRouteId).toBe('with-poly');
      expect(state.approachRoute).toBeNull();
      expect(state.previewRoute).toBeNull();
      expect(state.isFetchingPreview).toBe(false);
      expect(state.previewError).toBe('OSRM offline');
    });

    it('clearPreview wipes id, routes, error, and fetching flag in one shot', async () => {
      mockGetRoute
        .mockResolvedValueOnce(makeMockRoute())
        .mockResolvedValueOnce(makeMockRoute());
      const store = useCatalogStore.getState();
      store.setFilters(defaultFilters);
      store.runSearch();
      store.setPreviewRoute('with-poly');
      await useCatalogStore.getState().loadPreviewRoutes({
        latitude: -23.5,
        longitude: -46.6,
      });
      expect(useCatalogStore.getState().approachRoute).not.toBeNull();

      useCatalogStore.getState().clearPreview();
      const state = useCatalogStore.getState();
      expect(state.previewRouteId).toBeNull();
      expect(state.approachRoute).toBeNull();
      expect(state.previewRoute).toBeNull();
      expect(state.isFetchingPreview).toBe(false);
      expect(state.previewError).toBeNull();
    });

    it('is a no-op when previewRouteId is null', async () => {
      mockGetRoute.mockResolvedValue(makeMockRoute());
      // No setPreviewRoute call → id stays null. loadPreviewRoutes must
      // bail out silently without firing any OSRM request.
      await useCatalogStore.getState().loadPreviewRoutes({
        latitude: -23.5,
        longitude: -46.6,
      });
      expect(mockGetRoute).not.toHaveBeenCalled();
      expect(useCatalogStore.getState().approachRoute).toBeNull();
    });
  });

  describe('refineResultsWithOsrm', () => {
    // Build a catalog with N entries so the top-N cap is testable. Each
    // route's start coordinate is slightly south of São Paulo so the
    // matcher's proximity sort is deterministic (ascending lat distance).
    function makeBigCatalog(n: number): CatalogRoute[] {
      const out: CatalogRoute[] = [];
      for (let i = 0; i < n; i += 1) {
        out.push(makeRoute(`route-${i}`, -23.51 - i * 0.01, -46.61));
      }
      return out;
    }

    it('writes real* metrics onto the match when all 3 OSRM legs succeed', async () => {
      mockLoadCatalog.mockReturnValue([
        makeRoute('rt', -23.51, -46.61),
      ]);
      // Three distinct distances so we can verify the round-trip is the sum
      // of the legs (and rule out the matcher feeding haversine into them).
      const approach = makeMockRoute(4000, 300); // 4 km
      const main = makeMockRoute(60000, 3600); // 60 km
      const ret = makeMockRoute(5000, 360); // 5 km
      mockGetRoute
        .mockResolvedValueOnce(approach)
        .mockResolvedValueOnce(main)
        .mockResolvedValueOnce(ret);

      const store = useCatalogStore.getState();
      store.setFilters(defaultFilters);
      store.runSearch();
      // runSearch fires refineResultsWithOsrm internally and exposes the
      // resulting promise as `pendingRefine`. Awaiting it drains every
      // microtask the refine spawned.
      await useCatalogStore.getState().pendingRefine;

      const match = useCatalogStore.getState().results[0];
      expect(match).toBeDefined();
      if (!match) return;
      expect(match.hasRealMetrics).toBe(true);
      expect(match.isRefining).toBe(false);
      expect(match.realApproachDistanceKm).toBeCloseTo(4, 5);
      expect(match.realRouteDistanceKm).toBeCloseTo(60, 5);
      expect(match.realReturnDistanceKm).toBeCloseTo(5, 5);
      expect(match.realRoundTripDistanceKm).toBeCloseTo(69, 5);
      // Cost math: 69 km / 25 km/L * 6 R$/L + 0 toll ≈ R$16.56.
      expect(match.realRoundTripFuelLiters).toBeCloseTo(69 / 25, 5);
      expect(match.realRoundTripTotalCostReais).toBeCloseTo(
        (69 / 25) * defaultFilters.fuelPricePerLiter,
        5,
      );
    });

    it('leaves hasRealMetrics false when any OSRM leg fails', async () => {
      mockLoadCatalog.mockReturnValue([
        makeRoute('rt', -23.51, -46.61),
      ]);
      // First two succeed, return leg rejects — the all-or-nothing rule
      // should suppress writing partial real metrics so the card keeps
      // showing the haversine baseline.
      mockGetRoute
        .mockResolvedValueOnce(makeMockRoute(4000, 300))
        .mockResolvedValueOnce(makeMockRoute(60000, 3600))
        .mockRejectedValueOnce(new Error('OSRM offline'));

      const store = useCatalogStore.getState();
      store.setFilters(defaultFilters);
      store.runSearch();
      await useCatalogStore.getState().pendingRefine;

      const match = useCatalogStore.getState().results[0];
      expect(match).toBeDefined();
      if (!match) return;
      expect(match.hasRealMetrics).toBe(false);
      expect(match.isRefining).toBe(false);
      expect(match.realRoundTripDistanceKm).toBeUndefined();
      expect(match.realRoundTripTotalCostReais).toBeUndefined();
    });

    it('caps refinement at the top 5 matches even when more are present', async () => {
      mockLoadCatalog.mockReturnValue(makeBigCatalog(10));
      // Every OSRM call succeeds. We just need to count invocations: 5
      // matches * 3 legs = 15 OSRM calls, no more.
      mockGetRoute.mockResolvedValue(makeMockRoute(1000, 60));

      const store = useCatalogStore.getState();
      store.setFilters(defaultFilters);
      store.runSearch();
      await useCatalogStore.getState().pendingRefine;

      expect(mockGetRoute).toHaveBeenCalledTimes(15);
      const results = useCatalogStore.getState().results;
      // Top 5 refined, tail untouched.
      for (let i = 0; i < 5; i += 1) {
        expect(results[i]?.hasRealMetrics).toBe(true);
      }
      for (let i = 5; i < results.length; i += 1) {
        expect(results[i]?.hasRealMetrics).toBeUndefined();
        expect(results[i]?.isRefining).toBeUndefined();
      }
    });

    it('cancels stale refine writes via the epoch counter when runSearch fires again', async () => {
      mockLoadCatalog.mockReturnValue([
        makeRoute('rt', -23.51, -46.61),
      ]);
      // Stage 1: hold the OSRM responses behind a manual gate so the
      // auto-fired refine awaits forever — this gives us a window to
      // bump the epoch via clearResults before the writes are attempted.
      let releasePending: ((route: Route) => void) | null = null;
      const pendingResponse = new Promise<Route>((resolve) => {
        releasePending = resolve;
      });
      mockGetRoute.mockImplementation(() => pendingResponse);

      const store = useCatalogStore.getState();
      store.setFilters(defaultFilters);
      store.runSearch();
      const stalePromise = useCatalogStore.getState().pendingRefine;
      const epochBefore = useCatalogStore.getState().refineEpoch;

      // Stage 2: bump the epoch via clearResults so the stale refine sees
      // a moved-on store when it eventually wakes up. clearResults is a
      // safer bump than a second runSearch because it does not fire a new
      // refine task whose OSRM calls would also block on the same gate.
      store.clearResults();
      expect(useCatalogStore.getState().refineEpoch).toBe(epochBefore + 1);

      // Stage 3: re-populate the results with a fresh match (no real*
      // flags). Any stale write that ignored the epoch check would land
      // here because the id matches — that is the regression we are
      // guarding against.
      const freshMatch: CatalogRouteMatch = {
        route: makeRoute('rt', -23.51, -46.61),
        distanceToStartKm: 0,
        estimatedFuelLiters: 0,
        estimatedFuelCostReais: 0,
        estimatedTotalCostReais: 0,
        approachDistanceKm: 0,
        returnDistanceKm: 0,
        roundTripDistanceKm: 50,
        roundTripFuelLiters: 0,
        roundTripFuelCostReais: 0,
        roundTripTotalCostReais: 0,
        fuelPricePerLiter: 6,
        autonomyWarning: false,
        overBudget: false,
      };
      useCatalogStore.setState({ results: [freshMatch] });

      // Stage 4: release the OSRM gate. The stale refine wakes up, sees
      // the bumped epoch, and exits silently without touching the
      // freshly-injected match.
      if (releasePending) {
        (releasePending as (route: Route) => void)(makeMockRoute(1000, 60));
      }
      await stalePromise;

      const matchAfter = useCatalogStore.getState().results[0];
      expect(matchAfter).toBeDefined();
      if (!matchAfter) return;
      expect(matchAfter.hasRealMetrics).toBeUndefined();
      expect(matchAfter.realRoundTripDistanceKm).toBeUndefined();
      // isRefining was set to true by the stale task's initial sync set
      // (before clearResults landed), but clearResults wiped that match
      // entirely. The freshly-injected match never had the flag set.
      expect(matchAfter.isRefining).toBeUndefined();
    });

    it('refineResultsWithOsrm is a no-op when filters are null', async () => {
      // No setFilters call → refine must bail without touching mockGetRoute.
      await useCatalogStore.getState().refineResultsWithOsrm();
      expect(mockGetRoute).not.toHaveBeenCalled();
    });
  });
});
