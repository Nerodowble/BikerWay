import type { GeoPosition, RouteSettings } from '../navigation/types';

export interface RouteCoordinate { latitude: number; longitude: number }

export interface RouteRequest {
  start: { latitude: number; longitude: number };
  end:   { latitude: number; longitude: number };
  /**
   * OSRM intermediate stops, in order: start -> waypoints[] -> end.
   * Optional for backward compatibility. When omitted (or empty), the OSRM
   * URL is built with only start and end, matching the legacy behavior.
   */
  waypoints?: Array<{ latitude: number; longitude: number }>;
  settings?: Partial<RouteSettings>;
}

export interface RouteStep { distanceMeters: number; durationSeconds: number; instruction?: string }

export interface Route {
  coordinates: RouteCoordinate[]; // decoded polyline points
  distanceMeters: number;
  durationSeconds: number;
  steps: RouteStep[];
  fetchedAt: number;
  cacheHit: boolean;
  /**
   * Sinuosity score = degrees of heading change per kilometre. Populated
   * when the route comes from {@link getRouteAlternatives} so callers can
   * rank or label the alternative (e.g. "MAIS SINUOSA"). Older single-route
   * paths leave it undefined; downstream consumers must treat it as optional.
   */
  sinuosityScore?: number;
}

export interface GeocodingResult {
  displayName: string;
  latitude: number;
  longitude: number;
  type?: string;
  importance?: number;
}

// Re-export to keep the module self-contained for downstream importers.
export type { GeoPosition, RouteSettings };
