/**
 * F35.2 — Detector puro de conclusao de rota.
 *
 * Estrategia: o piloto "completou" a rota quando
 *   1. >= 80% dos pontos da polilinha_simplificada ja foram cobertos (raio
 *      de 500m em qualquer momento da viagem — proximidade unica vez basta);
 *   2. A posicao atual esta a <= 2 km da `coordenada_fim` da rota.
 *
 * Sem GPS detalhado salvo aqui (esse e papel do Replay F34.10). So um Set
 * de indices visitados.
 */

const EARTH_RADIUS_METERS = 6_371_000;

export const DEFAULT_COVERAGE_RADIUS_M = 500;
export const DEFAULT_COMPLETION_THRESHOLD = 0.8;
export const DEFAULT_FINISH_PROXIMITY_KM = 2;

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface TripProgressInput {
  /** Polyline curada do catalogo, convertida pra {lat,lng}. */
  polyline: ReadonlyArray<LatLng>;
  /** Indices ja marcados como cobertos em samples anteriores. */
  coveredIndices: ReadonlySet<number>;
  /** Posicao atual do piloto (GPS sample novo). */
  position: LatLng;
  /** Fim da rota do catalogo (criterio de proximidade final). */
  coordenadaFim: LatLng;
  /** Override pro raio de cobertura por ponto. Default 500m. */
  radiusMeters?: number;
  /** Override pro % minimo de cobertura. Default 0.8 (80%). */
  completionThreshold?: number;
  /** Override pra proximidade ao fim em km. Default 2 km. */
  finishProximityKm?: number;
}

export interface TripProgress {
  /** Set atualizado (novo Set — nao muta o input). */
  coveredIndices: Set<number>;
  /** 0..1 — fracao da polyline ja coberta. */
  completionRatio: number;
  /** Distancia em km do piloto ate `coordenadaFim`. */
  distanceFromEndKm: number;
  /** True quando AMBOS criterios batem (>= threshold E perto do fim). */
  isCompleted: boolean;
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Haversine local pra evitar dependencia do shared helper (que exige
 * `GeoPosition` com timestamp). O detector e puro: aceita LatLng minimo e
 * fica isolado pra testes determinacionais.
 */
function distanceMeters(a: LatLng, b: LatLng): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Distancia em metros do ponto P ao segmento de reta AB, usando projecao
 * equirectangular local centrada em A. Pra distancias ate ~5km essa
 * projecao tem erro <1% — bom o suficiente pro raio de 500m do detector.
 *
 * Por que segmento e nao so vertice? Polylines do catalogo sao
 * decimadas (5-20 pontos pra rota inteira). Se medissemos so distancia ao
 * vertice, o piloto que passa A MEIO CAMINHO entre dois vertices nao
 * marcaria nenhum dos dois — sample "se perderia" entre os pontos.
 * Medindo ao segmento, qualquer passagem dentro do raio marca AMBOS os
 * vertices do segmento, o que reflete melhor "estou na rota".
 */
function distanceToSegmentMeters(p: LatLng, a: LatLng, b: LatLng): number {
  // Projecao equirectangular local com origem em A.
  const cosLatA = Math.cos(toRadians(a.latitude));
  const toMetersLat = (EARTH_RADIUS_METERS * Math.PI) / 180;
  const ax = 0;
  const ay = 0;
  const bx = (b.longitude - a.longitude) * toMetersLat * cosLatA;
  const by = (b.latitude - a.latitude) * toMetersLat;
  const px = (p.longitude - a.longitude) * toMetersLat * cosLatA;
  const py = (p.latitude - a.latitude) * toMetersLat;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    // Segmento degenerado (A === B) — cai pra haversine direto.
    return distanceMeters(p, a);
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(px - projX, py - projY);
}

/**
 * Avalia um sample novo: marca quais SEGMENTOS estao dentro do raio
 * (marcando ambos os vertices do segmento), computa cobertura acumulada
 * e checa se ja completou. Funcao pura — o caller decide se vai persistir.
 */
export function evaluateTripProgress(input: TripProgressInput): TripProgress {
  const radius = input.radiusMeters ?? DEFAULT_COVERAGE_RADIUS_M;
  const threshold = input.completionThreshold ?? DEFAULT_COMPLETION_THRESHOLD;
  const finishKm = input.finishProximityKm ?? DEFAULT_FINISH_PROXIMITY_KM;

  const next = new Set(input.coveredIndices);
  const N = input.polyline.length;

  if (N === 1) {
    // Polyline degenerada com um unico ponto — caimos pra check vertice.
    const only = input.polyline[0];
    if (only && distanceMeters(only, input.position) <= radius) {
      next.add(0);
    }
  } else {
    // Itera por segmentos consecutivos. Marcar ambos os vertices quando o
    // segmento esta proximo evita "buracos" entre pontos decimados.
    for (let i = 0; i < N - 1; i += 1) {
      if (next.has(i) && next.has(i + 1)) continue;
      const A = input.polyline[i];
      const B = input.polyline[i + 1];
      if (!A || !B) continue;
      const d = distanceToSegmentMeters(input.position, A, B);
      if (d <= radius) {
        next.add(i);
        next.add(i + 1);
      }
    }
  }

  const ratio = N > 0 ? next.size / N : 0;
  const distanceFromEndMeters = distanceMeters(
    input.position,
    input.coordenadaFim,
  );
  const distanceFromEndKm = distanceFromEndMeters / 1000;

  const isCompleted = ratio >= threshold && distanceFromEndKm <= finishKm;

  return {
    coveredIndices: next,
    completionRatio: ratio,
    distanceFromEndKm,
    isCompleted,
  };
}
