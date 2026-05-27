export type Pavimento = 'asfalto' | 'misto' | 'terra';
export type NivelCurvas = 'baixo' | 'medio' | 'alto';
/**
 * Curated metadata enums (F21.1). Kept aligned with
 * `prompts/catalog-schema.json` and `scripts/validate-catalog.ts`. If you add
 * a new tier here, mirror it in both files so the validator stays the source
 * of truth for what the curated JSON may carry.
 */
export type Confiabilidade = 'alta' | 'media' | 'baixa';
export type Dificuldade = 'iniciante' | 'intermediario' | 'avancado';
export type SistemaCobranca = 'fisica' | 'free_flow';

/**
 * Per-plaza toll detail (F28). Surfaces the breakdown that
 * `total_pedagios_moto_reais` aggregates so the rider sees *which* plazas they
 * pass through and so future audits can spot when a concessionaire reajuste
 * lands. All values are for motorcycles (categoria 5 ANTT), single-pass.
 */
export interface PedagioPraca {
  nome: string;
  km?: number;
  valor_moto_reais: number;
  sistema: SistemaCobranca;
  concessionaria?: string;
  fonte_url?: string;
}

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
  /**
   * Sum of all motorcycle toll fees for ONE pass through the route (one-way).
   * The matcher doubles this when computing the round-trip cost — the rider
   * pays each plaza both going out and coming back. Keep this value as the
   * one-way sum of `pedagios_detalhados[].valor_moto_reais` so the two stay
   * in sync.
   */
  total_pedagios_moto_reais: number;
  caracteristicas: {
    tipo_pavimento: Pavimento;
    nivel_curvas: NivelCurvas;
    trecho_critico_sem_posto_km: number;
  };
  interconexoes_ids: string[];
  pontos_apoio_homologados: CatalogPontoApoio[];
  polilinha_simplificada: CatalogPolylinePoint[];
  /**
   * Curated metadata (F21.1). All optional — older catalog entries pre-date
   * the framework and must keep rendering. The card guards every read with
   * an `undefined` check so absent fields render no extra UI rather than a
   * placeholder. Invalid values (e.g. unknown enum string in the JSON) are
   * dropped silently during validation (`catalogClient.ts`) so a single
   * mis-curated entry cannot brick the catalog screen.
   */
  ultima_revisao?: string;
  confiabilidade?: Confiabilidade;
  dificuldade?: Dificuldade;
  melhor_epoca?: string;
  descricao_biker?: string;
  fontes_dados?: string[];
  dicas_seguranca?: string[];
  /**
   * Per-plaza breakdown of `total_pedagios_moto_reais` (F28). Optional —
   * older entries pre-date this field. When present, the array sums to
   * `total_pedagios_moto_reais` (one-way) and the rider-facing detail screen
   * can list each plaza individually.
   */
  pedagios_detalhados?: PedagioPraca[];
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
  /**
   * Rider-editable price per litre. The catalog screen pre-fills this with
   * `DEFAULT_FUEL_PRICE_REAIS` but a rider in a cheaper (interior) or pricier
   * (litoral / capital) region can override before the search so the cost
   * estimate reflects their actual pump. Non-positive values fall back to
   * the default inside the matcher to avoid zero-cost cards.
   */
  fuelPricePerLiter: number;
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
  /**
   * Price per litre used in the cost breakdown. We surface this on the card
   * so the rider can sanity-check the math ("R$ X,XX × Y L"); otherwise the
   * total is opaque when the rider has edited the default to a regional
   * price.
   */
  fuelPricePerLiter: number;
  autonomyWarning: boolean;
  overBudget: boolean;
  /**
   * Real-road metrics provided by OSRM, written by
   * `refineResultsWithOsrm` after the initial haversine-based card has
   * already rendered. All fields are optional because the refinement is
   * fire-and-forget — when OSRM is offline (or the rider's match falls
   * outside the top-N refine budget) we keep the haversine numbers and
   * leave these undefined.
   *
   * `realRouteDistanceKm` may differ from `route.distancia_total_km` (the
   * curated JSON value) because OSRM re-computes the polyline with current
   * road data and waypoint decimation.
   */
  realApproachDistanceKm?: number;
  realRouteDistanceKm?: number;
  realReturnDistanceKm?: number;
  realRoundTripDistanceKm?: number;
  realRoundTripFuelLiters?: number;
  realRoundTripFuelCostReais?: number;
  realRoundTripTotalCostReais?: number;
  /**
   * F35.0.D rev3 — Polyline OSRM-real do trecho da rota (start → polyline
   * waypoints → end). Persistida pelo `refineSingleMatch` quando o lookup do
   * leg "rota" termina com sucesso, INDEPENDENTE dos legs approach/return.
   *
   * Antes desse campo, o refine fazia 3 chamadas OSRM, usava só o
   * `distanceMeters` da do meio e descartava as coordenadas. O modal de
   * prévia do RouteDetail tinha que refazer o fetch — quando o usuario
   * abria o modal antes da refine terminar, ele esperava na fila do
   * servidor publico OSRM (cabendo no pior caso ~37s entre timeout +
   * retries).
   *
   * Agora o modal le esse campo direto se existir, e so dispara o fetch
   * proprio se a refine nao rodou (rota fora do top-N) ou ainda nao
   * terminou.
   */
  realRouteCoordinates?: ReadonlyArray<{ latitude: number; longitude: number }>;
  /**
   * F35.0.D rev4 — Polyline OSRM-real do trecho de aproximacao (GPS do
   * piloto → coordenada_inicio). Persistida pelo `refineSingleMatch` /
   * `fetchPreviewCoordinates` quando o leg "approach" termina com sucesso.
   * Renderizada em laranja no modal de previa pra mostrar quanto o piloto
   * precisa pedalar do ponto atual ate o comeco da rota. Fallback no modal e
   * uma linha reta de 2 pontos enquanto OSRM nao resolve.
   */
  realApproachCoordinates?: ReadonlyArray<{ latitude: number; longitude: number }>;
  /**
   * `true` while at least one of the three OSRM calls (approach, route,
   * return) is still in flight. The card flips to a small "atualizando…"
   * indicator while this is set. Mutually exclusive with
   * `hasRealMetrics === true`.
   */
  isRefining?: boolean;
  /**
   * `true` once all three OSRM calls have succeeded and the `real*` fields
   * are populated. The card swaps the haversine round-trip line for the
   * OSRM-derived one (and shows a small green dot).
   */
  hasRealMetrics?: boolean;
}
