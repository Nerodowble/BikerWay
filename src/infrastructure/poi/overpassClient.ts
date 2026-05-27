/**
 * Overpass API client for fetching POIs (fuel stations, tyre shops,
 * mechanic workshops) inside a bounding box. Used by the Phase 4 POI engine
 * after the BBOX has been computed from the remaining route polyline.
 *
 * Notes:
 *  - Overpass accepts the query as a `data=` form parameter on a POST
 *    request. We DO NOT send the query in the URL: long queries (and ours
 *    can get long for big routes) overflow the practical URL limit on
 *    some proxies, and Overpass officially documents the POST form-data
 *    interface. We encode with URLSearchParams + Content-Type
 *    `application/x-www-form-urlencoded`.
 *  - Public Overpass instances (overpass-api.de) enforce aggressive rate
 *    limits and may return 429/504 under load. The retry layer in
 *    fetchWithRetry handles transient retries; this client adds a
 *    module-scoped throttle (default 3s between requests) so even
 *    well-behaved callers don't hammer the public instance. For
 *    production launch we recommend self-hosting an Overpass instance
 *    (or using a paid provider) to avoid surprises.
 *  - For every category we issue a UNION query over both `node` and `way`
 *    (and `relation` where applicable) with `out center;` — many OSM
 *    contributors map fuel station / mechanic / tyre shop footprints as
 *    `way`s, and a node-only query silently drops the majority of urban
 *    POIs in Brazil (see gotcha_osm_fuel_stations_are_ways).
 */

import type { BoundingBox, Poi, PoiCategory } from '../../domains/poi/types';
import { LRUCache } from '../../shared/utils/lruCache';
import {
  assertOk,
  fetchWithRetry,
  HttpError,
  safeJson,
} from '../../shared/utils/httpClient';

const DEFAULT_BASE_URL = 'https://overpass-api.de/api/interpreter';
const DEFAULT_USER_AGENT = 'BikerWay/0.1 (https://github.com/bikerway/app)';
const DEFAULT_CACHE_CAPACITY = 16;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MIN_INTERVAL_MS = 3_000;
const BBOX_KEY_PRECISION = 3; // ~110m grid — dedup near-identical requests.
const BBOX_COORD_PRECISION = 6; // fed into the QL query.

// Module-scoped throttle timestamp shared across every client instance so
// that creating multiple clients (e.g. via DI in tests) cannot accidentally
// bypass the global rate-limit.
let lastRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface OverpassClientOptions {
  baseUrl?: string;
  cacheCapacity?: number;
  userAgent?: string;
  /** Overpass can be slow; default 20s. */
  timeoutMs?: number;
  /** Manual throttle gap between two consecutive Overpass calls (ms). */
  minIntervalMs?: number;
}

export interface OverpassClient {
  /**
   * Fetch POIs of the given category inside the bounding box. Results are
   * cached keyed by `(category, bbox-snapped-to-110m-grid)` so switching
   * back and forth between chips re-uses results.
   */
  fetchPoisInBox(bbox: BoundingBox, category: PoiCategory): Promise<Poi[]>;
  /**
   * Back-compat shorthand for `fetchPoisInBox(bbox, 'fuel')`. Existing
   * call-sites in the POI store still use this; the rest of the code
   * should prefer `fetchPoisInBox` so the category is explicit.
   */
  fetchFuelStationsInBox(bbox: BoundingBox): Promise<Poi[]>;
  clearCache(): void;
}

interface OverpassElement {
  /** "node" for points, "way" for polygon-mapped POIs. */
  type?: 'node' | 'way' | 'relation';
  id?: number;
  /** Present on `node`s. */
  lat?: number;
  lon?: number;
  /** Present on `way`/`relation`s when the query uses `out center;`. */
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

/**
 * Returns the list of `selector(value)` filters that must be UNION'd inside
 * the QL query for the given category. Each entry MUST be a single OSM tag
 * selector (e.g. `["amenity"="fuel"]`); the bbox is appended by the caller
 * once for `node`, once for `way` and once for `relation`.
 *
 * The selectors below were chosen by sampling Overpass turbo against São
 * Paulo (where the user smoke-tests) so the chips actually return
 * non-empty results. We deliberately union multiple selectors per category
 * because OSM contributors tag the same kind of business several ways.
 */
function selectorsFor(category: PoiCategory): readonly string[] {
  switch (category) {
    case 'fuel':
      return ['["amenity"="fuel"]'];
    case 'tyres':
      // `shop=tyres` is the canonical OSM tag for tyre shops; many BR
      // contributors use `shop=tire_repair` (informal English) or the
      // craft taxonomy `craft=tyres` for borracheiro-style street shops.
      return [
        '["shop"="tyres"]',
        '["shop"="tire_repair"]',
        '["craft"="tyres"]',
      ];
    case 'mechanic':
      // Motorcycle-specific tags first so a moto-only workshop ranks
      // before a generic car mechanic; we include the generic car_repair
      // selector last as a fallback because in many BR neighbourhoods the
      // only moto-friendly mechanic on the block is tagged generically.
      return [
        '["shop"="motorcycle_repair"]',
        '["shop"="motorcycle"]',
        '["amenity"="motorcycle_repair"]',
        '["shop"="car_repair"]',
      ];
    case 'restaurante':
      // amenity=restaurant cobre da pizzaria ao prato feito; fast_food
      // cobre lanchonete/hambugueria. Sem `cuisine=` filtro pra nao
      // reduzir demais o resultado em cidade pequena onde o tag e omisso.
      return ['["amenity"="restaurant"]', '["amenity"="fast_food"]'];
    case 'hotel':
      // OSM separa hotel "tradicional" de motel/inn. Em BR, motel tem
      // conotacao "drive-in"; mantemos junto porque pra o piloto cansado
      // de viagem qualquer cama serve, e a marca/nome do estabelecimento
      // ja deixa claro qual e qual no app via `name`.
      return ['["tourism"="hotel"]', '["tourism"="motel"]'];
    case 'pousada':
      // guest_house = pousada classica; hostel = albergue (categoria
      // gemea no contexto de viagem moto barata). Separamos de "hotel"
      // pq o feel + preco e diferente.
      return ['["tourism"="guest_house"]', '["tourism"="hostel"]'];
    default: {
      // Exhaustiveness guard — fails the build if a new PoiCategory is
      // added without a matching branch above.
      const _exhaustive: never = category;
      throw new Error(`Unsupported POI category: ${String(_exhaustive)}`);
    }
  }
}

function buildQuery(bbox: BoundingBox, category: PoiCategory): string {
  const s = bbox.south.toFixed(BBOX_COORD_PRECISION);
  const w = bbox.west.toFixed(BBOX_COORD_PRECISION);
  const n = bbox.north.toFixed(BBOX_COORD_PRECISION);
  const e = bbox.east.toFixed(BBOX_COORD_PRECISION);
  const bboxClause = `(${s},${w},${n},${e})`;
  // For every selector we emit a node+way+relation union — many POIs in
  // OSM are mapped as polygons (`way`) for fuel stations / repair shops,
  // and a node-only query silently drops most urban results in Brazil.
  // `out center;` gives us a lat/lon for each way/relation without paying
  // for the full geometry.
  const lines: string[] = [];
  for (const sel of selectorsFor(category)) {
    lines.push(`  node${sel}${bboxClause};`);
    lines.push(`  way${sel}${bboxClause};`);
    lines.push(`  relation${sel}${bboxClause};`);
  }
  return `[out:json][timeout:25];\n(\n${lines.join('\n')}\n);\nout center;`;
}

function buildCacheKey(bbox: BoundingBox, category: PoiCategory): string {
  // Snap to a coarser grid so two queries that differ by a few meters
  // map to the same cache entry. The precision is intentionally lower
  // than the QL query precision — we cache by region, not by exact box.
  // Category is part of the key so toggling chips never returns stale
  // results from a different category.
  const s = bbox.south.toFixed(BBOX_KEY_PRECISION);
  const w = bbox.west.toFixed(BBOX_KEY_PRECISION);
  const n = bbox.north.toFixed(BBOX_KEY_PRECISION);
  const e = bbox.east.toFixed(BBOX_KEY_PRECISION);
  return `${category}|${s},${w},${n},${e}`;
}

/**
 * Best-effort fallback name when the OSM element has neither `name` nor
 * `brand`. Localised to Portuguese to match the rest of the UI.
 */
function fallbackName(category: PoiCategory): string {
  switch (category) {
    case 'fuel':
      return 'Posto sem nome';
    case 'tyres':
      return 'Borracheiro';
    case 'mechanic':
      return 'Oficina mecânica';
    case 'restaurante':
      return 'Restaurante';
    case 'hotel':
      return 'Hotel';
    case 'pousada':
      return 'Pousada';
    default: {
      const _exhaustive: never = category;
      throw new Error(`Unsupported POI category: ${String(_exhaustive)}`);
    }
  }
}

function mapElement(el: OverpassElement, category: PoiCategory): Poi | null {
  if (typeof el.id !== 'number') return null;

  // Pick the best coordinate source: native lat/lon for `node`, or the
  // computed centroid (`center`) for `way`/`relation` when the query used
  // `out center;`. Without this branch, every polygon-mapped POI would be
  // silently dropped — which is the majority in many cities.
  let lat: number | undefined;
  let lon: number | undefined;
  if (typeof el.lat === 'number' && typeof el.lon === 'number') {
    lat = el.lat;
    lon = el.lon;
  } else if (
    el.center &&
    typeof el.center.lat === 'number' &&
    typeof el.center.lon === 'number'
  ) {
    lat = el.center.lat;
    lon = el.center.lon;
  }
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const tags = el.tags ?? {};
  const name = tags.name ?? tags.brand ?? fallbackName(category);

  // Prefix the id with the element type so a `node` and a `way` with the
  // same numeric id (allowed in OSM — separate id spaces) never collide.
  const typePrefix = el.type ?? 'osm';

  const poi: Poi = {
    id: `${typePrefix}-${el.id}`,
    category,
    name,
    latitude: lat,
    longitude: lon,
  };
  if (typeof tags.brand === 'string' && tags.brand.length > 0) {
    poi.brand = tags.brand;
  }
  if (typeof tags.operator === 'string' && tags.operator.length > 0) {
    poi.operator = tags.operator;
  }
  if (typeof tags.opening_hours === 'string' && tags.opening_hours.length > 0) {
    poi.openingHours = tags.opening_hours;
  }
  return poi;
}

function cloneList(list: Poi[]): Poi[] {
  // Defensive copy so callers cannot mutate cached entries.
  return list.map((p) => ({ ...p }));
}

export function createOverpassClient(
  opts: OverpassClientOptions = {},
): OverpassClient {
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const minIntervalMs = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const cache = new LRUCache<string, Poi[]>(
    opts.cacheCapacity ?? DEFAULT_CACHE_CAPACITY,
  );

  async function fetchPoisInBox(
    bbox: BoundingBox,
    category: PoiCategory,
  ): Promise<Poi[]> {
    const cacheKey = buildCacheKey(bbox, category);
    const cached = cache.get(cacheKey);
    if (cached) return cloneList(cached);

    // Throttle: keep at least `minIntervalMs` between consecutive calls.
    const now = Date.now();
    const elapsed = now - lastRequestAt;
    if (elapsed < minIntervalMs) {
      await sleep(minIntervalMs - elapsed);
    }
    lastRequestAt = Date.now();

    const query = buildQuery(bbox, category);
    const body = new URLSearchParams({ data: query }).toString();

    let response: Response;
    try {
      response = await fetchWithRetry(baseUrl, {
        method: 'POST',
        timeoutMs,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': userAgent,
        },
        body,
      });
      await assertOk(response);
    } catch (err) {
      // Preserve the original HttpError as `cause` so the UI/diagnostics
      // layer can still inspect the status code and body snippet, while
      // giving callers a user-facing Portuguese message consistent with
      // the rest of the app. Message text varies by category so the
      // banner reads naturally.
      if (err instanceof HttpError) {
        const labelByCategory: Record<PoiCategory, string> = {
          fuel: 'postos',
          tyres: 'borracheiros',
          mechanic: 'oficinas',
          restaurante: 'restaurantes',
          hotel: 'hoteis',
          pousada: 'pousadas',
        };
        const label = labelByCategory[category];
        const wrapped = new Error(
          `Falha ao buscar ${label} (Overpass) — HTTP ${err.status}`,
        );
        (wrapped as { cause?: unknown }).cause = err;
        (wrapped as { status?: number }).status = err.status;
        throw wrapped;
      }
      throw err;
    }

    const json = await safeJson<OverpassResponse>(response);
    const elements = Array.isArray(json.elements) ? json.elements : [];

    const out: Poi[] = [];
    for (const el of elements) {
      const mapped = mapElement(el, category);
      if (mapped) out.push(mapped);
    }

    cache.set(cacheKey, out);
    return cloneList(out);
  }

  function fetchFuelStationsInBox(bbox: BoundingBox): Promise<Poi[]> {
    return fetchPoisInBox(bbox, 'fuel');
  }

  function clearCache(): void {
    cache.clear();
  }

  return { fetchPoisInBox, fetchFuelStationsInBox, clearCache };
}

export const overpassClient: OverpassClient = createOverpassClient();
