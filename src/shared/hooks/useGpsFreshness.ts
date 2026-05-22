import { useEffect, useState } from 'react';
import { useNavigationStore } from '@/state/navigationStore';

/**
 * Maximum age (seconds) of the last GPS fix before we consider the signal
 * stale. 10 s gives one or two missed samples at the navigation-mode
 * cadence (1 Hz) without false-positiving on a brief tunnel or canyon dip.
 */
export const GPS_STALE_THRESHOLD_SECONDS = 10;

const TICK_INTERVAL_MS = 2000;

export interface GpsFreshnessResult {
  isGpsStale: boolean;
  staleSeconds: number;
}

/**
 * Hook that tracks how fresh the most recent GPS fix is. While navigating,
 * a 2 s ticker drives a `now` clock so the UI can re-render and show the
 * elapsed time since the last fix. When the user is not navigating, the
 * ticker is paused to avoid waking the JS bridge unnecessarily.
 *
 * Special case: when `isNavigating` is true but `currentPosition` is null,
 * we report `isGpsStale = true` with `staleSeconds = 0` so the UI can show
 * an "awaiting signal" state instead of a misleading 0-second timer.
 */
export function useGpsFreshness(): GpsFreshnessResult {
  const currentPosition = useNavigationStore((s) => s.currentPosition);
  const isNavigating = useNavigationStore((s) => s.isNavigating);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!isNavigating) {
      return undefined;
    }
    // Seed `now` on entry so we don't carry a stale clock from a previous
    // navigation session.
    setNow(Date.now());
    const id = setInterval(() => {
      setNow(Date.now());
    }, TICK_INTERVAL_MS);
    return () => {
      clearInterval(id);
    };
  }, [isNavigating]);

  if (isNavigating && currentPosition === null) {
    return { isGpsStale: true, staleSeconds: 0 };
  }

  const staleSeconds = currentPosition
    ? Math.floor((now - currentPosition.timestamp) / 1000)
    : 0;
  const isGpsStale =
    isNavigating &&
    currentPosition !== null &&
    staleSeconds > GPS_STALE_THRESHOLD_SECONDS;

  return { isGpsStale, staleSeconds };
}
