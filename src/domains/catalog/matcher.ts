import { calculateHaversineDistance } from './haversine';
import { calculateRouteCost, DEFAULT_FUEL_PRICE_REAIS } from './cost';
import type {
  CatalogFilters,
  CatalogRoute,
  CatalogRouteMatch,
} from './types';

/**
 * Empirical multiplier that converts a great-circle (haversine) distance into
 * an approximate real-road distance for the approach and return legs of a
 * catalog trip. Studies of Brazilian highway networks put the average ratio
 * around 1.25-1.35 — we pick 1.30 as a conservative middle ground that
 * over-estimates short urban hops slightly (so the rider isn't surprised by
 * extra fuel) while under-estimating very twisty mountain roads (where the
 * `polilinha_simplificada` already captures the meandering inside the route
 * itself). Override at the call site (e.g. when OSRM gives a real number) by
 * passing the corrected distance into `calculateRouteCost` directly.
 */
export const STRAIGHT_TO_ROAD_FACTOR = 1.3 as const;

/**
 * Run the 4-step matching pipeline (spec section 1) on the in-memory catalog.
 *
 * Pipeline:
 *   1. Compute great-circle distance from the rider to each route's start.
 *   2. Estimate fuel litres + total cost using the mocked global price.
 *   3. Tag autonomy and budget warnings as cheap booleans.
 *   4. Apply optional categorical filters (`null` = "Qualquer" = skip).
 *
 * Ordering: matches that fit the budget come first, sorted by ascending
 * proximity to the rider. Over-budget routes are pushed to the tail (also
 * proximity-sorted) so the UI can still render them dimmed instead of hiding
 * them entirely — the spec leaves the choice to the screen.
 */
export function matchRoutes(
  routes: CatalogRoute[],
  filters: CatalogFilters,
): CatalogRouteMatch[] {
  const enriched: CatalogRouteMatch[] = [];

  for (const route of routes) {
    if (
      filters.pavimento !== null &&
      route.caracteristicas.tipo_pavimento !== filters.pavimento
    ) {
      continue;
    }
    if (
      filters.nivelCurvas !== null &&
      route.caracteristicas.nivel_curvas !== filters.nivelCurvas
    ) {
      continue;
    }

    const startPoint = {
      latitude: route.coordenada_inicio.latitude,
      longitude: route.coordenada_inicio.longitude,
    };
    const endPoint = {
      latitude: route.coordenada_fim.latitude,
      longitude: route.coordenada_fim.longitude,
    };

    const rawApproachKm = calculateHaversineDistance(filters.origin, startPoint);
    const rawReturnKm = calculateHaversineDistance(endPoint, filters.origin);
    // distanceToStartKm stays as the great-circle distance because it's the
    // "as the crow flies" proximity used for sorting; multiplying it would
    // distort how the rider sees "rotas mais perto" in the list.
    const distanceToStartKm = rawApproachKm;
    const approachDistanceKm = rawApproachKm * STRAIGHT_TO_ROAD_FACTOR;
    const returnDistanceKm = rawReturnKm * STRAIGHT_TO_ROAD_FACTOR;
    const roundTripDistanceKm =
      approachDistanceKm + route.distancia_total_km + returnDistanceKm;

    const effectiveFuelPrice =
      filters.fuelPricePerLiter > 0
        ? filters.fuelPricePerLiter
        : DEFAULT_FUEL_PRICE_REAIS;
    const breakdown = calculateRouteCost(
      route.distancia_total_km,
      filters.motoConsumoKmL,
      effectiveFuelPrice,
      route.total_pedagios_moto_reais,
    );
    // Round-trip: rider passes through every plaza twice (going out + coming
    // back), so the toll must be doubled. `total_pedagios_moto_reais` stores
    // the one-way sum by contract (see types.ts) and the previous version of
    // this code mistakenly counted it once, silently undercounting cost.
    const roundTripBreakdown = calculateRouteCost(
      roundTripDistanceKm,
      filters.motoConsumoKmL,
      effectiveFuelPrice,
      route.total_pedagios_moto_reais * 2,
    );

    const autonomyWarning =
      filters.motoSafeAutonomyKm > 0 &&
      route.caracteristicas.trecho_critico_sem_posto_km >
        filters.motoSafeAutonomyKm;

    // Budget gate uses the round-trip estimate because that's what the rider
    // actually pays for an out-and-back day. Keeping it on the rota-only cost
    // produced false positives (matches that fit on paper but blew the wallet
    // once approach/return were factored in).
    const overBudget =
      filters.budgetReais > 0 &&
      roundTripBreakdown.totalCost > filters.budgetReais;

    enriched.push({
      route,
      distanceToStartKm,
      estimatedFuelLiters: breakdown.liters,
      estimatedFuelCostReais: breakdown.fuelCost,
      estimatedTotalCostReais: breakdown.totalCost,
      approachDistanceKm,
      returnDistanceKm,
      roundTripDistanceKm,
      roundTripFuelLiters: roundTripBreakdown.liters,
      roundTripFuelCostReais: roundTripBreakdown.fuelCost,
      roundTripTotalCostReais: roundTripBreakdown.totalCost,
      fuelPricePerLiter: effectiveFuelPrice,
      autonomyWarning,
      overBudget,
    });
  }

  // Stable two-pass sort: in-budget first by ascending start distance, then
  // over-budget routes appended (also ascending) so the dimmed tail still
  // reads "closest first" to the rider.
  const inBudget = enriched
    .filter((m) => !m.overBudget)
    .sort((a, b) => a.distanceToStartKm - b.distanceToStartKm);
  const overBudget = enriched
    .filter((m) => m.overBudget)
    .sort((a, b) => a.distanceToStartKm - b.distanceToStartKm);

  return [...inBudget, ...overBudget];
}
