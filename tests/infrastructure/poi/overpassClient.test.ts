import { createOverpassClient } from '../../../src/infrastructure/poi/overpassClient';
import type { BoundingBox } from '../../../src/domains/poi/types';

const BBOX: BoundingBox = {
  south: -23.6,
  west: -46.7,
  north: -23.5,
  east: -46.6,
};

interface OverpassFakeElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function makeResponse(elements: OverpassFakeElement[]): Response {
  return new Response(JSON.stringify({ elements }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Helper: extract the QL query string that the client just POSTed. The
 * client encodes it as `data=...` in a URLSearchParams body, so we parse
 * the captured RequestInit body back out before asserting on it.
 */
function capturedQuery(fetchMock: jest.Mock, callIndex: number): string {
  const init = fetchMock.mock.calls[callIndex]?.[1] as
    | { body?: unknown }
    | undefined;
  const body = init?.body;
  if (typeof body !== 'string') {
    throw new Error('Expected URLSearchParams body to be a string');
  }
  const params = new URLSearchParams(body);
  const data = params.get('data');
  if (data === null) {
    throw new Error('Expected `data=` form field on Overpass request');
  }
  return data;
}

describe('overpassClient — per-category query shape', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('fuel category emits node+way+relation union for amenity=fuel', async () => {
    const client = createOverpassClient({
      // Disable throttling so the test does not actually wait 3s.
      minIntervalMs: 0,
    });
    const fetchMock = jest.fn().mockResolvedValue(
      makeResponse([
        {
          type: 'node',
          id: 1,
          lat: -23.55,
          lon: -46.65,
          tags: { amenity: 'fuel', name: 'Posto Centro' },
        },
        {
          type: 'way',
          id: 2,
          center: { lat: -23.56, lon: -46.66 },
          tags: { amenity: 'fuel', brand: 'Shell' },
        },
      ]),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.fetchPoisInBox(BBOX, 'fuel');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const query = capturedQuery(fetchMock, 0);
    expect(query).toContain('node["amenity"="fuel"]');
    expect(query).toContain('way["amenity"="fuel"]');
    expect(query).toContain('relation["amenity"="fuel"]');
    expect(query).toContain('out center;');

    // Both elements are mapped; the way uses its `center` as the lat/lon
    // (the gotcha_osm_fuel_stations_are_ways fix must survive).
    expect(result).toHaveLength(2);
    const ids = result.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['node-1', 'way-2']));
    expect(result.every((p) => p.category === 'fuel')).toBe(true);
    const way = result.find((p) => p.id === 'way-2');
    expect(way?.latitude).toBeCloseTo(-23.56, 5);
    expect(way?.longitude).toBeCloseTo(-46.66, 5);
    expect(way?.brand).toBe('Shell');
  });

  it('tyres category unions shop=tyres / tire_repair / craft=tyres', async () => {
    const client = createOverpassClient({ minIntervalMs: 0 });
    const fetchMock = jest.fn().mockResolvedValue(
      makeResponse([
        {
          type: 'node',
          id: 10,
          lat: -23.55,
          lon: -46.65,
          tags: { shop: 'tyres', name: 'Borracheiro Zé' },
        },
        {
          type: 'way',
          id: 11,
          center: { lat: -23.56, lon: -46.66 },
          tags: { craft: 'tyres' },
        },
      ]),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.fetchPoisInBox(BBOX, 'tyres');

    const query = capturedQuery(fetchMock, 0);
    expect(query).toContain('node["shop"="tyres"]');
    expect(query).toContain('node["shop"="tire_repair"]');
    expect(query).toContain('node["craft"="tyres"]');
    expect(query).toContain('way["shop"="tyres"]');
    expect(query).toContain('relation["shop"="tyres"]');

    expect(result).toHaveLength(2);
    expect(result.every((p) => p.category === 'tyres')).toBe(true);
    // Element without `name` or `brand` falls back to the localised label.
    const unnamed = result.find((p) => p.id === 'way-11');
    expect(unnamed?.name).toBe('Borracheiro');
  });

  it('mechanic category unions motorcycle_repair / motorcycle / car_repair', async () => {
    const client = createOverpassClient({ minIntervalMs: 0 });
    const fetchMock = jest.fn().mockResolvedValue(
      makeResponse([
        {
          type: 'node',
          id: 20,
          lat: -23.55,
          lon: -46.65,
          tags: { shop: 'motorcycle_repair', name: 'Oficina do João' },
        },
      ]),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.fetchPoisInBox(BBOX, 'mechanic');

    const query = capturedQuery(fetchMock, 0);
    expect(query).toContain('["shop"="motorcycle_repair"]');
    expect(query).toContain('["shop"="motorcycle"]');
    expect(query).toContain('["amenity"="motorcycle_repair"]');
    expect(query).toContain('["shop"="car_repair"]');

    expect(result).toHaveLength(1);
    expect(result[0]?.category).toBe('mechanic');
    expect(result[0]?.name).toBe('Oficina do João');
  });

  it('caches per (category, bbox) — switching categories does not return stale results', async () => {
    const client = createOverpassClient({ minIntervalMs: 0 });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        makeResponse([
          {
            type: 'node',
            id: 1,
            lat: -23.55,
            lon: -46.65,
            tags: { amenity: 'fuel', name: 'Posto A' },
          },
        ]),
      )
      .mockResolvedValueOnce(
        makeResponse([
          {
            type: 'node',
            id: 2,
            lat: -23.55,
            lon: -46.65,
            tags: { shop: 'tyres', name: 'Borracheiro B' },
          },
        ]),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const fuel = await client.fetchPoisInBox(BBOX, 'fuel');
    const tyres = await client.fetchPoisInBox(BBOX, 'tyres');

    // Cache is keyed by `(category, bbox)` — same bbox + different
    // category MUST round-trip the network so we don't show "Postos" rows
    // under a "Borracheiros próximos" header.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fuel[0]?.category).toBe('fuel');
    expect(fuel[0]?.name).toBe('Posto A');
    expect(tyres[0]?.category).toBe('tyres');
    expect(tyres[0]?.name).toBe('Borracheiro B');

    // Second `fuel` call must come from the cache (no third network hit).
    const fuelAgain = await client.fetchPoisInBox(BBOX, 'fuel');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fuelAgain[0]?.id).toBe('node-1');
  });

  it('fetchFuelStationsInBox is a thin shim that delegates to fetchPoisInBox(_, "fuel")', async () => {
    const client = createOverpassClient({ minIntervalMs: 0 });
    const fetchMock = jest.fn().mockResolvedValue(
      makeResponse([
        {
          type: 'node',
          id: 1,
          lat: -23.55,
          lon: -46.65,
          tags: { amenity: 'fuel', name: 'Posto Legacy' },
        },
      ]),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.fetchFuelStationsInBox(BBOX);
    const query = capturedQuery(fetchMock, 0);

    expect(query).toContain('["amenity"="fuel"]');
    expect(result).toHaveLength(1);
    expect(result[0]?.category).toBe('fuel');
  });
});
