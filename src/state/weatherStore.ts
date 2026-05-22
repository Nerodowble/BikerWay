/**
 * Weather store — owns the rider's current conditions snapshot and the
 * forecast computed along the active route.
 *
 * Throttle policy for `refreshCurrent`:
 *  - The first call always fetches.
 *  - Subsequent unforced calls are skipped when LESS than 15 minutes have
 *    elapsed since the cached snapshot AND the rider has moved LESS than
 *    10 km from the position where that snapshot was taken.
 *  - `force: true` bypasses both gates.
 *
 * `computeRouteForecast` samples the polyline along the route — historically
 * we used 3 points (start / mid / end); we now adaptively sample one point
 * every ~10 km, capped at 12 points so the Open-Meteo budget stays bounded
 * even on cross-country trips. The client-side LRU cache snaps to 1 km cells,
 * so dense routes still hit the cache between calls.
 *
 * After a successful forecast the store also computes `routeSegments` — the
 * input polyline split into runs of homogeneous severity — so the map
 * renderer can overlay coloured polylines on top of the base route polyline.
 */

import { create } from 'zustand';
import {
  RouteForecast,
  RouteForecastPoint,
  RouteForecastSample,
  WeatherSegment,
  WeatherSnapshot,
} from '../domains/weather/types';
import { describeWeatherCode } from '../domains/weather/weatherCodes';
import { segmentRouteByWeather } from '../domains/weather/segmenting';
import { haversineKm } from '../shared/utils/haversine';
import {
  OpenMeteoClient,
  openMeteoClient as defaultClient,
} from '../infrastructure/weather/openMeteoClient';

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 min
const REFRESH_DISTANCE_KM = 10;
const RAIN_PROBABILITY_THRESHOLD = 50;
const STORM_CODE_MIN = 95;
const STORM_CODE_MAX = 99;
/**
 * Spacing between forecast samples along the route, in kilometres. Picked to
 * balance map detail (10 km is fine-grained enough to see a storm cell over
 * a city) against Open-Meteo cost (the client snaps to 1 km cells so dense
 * city routes hit the LRU cache).
 */
const ROUTE_SAMPLE_SPACING_KM = 10;
/**
 * Hard upper bound on the number of forecast samples per route. Caps the
 * Open-Meteo budget for very long trips (e.g. SP -> Rio is ~430 km =
 * 43 samples at 10 km spacing; we clamp that down to 12 to keep latency
 * predictable). Start, mid, and end are always preserved.
 */
const ROUTE_SAMPLE_MAX = 12;

export interface RouteForecastInput {
  routeCoordinates: { latitude: number; longitude: number }[];
  durationSeconds: number;
}

export interface WeatherStoreState {
  current: WeatherSnapshot | null;
  routeForecast: RouteForecast | null;
  /**
   * Polyline-by-severity overlay derived from the last successful
   * `computeRouteForecast` call. Cleared on store reset / route swap. The
   * map renderer reads this and paints one coloured `<Polyline>` per entry
   * on top of the base route polyline.
   */
  routeSegments: WeatherSegment[] | null;
  isFetching: boolean;
  lastError: string | null;
  refreshCurrent: (
    lat: number,
    lng: number,
    force?: boolean,
  ) => Promise<void>;
  computeRouteForecast: (
    params: RouteForecastInput,
  ) => Promise<RouteForecast | null>;
  /**
   * Drop any cached per-route state (forecast + segments). The rider's
   * current-conditions snapshot is intentionally NOT cleared because it
   * is independent of the active route (used by the top-bar badge whether
   * navigating or not).
   */
  clearRoute: () => void;
  clear: () => void;
}

// Allow tests to swap the underlying Open-Meteo client without monkeypatching
// the singleton. Production code always uses the default instance.
let activeClient: OpenMeteoClient = defaultClient;
export function __setWeatherClientForTests(client: OpenMeteoClient): void {
  activeClient = client;
}
export function __resetWeatherClientForTests(): void {
  activeClient = defaultClient;
}

function shouldSkipRefresh(
  current: WeatherSnapshot | null,
  lat: number,
  lng: number,
): boolean {
  if (!current) return false;
  const elapsed = Date.now() - current.fetchedAt;
  if (elapsed >= REFRESH_INTERVAL_MS) return false;
  const movedKm = haversineKm(
    { latitude: current.latitude, longitude: current.longitude, timestamp: 0 },
    { latitude: lat, longitude: lng, timestamp: 0 },
  );
  if (movedKm >= REFRESH_DISTANCE_KM) return false;
  return true;
}

/**
 * Walk the polyline once accumulating segment lengths, then pick indices at
 * roughly equal arc-length intervals along the route. We always pin the very
 * first and very last route vertices so the start and the destination get
 * their own forecast (matching the legacy 3-point behaviour at the edges).
 *
 * The returned `ratios` are the cumulative-distance fractions [0..1] at the
 * sampled indices and are used downstream to estimate ETA-from-now at each
 * sample point (so the hourly slice we ask Open-Meteo for matches when the
 * rider will actually be there).
 */
function pickSampleIndices(
  coords: { latitude: number; longitude: number }[],
  spacingKm: number = ROUTE_SAMPLE_SPACING_KM,
  maxSamples: number = ROUTE_SAMPLE_MAX,
): {
  indices: number[];
  ratios: number[];
} {
  const last = coords.length - 1;
  if (last <= 0) {
    return { indices: [0], ratios: [0] };
  }
  // Cumulative distance along the polyline at vertex i.
  const cumKm: number[] = new Array(coords.length);
  cumKm[0] = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    if (!a || !b) {
      // Defensive: noUncheckedIndexedAccess. A malformed polyline still gets
      // sensible (monotonic) distances by reusing the previous value.
      cumKm[i] = cumKm[i - 1] ?? 0;
      continue;
    }
    const prev = cumKm[i - 1] ?? 0;
    cumKm[i] = prev + haversineKm(
      { latitude: a.latitude, longitude: a.longitude, timestamp: 0 },
      { latitude: b.latitude, longitude: b.longitude, timestamp: 0 },
    );
  }
  const totalKm = cumKm[last] ?? 0;
  if (totalKm <= 0) {
    // Route collapses to a point (start == end) — emit a single sample at 0.
    return { indices: [0], ratios: [0] };
  }

  // Decide how many samples to emit. We want one sample per `spacingKm` of
  // route, but always at least 3 (start / mid / end legacy parity) and at
  // most `maxSamples` so Open-Meteo cost stays bounded.
  const desired = Math.max(3, Math.ceil(totalKm / spacingKm) + 1);
  const sampleCount = Math.min(maxSamples, desired);

  const indices: number[] = [];
  const ratios: number[] = [];
  // Walk forward through `cumKm` to find the vertex closest to each target
  // arc-length. Linear scan is fine because `cumKm` is monotonic and we
  // only emit O(maxSamples) targets per call.
  let scanFrom = 0;
  for (let s = 0; s < sampleCount; s++) {
    const targetRatio = sampleCount === 1 ? 0 : s / (sampleCount - 1);
    const targetKm = totalKm * targetRatio;
    let chosen = scanFrom;
    let bestDelta = Math.abs((cumKm[scanFrom] ?? 0) - targetKm);
    for (let i = scanFrom; i <= last; i++) {
      const delta = Math.abs((cumKm[i] ?? 0) - targetKm);
      if (delta < bestDelta) {
        bestDelta = delta;
        chosen = i;
      }
      // Once we're past the target the deltas only grow.
      const ck = cumKm[i] ?? 0;
      if (ck > targetKm) break;
    }
    // De-dupe: if two adjacent targets snap to the same vertex (short route,
    // high spacing) we skip the repeat so callers don't make redundant
    // Open-Meteo calls for the same lat/lng.
    if (indices.length === 0 || indices[indices.length - 1] !== chosen) {
      indices.push(chosen);
      ratios.push(targetRatio);
      scanFrom = chosen;
    }
  }
  // Guarantee the last vertex is included (rounding can leave it just shy on
  // very short routes).
  if (indices[indices.length - 1] !== last) {
    indices.push(last);
    ratios.push(1);
  }
  return { indices, ratios };
}

function isRainSample(sample: RouteForecastSample): boolean {
  if (sample.precipitationProbability > RAIN_PROBABILITY_THRESHOLD) return true;
  if (
    sample.weatherCode >= STORM_CODE_MIN &&
    sample.weatherCode <= STORM_CODE_MAX
  ) {
    return true;
  }
  return false;
}

function buildSummary(samples: RouteForecastSample[]): string {
  const rainySamples = samples.filter(isRainSample);
  if (rainySamples.length === 0) {
    return 'Tempo limpo no trajeto.';
  }
  // Pick the first rainy sample as the "peak" — i.e. the earliest moment the
  // rider hits weather. Round to minutes so the alert reads naturally.
  const first = rainySamples[0];
  if (!first) {
    return 'Chuva prevista no trajeto.';
  }
  const minutes = Math.max(0, Math.round(first.hoursAhead * 60));
  if (minutes === 0) {
    return 'Chuva prevista agora no trajeto.';
  }
  return `Chuva prevista no trajeto. Pico em ~${minutes}min.`;
}

function pickHourlySample(
  hourly: RouteForecastSample[],
  hoursAhead: number,
): RouteForecastSample | null {
  if (hourly.length === 0) return null;
  const rounded = Math.max(0, Math.round(hoursAhead));
  const match = hourly.find((s) => s.hoursAhead === rounded);
  if (match) return match;
  return hourly[hourly.length - 1] ?? null;
}

export const useWeatherStore = create<WeatherStoreState>((set, get) => ({
  current: null,
  routeForecast: null,
  routeSegments: null,
  isFetching: false,
  lastError: null,

  refreshCurrent: async (
    lat: number,
    lng: number,
    force?: boolean,
  ): Promise<void> => {
    const state = get();
    if (!force && shouldSkipRefresh(state.current, lat, lng)) {
      return;
    }
    set({ isFetching: true, lastError: null });
    try {
      const snapshot = await activeClient.getCurrent(lat, lng);
      set({ current: snapshot, isFetching: false });
    } catch (err) {
      const message =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'Falha ao consultar o clima';
      set({ lastError: message, isFetching: false });
    }
  },

  computeRouteForecast: async (
    params: RouteForecastInput,
  ): Promise<RouteForecast | null> => {
    const { routeCoordinates, durationSeconds } = params;
    if (!routeCoordinates || routeCoordinates.length === 0) {
      set({ routeForecast: null, routeSegments: null });
      return null;
    }
    const { indices, ratios } = pickSampleIndices(routeCoordinates);
    const totalHours = durationSeconds > 0 ? durationSeconds / 3600 : 0;
    set({ isFetching: true, lastError: null });
    try {
      const samples: RouteForecastSample[] = [];
      // We accumulate geo-anchored points in parallel with the legacy
      // `samples` array so the segmentation pass downstream can map each
      // route vertex to the nearest forecast. The legacy array is preserved
      // verbatim so the existing rain-alert summary keeps working.
      const points: RouteForecastPoint[] = [];
      for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        const ratio = ratios[i] ?? 0;
        if (idx === undefined) continue;
        const pt = routeCoordinates[idx];
        if (!pt) continue;
        const etaHours = totalHours * ratio;
        const hourly = await activeClient.getHourlyForecast(
          pt.latitude,
          pt.longitude,
          Math.max(1, Math.ceil(etaHours) + 1),
        );
        const picked = pickHourlySample(hourly, etaHours);
        if (picked) {
          // Replace the sample's hoursAhead with the rider's ETA at that
          // point so summary maths line up across heterogeneous slices.
          samples.push({ ...picked, hoursAhead: etaHours });
          points.push({
            latitude: pt.latitude,
            longitude: pt.longitude,
            hoursAhead: etaHours,
            severity: picked.severity,
            precipitationMm: picked.precipitationMm,
            label: picked.label,
            weatherCode: picked.weatherCode,
            precipitationProbability: picked.precipitationProbability,
          });
        } else {
          // Fall back to a calm placeholder so the consumer always gets a
          // length-N array when the route is well-formed.
          const { label, severity } = describeWeatherCode(0);
          samples.push({
            hoursAhead: etaHours,
            precipitationProbability: 0,
            precipitationMm: 0,
            weatherCode: 0,
            label,
            severity,
          });
          points.push({
            latitude: pt.latitude,
            longitude: pt.longitude,
            hoursAhead: etaHours,
            severity,
            precipitationMm: 0,
            label,
            weatherCode: 0,
            precipitationProbability: 0,
          });
        }
      }
      const rainExpected = samples.some(isRainSample);
      const forecast: RouteForecast = {
        samples,
        rainExpected,
        summary: buildSummary(samples),
      };
      // Build segments from the geo-anchored points. The segmenting function
      // is pure and returns [] when the polyline has < 2 coords — both safe
      // states for the downstream map renderer.
      const routeSegments = segmentRouteByWeather(routeCoordinates, points);
      set({ routeForecast: forecast, routeSegments, isFetching: false });
      return forecast;
    } catch (err) {
      const message =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'Falha ao calcular a previsão do trajeto';
      set({
        lastError: message,
        isFetching: false,
        routeForecast: null,
        routeSegments: null,
      });
      return null;
    }
  },

  clearRoute: (): void => {
    set({ routeForecast: null, routeSegments: null });
  },

  clear: (): void => {
    set({
      current: null,
      routeForecast: null,
      routeSegments: null,
      isFetching: false,
      lastError: null,
    });
  },
}));

// Internal helpers exposed for tests only.
export const __internal = {
  shouldSkipRefresh,
  pickSampleIndices,
  buildSummary,
  isRainSample,
  pickHourlySample,
  REFRESH_INTERVAL_MS,
  REFRESH_DISTANCE_KM,
};
