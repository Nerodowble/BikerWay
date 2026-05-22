export type Pavimento = 'asfalto' | 'misto' | 'terra';
export type NivelCurvas = 'baixo' | 'medio' | 'alto';

export interface CatalogRouteCoordinate {
  cidade: string;
  latitude: number;
  longitude: number;
}

export interface CatalogPontoApoio {
  tipo: string;
  nome: string;
  latitude: number;
  longitude: number;
  descricao_biker: string;
}

export interface CatalogPolylinePoint {
  lat: number;
  lng: number;
}

export interface CatalogRoute {
  rota_id: string;
  nome_rota: string;
  estado_pais: string;
  coordenada_inicio: CatalogRouteCoordinate;
  coordenada_fim: CatalogRouteCoordinate;
  distancia_total_km: number;
  total_pedagios_moto_reais: number;
  caracteristicas: {
    tipo_pavimento: Pavimento;
    nivel_curvas: NivelCurvas;
    trecho_critico_sem_posto_km: number;
  };
  interconexoes_ids: string[];
  pontos_apoio_homologados: CatalogPontoApoio[];
  polilinha_simplificada: CatalogPolylinePoint[];
}

/**
 * User-controlled filters used by `matchRoutes`. Origin is required (computed
 * upstream from GPS or geocode), the categorical filters are nullable to
 * represent the "Qualquer" UX choice (skip the filter entirely).
 */
export interface CatalogFilters {
  origin: { latitude: number; longitude: number };
  budgetReais: number;
  motoConsumoKmL: number;
  motoSafeAutonomyKm: number;
  pavimento: 'asfalto' | 'misto' | null;
  nivelCurvas: NivelCurvas | null;
}

/**
 * Enriched result row produced by `matchRoutes`. We keep `overBudget` /
 * `autonomyWarning` as cheap booleans so the UI can branch without
 * recomputing the underlying math.
 */
export interface CatalogRouteMatch {
  route: CatalogRoute;
  distanceToStartKm: number;
  estimatedFuelLiters: number;
  estimatedFuelCostReais: number;
  estimatedTotalCostReais: number;
  /**
   * Round-trip estimate: approach (rider GPS → route start) + route itself +
   * return (route end → rider GPS). Toll is counted once (single pass through
   * the route's tolled stretch); approach/return are modelled as great-circle
   * distances so they're a floor, not an upper bound. `overBudget` is keyed
   * to `roundTripTotalCostReais` because that's what the rider actually
   * spends in a same-day out-and-back.
   */
  approachDistanceKm: number;
  returnDistanceKm: number;
  roundTripDistanceKm: number;
  roundTripFuelLiters: number;
  roundTripFuelCostReais: number;
  roundTripTotalCostReais: number;
  autonomyWarning: boolean;
  overBudget: boolean;
}
