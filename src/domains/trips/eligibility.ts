import type { CatalogRoute } from '../catalog/types';

/**
 * F35.7 — Filtros pra TripBuilder (manual). Dado o catalogo e a sequencia
 * atual de rotas escolhidas, retorna quais rotas o piloto pode acrescentar
 * NO PROXIMO DIA.
 *
 * Regras:
 *   - Dia 1: qualquer rota do catalogo.
 *   - Dia N+1: rotas cuja `coordenada_inicio` esta a <= proximityKm da
 *     `coordenada_fim` do dia anterior (mesma logica do gerador auto).
 *   - Nunca repete uma rota ja escolhida no trip.
 *
 * Funcao pura — testavel sem store/db.
 */

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineKm(
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
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export const DEFAULT_BUILDER_PROXIMITY_KM = 30;

export interface EligibilityInput {
  catalog: ReadonlyArray<CatalogRoute>;
  /** Rotas ja escolhidas pelos dias anteriores. */
  selectedRotaIds: ReadonlyArray<string>;
  /** Override da proximidade (km). Default 30km. */
  proximityKm?: number;
}

export function eligibleRoutesForNextDay(
  input: EligibilityInput,
): CatalogRoute[] {
  const proximity = input.proximityKm ?? DEFAULT_BUILDER_PROXIMITY_KM;
  const selectedSet = new Set(input.selectedRotaIds);
  if (input.selectedRotaIds.length === 0) {
    // Dia 1: qualquer rota
    return [...input.catalog];
  }
  const lastId = input.selectedRotaIds[input.selectedRotaIds.length - 1];
  const lastRoute = input.catalog.find((r) => r.rota_id === lastId);
  if (!lastRoute) return [];
  const endPoint = {
    latitude: lastRoute.coordenada_fim.latitude,
    longitude: lastRoute.coordenada_fim.longitude,
  };
  return input.catalog.filter((r) => {
    if (selectedSet.has(r.rota_id)) return false;
    // Conexao declarada pelo curador conta automaticamente
    if (lastRoute.interconexoes_ids.includes(r.rota_id)) return true;
    const d = haversineKm(endPoint, {
      latitude: r.coordenada_inicio.latitude,
      longitude: r.coordenada_inicio.longitude,
    });
    return d <= proximity;
  });
}
