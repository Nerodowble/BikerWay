import {
  __internal,
  createOsrmClient,
} from '../../../src/infrastructure/routing/osrmClient';
import type { RouteRequest } from '../../../src/domains/routing/types';

const { buildUrl, buildCacheKey } = __internal;

// Encoded polyline that decodes into the classic three-point example off
// the California coast. It is short, valid for `@mapbox/polyline` precision
// 5, and has enough heading change for `calculateSinuosity` to return a
// finite, non-zero score so the picker has something to display.
const CLASSIC_POLY = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

interface OsrmRouteShape {
  geometry: string;
  distance: number;
  duration: number;
  legs: Array<{ steps: Array<Record<string, unknown>> }>;
}

function makeOsrmResponse(routes: OsrmRouteShape[]): Response {
  const body = JSON.stringify({ code: 'Ok', routes });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeRequest(): RouteRequest {
  return {
    start: { latitude: 38.5, longitude: -120.2 },
    end: { latitude: 43.252, longitude: -126.453 },
    settings: { type: 'express', allowUnpaved: false },
  };
}

describe('osrmClient.__internal — URL + cache key shape', () => {
  it('buildUrl(forceAlternatives=true) sets alternatives=true even in express mode', () => {
    const url = buildUrl('https://example.test', makeRequest(), true);
    expect(url).toContain('alternatives=true');
    // Sanity: keeps the rest of the OSRM query intact so this stays a
    // drop-in for the existing routing.
    expect(url).toContain('overview=full');
    expect(url).toContain('geometries=polyline');
    expect(url).toContain('steps=true');
    expect(url).toContain('/route/v1/driving/');
  });

  it('buildUrl(forceAlternatives undefined) preserves the legacy scenic-only behaviour', () => {
    const expressUrl = buildUrl('https://example.test', makeRequest());
    expect(expressUrl).toContain('alternatives=false');

    const scenicReq: RouteRequest = {
      ...makeRequest(),
      settings: { type: 'scenic', allowUnpaved: false },
    };
    const scenicUrl = buildUrl('https://example.test', scenicReq);
    expect(scenicUrl).toContain('alternatives=true');
  });

  it('buildCacheKey produces the same base key regardless of forceAlternatives', () => {
    // The alternatives-specific suffix is appended by getRouteAlternatives
    // itself, not by buildCacheKey. We exercise that here so a regression
    // in key shape (e.g. accidentally embedding the alternatives flag in
    // the base key) would be caught immediately.
    const key = buildCacheKey(makeRequest());
    expect(key).toMatch(/^38\.50000,-120\.20000\|43\.25200,-126\.45300\|express\|false$/);
  });
});

describe('createOsrmClient.getRouteAlternatives — decode + score + cache', () => {
  // The OSRM client uses the global `fetch`. We swap it out per test so
  // the network is never touched and we can hand the client exactly the
  // shape we want to validate.
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns up to `max` alternatives with sinuosityScore populated', async () => {
    const client = createOsrmClient({ baseUrl: 'https://example.test' });
    const response = makeOsrmResponse([
      {
        geometry: CLASSIC_POLY,
        distance: 1000,
        duration: 600,
        legs: [{ steps: [] }],
      },
      {
        geometry: CLASSIC_POLY,
        distance: 1500,
        duration: 700,
        legs: [{ steps: [] }],
      },
      {
        geometry: CLASSIC_POLY,
        distance: 2000,
        duration: 800,
        legs: [{ steps: [] }],
      },
    ]);
    const fetchMock = jest.fn().mockResolvedValue(response);
    global.fetch = fetchMock as unknown as typeof fetch;

    const routes = await client.getRouteAlternatives(makeRequest(), 2);

    // Limited to `max = 2` even though OSRM returned 3.
    expect(routes).toHaveLength(2);
    // Order preserved — OSRM's index 0 stays first (the "MAIS RÁPIDA" tag
    // depends on that contract).
    expect(routes[0]?.durationSeconds).toBe(600);
    expect(routes[1]?.durationSeconds).toBe(700);
    // Every entry exposes a finite sinuosity score so the picker can rank
    // them locally without a second pass over the polyline.
    expect(typeof routes[0]?.sinuosityScore).toBe('number');
    expect(typeof routes[1]?.sinuosityScore).toBe('number');
    expect(Number.isFinite(routes[0]?.sinuosityScore ?? NaN)).toBe(true);
    // First call hit the network with alternatives=true.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('alternatives=true');
  });

  it('caches the result under an :alts:<max> suffix and returns cacheHit clones', async () => {
    const client = createOsrmClient({ baseUrl: 'https://example.test' });
    const response = makeOsrmResponse([
      {
        geometry: CLASSIC_POLY,
        distance: 1000,
        duration: 600,
        legs: [{ steps: [] }],
      },
    ]);
    const fetchMock = jest.fn().mockResolvedValue(response);
    global.fetch = fetchMock as unknown as typeof fetch;

    const first = await client.getRouteAlternatives(makeRequest(), 3);
    const second = await client.getRouteAlternatives(makeRequest(), 3);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first[0]?.cacheHit).toBe(false);
    expect(second[0]?.cacheHit).toBe(true);
    // sinuosityScore must survive the cache round-trip so downstream
    // ranking (MAIS SINUOSA) does not silently degrade on a cache hit.
    expect(typeof second[0]?.sinuosityScore).toBe('number');
  });

  it('different `max` values cache independently (no cross-contamination)', async () => {
    const client = createOsrmClient({ baseUrl: 'https://example.test' });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        makeOsrmResponse([
          {
            geometry: CLASSIC_POLY,
            distance: 1000,
            duration: 600,
            legs: [{ steps: [] }],
          },
        ]),
      )
      .mockResolvedValueOnce(
        makeOsrmResponse([
          {
            geometry: CLASSIC_POLY,
            distance: 1000,
            duration: 600,
            legs: [{ steps: [] }],
          },
          {
            geometry: CLASSIC_POLY,
            distance: 1500,
            duration: 700,
            legs: [{ steps: [] }],
          },
        ]),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const oneAlt = await client.getRouteAlternatives(makeRequest(), 1);
    const twoAlts = await client.getRouteAlternatives(makeRequest(), 2);

    // Both calls hit the network — the cache key suffix (:alts:1 vs
    // :alts:2) keeps the two bags apart even though the request body is
    // identical otherwise.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(oneAlt).toHaveLength(1);
    expect(twoAlts).toHaveLength(2);
  });
});
