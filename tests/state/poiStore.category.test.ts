// Mock SQLite so the navigationStore-import-chain doesn't try to open a
// real database file when the poiStore module pulls it in transitively.
jest.mock('@/infrastructure/db/sqlite', () => ({
  openDatabase: async () => ({
    runAsync: async () => {},
    getFirstAsync: async () => null,
    getAllAsync: async () => [],
    execAsync: async () => {},
    withTransactionAsync: async (fn: () => Promise<void>) => {
      await fn();
    },
  }),
}));

// Stub the Overpass client. Spy is exposed so each test can assert which
// (bbox, category) pair the store requested without touching the network.
const mockFetchPoisInBox = jest.fn();
const mockFetchFuelStationsInBox = jest.fn();
jest.mock('@/infrastructure/poi/overpassClient', () => ({
  __esModule: true,
  overpassClient: {
    fetchPoisInBox: (...args: unknown[]) => mockFetchPoisInBox(...args),
    fetchFuelStationsInBox: (...args: unknown[]) =>
      mockFetchFuelStationsInBox(...args),
    clearCache: () => {},
  },
  createOverpassClient: () => ({
    fetchPoisInBox: (...args: unknown[]) => mockFetchPoisInBox(...args),
    fetchFuelStationsInBox: (...args: unknown[]) =>
      mockFetchFuelStationsInBox(...args),
    clearCache: () => {},
  }),
}));

import { usePoiStore } from '../../src/state/poiStore';
import { useNavigationStore } from '../../src/state/navigationStore';
import type { Poi, PoiCategory } from '../../src/domains/poi/types';

function makePoi(
  id: string,
  category: PoiCategory,
  latitude: number,
  longitude: number,
): Poi {
  return { id, category, name: `${category}-${id}`, latitude, longitude };
}

function resetStores(): void {
  useNavigationStore.setState({
    currentPosition: { latitude: -23.55, longitude: -46.65, timestamp: 0 },
    destination: null,
    isNavigating: false,
    distanceTraveledKm: 0,
    isReserveMode: false,
    routeSettings: { type: 'express', allowUnpaved: false },
    activeRoute: null,
    isFetchingRoute: false,
    routeError: null,
    lastReroutedAt: null,
    lastSamplePosition: null,
    currentRouteIndex: 0,
    pendingFuelWaypoint: null,
    originalDestination: null,
  });
  usePoiStore.setState({
    pois: [],
    isFetching: false,
    lastError: null,
    lastFetchedAt: null,
    selectedPoiId: null,
    searchMode: 'along-route',
    searchCategory: 'fuel',
  });
}

describe('poiStore — searchCategory wiring', () => {
  beforeEach(() => {
    resetStores();
    mockFetchPoisInBox.mockReset();
    mockFetchFuelStationsInBox.mockReset();
  });

  it('default state is fuel + along-route', () => {
    const state = usePoiStore.getState();
    expect(state.searchCategory).toBe('fuel');
    expect(state.searchMode).toBe('along-route');
  });

  it('setSearchCategory clears pois/selectedPoiId and triggers a refetch under the current mode', async () => {
    // Seed the store as if a previous fuel search had populated it.
    usePoiStore.setState({
      pois: [
        {
          ...makePoi('seed', 'fuel', -23.55, -46.65),
          distanceFromUserMeters: 100,
          distanceToRouteMeters: 100,
        },
      ],
      selectedPoiId: 'seed',
      searchMode: 'nearby',
      searchCategory: 'fuel',
    });

    mockFetchPoisInBox.mockResolvedValueOnce([
      makePoi('t1', 'tyres', -23.5501, -46.6501),
    ]);

    await usePoiStore.getState().setSearchCategory('tyres');

    expect(mockFetchPoisInBox).toHaveBeenCalledTimes(1);
    const [, calledCategory] = mockFetchPoisInBox.mock.calls[0] as [
      unknown,
      PoiCategory,
    ];
    expect(calledCategory).toBe('tyres');

    const after = usePoiStore.getState();
    expect(after.searchCategory).toBe('tyres');
    expect(after.selectedPoiId).toBeNull();
    expect(after.pois).toHaveLength(1);
    expect(after.pois[0]?.id).toBe('t1');
    // Mode was 'nearby' before the call — must be preserved (the rider is
    // refining the *what*, not the *where*).
    expect(after.searchMode).toBe('nearby');
  });

  it('setSearchCategory is a no-op when the category is unchanged', async () => {
    usePoiStore.setState({ searchCategory: 'mechanic' });
    await usePoiStore.getState().setSearchCategory('mechanic');
    expect(mockFetchPoisInBox).not.toHaveBeenCalled();
  });

  it('setSearchCategory propagates the new category into fetchAlongRoute', async () => {
    // Configure an active route so the along-route branch is taken instead
    // of the degenerate fallback.
    useNavigationStore.setState({
      activeRoute: {
        coordinates: [
          { latitude: -23.55, longitude: -46.65 },
          { latitude: -23.55, longitude: -46.64 },
        ],
        distanceMeters: 1000,
        durationSeconds: 60,
        steps: [],
        fetchedAt: 0,
        cacheHit: false,
      },
    });
    usePoiStore.setState({ searchMode: 'along-route', searchCategory: 'fuel' });

    mockFetchPoisInBox.mockResolvedValueOnce([
      makePoi('m1', 'mechanic', -23.55, -46.645),
    ]);

    await usePoiStore.getState().setSearchCategory('mechanic');

    expect(mockFetchPoisInBox).toHaveBeenCalledTimes(1);
    const [, calledCategory] = mockFetchPoisInBox.mock.calls[0] as [
      unknown,
      PoiCategory,
    ];
    expect(calledCategory).toBe('mechanic');
  });
});
