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

import {
  SAMPLE_DISTANCE_METERS,
  useNavigationStore,
} from '../../src/state/navigationStore';
import type { GeoPosition } from '../../src/domains/navigation/types';

// At lat = 0, 1 degree of longitude in the spherical model used by the
// project haversine (R = 6_371_000 m) is π·R/180 ≈ 111_194.93 m. We MUST
// match the haversine's constant, otherwise lonForMeters(500) below produces
// a delta that haversine measures as 499.998 m and the 500m sampling gate
// (strictly `delta >= 500`) silently rejects it.
const METERS_PER_DEG_LON_AT_EQUATOR =
  (Math.PI * 6_371_000) / 180;

function lonForMeters(meters: number): number {
  return meters / METERS_PER_DEG_LON_AT_EQUATOR;
}

function makePos(latitude: number, longitude: number): GeoPosition {
  return { latitude, longitude, timestamp: 0 };
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
  });
}

describe('navigationStore 500m sampling (RF03)', () => {
  beforeEach(() => {
    resetStore();
  });

  it('exports SAMPLE_DISTANCE_METERS = 500', () => {
    expect(SAMPLE_DISTANCE_METERS).toBe(500);
  });

  it('does not accumulate distance when next point is only ~100m away', () => {
    const store = useNavigationStore.getState();
    const anchor = makePos(0, 0);
    store.setCurrentPosition(anchor);
    store.startNavigation();

    // ~100m east of the anchor — below the 500m sample threshold.
    const near = makePos(0, lonForMeters(100));
    useNavigationStore.getState().setCurrentPosition(near);

    const after = useNavigationStore.getState();
    expect(after.distanceTraveledKm).toBe(0);
    // Anchor must NOT advance while below the threshold.
    expect(after.lastSamplePosition).toEqual(anchor);
    // currentPosition still updates so the map can render the live dot.
    expect(after.currentPosition).toEqual(near);
  });

  it('increments distance by ~0.5km and advances the anchor at exactly 500m', () => {
    const store = useNavigationStore.getState();
    const anchor = makePos(0, 0);
    store.setCurrentPosition(anchor);
    store.startNavigation();

    const at500 = makePos(0, lonForMeters(500));
    useNavigationStore.getState().setCurrentPosition(at500);

    const after = useNavigationStore.getState();
    expect(after.distanceTraveledKm).toBeCloseTo(0.5, 2);
    expect(after.lastSamplePosition).toEqual(at500);
  });

  it('accumulates ~1.2km when next sample is 1200m from the new anchor', () => {
    const store = useNavigationStore.getState();
    const anchor = makePos(0, 0);
    store.setCurrentPosition(anchor);
    store.startNavigation();

    // First 500m hop — establishes a new anchor at lon ~= lonForMeters(500).
    const at500 = makePos(0, lonForMeters(500));
    useNavigationStore.getState().setCurrentPosition(at500);
    expect(useNavigationStore.getState().distanceTraveledKm).toBeCloseTo(0.5, 2);

    // Next: 1200m further east of the new anchor.
    const at1700 = makePos(0, lonForMeters(500) + lonForMeters(1200));
    useNavigationStore.getState().setCurrentPosition(at1700);

    const after = useNavigationStore.getState();
    // 0.5 km (first hop) + ~1.2 km (second hop) ≈ 1.7 km total.
    expect(after.distanceTraveledKm).toBeCloseTo(1.7, 2);
    expect(after.lastSamplePosition).toEqual(at1700);
  });

  it('resetTrip clears distance and anchor', () => {
    const store = useNavigationStore.getState();
    store.setCurrentPosition(makePos(0, 0));
    store.startNavigation();
    useNavigationStore
      .getState()
      .setCurrentPosition(makePos(0, lonForMeters(500)));
    expect(useNavigationStore.getState().distanceTraveledKm).toBeGreaterThan(0);

    useNavigationStore.getState().resetTrip();

    const after = useNavigationStore.getState();
    expect(after.distanceTraveledKm).toBe(0);
    expect(after.lastSamplePosition).toBeNull();
  });

  it('does NOT accumulate distance when isNavigating is false', () => {
    const store = useNavigationStore.getState();
    store.setCurrentPosition(makePos(0, 0));
    // isNavigating stays false — no startNavigation() call.
    useNavigationStore
      .getState()
      .setCurrentPosition(makePos(0, lonForMeters(500)));
    useNavigationStore
      .getState()
      .setCurrentPosition(makePos(0, lonForMeters(2000)));

    const after = useNavigationStore.getState();
    expect(after.distanceTraveledKm).toBe(0);
    expect(after.lastSamplePosition).toBeNull();
  });
});
