import { useCallback, useEffect } from 'react';
import { Linking } from 'react-native';
import { useLocationStore } from '@/state/locationStore';
import { LocationPermissionStatus } from '@/domains/location/types';

export interface UseLocationTrackingResult {
  permission: LocationPermissionStatus;
  isWatching: boolean;
  lastError: string | null;
  retry: () => void;
  openSettings: () => Promise<void>;
}

export function useLocationTracking(): UseLocationTrackingResult {
  const permission = useLocationStore((s) => s.permission);
  const isWatching = useLocationStore((s) => s.isWatching);
  const lastError = useLocationStore((s) => s.lastError);
  const startWatching = useLocationStore((s) => s.startWatching);
  const stopWatching = useLocationStore((s) => s.stopWatching);
  const refreshPermission = useLocationStore((s) => s.refreshPermission);

  useEffect(() => {
    // Do not auto-loop on denied; the user must trigger retry() manually.
    if (permission === 'denied') {
      return () => {
        // no-op
      };
    }

    void startWatching();

    return () => {
      void stopWatching();
    };
    // We intentionally exclude permission from the dependency array so that a
    // transient permission change does not restart the watcher on its own;
    // retry() is the explicit re-entry path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startWatching, stopWatching]);

  const retry = useCallback(() => {
    // When permission is denied, re-request once first. If the OS still
    // reports 'denied', the caller is expected to invoke openSettings()
    // so the user can grant the permission manually.
    if (permission === 'denied') {
      void (async () => {
        await refreshPermission();
        const next = useLocationStore.getState().permission;
        if (next === 'granted') {
          await useLocationStore.getState().startWatching();
        }
      })();
      return;
    }
    void startWatching();
  }, [permission, refreshPermission, startWatching]);

  const openSettings = useCallback(async () => {
    await Linking.openSettings();
  }, []);

  return { permission, isWatching, lastError, retry, openSettings };
}
