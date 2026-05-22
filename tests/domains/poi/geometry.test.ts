import {
  FUEL_BUFFER_METERS,
  distancePointToRouteMeters,
  fallbackBoundingBox,
  findPoisAlongRoute,
  routeBoundingBox,
} from '../../../src/domains/poi/geometry';
import type { FuelPoi } from '../../../src/domains/poi/types';
import type { RouteCoordinate } from '../../../src/domains/routing/types';

const DEFAULT_PADDING = 0.012;
const METERS_PER_DEGREE_LAT = 111_194;

function fuelPoi(id: string, latitude: number, longitude: number): FuelPoi {
  return { id, category: 'fuel', name: `Posto ${id}`, latitude, longitude };
}

describe('routeBoundingBox', () => {
  it('returns padded min/max over the route', () => {
    const route: RouteCoordinate[] = [
      { latitude: 0.0, longitude: 0 },
      { latitude: 0.1, longitude: 0 },
      { latitude: 0.2, longitude: 0 },
    ];
    const bbox = routeBoundingBox(route);
    expect(bbox.south).toBeCloseTo(0 - DEFAULT_PADDING, 6);
    expect(bbox.north).toBeCloseTo(0.2 + DEFAULT_PADDING, 6);
    expect(bbox.west).toBeCloseTo(0 - DEFAULT_PADDING, 6);
    expect(bbox.east).toBeCloseTo(0 + DEFAULT_PADDING, 6);
  });

  it('honours an explicit padding override (longitude scaled by 1/cos(meanLat))', () => {
    const route: RouteCoordinate[] = [
      { latitude: 10, longitude: -20 },
      { latitude: 11, longitude: -19 },
    ];
    const padding = 0.05;
    const bbox = routeBoundingBox(route, padding);
    const meanLat = (10 + 11) / 2;
    const lngPadding = padding / Math.cos((meanLat * Math.PI) / 180);
    expect(bbox.south).toBeCloseTo(10 - padding, 6);
    expect(bbox.north).toBeCloseTo(11 + padding, 6);
    expect(bbox.west).toBeCloseTo(-20 - lngPadding, 6);
    expect(bbox.east).toBeCloseTo(-19 + lngPadding, 6);
  });

  it('scales longitude padding by 1/cos(meanLat) — lat 60 has ~2× the longitude padding of lat 0', () => {
    const padding = 0.012;

    const routeEquator: RouteCoordinate[] = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0.01 },
    ];
    const bboxEquator = routeBoundingBox(routeEquator, padding);
    // Longitude padding at the equator (cos(0) = 1) is exactly `padding`.
    const lngPaddingEquator = bboxEquator.east - 0.01;
    expect(lngPaddingEquator).toBeCloseTo(padding, 6);

    const route60: RouteCoordinate[] = [
      { latitude: 60, longitude: 0 },
      { latitude: 60, longitude: 0.01 },
    ];
    const bbox60 = routeBoundingBox(route60, padding);
    const lngPadding60 = bbox60.east - 0.01;
    // cos(60°) === 0.5 so 1/cos(60°) === 2 — east padding doubles.
    expect(lngPadding60).toBeCloseTo(padding / Math.cos((60 * Math.PI) / 180), 6);
    expect(lngPadding60).toBeCloseTo(lngPaddingEquator * 2, 6);

    // Latitude padding is unaffected by latitude scaling.
    expect(bbox60.north - 60).toBeCloseTo(padding, 6);
    expect(bboxEquator.north - 0).toBeCloseTo(padding, 6);
  });

  it('returns a zero-area BBOX at (0,0) for an empty route', () => {
    const bbox = routeBoundingBox([]);
    expect(bbox).toEqual({ south: 0, west: 0, north: 0, east: 0 });
  });
});

describe('distancePointToRouteMeters', () => {
  it('returns 0 when the point coincides with a route vertex', () => {
    const route: RouteCoordinate[] = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0.01 },
      { latitude: 0, longitude: 0.02 },
    ];
    const d = distancePointToRouteMeters({ latitude: 0, longitude: 0 }, route);
    expect(d).toBeCloseTo(0, 5);
  });

  it('returns ~500m for a point offset 500m from the nearest vertex', () => {
    // 0.00449 degrees latitude ≈ 500m (1 deg lat ≈ 111_320m).
    const offsetDeg = 500 / 111_320;
    const route: RouteCoordinate[] = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0.01 },
      { latitude: 0, longitude: 0.02 },
    ];
    const point = { latitude: offsetDeg, longitude: 0.01 };
    const d = distancePointToRouteMeters(point, route);
    expect(d).toBeGreaterThan(450);
    expect(d).toBeLessThan(550);
  });

  it('returns +Infinity for an empty route', () => {
    expect(
      distancePointToRouteMeters({ latitude: 5, longitude: 5 }, []),
    ).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('findPoisAlongRoute', () => {
  it('keeps POIs inside the buffer and sorts ascending by distance from user', () => {
    // Route along the equator from lng 0 to lng 0.02 (~2.2km long).
    const route: RouteCoordinate[] = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0.01 },
      { latitude: 0, longitude: 0.02 },
    ];
    const user = { latitude: 0, longitude: 0 };

    // ~300m north of vertex 1 (middle of route).
    const near = 300 / 111_320;
    // ~700m north of vertex 2 (end of route).
    const mid = 700 / 111_320;
    // ~2000m north of vertex 1 — outside the 1km buffer.
    const far = 2000 / 111_320;

    const pois: FuelPoi[] = [
      fuelPoi('mid', mid, 0.02),
      fuelPoi('near', near, 0.01),
      fuelPoi('far', far, 0.01),
    ];

    const result = findPoisAlongRoute({ route, currentPosition: user, pois });

    expect(result).toHaveLength(2);
    expect(result.map((p) => p.id)).toEqual(['near', 'mid']);
    // distanceToRouteMeters should all be <= 1000m by construction.
    for (const p of result) {
      expect(p.distanceToRouteMeters).toBeLessThanOrEqual(FUEL_BUFFER_METERS);
      expect(p.distanceFromUserMeters).toBeGreaterThan(0);
    }
    // Ordering: nearer to user comes first.
    expect(result[0]!.distanceFromUserMeters).toBeLessThan(
      result[1]!.distanceFromUserMeters,
    );
  });

  it('skips POIs that only sit near already-traversed vertices via remainingFromIndex', () => {
    // 3-vertex route. We place a POI right on top of vertex 0 — if the
    // full route were considered, the POI would be 0m from the route and
    // therefore kept. With remainingFromIndex=2, the sliced route only
    // includes vertex 2, which is ~2.2km away → the POI must be filtered.
    const route: RouteCoordinate[] = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0.01 },
      { latitude: 0, longitude: 0.02 },
    ];

    const poiAtStart: FuelPoi = fuelPoi('start', 0, 0);

    const fullRouteResult = findPoisAlongRoute({
      route,
      currentPosition: { latitude: 0, longitude: 0.02 },
      pois: [poiAtStart],
    });
    expect(fullRouteResult).toHaveLength(1);

    const skippedResult = findPoisAlongRoute({
      route,
      remainingFromIndex: 2,
      currentPosition: { latitude: 0, longitude: 0.02 },
      pois: [poiAtStart],
    });
    expect(skippedResult).toHaveLength(0);
  });

  it('respects a custom bufferMeters override', () => {
    const route: RouteCoordinate[] = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0.01 },
    ];
    // ~600m offset — within the default 1000m buffer but outside a 500m buffer.
    const offsetDeg = 600 / 111_320;
    const poi: FuelPoi = fuelPoi('p1', offsetDeg, 0);

    const defaultBuffer = findPoisAlongRoute({
      route,
      currentPosition: { latitude: 0, longitude: 0 },
      pois: [poi],
    });
    expect(defaultBuffer).toHaveLength(1);

    const tightBuffer = findPoisAlongRoute({
      route,
      currentPosition: { latitude: 0, longitude: 0 },
      pois: [poi],
      bufferMeters: 500,
    });
    expect(tightBuffer).toHaveLength(0);
  });

  it('returns an empty list when the route is empty', () => {
    const result = findPoisAlongRoute({
      route: [],
      currentPosition: { latitude: 0, longitude: 0 },
      pois: [fuelPoi('p1', 0, 0)],
    });
    expect(result).toEqual([]);
  });
});

describe('fallbackBoundingBox', () => {
  it('produces a square (in meters) box at the equator', () => {
    const halfWidth = 5000;
    const bbox = fallbackBoundingBox({ latitude: 0, longitude: 0 }, halfWidth);

    const lngSpan = bbox.east - bbox.west;
    const latSpan = bbox.north - bbox.south;

    // At lat 0, longitude span === 2 * halfWidth / METERS_PER_DEGREE_LAT.
    const expectedLngSpan = (2 * halfWidth) / METERS_PER_DEGREE_LAT;
    expect(lngSpan).toBeCloseTo(expectedLngSpan, 6);
    expect(latSpan).toBeCloseTo(expectedLngSpan, 6);
  });

  it('doubles the longitude span at lat 60 vs lat 0 (1/cos(60°) === 2)', () => {
    const halfWidth = 5000;
    const bboxEq = fallbackBoundingBox(
      { latitude: 0, longitude: 0 },
      halfWidth,
    );
    const bbox60 = fallbackBoundingBox(
      { latitude: 60, longitude: 0 },
      halfWidth,
    );

    const lngSpanEq = bboxEq.east - bboxEq.west;
    const lngSpan60 = bbox60.east - bbox60.west;

    expect(lngSpan60).toBeCloseTo(lngSpanEq * 2, 6);
    // Latitude span is unaffected by latitude (purely a meter→degree
    // conversion based on Earth's mean latitude-degree length).
    const latSpanEq = bboxEq.north - bboxEq.south;
    const latSpan60 = bbox60.north - bbox60.south;
    expect(latSpan60).toBeCloseTo(latSpanEq, 6);
  });

  it('uses the default 5000m half-width when not specified', () => {
    const explicit = fallbackBoundingBox({ latitude: 0, longitude: 0 }, 5000);
    const implicit = fallbackBoundingBox({ latitude: 0, longitude: 0 });
    expect(implicit).toEqual(explicit);
  });
});
