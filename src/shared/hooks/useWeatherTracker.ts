/**
 * useWeatherTracker — watches the navigation store's `currentPosition` and
 * refreshes the weather snapshot whenever:
 *   1. The first non-null GPS fix arrives.
 *   2. The rider has moved more than 10 km from the last fetched position.
 *   3. A 15-minute interval ticks (refresh even on a parked bike).
 *
 * The hook returns nothing — it is meant to be mounted once at the top of
 * a screen (HomeScreen) and torn down when that screen unmounts.
 */

import { useEffect, useRef } from 'react';
import { useNavigationStore } from '@/state/navigationStore';
import { useWeatherStore } from '@/state/weatherStore';
import { haversineKm } from '@/shared/utils/haversine';

const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const REFRESH_DISTANCE_KM = 10;

export function useWeatherTracker(): void {
  const currentPosition = useNavigationStore((s) => s.currentPosition);
  // Track the position at which we last triggered a fetch. We keep this in a
  // ref (not state) so we don't re-render this hook's owner on every fix.
  const lastFetchPosRef = useRef<{ latitude: number; longitude: number } | null>(
    null,
  );

  // Position-driven refresh. The store's own throttle still guards against
  // duplicate fetches if a tight GPS loop somehow slips past us — see
  // weatherStore.shouldSkipRefresh.
  useEffect(() => {
    if (!currentPosition) return;
    const last = lastFetchPosRef.current;
    if (last === null) {
      lastFetchPosRef.current = {
        latitude: currentPosition.latitude,
        longitude: currentPosition.longitude,
      };
      void useWeatherStore
        .getState()
        .refreshCurrent(currentPosition.latitude, currentPosition.longitude);
      return;
    }
    const movedKm = haversineKm(
      { latitude: last.latitude, longitude: last.longitude, timestamp: 0 },
      {
        latitude: currentPosition.latitude,
        longitude: currentPosition.longitude,
        timestamp: 0,
      },
    );
    if (movedKm > REFRESH_DISTANCE_KM) {
      lastFetchPosRef.current = {
        latitude: currentPosition.latitude,
        longitude: currentPosition.longitude,
      };
      void useWeatherStore
        .getState()
        .refreshCurrent(currentPosition.latitude, currentPosition.longitude);
    }
  }, [currentPosition]);

  // Wall-clock interval refresh. We re-read the latest position from the
  // store inside the tick (rather than capturing it in a closure) so a stale
  // currentPosition value can never freeze the refresh chain.
  useEffect(() => {
    const handle = setInterval(() => {
      const pos = useNavigationStore.getState().currentPosition;
      if (!pos) return;
      // We pass force=false; the store decides whether enough time has passed
      // (the throttle will accept this call because the interval cadence
      // matches REFRESH_INTERVAL_MS).
      void useWeatherStore
        .getState()
        .refreshCurrent(pos.latitude, pos.longitude);
    }, REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(handle);
    };
  }, []);
}
