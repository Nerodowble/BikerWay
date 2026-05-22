import { useNavigationStore } from '@/state/navigationStore';

/**
 * Threshold above which we treat the rider as actively moving and block
 * destructive UI like keyboards. 1.4 m/s == 5.04 km/h, chosen as the
 * "walking briskly / parking lot crawl" boundary. Strict greater-than: a
 * value of exactly 1.4 still counts as NOT moving.
 */
export const MOVING_SPEED_THRESHOLD_MPS = 1.4;

export interface MovementLockResult {
  isMoving: boolean;
  speedKmh: number;
}

/**
 * Pure derivation extracted from the hook so it can be unit-tested without
 * a React renderer. Maps a raw GPS speed (m/s, may be null on Android when
 * stationary) into a movement boolean and a rounded km/h value.
 */
export function deriveMovementFromSpeed(
  speedMps: number | null | undefined,
): MovementLockResult {
  const safeSpeed = speedMps ?? 0;
  // Convert to km/h. Callers that need a display string should format
  // (e.g. toFixed(1)) at the render site — this hook keeps full
  // precision so unit tests can assert exact conversion values.
  const speedKmh = safeSpeed * 3.6;
  return {
    isMoving: safeSpeed > MOVING_SPEED_THRESHOLD_MPS,
    speedKmh,
  };
}

/**
 * Hook returning movement state derived from the current GPS position.
 * Returns `{ isMoving: false, speedKmh: 0 }` when no position is available
 * yet (no GPS fix) or when the platform reports `null` speed (common on
 * Android when the device is stationary or has a poor fix).
 */
export function useMovementLock(): MovementLockResult {
  const speedMps = useNavigationStore(
    (s) => s.currentPosition?.speed ?? null,
  );
  return deriveMovementFromSpeed(speedMps);
}
