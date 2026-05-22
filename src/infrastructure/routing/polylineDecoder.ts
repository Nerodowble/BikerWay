import polyline from '@mapbox/polyline';

import type { RouteCoordinate } from '../../domains/routing/types';

/**
 * Decode an encoded polyline using the precision OSRM uses by default (5).
 *
 * The `@mapbox/polyline` package returns coordinate pairs as `[lat, lng]`
 * tuples; we map them into the `{ latitude, longitude }` shape used across
 * the routing domain.
 */
export function decodePolyline(encoded: string): RouteCoordinate[] {
  return decodeWithPrecision(encoded, 5);
}

export function decodeWithPrecision(
  encoded: string,
  precision: 5 | 6,
): RouteCoordinate[] {
  if (!encoded) return [];

  const pairs = polyline.decode(encoded, precision);
  const out: RouteCoordinate[] = [];

  for (const pair of pairs) {
    if (!pair) continue;
    const lat = pair[0];
    const lng = pair[1];
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    out.push({ latitude: lat, longitude: lng });
  }

  return out;
}
