/**
 * Mocked global fuel price used by the catalog cost estimator. The spec
 * explicitly calls out a fixed R$/L variable until a real fuel-price feed
 * exists; downstream callers should ALWAYS use this constant so the UI and
 * the matcher agree on the same baseline.
 */
export const DEFAULT_FUEL_PRICE_REAIS = 6.0 as const;

export interface RouteCostBreakdown {
  liters: number;
  fuelCost: number;
  totalCost: number;
}

function safeNumber(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Estimate the cost of riding `routeDistanceKm` on a bike whose average
 * consumption is `motoConsumoKmL`, paying `fuelPricePerLiter` per litre and
 * `tollCostReais` in tolls for the whole trip. Bad inputs (NaN, <=0
 * consumption) collapse to zero so the UI never shows "NaN" or "Infinity"
 * while a rider is choosing a route.
 */
export function calculateRouteCost(
  routeDistanceKm: number,
  motoConsumoKmL: number,
  fuelPricePerLiter: number,
  tollCostReais: number,
): RouteCostBreakdown {
  const distance = safeNumber(routeDistanceKm);
  const consumption = safeNumber(motoConsumoKmL);
  const price = safeNumber(fuelPricePerLiter);
  const tolls = Number.isFinite(tollCostReais) && tollCostReais > 0
    ? tollCostReais
    : 0;

  if (consumption === 0) {
    return { liters: 0, fuelCost: 0, totalCost: tolls };
  }

  const liters = distance / consumption;
  const fuelCost = liters * price;
  const totalCost = fuelCost + tolls;
  return { liters, fuelCost, totalCost };
}
