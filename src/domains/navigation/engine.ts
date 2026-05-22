import type { GeoPosition } from './types';
import type { Route, RouteCoordinate, RouteStep } from '../routing/types';
import { haversineMeters } from '@/shared/utils/haversine';

export interface NearestPointResult {
  index: number;
  distanceMeters: number;
}

export interface RouteProgress {
  traveledMeters: number;
  remainingMeters: number;
  totalMeters: number;
  percent: number;
  nearestIndex: number;
  distanceToRouteMeters: number;
}

export interface ManeuverInfo {
  step: RouteStep | null;
  stepIndex: number | null;
  distanceToManeuverMeters: number;
  instruction: string;
}

export interface NavigationDerivedState {
  progress: RouteProgress;
  maneuver: ManeuverInfo;
  etaSeconds: number;
  isOffRoute: boolean;
  offRouteSinceMs: number | null;
}

export const OFF_ROUTE_THRESHOLD_METERS = 50 as const;

interface LatLon {
  latitude: number;
  longitude: number;
}

// haversineMeters expects GeoPosition (with timestamp); these helpers
// adapt plain lat/lon vertices without leaking the stub timestamp outward.
function asGeoPosition(p: LatLon): GeoPosition {
  return { latitude: p.latitude, longitude: p.longitude, timestamp: 0 };
}

function distanceMeters(a: LatLon, b: LatLon): number {
  return haversineMeters(asGeoPosition(a), asGeoPosition(b));
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function findNearestPointOnRoute(
  coordinates: RouteCoordinate[],
  position: LatLon,
): NearestPointResult {
  if (coordinates.length === 0) {
    return { index: 0, distanceMeters: Infinity };
  }

  let bestIndex = 0;
  let bestDistance = Infinity;

  for (let i = 0; i < coordinates.length; i += 1) {
    const vertex = coordinates[i];
    if (!vertex) continue;
    const d = distanceMeters(vertex, position);
    if (d < bestDistance) {
      bestDistance = d;
      bestIndex = i;
    }
  }

  return { index: bestIndex, distanceMeters: bestDistance };
}

export function computeRouteProgress(
  coordinates: RouteCoordinate[],
  totalRouteMeters: number,
  position: LatLon,
): RouteProgress {
  const safeTotal = Number.isFinite(totalRouteMeters) && totalRouteMeters > 0
    ? totalRouteMeters
    : 0;

  if (coordinates.length === 0) {
    return {
      traveledMeters: 0,
      remainingMeters: safeTotal,
      totalMeters: safeTotal,
      percent: 0,
      nearestIndex: 0,
      distanceToRouteMeters: Infinity,
    };
  }

  const { index: nearestIndex, distanceMeters: distanceToRouteMeters } =
    findNearestPointOnRoute(coordinates, position);

  // Phase 2.5 shortcut: traveledMeters is the cumulative segment length
  // from start up to the nearest vertex. We do NOT project the position
  // onto the segment beyond the vertex — keeps the math O(n) and avoids
  // mercator-projection complexity. Worst-case error is one segment length.
  let traveled = 0;
  for (let i = 0; i < nearestIndex; i += 1) {
    const a = coordinates[i];
    const b = coordinates[i + 1];
    if (!a || !b) continue;
    traveled += distanceMeters(a, b);
  }

  const remaining = safeTotal > 0 ? Math.max(0, safeTotal - traveled) : 0;
  const percent = safeTotal > 0 ? clamp((traveled / safeTotal) * 100, 0, 100) : 0;

  return {
    traveledMeters: traveled,
    remainingMeters: remaining,
    totalMeters: safeTotal,
    percent,
    nearestIndex,
    distanceToRouteMeters,
  };
}

function resolveInstruction(step: RouteStep): string {
  const raw = step.instruction;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return 'Continue';
}

export function findNextManeuver(
  steps: RouteStep[],
  totalRouteMeters: number,
  traveledMeters: number,
): ManeuverInfo {
  if (steps.length === 0) {
    return {
      step: null,
      stepIndex: null,
      distanceToManeuverMeters: 0,
      instruction: 'Chegou ao destino',
    };
  }

  const safeTraveled = Number.isFinite(traveledMeters) && traveledMeters > 0
    ? traveledMeters
    : 0;

  if (Number.isFinite(totalRouteMeters) && totalRouteMeters > 0 && safeTraveled >= totalRouteMeters) {
    return {
      step: null,
      stepIndex: null,
      distanceToManeuverMeters: 0,
      instruction: 'Chegou ao destino',
    };
  }

  let cumulative = 0;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (!step) continue;
    const segmentLength = Number.isFinite(step.distanceMeters) && step.distanceMeters > 0
      ? step.distanceMeters
      : 0;
    const cumulativeEnd = cumulative + segmentLength;
    if (cumulativeEnd > safeTraveled) {
      return {
        step,
        stepIndex: i,
        distanceToManeuverMeters: Math.max(0, cumulativeEnd - safeTraveled),
        instruction: resolveInstruction(step),
      };
    }
    cumulative = cumulativeEnd;
  }

  return {
    step: null,
    stepIndex: null,
    distanceToManeuverMeters: 0,
    instruction: 'Chegou ao destino',
  };
}

export function computeDynamicEta(
  remainingMeters: number,
  totalMeters: number,
  totalDurationSeconds: number,
): number {
  if (!Number.isFinite(totalMeters) || totalMeters <= 0) return 0;
  if (!Number.isFinite(totalDurationSeconds) || totalDurationSeconds <= 0) return 0;
  if (!Number.isFinite(remainingMeters) || remainingMeters <= 0) return 0;
  const ratio = remainingMeters / totalMeters;
  const eta = ratio * totalDurationSeconds;
  return Math.round(eta);
}

export function isOffRoute(
  distanceToRouteMeters: number,
  thresholdMeters: number = OFF_ROUTE_THRESHOLD_METERS,
): boolean {
  if (!Number.isFinite(distanceToRouteMeters)) return true;
  return distanceToRouteMeters > thresholdMeters;
}

export function deriveNavigationState(
  route: Route,
  position: LatLon,
  previousOffRouteSinceMs: number | null,
  now: number = Date.now(),
): NavigationDerivedState {
  const progress = computeRouteProgress(
    route.coordinates,
    route.distanceMeters,
    position,
  );

  const maneuver = findNextManeuver(
    route.steps,
    progress.totalMeters,
    progress.traveledMeters,
  );

  const etaSeconds = computeDynamicEta(
    progress.remainingMeters,
    progress.totalMeters,
    route.durationSeconds,
  );

  const off = isOffRoute(progress.distanceToRouteMeters);

  let offRouteSinceMs: number | null;
  if (off) {
    offRouteSinceMs = previousOffRouteSinceMs ?? now;
  } else {
    offRouteSinceMs = null;
  }

  return {
    progress,
    maneuver,
    etaSeconds,
    isOffRoute: off,
    offRouteSinceMs,
  };
}
