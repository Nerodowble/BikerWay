import {
  DEFAULT_COMPLETION_THRESHOLD,
  DEFAULT_COVERAGE_RADIUS_M,
  DEFAULT_FINISH_PROXIMITY_KM,
  evaluateTripProgress,
} from '@/domains/rideHistory/completionDetector';

/**
 * Polyline sintetica: 10 pontos em linha reta entre (-23.55, -46.63) e
 * (-23.50, -46.58). Distancia entre pontos: ~700m. Permite testar cobertura
 * por proximidade sem depender do JSON real.
 */
function syntheticPolyline(): Array<{ latitude: number; longitude: number }> {
  const N = 10;
  const startLat = -23.55;
  const startLng = -46.63;
  const endLat = -23.5;
  const endLng = -46.58;
  return Array.from({ length: N }, (_, i) => ({
    latitude: startLat + ((endLat - startLat) * i) / (N - 1),
    longitude: startLng + ((endLng - startLng) * i) / (N - 1),
  }));
}

describe('evaluateTripProgress', () => {
  const polyline = syntheticPolyline();
  const fim = polyline[polyline.length - 1] ?? {
    latitude: 0,
    longitude: 0,
  };

  it('exporta defaults coerentes com o brainstorm (80%, 500m, 2km)', () => {
    expect(DEFAULT_COMPLETION_THRESHOLD).toBeCloseTo(0.8, 5);
    expect(DEFAULT_COVERAGE_RADIUS_M).toBe(500);
    expect(DEFAULT_FINISH_PROXIMITY_KM).toBe(2);
  });

  it('marca apenas pontos dentro do raio de cobertura', () => {
    // posicao perto SO do indice 0
    const result = evaluateTripProgress({
      polyline,
      coveredIndices: new Set<number>(),
      position: { latitude: -23.55, longitude: -46.63 },
      coordenadaFim: fim,
    });
    expect(result.coveredIndices.has(0)).toBe(true);
    // Pontos longe nao sao marcados — indices 5+ ficam a >>500m
    expect(result.coveredIndices.size).toBeLessThanOrEqual(2);
  });

  it('acumula coberturas entre chamadas sem perder indices ja marcados', () => {
    const first = evaluateTripProgress({
      polyline,
      coveredIndices: new Set<number>(),
      position: polyline[0] ?? { latitude: 0, longitude: 0 },
      coordenadaFim: fim,
    });
    const second = evaluateTripProgress({
      polyline,
      coveredIndices: first.coveredIndices,
      position: polyline[5] ?? { latitude: 0, longitude: 0 },
      coordenadaFim: fim,
    });
    expect(second.coveredIndices.has(0)).toBe(true);
    expect(second.coveredIndices.has(5)).toBe(true);
  });

  it('isCompleted=false quando cobertura < 80%, mesmo perto do fim', () => {
    // Cobertura apenas dos indices 0..5 (60% de 10). Posicao 1km a leste
    // do fim — perto o suficiente pra criterio de proximidade, mas longe
    // o suficiente pra nao adicionar coverage nova ao Set durante a
    // avaliacao.
    const covered = new Set<number>([0, 1, 2, 3, 4, 5]);
    const position = {
      latitude: fim.latitude,
      longitude: fim.longitude + 0.01, // ~1km a leste em -23deg
    };
    const result = evaluateTripProgress({
      polyline,
      coveredIndices: covered,
      position,
      coordenadaFim: fim,
    });
    expect(result.completionRatio).toBeLessThan(0.8);
    expect(result.distanceFromEndKm).toBeLessThan(2);
    expect(result.isCompleted).toBe(false);
  });

  it('isCompleted=false quando >=80% cobertos mas longe do fim', () => {
    const covered = new Set<number>([0, 1, 2, 3, 4, 5, 6, 7]);
    const result = evaluateTripProgress({
      polyline,
      coveredIndices: covered,
      // posicao 5km ao norte do fim (longe demais)
      position: { latitude: fim.latitude + 0.045, longitude: fim.longitude },
      coordenadaFim: fim,
    });
    expect(result.completionRatio).toBeCloseTo(0.8, 2);
    expect(result.distanceFromEndKm).toBeGreaterThan(2);
    expect(result.isCompleted).toBe(false);
  });

  it('isCompleted=true quando >=80% cobertos E posicao perto do fim', () => {
    const covered = new Set<number>([0, 1, 2, 3, 4, 5, 6, 7]);
    const result = evaluateTripProgress({
      polyline,
      coveredIndices: covered,
      position: fim,
      coordenadaFim: fim,
    });
    expect(result.completionRatio).toBeGreaterThanOrEqual(0.8);
    expect(result.distanceFromEndKm).toBeLessThan(2);
    expect(result.isCompleted).toBe(true);
  });

  it('nao muta o Set de input', () => {
    const original = new Set<number>([0]);
    evaluateTripProgress({
      polyline,
      coveredIndices: original,
      position: polyline[3] ?? { latitude: 0, longitude: 0 },
      coordenadaFim: fim,
    });
    // Set original continua so com o 0
    expect(Array.from(original)).toEqual([0]);
  });

  it('polyline vazia retorna 0% e nao quebra', () => {
    const result = evaluateTripProgress({
      polyline: [],
      coveredIndices: new Set<number>(),
      position: { latitude: 0, longitude: 0 },
      coordenadaFim: { latitude: 0, longitude: 0 },
    });
    expect(result.completionRatio).toBe(0);
    expect(result.isCompleted).toBe(false);
  });
});
