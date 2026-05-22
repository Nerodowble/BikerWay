import type { FuelSnapshot } from './types';

export const SAFETY_MARGIN = 0.15 as const;
export const RESERVE_THRESHOLD_KM = 40 as const;
export const SAFE_AUTONOMY_FACTOR = 1 - SAFETY_MARGIN;

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function calculateMaxAutonomy(
  tankCapacity: number,
  averageConsump: number,
): number {
  if (!isPositiveFinite(tankCapacity) || !isPositiveFinite(averageConsump)) {
    return 0;
  }
  return tankCapacity * averageConsump;
}

export function calculateSafeAutonomy(maxAutonomy: number): number {
  if (!Number.isFinite(maxAutonomy) || maxAutonomy <= 0) {
    return 0;
  }
  const safe = maxAutonomy * SAFE_AUTONOMY_FACTOR;
  return safe < 0 ? 0 : safe;
}

export function calculateRemainingAutonomy(
  safeAutonomy: number,
  distanceTraveledKm: number,
): number {
  const safe = Number.isFinite(safeAutonomy) ? safeAutonomy : 0;
  const distance = Number.isFinite(distanceTraveledKm) ? distanceTraveledKm : 0;
  return Math.max(0, safe - distance);
}

/**
 * @deprecated Use `computeReserveStatus` instead — it implements the full RF03
 * rule including the 20%-of-tank fallback and the navigating gate.
 */
// use `computeReserveStatus` instead
export function isReserveMode(remainingAutonomyKm: number): boolean {
  if (!Number.isFinite(remainingAutonomyKm)) {
    return true;
  }
  return remainingAutonomyKm <= RESERVE_THRESHOLD_KM;
}

export const RESERVE_TANK_FRACTION = 0.20 as const; // 20% of A_max as fuel-low fallback

export interface ReserveStatusInput {
  tankCapacity: number;
  averageConsump: number;
  distanceTraveledKm: number;
  isNavigating?: boolean; // optional — if provided AND false, isReserveMode is always false
}

export interface ReserveStatus {
  remainingAutonomyKm: number;
  thresholdKm: number; // max(RESERVE_THRESHOLD_KM, RESERVE_TANK_FRACTION * A_max)
  isReserveMode: boolean;
}

export function computeReserveStatus(
  input: ReserveStatusInput,
): ReserveStatus {
  const maxAutonomyKm = calculateMaxAutonomy(
    input.tankCapacity,
    input.averageConsump,
  );

  if (maxAutonomyKm <= 0) {
    return {
      remainingAutonomyKm: 0,
      thresholdKm: RESERVE_THRESHOLD_KM,
      isReserveMode: false,
    };
  }

  const safeAutonomyKm = calculateSafeAutonomy(maxAutonomyKm);
  const distanceTraveledKm = Number.isFinite(input.distanceTraveledKm)
    ? Math.max(0, input.distanceTraveledKm)
    : 0;
  const remainingAutonomyKm = calculateRemainingAutonomy(
    safeAutonomyKm,
    distanceTraveledKm,
  );
  const thresholdKm = Math.max(
    RESERVE_THRESHOLD_KM,
    maxAutonomyKm * RESERVE_TANK_FRACTION,
  );
  const navigatingGate = input.isNavigating !== false;
  const isReserveMode =
    remainingAutonomyKm <= thresholdKm &&
    distanceTraveledKm > 0 &&
    navigatingGate;

  return {
    remainingAutonomyKm,
    thresholdKm,
    isReserveMode,
  };
}

export function snapshotFuel(input: {
  tankCapacity: number;
  averageConsump: number;
  distanceTraveledKm: number;
}): FuelSnapshot {
  const maxAutonomyKm = calculateMaxAutonomy(
    input.tankCapacity,
    input.averageConsump,
  );
  const safeAutonomyKm = calculateSafeAutonomy(maxAutonomyKm);
  const distanceTraveledKm = Number.isFinite(input.distanceTraveledKm)
    ? Math.max(0, input.distanceTraveledKm)
    : 0;
  const remainingAutonomyKm = calculateRemainingAutonomy(
    safeAutonomyKm,
    distanceTraveledKm,
  );

  return {
    maxAutonomyKm,
    safeAutonomyKm,
    distanceTraveledKm,
    remainingAutonomyKm,
    isReserveMode: isReserveMode(remainingAutonomyKm),
  };
}
