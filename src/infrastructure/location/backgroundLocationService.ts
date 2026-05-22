import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { BIKERWAY_LOCATION_TASK_NAME } from './backgroundLocationTask';

export type BackgroundPermissionStatus = 'granted' | 'denied' | 'undetermined';

function mapPermissionStatus(
  granted: boolean,
  status: Location.PermissionStatus,
): BackgroundPermissionStatus {
  if (granted) return 'granted';
  switch (status) {
    case Location.PermissionStatus.GRANTED:
      return 'granted';
    case Location.PermissionStatus.DENIED:
      return 'denied';
    case Location.PermissionStatus.UNDETERMINED:
      return 'undetermined';
    default:
      // 'restricted' (iOS) is intentionally collapsed to 'denied' here — the
      // background service only branches on grant vs. not-grant and we want a
      // narrower 3-value enum at this boundary.
      return 'denied';
  }
}

export async function requestBackgroundPermission(): Promise<BackgroundPermissionStatus> {
  const result = await Location.requestBackgroundPermissionsAsync();
  return mapPermissionStatus(result.granted, result.status);
}

export async function startBackgroundLocation(): Promise<boolean> {
  // Foreground permission is a hard prerequisite — without it the OS refuses
  // to grant background, and startLocationUpdatesAsync would throw.
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) return false;

  const bg = await requestBackgroundPermission();
  if (bg !== 'granted') return false;

  if (!TaskManager.isTaskDefined(BIKERWAY_LOCATION_TASK_NAME)) {
    // The side-effect import in App.tsx must run before this point. If we get
    // here, the task body was never registered and starting updates would
    // either silently no-op or crash on first location batch.
    return false;
  }

  const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(
    BIKERWAY_LOCATION_TASK_NAME,
  );
  if (alreadyRunning) return true;

  await Location.startLocationUpdatesAsync(BIKERWAY_LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.BestForNavigation,
    distanceInterval: 10,
    timeInterval: 3000,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'BikerWay navegando',
      notificationBody:
        'Rastreando rota e autonomia. Toque para abrir.',
      notificationColor: '#FF6B00',
    },
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.Fitness,
  });

  return true;
}

export async function stopBackgroundLocation(): Promise<void> {
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(
      BIKERWAY_LOCATION_TASK_NAME,
    );
    if (running) {
      await Location.stopLocationUpdatesAsync(BIKERWAY_LOCATION_TASK_NAME);
    }
  } catch {
    // Best-effort: swallow. The task may already be torn down by the OS
    // (e.g. user force-stopped the app) and there's nothing actionable here.
  }
}

export async function isBackgroundLocationRunning(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(BIKERWAY_LOCATION_TASK_NAME);
}
