/**
 * Route weather segmentation.
 *
 * Why this exists:
 *   The Open-Meteo client returns a sparse set of forecasts (a handful of
 *   sample points along the route). The map renderer, however, needs a list
 *   of polyline segments — one per stretch of road that shares a single
 *   severity bucket — so it can paint the route in chunks (calm / warning /
 *   danger) without losing the per-vertex granularity of the OSRM polyline.
 *
 *   `segmentRouteByWeather` is the bridge between the two: it walks every
 *   coordinate of the route, snaps it to the nearest forecast (haversine),
 *   tags it with that forecast's severity, then groups consecutive coords
 *   sharing a severity into a {@link WeatherSegment}.
 *
 * Design choices:
 *   - PURE function, no side effects, no I/O, no React. Trivial to test and
 *     trivial to memoise upstream.
 *   - Adjacent segments share their boundary coordinate (last point of seg N
 *     equals first point of seg N+1). This is intentional so the
 *     react-native-maps `<Polyline>` renderer does not leave a 1-pixel gap
 *     at the transition between two severities — both lines visually touch.
 *   - When `forecasts` is empty the function returns a single 'ok' segment
 *     covering the whole route (i.e. "no data => calm"). This keeps the map
 *     overlay defensive: a transient Open-Meteo failure cannot paint the map
 *     in a bogus colour.
 *   - When `routeCoords` has fewer than two points the function returns an
 *     empty array — no segment can be drawn from a single coordinate.
 */

import type { RouteForecastPoint, WeatherSegment, WeatherSeverity } from './types';

interface LatLng {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Local haversine implementation. We deliberately do NOT import the shared
 * `haversineMeters` util because that one is typed on `GeoPosition` (which
 * carries timestamp + heading + speed), and forcing the caller to wrap every
 * coordinate in those fields would be both noisy and lossy. The math is
 * identical.
 */
function distanceMeters(a: LatLng, b: LatLng): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const clamped = Math.max(0, Math.min(1, h));
  const c =
    2 * Math.atan2(Math.sqrt(clamped), Math.sqrt(Math.max(0, 1 - clamped)));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Find the index of the forecast point closest to `coord` (Euclidean on the
 * sphere via haversine). Returns -1 when `forecasts` is empty so the caller
 * can fall back to a default severity.
 */
function findNearestForecastIndex(
  coord: LatLng,
  forecasts: RouteForecastPoint[],
): number {
  if (forecasts.length === 0) return -1;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < forecasts.length; i++) {
    const fc = forecasts[i];
    if (!fc) continue;
    const d = distanceMeters(coord, fc);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Group consecutive route coordinates by their nearest-forecast severity,
 * returning one {@link WeatherSegment} per run.
 *
 * Boundary handling: every segment after the first repeats the LAST point of
 * the previous segment as its FIRST point. This is intentional — see the
 * module header for the rationale (zero-gap rendering on react-native-maps).
 *
 * @param routeCoords  the full OSRM polyline of the active route.
 * @param forecasts    sparse, geo-anchored forecast points. May be empty (then
 *                     the entire route is reported as a single 'ok' segment).
 */
export function segmentRouteByWeather(
  routeCoords: LatLng[],
  forecasts: RouteForecastPoint[],
): WeatherSegment[] {
  if (!routeCoords || routeCoords.length < 2) {
    return [];
  }

  // Pre-compute the severity, precipitation, and label assigned to each
  // route coordinate. We do this in a single pass so the grouping loop below
  // is plain O(n) with no nested forecast scans.
  type PointMeta = {
    severity: WeatherSeverity;
    precipMm: number;
    label: string;
  };
  const meta: PointMeta[] = new Array(routeCoords.length);
  for (let i = 0; i < routeCoords.length; i++) {
    const coord = routeCoords[i];
    if (!coord) {
      // Defensive: noUncheckedIndexedAccess means TS forces a guard here.
      meta[i] = { severity: 'ok', precipMm: 0, label: '' };
      continue;
    }
    const nearestIdx = findNearestForecastIndex(coord, forecasts);
    if (nearestIdx < 0) {
      meta[i] = { severity: 'ok', precipMm: 0, label: '' };
      continue;
    }
    const fc = forecasts[nearestIdx];
    if (!fc) {
      meta[i] = { severity: 'ok', precipMm: 0, label: '' };
      continue;
    }
    meta[i] = {
      severity: fc.severity,
      precipMm: fc.precipitationMm,
      label: fc.label,
    };
  }

  // Group consecutive coords sharing a severity. We accumulate coords into
  // `currentCoords` and flush whenever the severity changes (or we hit the
  // end of the route).
  const segments: WeatherSegment[] = [];
  // We've already early-returned on routeCoords.length < 2 above, so the
  // first element is guaranteed to exist — assert for the type checker.
  const firstCoord = routeCoords[0];
  const firstMeta = meta[0];
  if (!firstCoord || !firstMeta) {
    return [];
  }

  let currentSeverity: WeatherSeverity = firstMeta.severity;
  let currentCoords: LatLng[] = [firstCoord];
  let currentMaxPrecip: number = firstMeta.precipMm;
  let currentLabel: string = firstMeta.label;

  for (let i = 1; i < routeCoords.length; i++) {
    const coord = routeCoords[i];
    const m = meta[i];
    if (!coord || !m) continue;

    if (m.severity === currentSeverity) {
      currentCoords.push(coord);
      if (m.precipMm > currentMaxPrecip) {
        currentMaxPrecip = m.precipMm;
      }
      if (currentLabel === '' && m.label !== '') {
        currentLabel = m.label;
      }
      continue;
    }

    // Severity transition: close the current segment INCLUDING the boundary
    // coordinate so the upcoming segment can start from the same point and
    // the two polylines visually touch (no 1-px gap on the map).
    currentCoords.push(coord);
    segments.push({
      coordinates: currentCoords,
      severity: currentSeverity,
      precipMm: currentMaxPrecip,
      description: currentLabel === '' ? undefined : currentLabel,
    });

    // Start a new segment whose first point is the boundary coordinate we
    // just appended. This guarantees `segments[k].coordinates[last] ===
    // segments[k+1].coordinates[0]` (by value) and zero rendering gap.
    currentSeverity = m.severity;
    currentCoords = [coord];
    currentMaxPrecip = m.precipMm;
    currentLabel = m.label;
  }

  // Flush the trailing segment. We need at least 2 coords to be a renderable
  // polyline; the single-route-coord case was filtered at the top.
  if (currentCoords.length >= 1) {
    segments.push({
      coordinates: currentCoords,
      severity: currentSeverity,
      precipMm: currentMaxPrecip,
      description: currentLabel === '' ? undefined : currentLabel,
    });
  }

  // Drop any degenerate single-coord trailing segment (would happen if the
  // very last route point had a different severity from its predecessor —
  // we'd then emit a 1-point segment after the transition, which is not
  // renderable). Merge it into the previous segment instead.
  if (segments.length >= 2) {
    const last = segments[segments.length - 1];
    if (last && last.coordinates.length < 2) {
      const prev = segments[segments.length - 2];
      if (prev) {
        // Append the orphan coord to the previous segment so it remains
        // visible — at the cost of slightly extending the previous severity
        // by one vertex (acceptable: one vertex is sub-meter for OSRM
        // polylines, and the rider already saw the transition just before).
        for (const c of last.coordinates) {
          prev.coordinates.push(c);
        }
        segments.pop();
      }
    }
  }

  return segments;
}
