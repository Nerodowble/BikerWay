import {
  calculateRouteCost,
  DEFAULT_FUEL_PRICE_REAIS,
} from '../../../src/domains/catalog/cost';

describe('calculateRouteCost', () => {
  it('exports a R$6.00 default fuel price (spec mocked global)', () => {
    expect(DEFAULT_FUEL_PRICE_REAIS).toBe(6.0);
  });

  it('computes liters + total cost for a happy-path route', () => {
    // 100 km at 25 km/L = 4 L; 4 L at R$6 = R$24; + R$10 toll = R$34
    const r = calculateRouteCost(100, 25, 6, 10);
    expect(r.liters).toBeCloseTo(4, 6);
    expect(r.fuelCost).toBeCloseTo(24, 6);
    expect(r.totalCost).toBeCloseTo(34, 6);
  });

  it('falls back to toll-only when consumption is zero', () => {
    const r = calculateRouteCost(100, 0, 6, 7.5);
    expect(r.liters).toBe(0);
    expect(r.fuelCost).toBe(0);
    expect(r.totalCost).toBe(7.5);
  });

  it('zeros out NaN / negative inputs so the UI never shows NaN', () => {
    const r = calculateRouteCost(NaN, 25, 6, -3);
    expect(r.liters).toBe(0);
    expect(r.fuelCost).toBe(0);
    expect(r.totalCost).toBe(0);
  });

  it('accepts the default fuel price constant', () => {
    const r = calculateRouteCost(60, 30, DEFAULT_FUEL_PRICE_REAIS, 0);
    // 60 / 30 = 2L; 2 * 6 = R$12
    expect(r.totalCost).toBeCloseTo(12, 6);
  });
});
