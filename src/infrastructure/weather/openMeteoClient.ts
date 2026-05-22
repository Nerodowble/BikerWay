/**
 * Open-Meteo weather client.
 *
 * Open-Meteo is free, requires no signup and no API key, and exposes a simple
 * REST surface. We hit two endpoints:
 *   - `current=...`           → live conditions at lat/lng (current snapshot).
 *   - `hourly=...`            → next ~48h of hourly samples (route forecast).
 *
 * The client adds a small LRU cache keyed by `(lat,lng-snapped,type)` so two
 * near-identical reads (same ~1km cell, same endpoint) reuse the response.
 * The store layer (weatherStore) controls TTL and movement-based refresh; the
 * client cache is just a bounded LRU to avoid re-parsing JSON on tight loops.
 */

import {
  RouteForecastSample,
  WeatherSnapshot,
} from '../../domains/weather/types';
import {
  combineSeverity,
  describeWeatherCode,
} from '../../domains/weather/weatherCodes';
import { LRUCache } from '../../shared/utils/lruCache';
import {
  assertOk,
  fetchWithRetry,
  safeJson,
} from '../../shared/utils/httpClient';

const DEFAULT_BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const DEFAULT_USER_AGENT = 'BikerWay/0.1 (https://github.com/bikerway/app)';
const DEFAULT_CACHE_CAPACITY = 32;
const MAX_FORECAST_HOURS = 47;

export interface OpenMeteoClientOptions {
  baseUrl?: string;
  cacheCapacity?: number;
  userAgent?: string;
}

export interface OpenMeteoClient {
  getCurrent(lat: number, lng: number): Promise<WeatherSnapshot>;
  getHourlyForecast(
    lat: number,
    lng: number,
    hoursAhead: number,
  ): Promise<RouteForecastSample[]>;
  clearCache(): void;
}

interface CurrentBlock {
  time?: string;
  temperature_2m?: number;
  weather_code?: number;
  wind_speed_10m?: number;
  precipitation?: number;
}

interface HourlyBlock {
  time?: string[];
  temperature_2m?: number[];
  precipitation_probability?: number[];
  precipitation?: number[];
  weather_code?: number[];
}

interface OpenMeteoResponse {
  latitude?: number;
  longitude?: number;
  current?: CurrentBlock;
  hourly?: HourlyBlock;
}

function snapKey(lat: number, lng: number, type: 'current' | 'hourly'): string {
  // Snap to ~1km (two decimals at the equator is ~1.1km); this dedupes
  // requests issued for tightly-clustered GPS samples without losing the
  // weather variation between neighbouring cities.
  return `${lat.toFixed(2)},${lng.toFixed(2)}|${type}`;
}

function buildCurrentUrl(baseUrl: string, lat: number, lng: number): string {
  const params = [
    `latitude=${lat}`,
    `longitude=${lng}`,
    'current=temperature_2m,weather_code,wind_speed_10m,precipitation',
    'timezone=auto',
  ].join('&');
  return `${baseUrl}?${params}`;
}

function buildHourlyUrl(baseUrl: string, lat: number, lng: number): string {
  const params = [
    `latitude=${lat}`,
    `longitude=${lng}`,
    'hourly=temperature_2m,precipitation_probability,precipitation,weather_code',
    'forecast_days=2',
    'timezone=auto',
  ].join('&');
  return `${baseUrl}?${params}`;
}

function toSnapshot(
  data: OpenMeteoResponse,
  lat: number,
  lng: number,
): WeatherSnapshot {
  const current = data.current;
  if (!current) {
    throw new Error('Open-Meteo: resposta sem bloco "current"');
  }
  const weatherCode =
    typeof current.weather_code === 'number' ? current.weather_code : 0;
  const temperatureC =
    typeof current.temperature_2m === 'number' ? current.temperature_2m : 0;
  const windKmh =
    typeof current.wind_speed_10m === 'number' ? current.wind_speed_10m : 0;
  const precipitationMm =
    typeof current.precipitation === 'number' ? current.precipitation : 0;
  const { label } = describeWeatherCode(weatherCode);
  const severity = combineSeverity(weatherCode, windKmh, precipitationMm);
  return {
    fetchedAt: Date.now(),
    latitude: lat,
    longitude: lng,
    weatherCode,
    temperatureC,
    windKmh,
    precipitationMm,
    label,
    severity,
  };
}

function pickArrayValue<T>(arr: T[] | undefined, idx: number): T | undefined {
  if (!arr || idx < 0 || idx >= arr.length) return undefined;
  return arr[idx];
}

function toHourlySamples(
  data: OpenMeteoResponse,
  hoursAhead: number,
): RouteForecastSample[] {
  const hourly = data.hourly;
  if (!hourly || !hourly.time || hourly.time.length === 0) {
    return [];
  }
  // Open-Meteo returns the hourly arrays starting at 00:00 LOCAL of "today"
  // (the timezone we requested is auto). We compute the index of the current
  // hour by matching the wall-clock hour string against the time array, which
  // is more robust than relying on epoch arithmetic across DST transitions.
  const now = new Date();
  const nowHourIso = isoHourLocal(now);
  let startIdx = hourly.time.findIndex((t) => t === nowHourIso);
  if (startIdx < 0) {
    // Fallback: search for the latest entry whose hour <= now.
    for (let i = hourly.time.length - 1; i >= 0; i--) {
      const t = hourly.time[i];
      if (typeof t === 'string' && t <= nowHourIso) {
        startIdx = i;
        break;
      }
    }
  }
  if (startIdx < 0) startIdx = 0;

  const clampedHoursAhead = Math.min(
    Math.max(0, Math.floor(hoursAhead)),
    MAX_FORECAST_HOURS,
  );

  const samples: RouteForecastSample[] = [];
  for (let h = 0; h <= clampedHoursAhead; h++) {
    const i = startIdx + h;
    const code = pickArrayValue(hourly.weather_code, i) ?? 0;
    const prob = pickArrayValue(hourly.precipitation_probability, i) ?? 0;
    const precip = pickArrayValue(hourly.precipitation, i) ?? 0;
    const { label } = describeWeatherCode(code);
    const severity = combineSeverity(code, 0, precip);
    samples.push({
      hoursAhead: h,
      precipitationProbability: prob,
      precipitationMm: precip,
      weatherCode: code,
      label,
      severity,
    });
  }
  return samples;
}

function isoHourLocal(date: Date): string {
  // Open-Meteo's "auto" timezone returns ISO-like strings WITHOUT a TZ suffix
  // (e.g. "2026-05-21T13:00"). We reproduce the same local-wall-clock string
  // so equality comparisons line up.
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:00`;
}

export function createOpenMeteoClient(
  opts: OpenMeteoClientOptions = {},
): OpenMeteoClient {
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  const snapshotCache = new LRUCache<string, WeatherSnapshot>(
    opts.cacheCapacity ?? DEFAULT_CACHE_CAPACITY,
  );
  const hourlyCache = new LRUCache<string, RouteForecastSample[]>(
    opts.cacheCapacity ?? DEFAULT_CACHE_CAPACITY,
  );

  async function fetchOpenMeteo(url: string): Promise<OpenMeteoResponse> {
    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': userAgent,
      },
    });
    await assertOk(response);
    return safeJson<OpenMeteoResponse>(response);
  }

  async function getCurrent(
    lat: number,
    lng: number,
  ): Promise<WeatherSnapshot> {
    const key = snapKey(lat, lng, 'current');
    const cached = snapshotCache.get(key);
    if (cached) {
      return { ...cached };
    }
    const url = buildCurrentUrl(baseUrl, lat, lng);
    const data = await fetchOpenMeteo(url);
    const snapshot = toSnapshot(data, lat, lng);
    snapshotCache.set(key, snapshot);
    return { ...snapshot };
  }

  async function getHourlyForecast(
    lat: number,
    lng: number,
    hoursAhead: number,
  ): Promise<RouteForecastSample[]> {
    const clamped = Math.min(
      Math.max(0, Math.floor(hoursAhead)),
      MAX_FORECAST_HOURS,
    );
    const key = `${snapKey(lat, lng, 'hourly')}|h:${clamped}`;
    const cached = hourlyCache.get(key);
    if (cached) {
      return cached.map((s) => ({ ...s }));
    }
    const url = buildHourlyUrl(baseUrl, lat, lng);
    const data = await fetchOpenMeteo(url);
    const samples = toHourlySamples(data, clamped);
    hourlyCache.set(key, samples);
    return samples.map((s) => ({ ...s }));
  }

  function clearCache(): void {
    snapshotCache.clear();
    hourlyCache.clear();
  }

  return { getCurrent, getHourlyForecast, clearCache };
}

export const openMeteoClient: OpenMeteoClient = createOpenMeteoClient();
