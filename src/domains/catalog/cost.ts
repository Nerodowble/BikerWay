/**
 * Default fuel price used when the rider hasn't overridden it. Reflects the
 * 2026-05 average for gasolina comum in São Paulo (~R$ 6,50/L). The catalog
 * filters expose this as an editable field — downstream callers should read
 * the price from `filters.fuelPricePerLiter` rather than this constant so the
 * rider's local override (e.g. R$ 5,80 in the interior, R$ 7,20 near
 * Litoral) flows through to the cost estimate.
 */
export const DEFAULT_FUEL_PRICE_REAIS = 6.5 as const;

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
