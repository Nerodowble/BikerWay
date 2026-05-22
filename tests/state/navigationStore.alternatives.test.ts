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

// We do not exercise OSRM in these tests, but the store imports the
// singleton at module load time. Stub it so the test never hits the
// network and any accidental call surfaces as a clear failure.
const mockGetRoute = jest.fn();
const mockGetRouteAlternatives = jest.fn();
jest.mock('@/infrastructure/routing/osrmClient', () => ({
  __esModule: true,
  osrmClient: {
    getRoute: (...args: unknown[]) => mockGetRoute(...args),
    getRouteAlternatives: (...args: unknown[]) =>
      mockGetRouteAlternatives(...args),
    clearCache: () => {},
  },
  createOsrmClient: () => ({
    getRoute: (...args: unknown[]) => mockGetRoute(...args),
    getRouteAlternatives: (...args: unknown[]) =>
      mockGetRouteAlternatives(...args),
    clearCache: () => {},
  }),
}));

import {
  selectRouteAlternatives,
  useNavigationStore,
} from '../../src/state/navigationStore';
import type { Route } from '../../src/domains/routing/types';

function makeRoute(overrides: Partial<Route> = {}): Route {
  return {
    coordinates: [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
    ],
    distanceMeters: 1000,
    durationSeconds: 60,
    steps: [],
    fetchedAt: 0,
    cacheHit: false,
    ...overrides,
  };
}

function resetStore(): void {
  useNavigationStore.setState({
    currentPosition: null,
    destination: null,
    isNavigating: false,
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
  });
}

describe('navigationStore — route alternatives (multi-route picker)', () => {
  beforeEach(() => {
    resetStore();
    mockGetRoute.mockReset();
    mockGetRouteAlternatives.mockReset();
  });

  it('starts with routeAlternatives = null', () => {
    expect(useNavigationStore.getState().routeAlternatives).toBeNull();
    expect(selectRouteAlternatives(useNavigationStore.getState())).toBeNull();
  });

  it('setRouteAlternatives upserts an array of routes', () => {
    const alts: Route[] = [
      makeRoute({ distanceMeters: 1000, sinuosityScore: 10 }),
      makeRoute({ distanceMeters: 2000, sinuosityScore: 90 }),
    ];

    useNavigationStore.getState().setRouteAlternatives(alts);

    const next = useNavigationStore.getState().routeAlternatives;
    expect(next).not.toBeNull();
    expect(next).toHaveLength(2);
    expect(next?.[0]?.distanceMeters).toBe(1000);
    expect(next?.[1]?.sinuosityScore).toBe(90);
    // Same array identity preserved — the store does not clone.
    expect(next).toBe(alts);
  });

  it('setRouteAlternatives(null) clears the array', () => {
    useNavigationStore.getState().setRouteAlternatives([makeRoute()]);
    expect(useNavigationStore.getState().routeAlternatives).not.toBeNull();

    useNavigationStore.getState().setRouteAlternatives(null);
    expect(useNavigationStore.getState().routeAlternatives).toBeNull();
  });

  it('setActiveRoute(non-null) clears the pending alternatives', () => {
    const alts: Route[] = [makeRoute(), makeRoute({ distanceMeters: 2000 })];
    const chosen = makeRoute({ distanceMeters: 3000 });

    useNavigationStore.getState().setRouteAlternatives(alts);
    expect(useNavigationStore.getState().routeAlternatives).toHaveLength(2);

    useNavigationStore.getState().setActiveRoute(chosen);

    const after = useNavigationStore.getState();
    expect(after.activeRoute).toBe(chosen);
    expect(after.routeAlternatives).toBeNull();
    expect(after.currentRouteIndex).toBe(0);
  });

  it('setActiveRoute(null) does NOT clear the pending alternatives', () => {
    const alts: Route[] = [makeRoute()];
    useNavigationStore.getState().setActiveRoute(makeRoute());
    useNavigationStore.getState().setRouteAlternatives(alts);

    expect(useNavigationStore.getState().routeAlternatives).toHaveLength(1);
    expect(useNavigationStore.getState().activeRoute).not.toBeNull();

    useNavigationStore.getState().setActiveRoute(null);

    const after = useNavigationStore.getState();
    // activeRoute is wiped but the picker can still surface its options.
    expect(after.activeRoute).toBeNull();
    expect(after.routeAlternatives).toBe(alts);
    expect(after.currentRouteIndex).toBe(0);
  });

  it('stopNavigation clears the pending alternatives', () => {
    const alts: Route[] = [makeRoute(), makeRoute()];
    useNavigationStore.getState().setRouteAlternatives(alts);
    useNavigationStore.setState({ isNavigating: true });

    useNavigationStore.getState().stopNavigation();

    const after = useNavigationStore.getState();
    expect(after.routeAlternatives).toBeNull();
    expect(after.isNavigating).toBe(false);
    expect(after.activeRoute).toBeNull();
  });
});
