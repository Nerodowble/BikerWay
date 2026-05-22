/**
 * Pure geometry helpers for filtering POIs along a route (RF04).
 *
 * The Phase 4 engine uses a nearest-vertex approximation for the distance
 * from a POI to the route: we walk every vertex of the route polyline and
 * keep the smallest haversine distance to the POI. This is intentionally
 * simpler than projecting onto each segment — see the note below for the
 * trade-off.
 *
 * Nearest-vertex approximation: worst-case error is roughly half the
 * length of a single route segment. OSRM routes are typically sampled
 * every 10-50m, so the error is normally <25m — well within the 1000m
 * buffer mandated by RF04. For sparser polylines (e.g. straight highway
 * stretches with vertices hundreds of meters apart) a POI sitting exactly
 * midway between two vertices could be classified ~50-200m further from
 * the route than it actually is. We accept this conservative bias.
 */

import type { BoundingBox, Poi } from './types';
import type { RouteCoordinate } from '../routing/types';
import { haversineMeters } from '../../shared/utils/haversine';

/** RF04: fixed 1km buffer on each side of the remaining route. */
export const FUEL_BUFFER_METERS = 1000 as const;

/**
 * Default lat/lng padding around the route bounding box when querying
 * Overpass. 0.012 degrees ≈ 1.33km of latitude — comfortably more than
 * the 1km buffer so we don't drop a POI at the edge because the BBOX
 * was too tight. Longitude padding is scaled by 1/cos(meanLat) inside
 * `routeBoundingBox` so the BBOX preserves real-world width at higher
 * latitudes (at lat 60, 0.012 degrees of longitude is only ~670m).
 */
const DEFAULT_BBOX_PADDING_DEGREES = 0.012;

/**
 * Minimum cosine factor used when scaling longitude padding. Guards
 * against division-by-zero near the poles (cos(90°) === 0). 0.05
 * corresponds to ~lat 87°, which the app will never legitimately see.
 */
const MIN_COSINE_FACTOR = 0.05;

/** Meters per degree of latitude (mean Earth, WGS84 approximation). */
const METERS_PER_DEGREE_LAT = 111_194;

export interface FilteredPoi extends Poi {
  distanceFromUserMeters: number;
  distanceToRouteMeters: number;
}

/**
 * Back-compat alias preserved so existing imports of `FilteredFuelPoi`
 * continue to compile. New code should reach for `FilteredPoi` since the
 * pipeline now serves multiple `PoiCategory` values (fuel / tyres /
 * mechanic), not just fuel stations.
 */
export type FilteredFuelPoi = FilteredPoi;

/**
 * Computes a padded bounding box around the route polyline. Used to
 * scope the Overpass query so we only fetch fuel stations near the route.
 *
 * Longitude padding is scaled by `1 / cos(meanLat)` so the BBOX preserves
 * its real-world east-west width at higher latitudes — at lat 60 a degree
 * of longitude spans roughly half the distance of a degree at the equator,
 * so we need ~2× the longitude padding to retain the same metric width.
 *
 * Limitations:
 *  - Does not split the BBOX across the antimeridian (longitude wraparound
 *    at ±180°). A route that crosses 180° would produce an inverted BBOX
 *    here. Acceptable for the current Brazil-region usage; revisit if the
 *    app ever ships to the Pacific or to riders crossing the date line.
 *
 * Returns a zero-area BBOX at (0,0) when the route is empty so callers
 * can still issue a request (Overpass will simply return no elements).
 */
export function routeBoundingBox(
  route: RouteCoordinate[],
  paddingDegrees: number = DEFAULT_BBOX_PADDING_DEGREES,
): BoundingBox {
  if (route.length === 0) {
    return { south: 0, west: 0, north: 0, east: 0 };
  }

  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  let west = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;

  for (const c of route) {
    if (c.latitude < south) south = c.latitude;
    if (c.latitude > north) north = c.latitude;
    if (c.longitude < west) west = c.longitude;
    if (c.longitude > east) east = c.longitude;
  }

  const meanLat = (south + north) / 2;
  const cosFactor = Math.max(
    MIN_COSINE_FACTOR,
    Math.cos((meanLat * Math.PI) / 180),
  );
  const lngPadding = paddingDegrees / cosFactor;

  return {
    south: south - paddingDegrees,
    west: west - lngPadding,
    north: north + paddingDegrees,
    east: east + lngPadding,
  };
}

/**
 * Builds a square-in-meters bounding box centered on `center`, sized
 * `2 * halfWidthMeters` per side. Longitude span is scaled by 1/cos(lat)
 * so the box stays roughly square on the ground regardless of latitude.
 *
 * Used by the POI store as a fallback when the active route is empty
 * (single-coordinate "route", or no route at all) so we can still issue
 * a BBOX query around the rider's current position.
 *
 * Limitations: same antimeridian caveat as `routeBoundingBox`.
 */
export function fallbackBoundingBox(
  center: { latitude: number; longitude: number },
  halfWidthMeters: number = 5000,
): BoundingBox {
  const halfLatDeg = halfWidthMeters / METERS_PER_DEGREE_LAT;
  const cosFactor = Math.max(
    MIN_COSINE_FACTOR,
    Math.cos((center.latitude * Math.PI) / 180),
  );
  const halfLngDeg = halfLatDeg / cosFactor;
  return {
    south: center.latitude - halfLatDeg,
    west: center.longitude - halfLngDeg,
    north: center.latitude + halfLatDeg,
    east: center.longitude + halfLngDeg,
  };
}

/**
 * Returns the minimum haversine distance (meters) from `point` to any
 * vertex of `route`. Returns +Infinity when the route is empty so callers
 * naturally filter out all POIs against an unknown route.
 */
export function distancePointToRouteMeters(
  point: { latitude: number; longitude: number },
  route: RouteCoordinate[],
): number {
  if (route.length === 0) return Number.POSITIVE_INFINITY;

  // haversineMeters expects GeoPosition (which includes timestamp). We
  // synthesize a minimal compatible shape — the math only reads
  // latitude/longitude. Using `as never` would defeat type-safety, so we
  // explicitly stamp a timestamp.
  const p = { latitude: point.latitude, longitude: point.longitude, timestamp: 0 };

  let best = Number.POSITIVE_INFINITY;
  for (const v of route) {
    const d = haversineMeters(p, { latitude: v.latitude, longitude: v.longitude, timestamp: 0 });
    if (d < best) best = d;
  }
  return best;
}

export interface FindPoisAlongRouteInput {
  route: RouteCoordinate[];
  /**
   * Index into `route` marking the first vertex the rider has not yet
   * passed. POIs are evaluated only against `route.slice(remainingFromIndex)`
   * so that already-traversed portions of the trip cannot pull a POI into
   * the buffer. Defaults to 0 (consider the whole route).
   */
  remainingFromIndex?: number;
  currentPosition: { latitude: number; longitude: number };
  pois: Poi[];
  /** Override the default 1000m buffer if a feature needs a different width. */
  bufferMeters?: number;
}

/**
 * Filters and sorts POIs (any `PoiCategory`) against the remaining portion
 * of the route, implementing the RF04 requirement: keep POIs within a 1km
 * buffer of the route and order them by linear distance from the user.
 */
export function findPoisAlongRoute(input: FindPoisAlongRouteInput): FilteredPoi[] {
  const { route, currentPosition, pois } = input;
  const buffer = input.bufferMeters ?? FUEL_BUFFER_METERS;

  // Clamp the slice index defensively — negative or out-of-range values
  // should not blow up; instead we treat them as "consider the whole route".
  let fromIndex = input.remainingFromIndex ?? 0;
  if (!Number.isFinite(fromIndex) || fromIndex < 0) fromIndex = 0;
  if (fromIndex > route.length) fromIndex = route.length;

  const remaining = fromIndex === 0 ? route : route.slice(fromIndex);

  const userPos = {
    latitude: currentPosition.latitude,
    longitude: currentPosition.longitude,
    timestamp: 0,
  };

  const kept: FilteredPoi[] = [];
  for (const poi of pois) {
    const distanceToRouteMeters = distancePointToRouteMeters(poi, remaining);
    if (!Number.isFinite(distanceToRouteMeters)) continue;
    if (distanceToRouteMeters > buffer) continue;

    const distanceFromUserMeters = haversineMeters(userPos, {
      latitude: poi.latitude,
      longitude: poi.longitude,
      timestamp: 0,
    });

    kept.push({
      ...poi,
      distanceFromUserMeters,
      distanceToRouteMeters,
    });
  }

  kept.sort((a, b) => a.distanceFromUserMeters - b.distanceFromUserMeters);
  return kept;
}
