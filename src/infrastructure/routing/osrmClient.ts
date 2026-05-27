import type { Route, RouteRequest, RouteStep } from '../../domains/routing/types';
import { LRUCache } from '../../shared/utils/lruCache';
import {
  assertOk,
  fetchWithRetry,
  safeJson,
} from '../../shared/utils/httpClient';
import { decodePolyline } from './polylineDecoder';
import {
  calculateSinuosity,
  pickMostSinuousIndex,
} from '../../domains/routing/sinuosity';
import type { OsrmCacheRepository } from '../db/osrmCacheRepository';

const DEFAULT_BASE_URL = 'https://router.project-osrm.org';
const DEFAULT_USER_AGENT = 'BikerWay/0.1 (https://github.com/bikerway/app)';
const DEFAULT_CACHE_CAPACITY = 16;

export interface OsrmClientOptions {
  baseUrl?: string;
  cacheCapacity?: number;
  userAgent?: string;
}

export interface OsrmClient {
  getRoute(req: RouteRequest): Promise<Route>;
  /**
   * Fetch up to `max` route alternatives for the given request. OSRM's
   * alternatives flag is forced to `true` regardless of `settings.type`, so
   * every caller gets a list. Returned routes preserve OSRM's order (index
   * 0 = fastest); each entry has its `sinuosityScore` populated so callers
   * can rank by curviness without re-walking the polyline. Default
   * `max = 3`.
   */
  getRouteAlternatives(req: RouteRequest, max?: number): Promise<Route[]>;
  clearCache(): void;
}

const DEFAULT_ALTERNATIVES = 3;

interface OsrmStep {
  distance?: number;
  duration?: number;
  name?: string;
  maneuver?: { instruction?: string };
}

interface OsrmLeg {
  steps?: OsrmStep[];
}

interface OsrmRoute {
  geometry?: string;
  distance?: number;
  duration?: number;
  legs?: OsrmLeg[];
}

interface OsrmResponse {
  code?: string;
  message?: string;
  routes?: OsrmRoute[];
}

function buildCacheKey(req: RouteRequest): string {
  const { start, end, settings, waypoints } = req;
  const type = settings?.type ?? 'express';
  const allowUnpaved = settings?.allowUnpaved ?? false;
  const parts: string[] = [
    `${start.latitude.toFixed(5)},${start.longitude.toFixed(5)}`,
    `${end.latitude.toFixed(5)},${end.longitude.toFixed(5)}`,
    type,
    String(allowUnpaved),
  ];
  // Include waypoints in the cache key when present, so a detoured request
  // (start -> wp -> end) never collides with the same start/end straight
  // route. The `wp:` prefix keeps the no-waypoint case bit-for-bit identical
  // to the legacy key shape and therefore preserves cache hits.
  if (waypoints && waypoints.length > 0) {
    const wpKey = waypoints
      .map((w) => `${w.latitude.toFixed(5)},${w.longitude.toFixed(5)}`)
      .join('|');
    parts.push(`wp:${wpKey}`);
  }
  return parts.join('|');
}

function buildUrl(
  baseUrl: string,
  req: RouteRequest,
  forceAlternatives?: boolean,
): string {
  const { start, end, waypoints, settings } = req;
  const segments: string[] = [
    `${start.longitude},${start.latitude}`,
  ];
  if (waypoints && waypoints.length > 0) {
    for (const w of waypoints) {
      segments.push(`${w.longitude},${w.latitude}`);
    }
  }
  segments.push(`${end.longitude},${end.latitude}`);
  const coords = segments.join(';');
  // Scenic mode asks OSRM for multiple alternatives so we can locally pick
  // the most winding one (highest sinuosity score). Express mode keeps the
  // single fastest route, which is what OSRM's default profile already
  // returns first. Callers that explicitly want alternatives (e.g. the
  // multi-route picker) can override via `forceAlternatives`.
  const wantsAlternatives =
    forceAlternatives === true || settings?.type === 'scenic';
  const alternatives = wantsAlternatives ? 'true' : 'false';
  const params = `overview=full&geometries=polyline&steps=true&alternatives=${alternatives}`;
  return `${baseUrl}/route/v1/driving/${coords}?${params}`;
}

function mapSteps(legs: OsrmLeg[] | undefined): RouteStep[] {
  if (!legs || legs.length === 0) return [];
  const out: RouteStep[] = [];
  // Concatenate steps across all legs. A no-waypoint request still produces
  // exactly one leg, so this preserves backward compatibility while also
  // covering waypoint-injected detours (start -> wp -> end => 2 legs).
  for (const leg of legs) {
    const rawSteps = leg?.steps;
    if (!rawSteps || rawSteps.length === 0) continue;
    for (const s of rawSteps) {
      const distance = typeof s.distance === 'number' ? s.distance : 0;
      const duration = typeof s.duration === 'number' ? s.duration : 0;
      const instruction = s.maneuver?.instruction ?? s.name;

      const step: RouteStep = { distanceMeters: distance, durationSeconds: duration };
      if (instruction && instruction.length > 0) {
        step.instruction = instruction;
      }
      out.push(step);
    }
  }
  return out;
}

function cloneAsCacheHit(route: Route): Route {
  const clone: Route = {
    coordinates: route.coordinates.slice(),
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    steps: route.steps.map((s) => ({ ...s })),
    fetchedAt: route.fetchedAt,
    cacheHit: true,
  };
  // Preserve the optional sinuosity score so a cache-hit alternative still
  // exposes the same ranking signal as a fresh fetch.
  if (typeof route.sinuosityScore === 'number') {
    clone.sinuosityScore = route.sinuosityScore;
  }
  return clone;
}

export function createOsrmClient(opts: OsrmClientOptions = {}): OsrmClient {
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  const cache = new LRUCache<string, Route>(
    opts.cacheCapacity ?? DEFAULT_CACHE_CAPACITY,
  );

  // F36.2 — Cache layer SQLite lazy. Inicializa na primeira chamada que
  // precisar. Em ambientes sem SQLite (alguns tests), permanece null e o
  // codigo degrada pra cache RAM-only.
  let diskCacheRepo: OsrmCacheRepository | null = null;
  let diskInitTried = false;
  async function getDiskCache(): Promise<OsrmCacheRepository | null> {
    if (diskInitTried) return diskCacheRepo;
    diskInitTried = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const m =
        require('../db/osrmCacheRepository') as typeof import('../db/osrmCacheRepository');
      diskCacheRepo = await m.getOsrmCacheRepo();
    } catch {
      diskCacheRepo = null;
    }
    return diskCacheRepo;
  }
  // Separate cache for alternative-route bags. We keep this in its own LRU
  // (typed as Route[]) so a getRoute() lookup never accidentally collides
  // with a getRouteAlternatives() entry. The key shape — see
  // `${baseKey}:alts:${safeMax}` — is already disjoint from the
  // single-route keys, but a distinct LRU also keeps the eviction policy
  // independent so big alternative bags do not push out hot single routes.
  const alternativesCache = new LRUCache<string, Route[]>(
    opts.cacheCapacity ?? DEFAULT_CACHE_CAPACITY,
  );

  async function getRoute(req: RouteRequest): Promise<Route> {
    const cacheKey = buildCacheKey(req);
    const cached = cache.get(cacheKey);
    if (cached) {
      return cloneAsCacheHit(cached);
    }

    // F36.2 — Tenta SQLite ANTES de hit network. Resolve offline cases
    // (app aberto sem rede mas com rota cache de session anterior).
    const disk = await getDiskCache();
    if (disk !== null) {
      try {
        const fromDisk = await disk.get(cacheKey);
        if (fromDisk !== null) {
          cache.set(cacheKey, fromDisk);
          return cloneAsCacheHit(fromDisk);
        }
      } catch {
        // best-effort
      }
    }

    const url = buildUrl(baseUrl, req);
    // Note: in React Native (Android), the platform may override the
    // User-Agent header. We still send it because OSRM-style policies and
    // CDNs in front of the public demo server expect a sane identifier.
    let response: Response;
    try {
      response = await fetchWithRetry(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': userAgent,
        },
      });
      await assertOk(response);
    } catch (err) {
      // F36.2 — Defesa adicional: se o erro veio antes do parse (network
      // / timeout / DNS), tenta o disco "uma vez mais" caso o disco
      // tenha sido populado por outro client/instancia entre a checagem
      // inicial e aqui. Cobertura barata em troca de robustez offline.
      if (disk !== null) {
        const fromDisk = await disk.get(cacheKey).catch(() => null);
        if (fromDisk !== null) {
          cache.set(cacheKey, fromDisk);
          return cloneAsCacheHit(fromDisk);
        }
      }
      throw err;
    }
    const data = await safeJson<OsrmResponse>(response);

    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      throw new Error('Rota não encontrada');
    }

    // Decode each returned alternative once, then either pick the fastest
    // (OSRM's index 0 — already sorted by duration) or rank by sinuosity
    // when the rider asked for the scenic mode.
    const decoded = data.routes
      .filter(
        (r): r is OsrmRoute => Boolean(r && typeof r.geometry === 'string'),
      )
      .map((r) => ({
        coordinates: decodePolyline(r.geometry as string),
        distanceMeters: typeof r.distance === 'number' ? r.distance : 0,
        durationSeconds: typeof r.duration === 'number' ? r.duration : 0,
        steps: mapSteps(r.legs),
      }));
    if (decoded.length === 0) {
      throw new Error('Rota não encontrada');
    }

    const wantsScenic = req.settings?.type === 'scenic';
    const chosenIndex = wantsScenic
      ? pickMostSinuousIndex(decoded)
      : 0;
    const chosen = decoded[chosenIndex] ?? decoded[0];
    if (!chosen) {
      throw new Error('Rota não encontrada');
    }
    const route: Route = {
      coordinates: chosen.coordinates,
      distanceMeters: chosen.distanceMeters,
      durationSeconds: chosen.durationSeconds,
      steps: chosen.steps,
      fetchedAt: Date.now(),
      cacheHit: false,
    };

    cache.set(cacheKey, route);
    // F36.2 — Write-through pro SQLite. Fire-and-forget: erro nao bloqueia
    // o caller, so deixa o disk cache sem essa entrada (proximo fetch
    // tenta de novo). PRIMARY KEY garante upsert.
    if (disk !== null) {
      void disk.set(cacheKey, route).catch(() => undefined);
    }
    return route;
  }

  async function getRouteAlternatives(
    req: RouteRequest,
    max: number = DEFAULT_ALTERNATIVES,
  ): Promise<Route[]> {
    // Clamp to a sensible range so a buggy caller cannot ask for a huge
    // alternatives bag (OSRM caps it server-side anyway). The cache key
    // depends on this number so different `max` values are stored apart.
    const safeMax = Number.isFinite(max) && max > 0 ? Math.floor(max) : 1;
    const baseKey = buildCacheKey(req);
    const cacheKey = `${baseKey}:alts:${safeMax}`;
    const cached = alternativesCache.get(cacheKey);
    if (cached) {
      return cached.map(cloneAsCacheHit);
    }

    const url = buildUrl(baseUrl, req, true);
    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': userAgent,
      },
    });
    await assertOk(response);
    const data = await safeJson<OsrmResponse>(response);

    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      throw new Error('Rota não encontrada');
    }

    // Decode every alternative with a valid polyline, attach the sinuosity
    // score, but DO NOT sort: OSRM returns them fastest-first and we want
    // downstream callers to keep that ranking (the picker UI will tag the
    // first entry as "MAIS RÁPIDA"). Trim to `safeMax` so a generous OSRM
    // response cannot overrun the picker's colour palette.
    const fetchedAt = Date.now();
    const decoded: Route[] = [];
    for (const r of data.routes) {
      if (!r || typeof r.geometry !== 'string') continue;
      const coordinates = decodePolyline(r.geometry);
      const sinuosity = calculateSinuosity(coordinates);
      const route: Route = {
        coordinates,
        distanceMeters: typeof r.distance === 'number' ? r.distance : 0,
        durationSeconds: typeof r.duration === 'number' ? r.duration : 0,
        steps: mapSteps(r.legs),
        fetchedAt,
        cacheHit: false,
        sinuosityScore: sinuosity.score,
      };
      decoded.push(route);
      if (decoded.length >= safeMax) break;
    }

    if (decoded.length === 0) {
      throw new Error('Rota não encontrada');
    }

    // Cache the canonical (cacheHit=false) copies so subsequent reads can
    // mark each clone as a cache hit without mutating the stored array.
    alternativesCache.set(
      cacheKey,
      decoded.map((r) => ({
        ...r,
        coordinates: r.coordinates.slice(),
        steps: r.steps.map((s) => ({ ...s })),
      })),
    );
    return decoded;
  }

  function clearCache(): void {
    cache.clear();
    alternativesCache.clear();
  }

  return { getRoute, getRouteAlternatives, clearCache };
}

export const osrmClient: OsrmClient = createOsrmClient();

// Internal helpers exposed for unit tests. They are part of the
// non-public API of this module; do not import them from production code.
export const __internal = {
  buildUrl,
  buildCacheKey,
};
