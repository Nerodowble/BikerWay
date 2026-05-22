import { create } from 'zustand';
import { LocationState } from '@/domains/location/types';
import {
  requestForegroundPermission,
  watchPosition,
  type LocationAccuracyMode,
} from '@/infrastructure/location/locationService';
import {
  startBackgroundLocation,
  stopBackgroundLocation,
} from '@/infrastructure/location/backgroundLocationService';
import { useNavigationStore } from './navigationStore';

export interface LocationStoreState extends LocationState {
  isStarting: boolean;
  accuracyMode: LocationAccuracyMode;
  unsubscribe: (() => Promise<void>) | null;
  isBackgroundActive: boolean;
  startWatching: () => Promise<void>;
  stopWatching: () => Promise<void>;
  refreshPermission: () => Promise<void>;
  setAccuracyMode: (mode: LocationAccuracyMode) => Promise<void>;
  enableBackground: () => Promise<boolean>;
  disableBackground: () => Promise<void>;
}

export const useLocationStore = create<LocationStoreState>((set, get) => ({
  permission: 'undetermined',
  isWatching: false,
  isStarting: false,
  accuracyMode: 'high',
  unsubscribe: null,
  lastError: null,
  isBackgroundActive: false,

  startWatching: async () => {
    const state = get();
    if (state.isWatching || state.isStarting) return;

    set({ isStarting: true });

    let permission = state.permission;
    if (permission !== 'granted') {
      try {
        permission = await requestForegroundPermission();
        set({ permission });
      } catch (err) {
        set({
          isStarting: false,
          lastError: err instanceof Error ? err.message : String(err),
        });
        return;
      }
    }

    if (permission !== 'granted') {
      set({ isStarting: false });
      return;
    }

    try {
      const accuracy = get().accuracyMode;
      const stopFn = await watchPosition(
        {},
        (pos) => {
          useNavigationStore.getState().setCurrentPosition(pos);
        },
        (errMsg) => {
          set({ lastError: errMsg });
        },
        accuracy,
        (newPerm) => {
          // Mid-ride revocation: the watcher reported an error and a
          // subsequent permission read returned a non-granted status.
          // Surface it so PermissionBanner re-appears.
          set({ permission: newPerm });
        },
      );
      set({
        isWatching: true,
        isStarting: false,
        unsubscribe: stopFn,
        lastError: null,
      });
    } catch (err) {
      set({
        isStarting: false,
        lastError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  stopWatching: async () => {
    const current = get().unsubscribe;
    if (current) {
      try {
        await current();
      } catch {
        // best-effort: ignore unsubscribe errors
      }
    }
    set({ isWatching: false, unsubscribe: null });
  },

  refreshPermission: async () => {
    try {
      const permission = await requestForegroundPermission();
      set({ permission });
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : String(err) });
    }
  },

  setAccuracyMode: async (mode) => {
    // Serialize concurrent calls via a module-level promise chain. Without
    // this, two rapid toggles (e.g. user cancels nav within 1 s of starting)
    // interleave stop→start cycles and the second one observes
    // `isWatching === false` (because the first hasn't restarted yet) — so it
    // skips the restart entirely, leaving GPS silently OFF mid-ride. The
    // promise chain ensures each setAccuracyMode runs to completion before
    // the next one observes state.
    accuracyModeQueue = accuracyModeQueue.then(async () => {
      const prev = get().accuracyMode;
      if (prev === mode) return;
      // Read intent BEFORE stop, so a concurrent stopWatching can't lie to us.
      const shouldRestart = get().isWatching || get().isStarting;
      if (get().isWatching) {
        await get().stopWatching();
      }
      set({ accuracyMode: mode });
      if (shouldRestart) {
        await get().startWatching();
      }
    });
    return accuracyModeQueue;
  },

  enableBackground: async () => {
    try {
      const ok = await startBackgroundLocation();
      if (ok) {
        set({ isBackgroundActive: true });
        return true;
      }
      set({
        isBackgroundActive: false,
        lastError:
          'Não foi possível ativar o rastreamento em segundo plano. Verifique as permissões de localização.',
      });
      return false;
    } catch (err) {
      set({
        isBackgroundActive: false,
        lastError: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  },

  disableBackground: async () => {
    await stopBackgroundLocation();
    set({ isBackgroundActive: false });
  },
}));

// Module-scoped promise chain that serializes setAccuracyMode invocations.
let accuracyModeQueue: Promise<void> = Promise.resolve();
