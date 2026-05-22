import { calculateHaversineDistance } from './haversine';
import { calculateRouteCost, DEFAULT_FUEL_PRICE_REAIS } from './cost';
import type {
  CatalogFilters,
  CatalogRoute,
  CatalogRouteMatch,
} from './types';

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

    const distanceToStartKm = calculateHaversineDistance(
      filters.origin,
      startPoint,
    );
    const returnDistanceKm = calculateHaversineDistance(
      endPoint,
      filters.origin,
    );
    const approachDistanceKm = distanceToStartKm;
    const roundTripDistanceKm =
      approachDistanceKm + route.distancia_total_km + returnDistanceKm;

    const breakdown = calculateRouteCost(
      route.distancia_total_km,
      filters.motoConsumoKmL,
      DEFAULT_FUEL_PRICE_REAIS,
      route.total_pedagios_moto_reais,
    );
    const roundTripBreakdown = calculateRouteCost(
      roundTripDistanceKm,
      filters.motoConsumoKmL,
      DEFAULT_FUEL_PRICE_REAIS,
      route.total_pedagios_moto_reais,
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
