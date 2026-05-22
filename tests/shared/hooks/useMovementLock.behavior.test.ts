import {
  MOVING_SPEED_THRESHOLD_MPS,
  deriveMovementFromSpeed,
} from '../../../src/shared/hooks/useMovementLock';

describe('useMovementLock constants', () => {
  it('exposes the documented 5 km/h threshold as 1.4 m/s', () => {
    expect(MOVING_SPEED_THRESHOLD_MPS).toBe(1.4);
  });

  it('threshold converts to ~5 km/h (5.04 to be exact)', () => {
    expect(MOVING_SPEED_THRESHOLD_MPS * 3.6).toBeCloseTo(5.04, 2);
  });
});

describe('deriveMovementFromSpeed', () => {
  it('treats null speed as stationary (Android often reports null when still)', () => {
    const result = deriveMovementFromSpeed(null);
    expect(result.isMoving).toBe(false);
    expect(result.speedKmh).toBeCloseTo(0, 2);
  });

  it('treats undefined speed as stationary', () => {
    const result = deriveMovementFromSpeed(undefined);
    expect(result.isMoving).toBe(false);
    expect(result.speedKmh).toBeCloseTo(0, 2);
  });

  it('treats exactly 0 m/s as stationary', () => {
    const result = deriveMovementFromSpeed(0);
    expect(result.isMoving).toBe(false);
    expect(result.speedKmh).toBeCloseTo(0, 2);
  });

  it('treats 1.3 m/s as stationary (below threshold)', () => {
    const result = deriveMovementFromSpeed(1.3);
    expect(result.isMoving).toBe(false);
    expect(result.speedKmh).toBeCloseTo(4.68, 2);
  });

  it('treats exactly 1.4 m/s as stationary (boundary uses strict >)', () => {
    const result = deriveMovementFromSpeed(1.4);
    expect(result.isMoving).toBe(false);
    expect(result.speedKmh).toBeCloseTo(5.04, 2);
  });

  it('treats 1.41 m/s as moving (just above threshold)', () => {
    const result = deriveMovementFromSpeed(1.41);
    expect(result.isMoving).toBe(true);
    expect(result.speedKmh).toBeCloseTo(5.076, 2);
  });

  it('treats 27.78 m/s (100 km/h) as moving', () => {
    const result = deriveMovementFromSpeed(27.78);
    expect(result.isMoving).toBe(true);
    // 27.78 * 3.6 = 100.008 exactly (within FP), so we relax precision to
    // 1 decimal here — the 100 km/h round number is what the spec calls
    // out, not the rounding-error tail.
    expect(result.speedKmh).toBeCloseTo(100.0, 1);
  });
});
