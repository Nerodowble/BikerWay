import {
  computeDynamicEta,
  computeRouteProgress,
  deriveNavigationState,
  findNearestPointOnRoute,
  findNextManeuver,
  isOffRoute,
  OFF_ROUTE_THRESHOLD_METERS,
} from '../../../src/domains/navigation/engine';
import type {
  Route,
  RouteCoordinate,
  RouteStep,
} from '../../../src/domains/routing/types';

// At the equator (lat = 0), one degree of longitude is ~111.32 km.
// Using a longitude delta of 0.000898 deg gives ~100 m per segment.
const LON_STEP_100M = 0.000898;

function makeStraightLine(numPoints: number, lonStep: number = LON_STEP_100M): RouteCoordinate[] {
  const points: RouteCoordinate[] = [];
  for (let i = 0; i < numPoints; i += 1) {
    points.push({ latitude: 0, longitude: i * lonStep });
  }
  return points;
}

function makeRoute(partial: Partial<Route> = {}): Route {
  return {
    coordinates: partial.coordinates ?? [],
    distanceMeters: partial.distanceMeters ?? 0,
    durationSeconds: partial.durationSeconds ?? 0,
    steps: partial.steps ?? [],
    fetchedAt: partial.fetchedAt ?? 0,
    cacheHit: partial.cacheHit ?? false,
  };
}

function makeStep(distanceMeters: number, instruction?: string): RouteStep {
  return instruction !== undefined
    ? { distanceMeters, durationSeconds: 0, instruction }
    : { distanceMeters, durationSeconds: 0 };
}

describe('findNearestPointOnRoute', () => {
  it('identifies the middle vertex when the position is closest to it', () => {
    const coords = makeStraightLine(3);
    // Position sits right on top of the middle vertex.
    const middle = coords[1]!;
    const result = findNearestPointOnRoute(coords, {
      latitude: middle.latitude,
      longitude: middle.longitude,
    });
    expect(result.index).toBe(1);
    expect(result.distanceMeters).toBeLessThan(1);
  });

  it('returns Infinity distance for an empty coordinate array', () => {
    const result = findNearestPointOnRoute([], { latitude: 0, longitude: 0 });
    expect(result.index).toBe(0);
    expect(result.distanceMeters).toBe(Infinity);
  });

  it('picks the first vertex when the position is closest to it', () => {
    const coords = makeStraightLine(3);
    const first = coords[0]!;
    const result = findNearestPointOnRoute(coords, {
      latitude: first.latitude,
      longitude: first.longitude,
    });
    expect(result.index).toBe(0);
  });
});

describe('computeRouteProgress', () => {
  it('reports traveled ~100m and percent ~33 when position sits on vertex 1 of a 3-point line', () => {
    const coords = makeStraightLine(3);
    const totalMeters = 300; // declared total length of the route (~100m per segment)
    const vertex1 = coords[1]!;
    const progress = computeRouteProgress(coords, totalMeters, {
      latitude: vertex1.latitude,
      longitude: vertex1.longitude,
    });
    expect(progress.nearestIndex).toBe(1);
    expect(progress.traveledMeters).toBeGreaterThan(95);
    expect(progress.traveledMeters).toBeLessThan(105);
    expect(progress.percent).toBeGreaterThan(31);
    expect(progress.percent).toBeLessThan(35);
    expect(progress.remainingMeters).toBeGreaterThan(195);
    expect(progress.remainingMeters).toBeLessThan(205);
    expect(progress.distanceToRouteMeters).toBeLessThan(1);
    expect(progress.totalMeters).toBe(totalMeters);
  });

  it('handles empty coordinates safely', () => {
    const progress = computeRouteProgress([], 1000, { latitude: 0, longitude: 0 });
    expect(progress.traveledMeters).toBe(0);
    expect(progress.percent).toBe(0);
    expect(progress.remainingMeters).toBe(1000);
    expect(progress.distanceToRouteMeters).toBe(Infinity);
  });

  it('clamps progress to 100 percent when traveled would exceed total', () => {
    const coords = makeStraightLine(3);
    // Total declared as tiny (50m) — traveled-to-vertex-1 is ~100m and should clamp.
    const vertex1 = coords[1]!;
    const progress = computeRouteProgress(coords, 50, {
      latitude: vertex1.latitude,
      longitude: vertex1.longitude,
    });
    expect(progress.percent).toBe(100);
    expect(progress.remainingMeters).toBe(0);
  });
});

describe('findNextManeuver', () => {
  const threeSteps: RouteStep[] = [
    makeStep(1000, 'Turn right'),
    makeStep(1000, 'Turn left'),
    makeStep(1000, 'Arrive'),
  ];

  it('returns step 0 with distance 1000 when nothing has been traveled', () => {
    const result = findNextManeuver(threeSteps, 3000, 0);
    expect(result.stepIndex).toBe(0);
    expect(result.distanceToManeuverMeters).toBe(1000);
    expect(result.instruction).toBe('Turn right');
  });

  it('returns step 1 with distance 500 after 1500m traveled', () => {
    const result = findNextManeuver(threeSteps, 3000, 1500);
    expect(result.stepIndex).toBe(1);
    expect(result.distanceToManeuverMeters).toBe(500);
    expect(result.instruction).toBe('Turn left');
  });

  it('returns destination-reached when traveled exceeds total', () => {
    const result = findNextManeuver(threeSteps, 3000, 3500);
    expect(result.step).toBeNull();
    expect(result.stepIndex).toBeNull();
    expect(result.distanceToManeuverMeters).toBe(0);
    expect(result.instruction).toBe('Chegou ao destino');
  });

  it('falls back to "Continue" when a step has no instruction', () => {
    const stepsNoInstr: RouteStep[] = [makeStep(500), makeStep(500)];
    const result = findNextManeuver(stepsNoInstr, 1000, 0);
    expect(result.instruction).toBe('Continue');
  });

  it('handles empty steps array', () => {
    const result = findNextManeuver([], 0, 0);
    expect(result.step).toBeNull();
    expect(result.instruction).toBe('Chegou ao destino');
  });
});

describe('computeDynamicEta', () => {
  it('returns 300 when half of a 10km / 600s route remains', () => {
    expect(computeDynamicEta(5000, 10000, 600)).toBe(300);
  });

  it('returns 0 when total is 0', () => {
    expect(computeDynamicEta(5000, 0, 600)).toBe(0);
  });

  it('returns 0 when remaining is 0', () => {
    expect(computeDynamicEta(0, 10000, 600)).toBe(0);
  });

  it('rounds to the nearest integer', () => {
    // 3333.33 m remaining of 10000 m at 100 s total => 33.33 s => 33
    expect(computeDynamicEta(3333.33, 10000, 100)).toBe(33);
  });
});

describe('isOffRoute', () => {
  it('returns false at 49m (below threshold)', () => {
    expect(isOffRoute(49)).toBe(false);
  });

  it('returns true at 51m (above threshold)', () => {
    expect(isOffRoute(51)).toBe(true);
  });

  it('returns false at exactly the threshold (strict greater than)', () => {
    expect(isOffRoute(50)).toBe(false);
  });

  it('uses the exported threshold constant', () => {
    expect(OFF_ROUTE_THRESHOLD_METERS).toBe(50);
  });

  it('returns true for Infinity', () => {
    expect(isOffRoute(Infinity)).toBe(true);
  });
});

describe('deriveNavigationState', () => {
  it('sets offRouteSinceMs on the first off-route call and preserves it on subsequent off-route calls', () => {
    const coords = makeStraightLine(3);
    const route = makeRoute({
      coordinates: coords,
      distanceMeters: 300,
      durationSeconds: 60,
      steps: [makeStep(150, 'Half'), makeStep(150, 'Arrive')],
    });
    // Off-route position: ~500m north of the route at lat 0.0045 (~501m).
    const offRoutePos = { latitude: 0.0045, longitude: 0 };

    const first = deriveNavigationState(route, offRoutePos, null, 1_000);
    expect(first.isOffRoute).toBe(true);
    expect(first.offRouteSinceMs).toBe(1_000);

    // Second call, still off-route, should keep the original timestamp.
    const second = deriveNavigationState(route, offRoutePos, first.offRouteSinceMs, 5_000);
    expect(second.isOffRoute).toBe(true);
    expect(second.offRouteSinceMs).toBe(1_000);
  });

  it('resets offRouteSinceMs to null when the position returns to the route', () => {
    const coords = makeStraightLine(3);
    const route = makeRoute({
      coordinates: coords,
      distanceMeters: 300,
      durationSeconds: 60,
      steps: [makeStep(300, 'Drive')],
    });
    const onRouteVertex = coords[1]!;
    const onRoutePos = {
      latitude: onRouteVertex.latitude,
      longitude: onRouteVertex.longitude,
    };

    const result = deriveNavigationState(route, onRoutePos, 12_345, 99_999);
    expect(result.isOffRoute).toBe(false);
    expect(result.offRouteSinceMs).toBeNull();
  });

  it('composes progress, maneuver, and ETA consistently', () => {
    const coords = makeStraightLine(3);
    const route = makeRoute({
      coordinates: coords,
      distanceMeters: 300,
      durationSeconds: 90,
      steps: [makeStep(100, 'First'), makeStep(100, 'Second'), makeStep(100, 'Arrive')],
    });
    const startVertex = coords[0]!;
    const startPos = { latitude: startVertex.latitude, longitude: startVertex.longitude };

    const state = deriveNavigationState(route, startPos, null, 0);
    expect(state.progress.traveledMeters).toBe(0);
    expect(state.progress.percent).toBe(0);
    expect(state.maneuver.stepIndex).toBe(0);
    expect(state.maneuver.instruction).toBe('First');
    expect(state.etaSeconds).toBe(90);
    expect(state.isOffRoute).toBe(false);
    expect(state.offRouteSinceMs).toBeNull();
  });
});
