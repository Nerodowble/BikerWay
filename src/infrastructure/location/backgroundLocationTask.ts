import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { GeoPosition } from '@/domains/navigation/types';
import { useNavigationStore } from '@/state/navigationStore';

export const BIKERWAY_LOCATION_TASK_NAME = 'bikerway-background-location';

interface BackgroundLocationTaskData {
  locations?: Location.LocationObject[];
}

// Duplicated inline (not refactored from locationService) so this module can be
// imported as a pure side-effect at app cold start without dragging the rest of
// the location service surface into the boot path.
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

// MUST run at module top-level. React Native re-creates the JS runtime on cold
// start (including when the OS wakes the app for a background location event),
// so the task body must already be registered before any
// startLocationUpdatesAsync call resolves.
TaskManager.defineTask<BackgroundLocationTaskData>(
  BIKERWAY_LOCATION_TASK_NAME,
  async ({ data, error }) => {
    if (error) {
      console.warn(
        `[backgroundLocationTask] error: ${error.message ?? String(error)}`,
      );
      return;
    }

    if (!data) return;

    const locations = data.locations;
    if (!locations || locations.length === 0) return;

    const setCurrentPosition =
      useNavigationStore.getState().setCurrentPosition;

    for (const loc of locations) {
      try {
        const pos = mapToGeoPosition(loc);
        setCurrentPosition(pos);
      } catch (mapErr) {
        console.warn(
          `[backgroundLocationTask] skipped malformed location: ${
            mapErr instanceof Error ? mapErr.message : String(mapErr)
          }`,
        );
      }
    }
  },
);
