import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useLocationStore } from '@/state/locationStore';

/**
 * Listens for app foreground/background transitions and pauses GPS watching
 * while the app is backgrounded. When the app returns to the foreground, if
 * the caller still intends to watch (`shouldWatch === true`) and permission
 * remains 'granted', the watcher is restarted.
 *
 * This avoids the foreground-only permission warning on Android and reduces
 * battery drain when the user is not looking at the app.
 */
export function useAppStateGuard(shouldWatch: boolean): void {
  // Track the latest `shouldWatch` value in a ref so the AppState callback
  // always observes the current intent without re-subscribing on every render.
  const shouldWatchRef = useRef(shouldWatch);
  useEffect(() => {
    shouldWatchRef.current = shouldWatch;
  }, [shouldWatch]);

  useEffect(() => {
    let lastState: AppStateStatus = AppState.currentState;

    const handleChange = (next: AppStateStatus): void => {
      const wentBackground =
        (lastState === 'active' || lastState === 'inactive') &&
        next === 'background';
      const becameActive =
        (lastState === 'background' || lastState === 'inactive') &&
        next === 'active';

      if (wentBackground) {
        // Flush any pending trip-state write BEFORE we stop the watcher.
        // The OS may kill us shortly after backgrounding, and the debounce
        // timer would otherwise lose the final distance. Dynamic import
        // mirrors the navigationStore <-> locationStore cycle-avoidance.
        void (async () => {
          try {
            // Lazy require avoids dynamic `import()` (which Jest can't run
            // without --experimental-vm-modules) while still deferring the
            // module load past hook init to prevent any circular surprises.
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const m = require('@/state/navigationStore') as typeof import('@/state/navigationStore');
            await m.flushTripStateNow();
          } catch {
            // best-effort flush — never block the AppState handler
          }
        })();
        void useLocationStore.getState().stopWatching();
      } else if (becameActive) {
        const store = useLocationStore.getState();
        // Re-read the OS permission state first: the user may have revoked
        // location while the app was backgrounded. Without this, the
        // startWatching guard below would observe a stale 'granted' and
        // skip the restart only to fail later. Fire-and-forget; the
        // subsequent guard still protects against double-starts.
        void store.refreshPermission();
        // Skip restart if a startWatching is already in flight (e.g. from a
        // concurrent setAccuracyMode toggle) — otherwise we'd double-start
        // the watcher and leak the first subscription.
        if (
          shouldWatchRef.current &&
          store.permission === 'granted' &&
          !store.isStarting &&
          !store.isWatching
        ) {
          void store.startWatching();
        }
      }

      lastState = next;
    };

    const subscription = AppState.addEventListener('change', handleChange);

    return () => {
      subscription.remove();
    };
  }, []);
}
