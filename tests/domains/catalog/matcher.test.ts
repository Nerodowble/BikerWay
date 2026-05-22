import { matchRoutes } from '../../../src/domains/catalog/matcher';
import type {
  CatalogFilters,
  CatalogRoute,
  NivelCurvas,
  Pavimento,
} from '../../../src/domains/catalog/types';

interface RouteOverrides {
  id?: string;
  startLat?: number;
  startLng?: number;
  distanciaKm?: number;
  toll?: number;
  pavimento?: Pavimento;
  nivelCurvas?: NivelCurvas;
  trechoCritico?: number;
}

function makeRoute(o: RouteOverrides = {}): CatalogRoute {
  return {
    rota_id: o.id ?? 'rota-test',
    nome_rota: o.id ?? 'Rota Test',
    estado_pais: 'SP, Brasil',
    coordenada_inicio: {
      cidade: 'X',
      latitude: o.startLat ?? -23.5,
      longitude: o.startLng ?? -46.6,
    },
    coordenada_fim: { cidade: 'Y', latitude: -23.6, longitude: -46.7 },
    distancia_total_km: o.distanciaKm ?? 50,
    total_pedagios_moto_reais: o.toll ?? 0,
    caracteristicas: {
      tipo_pavimento: o.pavimento ?? 'asfalto',
      nivel_curvas: o.nivelCurvas ?? 'medio',
      trecho_critico_sem_posto_km: o.trechoCritico ?? 10,
    },
    interconexoes_ids: [],
    pontos_apoio_homologados: [],
    polilinha_simplificada: [],
  };
}

const defaultFilters: CatalogFilters = {
  origin: { latitude: -23.5, longitude: -46.6 },
  budgetReais: 0,
  motoConsumoKmL: 25,
  motoSafeAutonomyKm: 200,
  pavimento: null,
  nivelCurvas: null,
};

describe('matchRoutes', () => {
  it('sorts in-budget matches by ascending distance to the rider', () => {
    const near = makeRoute({ id: 'near', startLat: -23.51, startLng: -46.61 });
    const far = makeRoute({ id: 'far', startLat: -28.0, startLng: -49.0 });
    const result = matchRoutes([far, near], defaultFilters);
    expect(result[0]?.route.rota_id).toBe('near');
    expect(result[1]?.route.rota_id).toBe('far');
    expect(result[0]?.distanceToStartKm).toBeLessThan(
      result[1]?.distanceToStartKm ?? Number.POSITIVE_INFINITY,
    );
  });

  it('flags autonomyWarning when trecho_critico > safe autonomy', () => {
    const danger = makeRoute({ id: 'danger', trechoCritico: 300 });
    const safe = makeRoute({ id: 'safe', trechoCritico: 50 });
    const result = matchRoutes([danger, safe], {
      ...defaultFilters,
      motoSafeAutonomyKm: 200,
    });
    const dangerMatch = result.find((m) => m.route.rota_id === 'danger');
    const safeMatch = result.find((m) => m.route.rota_id === 'safe');
    expect(dangerMatch?.autonomyWarning).toBe(true);
    expect(safeMatch?.autonomyWarning).toBe(false);
  });

  it('pushes over-budget routes to the end of the list', () => {
    // 100km * 1/25 km/L * R$6 + R$0 toll = R$24 — fits under R$50 budget
    const cheap = makeRoute({ id: 'cheap', distanciaKm: 100 });
    // 1000km * 1/25 km/L * R$6 = R$240 — busts R$50 budget
    const expensive = makeRoute({ id: 'expensive', distanciaKm: 1000 });
    const result = matchRoutes(
      [cheap, expensive],
      { ...defaultFilters, budgetReais: 50 },
    );
    expect(result.length).toBe(2);
    expect(result[0]?.route.rota_id).toBe('cheap');
    expect(result[0]?.overBudget).toBe(false);
    expect(result[1]?.route.rota_id).toBe('expensive');
    expect(result[1]?.overBudget).toBe(true);
  });

  it('filters out routes whose pavimento does not match the user choice', () => {
    const asfalto = makeRoute({ id: 'asfalto', pavimento: 'asfalto' });
    const misto = makeRoute({ id: 'misto', pavimento: 'misto' });
    const terra = makeRoute({ id: 'terra', pavimento: 'terra' });
    const result = matchRoutes([asfalto, misto, terra], {
      ...defaultFilters,
      pavimento: 'asfalto',
    });
    expect(result.length).toBe(1);
    expect(result[0]?.route.rota_id).toBe('asfalto');
  });

  it('filters by nivelCurvas independently of pavimento', () => {
    const r1 = makeRoute({ id: 'r1', nivelCurvas: 'baixo' });
    const r2 = makeRoute({ id: 'r2', nivelCurvas: 'medio' });
    const r3 = makeRoute({ id: 'r3', nivelCurvas: 'alto' });
    const result = matchRoutes([r1, r2, r3], {
      ...defaultFilters,
      nivelCurvas: 'alto',
    });
    expect(result.length).toBe(1);
    expect(result[0]?.route.rota_id).toBe('r3');
  });

  it('computes round-trip distance and cost (approach + route + return)', () => {
    // Rider sits at the START coordinate, so approach == 0 and return is the
    // straight-line distance from end back to start (~14 km for the default
    // start -23.5,-46.6 / end -23.6,-46.7 used in makeRoute).
    const route = makeRoute({ id: 'rt', distanciaKm: 100, toll: 0 });
    const [match] = matchRoutes([route], defaultFilters);
    expect(match).toBeDefined();
    if (!match) return;
    expect(match.approachDistanceKm).toBeCloseTo(0, 1);
    expect(match.returnDistanceKm).toBeGreaterThan(10);
    expect(match.returnDistanceKm).toBeLessThan(20);
    // Round-trip is approach + 100km route + return; must beat the rota-only
    // distance by exactly the round-trip overhead.
    expect(match.roundTripDistanceKm).toBeGreaterThan(
      route.distancia_total_km,
    );
    expect(match.roundTripFuelCostReais).toBeGreaterThan(
      match.estimatedFuelCostReais,
    );
    expect(match.roundTripTotalCostReais).toBeGreaterThan(
      match.estimatedTotalCostReais,
    );
  });

  it('flips overBudget based on round-trip cost, not rota-only', () => {
    // 100km route + ~14km return + 0 approach ≈ 114km @ 25 km/L * R$6 ≈ R$27.4
    // rota-only cost is R$24, so a budget of R$25 must still mark it over.
    const route = makeRoute({ id: 'edge', distanciaKm: 100, toll: 0 });
    const result = matchRoutes([route], {
      ...defaultFilters,
      budgetReais: 25,
    });
    expect(result[0]?.overBudget).toBe(true);
    expect(result[0]?.estimatedTotalCostReais).toBeLessThan(25);
    expect(result[0]?.roundTripTotalCostReais).toBeGreaterThan(25);
  });

  it('passes all routes through when both categorical filters are null', () => {
    const a = makeRoute({ id: 'a', pavimento: 'terra', nivelCurvas: 'baixo' });
    const b = makeRoute({ id: 'b', pavimento: 'asfalto', nivelCurvas: 'alto' });
    const result = matchRoutes([a, b], defaultFilters);
    expect(result.length).toBe(2);
  });
});
