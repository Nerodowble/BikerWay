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

// Deterministic OSRM stub. Spy is exposed so each test can assert the
// arguments (especially `waypoints`) without hitting the network.
const mockGetRoute = jest.fn();
jest.mock('@/infrastructure/routing/osrmClient', () => ({
  __esModule: true,
  osrmClient: {
    getRoute: (...args: unknown[]) => mockGetRoute(...args),
    clearCache: () => {},
  },
  createOsrmClient: () => ({
    getRoute: (...args: unknown[]) => mockGetRoute(...args),
    clearCache: () => {},
  }),
}));

import { useNavigationStore } from '../../src/state/navigationStore';
import type { GeoPosition } from '../../src/domains/navigation/types';
import type { Route } from '../../src/domains/routing/types';
import type { FuelPoi } from '../../src/domains/poi/types';

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

function makePos(latitude: number, longitude: number): GeoPosition {
  return { latitude, longitude, timestamp: 0 };
}

function makeFuelPoi(
  id: string,
  latitude: number,
  longitude: number,
): FuelPoi {
  return { id, category: 'fuel', name: `Posto ${id}`, latitude, longitude };
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
    isFetchingRoute: false,
    routeError: null,
    lastReroutedAt: null,
    lastSamplePosition: null,
    currentRouteIndex: 0,
    pendingFuelWaypoint: null,
    originalDestination: null,
  });
}

describe('navigationStore — RF05 fuel waypoint detour', () => {
  beforeEach(() => {
    resetStore();
    mockGetRoute.mockReset();
  });

  it('injectFuelWaypoint without destination is a no-op (sets routeError)', async () => {
    const store = useNavigationStore.getState();
    store.setCurrentPosition(makePos(0, 0));
    // destination intentionally null

    const poi = makeFuelPoi('p1', 0.001, 0);
    await useNavigationStore.getState().injectFuelWaypoint(poi);

    const after = useNavigationStore.getState();
    expect(after.routeError).toBe('Sem posição ou destino para desviar');
    expect(after.pendingFuelWaypoint).toBeNull();
    expect(after.originalDestination).toBeNull();
    expect(after.activeRoute).toBeNull();
    expect(mockGetRoute).not.toHaveBeenCalled();
  });

  it('injectFuelWaypoint with position + destination calls osrm with waypoint and sets state', async () => {
    const dest = makePos(0, 0.02);
    const poi = makeFuelPoi('p1', 0.001, 0.005);
    const stubRoute = makeRoute();
    mockGetRoute.mockResolvedValueOnce(stubRoute);

    const store = useNavigationStore.getState();
    store.setCurrentPosition(makePos(0, 0));
    store.setDestination(dest);

    await useNavigationStore.getState().injectFuelWaypoint(poi);

    const after = useNavigationStore.getState();
    expect(after.pendingFuelWaypoint).toEqual(poi);
    expect(after.originalDestination).toEqual(dest);
    expect(after.activeRoute).toBe(stubRoute);
    expect(after.isFetchingRoute).toBe(false);
    expect(after.lastReroutedAt).not.toBeNull();

    expect(mockGetRoute).toHaveBeenCalledTimes(1);
    const callArg = mockGetRoute.mock.calls[0]?.[0] as {
      start: { latitude: number; longitude: number };
      end: { latitude: number; longitude: number };
      waypoints?: Array<{ latitude: number; longitude: number }>;
    };
    expect(callArg.start).toEqual({ latitude: 0, longitude: 0 });
    expect(callArg.end).toEqual({ latitude: dest.latitude, longitude: dest.longitude });
    expect(callArg.waypoints).toEqual([
      { latitude: poi.latitude, longitude: poi.longitude },
    ]);
  });

  it('second injectFuelWaypoint preserves the FIRST saved originalDestination', async () => {
    const firstDest = makePos(0, 0.05);
    const poi1 = makeFuelPoi('p1', 0.001, 0.01);
    const poi2 = makeFuelPoi('p2', 0.002, 0.02);
    mockGetRoute.mockResolvedValue(makeRoute());

    const store = useNavigationStore.getState();
    store.setCurrentPosition(makePos(0, 0));
    store.setDestination(firstDest);

    await useNavigationStore.getState().injectFuelWaypoint(poi1);
    expect(useNavigationStore.getState().originalDestination).toEqual(firstDest);

    // Simulate the store getting a different `destination` later (e.g. the
    // detour route's end-of-leg gets bound to destination by some screen
    // logic). The second inject must still target the originally saved one.
    useNavigationStore.getState().setDestination(makePos(0, 0.99));

    await useNavigationStore.getState().injectFuelWaypoint(poi2);

    const after = useNavigationStore.getState();
    expect(after.originalDestination).toEqual(firstDest);
    expect(after.pendingFuelWaypoint).toEqual(poi2);
    // And the OSRM call for poi2 must use firstDest as the end.
    const lastCall = mockGetRoute.mock.calls[mockGetRoute.mock.calls.length - 1]?.[0] as {
      end: { latitude: number; longitude: number };
    };
    expect(lastCall.end).toEqual({
      latitude: firstDest.latitude,
      longitude: firstDest.longitude,
    });
  });

  it('removeFuelWaypoint clears state and refetches straight route', async () => {
    const dest = makePos(0, 0.02);
    const poi = makeFuelPoi('p1', 0.001, 0.005);
    const detourRoute = makeRoute({ distanceMeters: 2000 });
    const restoredRoute = makeRoute({ distanceMeters: 1500 });
    mockGetRoute
      .mockResolvedValueOnce(detourRoute)
      .mockResolvedValueOnce(restoredRoute);

    const store = useNavigationStore.getState();
    store.setCurrentPosition(makePos(0, 0));
    store.setDestination(dest);

    await useNavigationStore.getState().injectFuelWaypoint(poi);
    expect(useNavigationStore.getState().pendingFuelWaypoint).not.toBeNull();
    expect(useNavigationStore.getState().originalDestination).toEqual(dest);

    await useNavigationStore.getState().removeFuelWaypoint();

    const after = useNavigationStore.getState();
    expect(after.pendingFuelWaypoint).toBeNull();
    expect(after.originalDestination).toBeNull();
    expect(after.activeRoute).toBe(restoredRoute);

    // The second OSRM call must NOT carry a waypoint (straight restore).
    const restoreCall = mockGetRoute.mock.calls[1]?.[0] as {
      waypoints?: Array<{ latitude: number; longitude: number }>;
      end: { latitude: number; longitude: number };
    };
    expect(restoreCall.waypoints).toBeUndefined();
    expect(restoreCall.end).toEqual({
      latitude: dest.latitude,
      longitude: dest.longitude,
    });
  });

  it('confirmFuelArrival zeroes the odometer AND clears the waypoint', async () => {
    const dest = makePos(0, 0.02);
    const poi = makeFuelPoi('p1', 0.001, 0.005);
    mockGetRoute.mockResolvedValue(makeRoute());

    const store = useNavigationStore.getState();
    store.setCurrentPosition(makePos(0, 0));
    store.setDestination(dest);
    // Seed some accumulated distance so we can prove resetTrip ran.
    useNavigationStore.setState({ distanceTraveledKm: 42.5 });

    await useNavigationStore.getState().injectFuelWaypoint(poi);
    expect(useNavigationStore.getState().pendingFuelWaypoint).not.toBeNull();

    await useNavigationStore.getState().confirmFuelArrival();

    const after = useNavigationStore.getState();
    expect(after.distanceTraveledKm).toBe(0);
    expect(after.pendingFuelWaypoint).toBeNull();
    expect(after.originalDestination).toBeNull();
  });

  it('stopNavigation clears pendingFuelWaypoint and originalDestination', async () => {
    const dest = makePos(0, 0.02);
    const poi = makeFuelPoi('p1', 0.001, 0.005);
    mockGetRoute.mockResolvedValue(makeRoute());

    const store = useNavigationStore.getState();
    store.setCurrentPosition(makePos(0, 0));
    store.setDestination(dest);
    store.startNavigation();
    await useNavigationStore.getState().injectFuelWaypoint(poi);

    expect(useNavigationStore.getState().pendingFuelWaypoint).not.toBeNull();
    expect(useNavigationStore.getState().originalDestination).not.toBeNull();

    useNavigationStore.getState().stopNavigation();

    const after = useNavigationStore.getState();
    expect(after.pendingFuelWaypoint).toBeNull();
    expect(after.originalDestination).toBeNull();
    expect(after.activeRoute).toBeNull();
    expect(after.isNavigating).toBe(false);
  });
});
