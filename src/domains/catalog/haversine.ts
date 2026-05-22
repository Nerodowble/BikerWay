import { haversineKm } from '@/shared/utils/haversine';

export interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * Great-circle distance in kilometres between two points. Thin wrapper around
 * the shared `haversineKm` so callers in the catalog domain do not depend on
 * the `GeoPosition` shape (which carries optional GPS fields the catalog
 * never has). Inputs are validated to keep the math robust against partial
 * data from the JSON dataset.
 */
export function calculateHaversineDistance(a: LatLng, b: LatLng): number {
  if (
    !Number.isFinite(a.latitude) ||
    !Number.isFinite(a.longitude) ||
    !Number.isFinite(b.latitude) ||
    !Number.isFinite(b.longitude)
  ) {
    return 0;
  }
  // Synthesize the minimal GeoPosition shape `haversineKm` expects. We pass a
  // zero timestamp because the shared helper only reads lat/lng.
  return haversineKm(
    { latitude: a.latitude, longitude: a.longitude, timestamp: 0 },
    { latitude: b.latitude, longitude: b.longitude, timestamp: 0 },
  );
}
