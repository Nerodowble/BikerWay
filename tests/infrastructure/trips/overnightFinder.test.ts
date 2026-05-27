import type { Poi } from '@/domains/poi/types';

const mockFetchPoisInBox = jest.fn();

jest.mock('@/infrastructure/poi/overpassClient', () => ({
  overpassClient: {
    fetchPoisInBox: (...args: unknown[]) => mockFetchPoisInBox(...args),
  },
}));

import { findOvernightsNear } from '@/infrastructure/trips/overnightFinder';

function makePoi(partial: Partial<Poi> & { id: string }): Poi {
  return {
    id: partial.id,
    category: partial.category ?? 'hotel',
    name: partial.name ?? `POI ${partial.id}`,
    latitude: partial.latitude ?? 0,
    longitude: partial.longitude ?? 0,
  };
}

describe('findOvernightsNear', () => {
  beforeEach(() => {
    mockFetchPoisInBox.mockReset();
  });

  it('chama overpass com hotel + pousada e retorna ordenado por distancia', async () => {
    mockFetchPoisInBox.mockImplementation(
      async (_bbox: unknown, category: string) => {
        if (category === 'hotel') {
          return [
            makePoi({
              id: 'hotel-far',
              category: 'hotel',
              name: 'Hotel Longe',
              latitude: -23.5 + 0.05,
              longitude: -46.5,
            }),
            makePoi({
              id: 'hotel-close',
              category: 'hotel',
              name: 'Hotel Perto',
              latitude: -23.5 + 0.005,
              longitude: -46.5,
            }),
          ];
        }
        if (category === 'pousada') {
          return [
            makePoi({
              id: 'pousada-mid',
              category: 'pousada',
              name: 'Pousada Meio',
              latitude: -23.5 + 0.02,
              longitude: -46.5,
            }),
          ];
        }
        return [];
      },
    );

    const results = await findOvernightsNear({
      center: { latitude: -23.5, longitude: -46.5 },
    });

    // 3 resultados, ordenados ascendente por distancia
    expect(results.map((r) => r.id)).toEqual([
      'hotel-close',
      'pousada-mid',
      'hotel-far',
    ]);
    // distancias coerentes
    expect(results[0]!.distanceMeters).toBeLessThan(results[1]!.distanceMeters);
    expect(results[1]!.distanceMeters).toBeLessThan(results[2]!.distanceMeters);
  });

  it('dedup por id quando POI aparece em ambas as categorias', async () => {
    mockFetchPoisInBox.mockImplementation(
      async (_bbox: unknown, category: string) => {
        if (category === 'hotel') {
          return [
            makePoi({
              id: 'dup-1',
              category: 'hotel',
              latitude: -23.5,
              longitude: -46.5,
            }),
          ];
        }
        if (category === 'pousada') {
          return [
            makePoi({
              id: 'dup-1',
              category: 'pousada',
              latitude: -23.5,
              longitude: -46.5,
            }),
          ];
        }
        return [];
      },
    );
    const results = await findOvernightsNear({
      center: { latitude: -23.5, longitude: -46.5 },
    });
    expect(results.length).toBe(1);
  });

  it('respeita maxResults', async () => {
    mockFetchPoisInBox.mockImplementation(async () => {
      return Array.from({ length: 10 }, (_, i) =>
        makePoi({
          id: `p${i}`,
          category: 'hotel',
          latitude: -23.5 + i * 0.001,
          longitude: -46.5,
        }),
      );
    });
    const results = await findOvernightsNear({
      center: { latitude: -23.5, longitude: -46.5 },
      maxResults: 3,
    });
    expect(results.length).toBe(3);
  });

  it('falha numa categoria nao zera a outra (allSettled)', async () => {
    mockFetchPoisInBox.mockImplementation(
      async (_bbox: unknown, category: string) => {
        if (category === 'hotel') {
          throw new Error('overpass timeout');
        }
        return [
          makePoi({
            id: 'pousada-ok',
            category: 'pousada',
            latitude: -23.5,
            longitude: -46.5,
          }),
        ];
      },
    );
    const results = await findOvernightsNear({
      center: { latitude: -23.5, longitude: -46.5 },
    });
    expect(results.map((r) => r.id)).toEqual(['pousada-ok']);
  });

  it('retorna [] quando ambas categorias falham', async () => {
    mockFetchPoisInBox.mockRejectedValue(new Error('overpass down'));
    const results = await findOvernightsNear({
      center: { latitude: 0, longitude: 0 },
    });
    expect(results).toEqual([]);
  });
});
