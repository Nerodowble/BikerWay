import { overpassClient } from '@/infrastructure/poi/overpassClient';
import type { Poi, BoundingBox } from '@/domains/poi/types';

/**
 * F35.6 rev — Busca pernoites (hoteis + pousadas) no entorno do
 * `coordenada_fim` do dia anterior do trip. Usa o overpassClient
 * existente, em duas chamadas (categorias `hotel` e `pousada`),
 * concatena e ordena por distancia da posicao.
 *
 * Nao e injetado no AutoTrip — pernoites sao buscados lazy quando o
 * piloto expande/clica no card, evitando uma rajada de queries Overpass
 * no boot. O store (`tripsStore`) tem uma action `loadOvernightsFor`
 * que chama essa funcao e cacheia o resultado por chave de trip+dia.
 */

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * 1000;
}

/** Calcula uma bbox quadrada centrada num ponto, com semi-lado em km.
 *  Imprecisa em latitudes altas — pra Brasil (latitude ~-30 a 5) erro
 *  fica abaixo de 5% no semi-lado leste-oeste. */
function bboxAround(
  center: { latitude: number; longitude: number },
  semiSideKm: number,
): BoundingBox {
  const deltaLat = semiSideKm / 111.0;
  const deltaLon = semiSideKm / (111.32 * Math.cos(toRad(center.latitude)));
  return {
    south: center.latitude - deltaLat,
    north: center.latitude + deltaLat,
    west: center.longitude - deltaLon,
    east: center.longitude + deltaLon,
  };
}

export interface OvernightOption {
  id: string;
  name: string;
  category: 'hotel' | 'pousada';
  latitude: number;
  longitude: number;
  distanceMeters: number;
}

export interface FindOvernightInput {
  center: { latitude: number; longitude: number };
  /** Raio em km. Default 8km (~5 milhas — abrange centros de cidade
   *  pequena tipo Caraguatatuba sem trazer alojamento de cidade vizinha). */
  radiusKm?: number;
  /** Limite de resultados retornados (ordenados por distancia). */
  maxResults?: number;
}

const DEFAULT_RADIUS_KM = 8;
const DEFAULT_MAX_RESULTS = 6;

export async function findOvernightsNear(
  input: FindOvernightInput,
): Promise<OvernightOption[]> {
  const radius = input.radiusKm ?? DEFAULT_RADIUS_KM;
  const max = input.maxResults ?? DEFAULT_MAX_RESULTS;
  const bbox = bboxAround(input.center, radius);

  // Roda as duas categorias em paralelo. allSettled pra que falha numa
  // (rate limit / timeout) nao zere a outra.
  const [hotelsResult, pousadasResult] = await Promise.allSettled([
    overpassClient.fetchPoisInBox(bbox, 'hotel'),
    overpassClient.fetchPoisInBox(bbox, 'pousada'),
  ]);

  const all: Poi[] = [];
  if (hotelsResult.status === 'fulfilled') all.push(...hotelsResult.value);
  if (pousadasResult.status === 'fulfilled') all.push(...pousadasResult.value);

  // Dedup por id (mesma POI poderia em teoria aparecer nas duas categorias
  // se OSM tagger usou ambas — improvavel mas defensive).
  const seen = new Set<string>();
  const unique: Poi[] = [];
  for (const poi of all) {
    if (seen.has(poi.id)) continue;
    seen.add(poi.id);
    unique.push(poi);
  }

  const withDistance: OvernightOption[] = unique
    .filter((p) => p.category === 'hotel' || p.category === 'pousada')
    .map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category as 'hotel' | 'pousada',
      latitude: p.latitude,
      longitude: p.longitude,
      distanceMeters: haversineMeters(input.center, {
        latitude: p.latitude,
        longitude: p.longitude,
      }),
    }));

  // Ordena por distancia ascendente, trunca em max.
  withDistance.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return withDistance.slice(0, max);
}
