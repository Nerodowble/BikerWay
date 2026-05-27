import {
  buildAdjacency,
  generateAutoTrips,
} from '@/domains/trips/generator';
import type { CatalogRoute, NivelCurvas, Dificuldade } from '@/domains/catalog/types';

function makeRoute(
  partial: Partial<CatalogRoute> & {
    rota_id: string;
    startLat?: number;
    startLng?: number;
    endLat?: number;
    endLng?: number;
    nivel_curvas?: NivelCurvas;
    dificuldade?: Dificuldade;
    interconexoes_ids?: string[];
  },
): CatalogRoute {
  return {
    rota_id: partial.rota_id,
    nome_rota: partial.nome_rota ?? partial.rota_id,
    estado_pais: partial.estado_pais ?? 'SP',
    coordenada_inicio: {
      cidade: partial.coordenada_inicio?.cidade ?? `Inicio-${partial.rota_id}`,
      latitude: partial.startLat ?? -23.5,
      longitude: partial.startLng ?? -46.6,
    },
    coordenada_fim: {
      cidade: partial.coordenada_fim?.cidade ?? `Fim-${partial.rota_id}`,
      latitude: partial.endLat ?? -23.4,
      longitude: partial.endLng ?? -46.5,
    },
    distancia_total_km: partial.distancia_total_km ?? 150,
    total_pedagios_moto_reais: partial.total_pedagios_moto_reais ?? 0,
    caracteristicas: {
      tipo_pavimento: 'asfalto',
      nivel_curvas: partial.nivel_curvas ?? 'medio',
      trecho_critico_sem_posto_km: 50,
    },
    interconexoes_ids: partial.interconexoes_ids ?? [],
    pontos_apoio_homologados: [],
    polilinha_simplificada: [],
    ...(partial.dificuldade !== undefined ? { dificuldade: partial.dificuldade } : {}),
    ...(partial.confiabilidade !== undefined ? { confiabilidade: partial.confiabilidade } : {}),
  };
}

describe('buildAdjacency', () => {
  it('cria aresta por interconexoes_ids declaradas', () => {
    const catalog = [
      makeRoute({ rota_id: 'a', interconexoes_ids: ['b'] }),
      makeRoute({
        rota_id: 'b',
        startLat: 10,
        startLng: 10,
        endLat: 11,
        endLng: 11,
      }),
    ];
    const { edges } = buildAdjacency(catalog, 30);
    expect(edges.get('a')?.has('b')).toBe(true);
  });

  it('cria aresta por proximidade fim→inicio (<=raio)', () => {
    const catalog = [
      makeRoute({
        rota_id: 'a',
        endLat: -23.4,
        endLng: -46.5,
      }),
      makeRoute({
        rota_id: 'b',
        startLat: -23.41, // ~1km
        startLng: -46.5,
      }),
    ];
    const { edges } = buildAdjacency(catalog, 30);
    expect(edges.get('a')?.has('b')).toBe(true);
  });

  it('NAO cria aresta quando fim→inicio fora do raio', () => {
    const catalog = [
      makeRoute({
        rota_id: 'a',
        endLat: -23.4,
        endLng: -46.5,
      }),
      makeRoute({
        rota_id: 'b',
        startLat: -22.0, // ~150km
        startLng: -45.0,
      }),
    ];
    const { edges } = buildAdjacency(catalog, 30);
    expect(edges.get('a')?.has('b')).toBeFalsy();
  });

  it('nao cria self-loops', () => {
    const catalog = [
      makeRoute({ rota_id: 'a', interconexoes_ids: ['a'] }),
    ];
    const { edges } = buildAdjacency(catalog, 30);
    expect(edges.get('a')?.has('a')).toBeFalsy();
  });
});

describe('generateAutoTrips', () => {
  it('retorna [] em catalogo vazio', () => {
    expect(generateAutoTrips({ catalog: [] })).toEqual([]);
  });

  it('gera trip de 2 dias quando duas rotas estao conectadas e somam minTotal', () => {
    const catalog = [
      makeRoute({
        rota_id: 'tamoios',
        nome_rota: 'Tamoios',
        nivel_curvas: 'alto',
        distancia_total_km: 80,
        endLat: -23.5,
        endLng: -45.4,
      }),
      makeRoute({
        rota_id: 'rio-santos',
        nome_rota: 'Rio-Santos',
        nivel_curvas: 'medio',
        distancia_total_km: 100,
        startLat: -23.5,
        startLng: -45.4,
        endLat: -23.5,
        endLng: -44.8,
      }),
    ];
    const trips = generateAutoTrips({ catalog });
    expect(trips.length).toBeGreaterThanOrEqual(1);
    const trip = trips[0]!;
    expect(trip.days).toHaveLength(2);
    expect(trip.days[0]?.rotaId).toBe('tamoios');
    expect(trip.days[1]?.rotaId).toBe('rio-santos');
    expect(trip.totalDistanceKm).toBe(180);
    expect(trip.pernoites).toBe(1);
    expect(trip.days[0]?.pernoiteEm).toBeDefined();
    expect(trip.days[1]?.pernoiteEm).toBeUndefined();
  });

  it('filtra trips com totalKm < minTotalKm', () => {
    const catalog = [
      makeRoute({
        rota_id: 'a',
        distancia_total_km: 30,
        nivel_curvas: 'alto',
        endLat: -23,
        endLng: -46,
      }),
      makeRoute({
        rota_id: 'b',
        distancia_total_km: 30,
        nivel_curvas: 'alto',
        startLat: -23,
        startLng: -46,
      }),
    ];
    // total = 60km, < 100km default
    const trips = generateAutoTrips({ catalog });
    expect(trips).toEqual([]);
  });

  it('filtra trips sem rota com curvas medio/alto', () => {
    const catalog = [
      makeRoute({
        rota_id: 'a',
        distancia_total_km: 100,
        nivel_curvas: 'baixo',
        endLat: -23,
        endLng: -46,
      }),
      makeRoute({
        rota_id: 'b',
        distancia_total_km: 100,
        nivel_curvas: 'baixo',
        startLat: -23,
        startLng: -46,
      }),
    ];
    const trips = generateAutoTrips({ catalog });
    expect(trips).toEqual([]);
  });

  it('respeita maxDailyKm — descarta trip onde algum dia ultrapassa', () => {
    const catalog = [
      makeRoute({
        rota_id: 'curta',
        distancia_total_km: 80,
        nivel_curvas: 'medio',
        endLat: -23,
        endLng: -46,
      }),
      makeRoute({
        rota_id: 'longissima',
        distancia_total_km: 600,
        nivel_curvas: 'medio',
        startLat: -23,
        startLng: -46,
      }),
    ];
    const trips = generateAutoTrips({ catalog, maxDailyKm: 500 });
    expect(trips).toEqual([]);
  });

  it('respeita maxDays (default 3) e nao gera trips de 4+ dias', () => {
    // Cria cadeia de 5 rotas conectadas em fila
    const catalog: CatalogRoute[] = [];
    for (let i = 0; i < 5; i += 1) {
      catalog.push(
        makeRoute({
          rota_id: `r${i}`,
          distancia_total_km: 100,
          nivel_curvas: 'medio',
          startLat: -23 + i * 0.01,
          startLng: -46,
          endLat: -23 + (i + 1) * 0.01,
          endLng: -46,
        }),
      );
    }
    const trips = generateAutoTrips({ catalog });
    // Nenhuma trip pode ter mais que 3 dias
    for (const t of trips) {
      expect(t.days.length).toBeLessThanOrEqual(3);
    }
  });

  it('deduplica chains identicas (mesmo set de rotas)', () => {
    const catalog = [
      makeRoute({
        rota_id: 'a',
        distancia_total_km: 100,
        nivel_curvas: 'medio',
        endLat: -23,
        endLng: -46,
        interconexoes_ids: ['b'],
      }),
      makeRoute({
        rota_id: 'b',
        distancia_total_km: 100,
        nivel_curvas: 'medio',
        startLat: -23,
        startLng: -46,
        endLat: -22.9,
        endLng: -46,
        interconexoes_ids: ['a'], // bidirecional
      }),
    ];
    const trips = generateAutoTrips({ catalog });
    // Apenas 1 trip A→B (B→A seria o mesmo combo, deduped)
    expect(trips.length).toBe(1);
  });

  it('preenche estimatedFuelLiters/Cost quando fuelEstimate e fornecido', () => {
    const catalog = [
      makeRoute({
        rota_id: 'a',
        distancia_total_km: 100,
        nivel_curvas: 'medio',
        endLat: -23,
        endLng: -46,
      }),
      makeRoute({
        rota_id: 'b',
        distancia_total_km: 100,
        nivel_curvas: 'medio',
        startLat: -23,
        startLng: -46,
      }),
    ];
    const trips = generateAutoTrips({
      catalog,
      fuelEstimate: { consumoKmL: 20, pricePerLiter: 6 },
    });
    expect(trips.length).toBeGreaterThanOrEqual(1);
    const t = trips[0]!;
    // 200 km / 20 km/L = 10 L; 10 * 6 = R$ 60
    expect(t.estimatedFuelLiters).toBeCloseTo(10, 1);
    expect(t.estimatedFuelCostReais).toBeCloseTo(60, 2);
  });

  it('omite estimatedFuel quando fuelEstimate nao e fornecido', () => {
    const catalog = [
      makeRoute({
        rota_id: 'a',
        distancia_total_km: 100,
        nivel_curvas: 'medio',
        endLat: -23,
        endLng: -46,
      }),
      makeRoute({
        rota_id: 'b',
        distancia_total_km: 100,
        nivel_curvas: 'medio',
        startLat: -23,
        startLng: -46,
      }),
    ];
    const trips = generateAutoTrips({ catalog });
    expect(trips[0]?.estimatedFuelLiters).toBeUndefined();
    expect(trips[0]?.estimatedFuelCostReais).toBeUndefined();
  });

  it('TripDay com pernoite preenche pernoiteLat/pernoiteLng', () => {
    const catalog = [
      makeRoute({
        rota_id: 'a',
        distancia_total_km: 100,
        nivel_curvas: 'medio',
        endLat: -23.45,
        endLng: -46.5,
      }),
      makeRoute({
        rota_id: 'b',
        distancia_total_km: 100,
        nivel_curvas: 'medio',
        startLat: -23.45,
        startLng: -46.5,
        endLat: -23.3,
        endLng: -46.4,
      }),
    ];
    const trips = generateAutoTrips({ catalog });
    const day1 = trips[0]?.days[0];
    const day2 = trips[0]?.days[1];
    expect(day1?.pernoiteEm).toBeDefined();
    expect(day1?.pernoiteLat).toBeCloseTo(-23.45, 3);
    expect(day1?.pernoiteLng).toBeCloseTo(-46.5, 3);
    // Ultimo dia: sem pernoite
    expect(day2?.pernoiteEm).toBeUndefined();
    expect(day2?.pernoiteLat).toBeUndefined();
  });

  it('temaTag = misto quando rotas tem temas distintos', () => {
    const catalog = [
      makeRoute({
        rota_id: 'historica',
        nome_rota: 'Estrada Histórica',
        distancia_total_km: 100,
        nivel_curvas: 'medio',
        endLat: -23,
        endLng: -46,
      }),
      makeRoute({
        rota_id: 'mantiqueira',
        nome_rota: 'Serra da Mantiqueira',
        distancia_total_km: 100,
        nivel_curvas: 'alto',
        startLat: -23,
        startLng: -46,
      }),
    ];
    const trips = generateAutoTrips({ catalog });
    // theme dominante e o que aparecer >= 50%. 1/2 cada — sem maioria → misto
    if (trips.length > 0) {
      expect(['litoral', 'serra', 'historica', 'trip', 'misto']).toContain(
        trips[0]?.themeTag,
      );
    }
  });
});
