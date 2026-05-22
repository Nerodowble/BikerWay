import type { GeoPosition } from '../../domains/navigation/types';

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineMeters(a: GeoPosition, b: GeoPosition): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);

  const sinDeltaLat = Math.sin(deltaLat / 2);
  const sinDeltaLon = Math.sin(deltaLon / 2);

  const h =
    sinDeltaLat * sinDeltaLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDeltaLon * sinDeltaLon;

  const clamped = Math.max(0, Math.min(1, h));
  const c = 2 * Math.atan2(Math.sqrt(clamped), Math.sqrt(Math.max(0, 1 - clamped)));

  return EARTH_RADIUS_METERS * c;
}

export function haversineKm(a: GeoPosition, b: GeoPosition): number {
  return haversineMeters(a, b) / 1000;
}
