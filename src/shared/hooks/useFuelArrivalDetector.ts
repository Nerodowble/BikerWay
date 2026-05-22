import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigationStore } from '@/state/navigationStore';
import { haversineMeters } from '@/shared/utils/haversine';

/**
 * RF05 — Arrival radius. Once the rider is within this many meters of the
 * pending fuel waypoint, we assume refueling may be in progress and offer
 * the "tanque cheio" confirmation prompt.
 */
export const FUEL_ARRIVAL_RADIUS_METERS = 50;

/**
 * RF05 — Auto-dismiss timeout. If the user does not confirm within this
 * window, we automatically drop the detour and restore the original route
 * (timeout path of RF05).
 */
export const FUEL_ARRIVAL_TIMEOUT_MS = 2 * 60 * 1000;

export interface UseFuelArrivalDetectorResult {
  isAtFuelStation: boolean;
  /** Set true while the prompt is showing. The screen toggles it. */
  isPromptOpen: boolean;
  openPrompt: () => void;
  dismissPrompt: () => void;
}

/**
 * Geofence detector for the active fuel waypoint. Emits a one-shot prompt
 * the first time the rider crosses the {@link FUEL_ARRIVAL_RADIUS_METERS}
 * boundary around the pending fuel POI, and arms a
 * {@link FUEL_ARRIVAL_TIMEOUT_MS} timer that auto-clears the detour if the
 * user does not confirm.
 *
 * Implementation notes:
 * - We compute the distance from `currentPosition` (already in the store,
 *   already sampled at GPS rate) — no extra subscription needed.
 * - A ref-based "already prompted" guard prevents the prompt from
 *   re-opening on every render once the rider lingers inside the geofence.
 *   The guard is reset to `false` only when `pendingFuelWaypoint` becomes
 *   `null`, so the same detector instance can handle multiple sequential
 *   detours without forcing the screen to remount.
 * - The 2-minute timer is started when the prompt opens. `dismissPrompt`
 *   clears it (user confirmed or manually closed). Unmount and
 *   waypoint-change also clear it via the effect cleanup.
 */
export function useFuelArrivalDetector(): UseFuelArrivalDetectorResult {
  const currentPosition = useNavigationStore((s) => s.currentPosition);
  const pendingFuelWaypoint = useNavigationStore((s) => s.pendingFuelWaypoint);

  const [isPromptOpen, setIsPromptOpen] = useState<boolean>(false);

  // One-shot guard: once we auto-open the prompt for the current waypoint,
  // do not reopen it (e.g. after the user dismisses) until the waypoint
  // changes or is cleared. This avoids a flicker loop while the rider
  // sits at the pump inside the 50 m radius.
  const alreadyPromptedRef = useRef<boolean>(false);
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Distance from the live position to the pending waypoint, in meters.
  // Infinity when either side is missing so the geofence check below is
  // trivially false.
  const distanceMeters =
    currentPosition && pendingFuelWaypoint
      ? haversineMeters(currentPosition, {
          latitude: pendingFuelWaypoint.latitude,
          longitude: pendingFuelWaypoint.longitude,
          timestamp: 0,
        })
      : Infinity;

  const isAtFuelStation =
    pendingFuelWaypoint !== null &&
    distanceMeters <= FUEL_ARRIVAL_RADIUS_METERS;

  const clearAutoTimer = useCallback(() => {
    if (timeoutIdRef.current !== null) {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }
  }, []);

  const dismissPrompt = useCallback(() => {
    clearAutoTimer();
    setIsPromptOpen(false);
  }, [clearAutoTimer]);

  const openPrompt = useCallback(() => {
    // Manual open path (e.g. user taps a "Cheguei" button before the
    // geofence fires). Mark guard so the auto-open effect doesn't fight
    // a manual close right after.
    alreadyPromptedRef.current = true;
    setIsPromptOpen(true);
    clearAutoTimer();
    timeoutIdRef.current = setTimeout(() => {
      timeoutIdRef.current = null;
      // Timeout path of RF05: drop the detour and close the prompt.
      void useNavigationStore.getState().removeFuelWaypoint();
      setIsPromptOpen(false);
    }, FUEL_ARRIVAL_TIMEOUT_MS);
  }, [clearAutoTimer]);

  // Reset the one-shot guard whenever the waypoint goes away (arrival
  // confirmed, navigation stopped, or detour cancelled). Without this,
  // a subsequent detour to a different station would not be able to
  // re-prompt the rider.
  useEffect(() => {
    if (pendingFuelWaypoint === null) {
      alreadyPromptedRef.current = false;
      clearAutoTimer();
      setIsPromptOpen(false);
    }
  }, [pendingFuelWaypoint, clearAutoTimer]);

  // Auto-open the prompt on the rising edge of `isAtFuelStation` — i.e.
  // the first GPS sample where the rider is inside the geofence. The
  // ref guard means subsequent samples inside the radius are no-ops.
  useEffect(() => {
    if (
      isAtFuelStation &&
      !isPromptOpen &&
      !alreadyPromptedRef.current
    ) {
      alreadyPromptedRef.current = true;
      setIsPromptOpen(true);
      clearAutoTimer();
      timeoutIdRef.current = setTimeout(() => {
        timeoutIdRef.current = null;
        void useNavigationStore.getState().removeFuelWaypoint();
        setIsPromptOpen(false);
      }, FUEL_ARRIVAL_TIMEOUT_MS);
    }
  }, [isAtFuelStation, isPromptOpen, clearAutoTimer]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      clearAutoTimer();
    };
  }, [clearAutoTimer]);

  return { isAtFuelStation, isPromptOpen, openPrompt, dismissPrompt };
}
