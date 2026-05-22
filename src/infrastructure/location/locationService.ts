import * as Location from 'expo-location';
import { GeoPosition } from '@/domains/navigation/types';
import { LocationPermissionStatus } from '@/domains/location/types';

export type LocationAccuracyMode = 'high' | 'best-for-navigation';

export interface WatchOptions {
  override?: Partial<Location.LocationOptions>;
}

function mapPermissionStatus(
  granted: boolean,
  status: Location.PermissionStatus,
): LocationPermissionStatus {
  if (granted) return 'granted';
  switch (status) {
    case Location.PermissionStatus.GRANTED:
      return 'granted';
    case Location.PermissionStatus.DENIED:
      return 'denied';
    case Location.PermissionStatus.UNDETERMINED:
      return 'undetermined';
    default:
      // expo-location does not expose RESTRICTED on all platforms; treat
      // any unknown status as 'restricted' so callers can react appropriately.
      return 'restricted';
  }
}

function mapToGeoPosition(loc: Location.LocationObject): GeoPosition {
  const coords = loc.coords;
  if (!coords) {
    throw new Error('Falha ao obter localização');
  }
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    altitude: coords.altitude ?? null,
    accuracy: coords.accuracy ?? null,
    speed: coords.speed ?? null,
    heading: coords.heading ?? null,
    timestamp: loc.timestamp,
  };
}

export async function requestForegroundPermission(): Promise<LocationPermissionStatus> {
  const result = await Location.requestForegroundPermissionsAsync();
  return mapPermissionStatus(result.granted, result.status);
}

/**
 * Read the current foreground permission state WITHOUT prompting the user.
 * Used to detect mid-ride revocations: if the watcher errors and the OS
 * now reports a non-granted permission, we surface that to the store so
 * the PermissionBanner can re-appear.
 */
async function readForegroundPermission(): Promise<LocationPermissionStatus> {
  const result = await Location.getForegroundPermissionsAsync();
  return mapPermissionStatus(result.granted, result.status);
}

export async function getCurrentPositionOnce(): Promise<GeoPosition> {
  const loc = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  return mapToGeoPosition(loc);
}

function defaultsForAccuracy(
  accuracy: LocationAccuracyMode,
): Pick<Location.LocationOptions, 'accuracy' | 'distanceInterval' | 'timeInterval'> {
  if (accuracy === 'best-for-navigation') {
    return {
      accuracy: Location.Accuracy.BestForNavigation,
      distanceInterval: 5,
      timeInterval: 1000,
    };
  }
  return {
    accuracy: Location.Accuracy.High,
    distanceInterval: 10,
    timeInterval: 2000,
  };
}

export async function watchPosition(
  opts: WatchOptions,
  onUpdate: (p: GeoPosition) => void,
  onError: (err: string) => void,
  accuracy: LocationAccuracyMode = 'high',
  onPermissionChange: (perm: LocationPermissionStatus) => void = () => {
    // no-op default keeps existing callers source-compatible
  },
): Promise<() => Promise<void>> {
  const baseOptions: Location.LocationOptions = {
    ...defaultsForAccuracy(accuracy),
    ...(opts.override ?? {}),
  };

  const handleError = (msg: string): void => {
    onError(msg);
    // The user may have revoked the foreground permission mid-ride. Check
    // (without prompting) and surface the new state so the store/UI can
    // react. We intentionally swallow any failure from the permission read
    // itself — it would only mask the original error otherwise.
    void (async () => {
      try {
        const refreshed = await readForegroundPermission();
        if (refreshed !== 'granted') {
          onPermissionChange(refreshed);
        }
      } catch {
        // best-effort: ignore secondary permission-read failures
      }
    })();
  };

  const subscription = await Location.watchPositionAsync(baseOptions, (loc) => {
    try {
      onUpdate(mapToGeoPosition(loc));
    } catch (err) {
      handleError(err instanceof Error ? err.message : String(err));
    }
  });

  return async () => {
    subscription.remove();
  };
}
