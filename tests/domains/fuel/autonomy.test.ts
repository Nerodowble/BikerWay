import {
  calculateMaxAutonomy,
  calculateSafeAutonomy,
  calculateRemainingAutonomy,
  computeReserveStatus,
  RESERVE_THRESHOLD_KM,
  RESERVE_TANK_FRACTION,
} from '../../../src/domains/fuel/autonomy';

describe('calculateMaxAutonomy', () => {
  it('multiplies tank capacity by average consumption', () => {
    expect(calculateMaxAutonomy(12, 30)).toBe(360);
  });

  it('returns 0 when capacity is zero', () => {
    expect(calculateMaxAutonomy(0, 30)).toBe(0);
  });

  it('returns 0 when consumption is zero', () => {
    expect(calculateMaxAutonomy(12, 0)).toBe(0);
  });

  it('returns 0 for NaN inputs', () => {
    expect(calculateMaxAutonomy(NaN, 30)).toBe(0);
    expect(calculateMaxAutonomy(12, NaN)).toBe(0);
  });

  it('returns 0 for Infinity inputs', () => {
    expect(calculateMaxAutonomy(Infinity, 30)).toBe(0);
    expect(calculateMaxAutonomy(12, Infinity)).toBe(0);
  });

  it('returns 0 for negative inputs', () => {
    expect(calculateMaxAutonomy(-12, 30)).toBe(0);
    expect(calculateMaxAutonomy(12, -30)).toBe(0);
  });
});

describe('calculateSafeAutonomy', () => {
  it('applies the 15% safety margin', () => {
    expect(calculateSafeAutonomy(200)).toBe(170);
  });

  it('returns 0 for non-positive input', () => {
    expect(calculateSafeAutonomy(0)).toBe(0);
    expect(calculateSafeAutonomy(-10)).toBe(0);
  });
});

describe('calculateRemainingAutonomy', () => {
  it('subtracts traveled distance from safe autonomy', () => {
    expect(calculateRemainingAutonomy(170, 100)).toBe(70);
  });

  it('clamps to 0 when traveled distance exceeds safe autonomy', () => {
    expect(calculateRemainingAutonomy(170, 300)).toBe(0);
  });

  it('treats non-finite inputs as 0', () => {
    expect(calculateRemainingAutonomy(NaN, 100)).toBe(0);
    expect(calculateRemainingAutonomy(170, NaN)).toBe(170);
  });
});

describe('computeReserveStatus', () => {
  it('is not in reserve mode when motorcycle is parked (distance = 0)', () => {
    // Tiny tank that would otherwise trigger reserve.
    const status = computeReserveStatus({
      tankCapacity: 5,
      averageConsump: 20,
      distanceTraveledKm: 0,
      isNavigating: true,
    });
    expect(status.isReserveMode).toBe(false);
  });

  it('large bike (A_max=400km): threshold is 20% of tank (80km), reserve at 40km remaining', () => {
    // tank=20L, consump=20km/L -> A_max=400, A_seg=340, threshold = max(40, 80) = 80
    // distance=300 -> remaining = 40 -> in reserve
    const status = computeReserveStatus({
      tankCapacity: 20,
      averageConsump: 20,
      distanceTraveledKm: 300,
      isNavigating: true,
    });
    expect(status.thresholdKm).toBe(400 * RESERVE_TANK_FRACTION);
    expect(status.remainingAutonomyKm).toBe(40);
    expect(status.isReserveMode).toBe(true);
  });

  it('medium bike (A_max=200km) at 130km traveled: exact boundary triggers reserve', () => {
    // tank=10L, consump=20km/L -> A_max=200, A_seg=170, threshold = max(40, 40) = 40
    // distance=130 -> remaining=40 -> isReserveMode true (<=)
    const status = computeReserveStatus({
      tankCapacity: 10,
      averageConsump: 20,
      distanceTraveledKm: 130,
      isNavigating: true,
    });
    expect(status.thresholdKm).toBe(RESERVE_THRESHOLD_KM);
    expect(status.remainingAutonomyKm).toBe(40);
    expect(status.isReserveMode).toBe(true);
  });

  it('medium bike (A_max=200km) at 129km traveled: just above boundary is not reserve', () => {
    const status = computeReserveStatus({
      tankCapacity: 10,
      averageConsump: 20,
      distanceTraveledKm: 129,
      isNavigating: true,
    });
    expect(status.remainingAutonomyKm).toBe(41);
    expect(status.isReserveMode).toBe(false);
  });

  it('is not in reserve mode when isNavigating === false, regardless of distance', () => {
    const status = computeReserveStatus({
      tankCapacity: 10,
      averageConsump: 20,
      distanceTraveledKm: 300,
      isNavigating: false,
    });
    expect(status.isReserveMode).toBe(false);
  });

  it('invalid motorcycle (A_max <= 0) returns safe defaults', () => {
    const status = computeReserveStatus({
      tankCapacity: 0,
      averageConsump: 0,
      distanceTraveledKm: 100,
      isNavigating: true,
    });
    expect(status.isReserveMode).toBe(false);
    expect(status.thresholdKm).toBe(RESERVE_THRESHOLD_KM);
    expect(status.remainingAutonomyKm).toBe(0);
  });

  it('defaults to navigating=true when isNavigating is omitted', () => {
    const status = computeReserveStatus({
      tankCapacity: 10,
      averageConsump: 20,
      distanceTraveledKm: 130,
    });
    expect(status.isReserveMode).toBe(true);
  });
});
