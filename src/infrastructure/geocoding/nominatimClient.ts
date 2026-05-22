import type { GeocodingResult } from '../../domains/routing/types';
import { LRUCache } from '../../shared/utils/lruCache';
import {
  assertOk,
  fetchWithRetry,
  safeJson,
} from '../../shared/utils/httpClient';

const DEFAULT_BASE_URL = 'https://nominatim.openstreetmap.org';
const DEFAULT_USER_AGENT = 'BikerWay/0.1 (https://github.com/bikerway/app)';
const DEFAULT_LANGUAGE = 'pt-BR';
const DEFAULT_CACHE_CAPACITY = 16;
const DEFAULT_LIMIT = 8;
const MIN_QUERY_LENGTH = 3;
// Viewbox half-width in degrees. Used as a BIAS hint (not a strict bound),
// so Nominatim ranks results near the rider higher but still returns global
// results when nothing local matches. ~5° ≈ 550km, enough to cover an entire
// Brazilian state and its neighbours, so searching "Ilha Comprida" from
// Diadema (~110km away) still surfaces the município, not just streets.
const VIEWBOX_HALF_DEGREES = 5;
const MIN_REQUEST_INTERVAL_MS = 1000; // Nominatim Usage Policy: 1 rps max.

// Module-scoped throttle timestamp shared across all NominatimClient
// instances so that even if callers create multiple clients we still honor
// the 1 rps Usage Policy.
let lastRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface NominatimClientOptions {
  baseUrl?: string;
  cacheCapacity?: number;
  userAgent?: string;
  language?: string;
}

export interface NominatimSearchOptions {
  limit?: number;
  countryCode?: string;
  near?: { latitude: number; longitude: number };
}

export interface NominatimClient {
  search(query: string, opts?: NominatimSearchOptions): Promise<GeocodingResult[]>;
  clearCache(): void;
}

interface NominatimRawResult {
  display_name?: string;
  lat?: string;
  lon?: string;
  type?: string;
  importance?: number;
}

function buildCacheKey(
  query: string,
  language: string,
  opts: NominatimSearchOptions | undefined,
): string {
  const country = opts?.countryCode ?? '*';
  const near = opts?.near
    ? `${opts.near.latitude.toFixed(3)},${opts.near.longitude.toFixed(3)}`
    : '*';
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  return `${query.toLowerCase().trim()}|${country}|${language}|${near}|${limit}`;
}

function buildUrl(
  baseUrl: string,
  query: string,
  language: string,
  opts: NominatimSearchOptions | undefined,
): string {
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const params: string[] = [
    'format=jsonv2',
    `q=${encodeURIComponent(query)}`,
    `limit=${encodeURIComponent(String(limit))}`,
    `accept-language=${encodeURIComponent(language)}`,
  ];
  if (opts?.countryCode) {
    params.push(`countrycodes=${encodeURIComponent(opts.countryCode)}`);
  }
  if (opts?.near) {
    const { latitude, longitude } = opts.near;
    const left = longitude - VIEWBOX_HALF_DEGREES;
    const right = longitude + VIEWBOX_HALF_DEGREES;
    const top = latitude + VIEWBOX_HALF_DEGREES;
    const bottom = latitude - VIEWBOX_HALF_DEGREES;
    // Nominatim viewbox order is: left,top,right,bottom.
    params.push(`viewbox=${left},${top},${right},${bottom}`);
    // Intentionally NOT setting `bounded=1`. Without it, viewbox is a
    // ranking BIAS — nearby results rank higher but global ones still
    // appear when nothing local matches. Setting bounded=1 here would
    // make "Ilha Comprida" return zero results for riders in São Paulo
    // (the município is ~110km south, outside the bias window).
  }
  return `${baseUrl}/search?${params.join('&')}`;
}

function mapResults(raw: NominatimRawResult[]): GeocodingResult[] {
  const out: GeocodingResult[] = [];
  for (const r of raw) {
    if (!r || typeof r.lat !== 'string' || typeof r.lon !== 'string') continue;
    const latitude = parseFloat(r.lat);
    const longitude = parseFloat(r.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

    const result: GeocodingResult = {
      displayName: r.display_name ?? '',
      latitude,
      longitude,
    };
    if (typeof r.type === 'string' && r.type.length > 0) {
      result.type = r.type;
    }
    if (typeof r.importance === 'number') {
      result.importance = r.importance;
    }
    out.push(result);
  }
  return out;
}

export function createNominatimClient(
  opts: NominatimClientOptions = {},
): NominatimClient {
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  const language = opts.language ?? DEFAULT_LANGUAGE;
  const cache = new LRUCache<string, GeocodingResult[]>(
    opts.cacheCapacity ?? DEFAULT_CACHE_CAPACITY,
  );

  async function search(
    query: string,
    searchOpts?: NominatimSearchOptions,
  ): Promise<GeocodingResult[]> {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) return [];

    const cacheKey = buildCacheKey(trimmed, language, searchOpts);
    const cached = cache.get(cacheKey);
    if (cached) {
      // Return a defensive copy so callers can't mutate cached entries.
      return cached.map((r) => ({ ...r }));
    }

    const url = buildUrl(baseUrl, trimmed, language, searchOpts);

    // Honor Nominatim's 1 rps Usage Policy even if callers debounce too
    // aggressively. We compute the gap from the last successful dispatch
    // and stamp `lastRequestAt` immediately after waiting so concurrent
    // callers space themselves out instead of all firing at once.
    const now = Date.now();
    const elapsed = now - lastRequestAt;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
    }
    lastRequestAt = Date.now();

    // Nominatim's Usage Policy requires a descriptive User-Agent that
    // identifies the application. We set it on every request even though
    // React Native may overwrite it on Android — when bundling with a
    // custom networking layer (e.g. a backend proxy) it will be honored.
    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': userAgent,
      },
    });
    await assertOk(response);
    const raw = await safeJson<NominatimRawResult[]>(response);
    const results = Array.isArray(raw) ? mapResults(raw) : [];

    cache.set(cacheKey, results);
    return results.map((r) => ({ ...r }));
  }

  function clearCache(): void {
    cache.clear();
  }

  return { search, clearCache };
}

export const nominatimClient: NominatimClient = createNominatimClient();
