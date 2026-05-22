export type WeatherSeverity = 'ok' | 'warning' | 'danger';

export interface WeatherSnapshot {
  fetchedAt: number;            // epoch ms
  latitude: number;
  longitude: number;
  /** Open-Meteo WMO weather code (0..99). */
  weatherCode: number;
  temperatureC: number;
  /** Wind speed in km/h. */
  windKmh: number;
  /** Precipitation in mm (last hour). */
  precipitationMm: number;
  /** Human label PT-BR: "Limpo", "Nublado", "Chuva fraca", etc. */
  label: string;
  /** App severity bucket derived from weatherCode + wind. */
  severity: WeatherSeverity;
}

export interface RouteForecastSample {
  /** Hours-from-now this sample applies to (rounded). */
  hoursAhead: number;
  precipitationProbability: number; // 0-100
  precipitationMm: number;
  weatherCode: number;
  label: string;
  severity: WeatherSeverity;
}

export interface RouteForecast {
  samples: RouteForecastSample[];
  /** True when any sample has rain probability > 50% OR storm code. */
  rainExpected: boolean;
  /** Summary string suitable for an alert ("Chuva prevista em ~30min em..."). */
  summary: string;
}

/**
 * Geo-indexed forecast sample anchored at a specific point along the active
 * route. Produced by `weatherStore.computeRouteForecast` so the segmentation
 * pass can associate each route coordinate with the nearest forecast.
 */
export interface RouteForecastPoint {
  latitude: number;
  longitude: number;
  /** Hours-from-now the rider is expected to reach this point. */
  hoursAhead: number;
  /** Severity bucket for this point (already combined wind + precip). */
  severity: WeatherSeverity;
  /** Precipitation in mm at the forecast hour for this point. */
  precipitationMm: number;
  /** Human label PT-BR mirroring the underlying weather code. */
  label: string;
  weatherCode: number;
  precipitationProbability: number;
}

/**
 * A contiguous stretch of the route polyline whose forecast points all share
 * the same severity bucket. Rendered on the map as a coloured overlay so the
 * rider can SEE where bad weather hits the route (vs. relying on the textual
 * top-bar badge alone).
 *
 * Invariants:
 *   - `coordinates` is a non-empty sub-array of the original route polyline,
 *     preserving order.
 *   - Adjacent segments share their boundary coordinate (last point of seg N
 *     equals first point of seg N+1) so the rendered polylines visually touch
 *     and no gap appears between trechos with different severities.
 */
export interface WeatherSegment {
  coordinates: Array<{ latitude: number; longitude: number }>;
  severity: WeatherSeverity;
  /** Optional max precipitation across the points feeding this segment. */
  precipMm?: number;
  /** Optional human-readable summary ("Chuva", "Trovoada"…). */
  description?: string;
}
