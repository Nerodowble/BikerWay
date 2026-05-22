import type {
  CatalogFilters,
  CatalogPolylinePoint,
  CatalogRoute,
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
  });
}

const defaultFilters: CatalogFilters = {
  origin: { latitude: -23.5, longitude: -46.6 },
  budgetReais: 0,
  motoConsumoKmL: 25,
  motoSafeAutonomyKm: 200,
  pavimento: null,
  nivelCurvas: null,
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
      // First call → approach (rider GPS → route start); second call → main
      // (start → polyline waypoints → end). The order matters because the
      // store fires them in that sequence inside Promise.allSettled.
      mockGetRoute
        .mockResolvedValueOnce(approachRoute)
        .mockResolvedValueOnce(mainRoute);

      const store = useCatalogStore.getState();
      store.setFilters(defaultFilters);
      store.runSearch();
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
});
