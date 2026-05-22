import type { RouteCoordinate } from './types';
import { haversineKm } from '@/shared/utils/haversine';

/**
 * Sinuosity scoring for OSRM route alternatives.
 *
 * The "scenic" route mode in RF02 wants twisty, curvy roads — the rider
 * picks the alternative with the most bends per kilometre, not the
 * shortest path. OSRM's public profile doesn't know about sinuosity, so
 * we ask it for several alternatives and rank them locally.
 *
 * Score formula:
 *   1. Compute the bearing between each consecutive pair of vertices.
 *   2. Sum the absolute angular delta between consecutive bearings.
 *   3. Divide by the total route distance in km.
 *
 * Result is **degrees of heading change per km**. A perfectly straight
 * highway is ~0; a winding mountain pass is hundreds.
 */

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Initial bearing (compass course) from `a` to `b` in degrees [-180, 180].
 * Standard great-circle formula; precise enough for the short hops between
 * OSRM polyline vertices (typically tens of metres).
 */
export function bearingDegrees(
  a: RouteCoordinate,
  b: RouteCoordinate,
): number {
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return toDeg(Math.atan2(y, x));
}

/**
 * Smallest absolute difference between two bearings, normalised to [0, 180].
 * A 350° → 10° change is treated as a 20° turn (not 340°).
 */
export function angularDeltaDeg(a: number, b: number): number {
  let delta = Math.abs(a - b) % 360;
  if (delta > 180) delta = 360 - delta;
  return delta;
}

export interface SinuosityReport {
  /** Total heading change accumulated along the polyline (degrees). */
  totalAngleChangeDeg: number;
  /** Total polyline length (kilometres). */
  totalDistanceKm: number;
  /** Score = degrees per km. Higher = more curves per distance. */
  score: number;
}

export function calculateSinuosity(
  coordinates: RouteCoordinate[],
): SinuosityReport {
  if (!Array.isArray(coordinates) || coordinates.length < 3) {
    return { totalAngleChangeDeg: 0, totalDistanceKm: 0, score: 0 };
  }
  let totalAngleChange = 0;
  let totalDistanceKm = 0;
  let prevBearing: number | null = null;
  for (let i = 0; i < coordinates.length - 1; i += 1) {
    const a = coordinates[i];
    const b = coordinates[i + 1];
    if (!a || !b) continue;
    const segmentBearing = bearingDegrees(a, b);
    if (prevBearing !== null) {
      totalAngleChange += angularDeltaDeg(segmentBearing, prevBearing);
    }
    prevBearing = segmentBearing;
    // Wrap RouteCoordinate as GeoPosition-shaped input for haversineKm.
    totalDistanceKm += haversineKm(
      { latitude: a.latitude, longitude: a.longitude, timestamp: 0 },
      { latitude: b.latitude, longitude: b.longitude, timestamp: 0 },
    );
  }
  const score = totalDistanceKm > 0 ? totalAngleChange / totalDistanceKm : 0;
  return {
    totalAngleChangeDeg: totalAngleChange,
    totalDistanceKm,
    score,
  };
}

/**
 * Given multiple route alternatives (each with its polyline coordinates),
 * pick the one with the highest sinuosity score. Ties broken by index
 * order (preserves OSRM's preferred ordering).
 */
export function pickMostSinuousIndex(
  alternatives: Array<{ coordinates: RouteCoordinate[] }>,
): number {
  if (alternatives.length === 0) return 0;
  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < alternatives.length; i += 1) {
    const alt = alternatives[i];
    if (!alt) continue;
    const report = calculateSinuosity(alt.coordinates);
    if (report.score > bestScore) {
      bestScore = report.score;
      bestIdx = i;
    }
  }
  return bestIdx;
}
