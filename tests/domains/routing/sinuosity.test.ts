import {
  angularDeltaDeg,
  bearingDegrees,
  calculateSinuosity,
  pickMostSinuousIndex,
} from '../../../src/domains/routing/sinuosity';
import type { RouteCoordinate } from '../../../src/domains/routing/types';

const NORTH: RouteCoordinate = { latitude: 0, longitude: 0 };
const NORTH_PLUS: RouteCoordinate = { latitude: 0.001, longitude: 0 };
const EAST: RouteCoordinate = { latitude: 0, longitude: 0.001 };
const NE: RouteCoordinate = { latitude: 0.001, longitude: 0.001 };

describe('bearingDegrees', () => {
  it('returns ~0 when target is due north', () => {
    expect(bearingDegrees(NORTH, NORTH_PLUS)).toBeCloseTo(0, 0);
  });

  it('returns ~90 when target is due east', () => {
    expect(bearingDegrees(NORTH, EAST)).toBeCloseTo(90, 0);
  });

  it('returns ~45 when target is northeast', () => {
    const b = bearingDegrees(NORTH, NE);
    expect(b).toBeGreaterThan(35);
    expect(b).toBeLessThan(55);
  });
});

describe('angularDeltaDeg', () => {
  it('returns 0 for equal angles', () => {
    expect(angularDeltaDeg(45, 45)).toBe(0);
  });

  it('returns absolute delta for small differences', () => {
    expect(angularDeltaDeg(10, 30)).toBe(20);
  });

  it('wraps around the 360 boundary', () => {
    expect(angularDeltaDeg(350, 10)).toBe(20);
    expect(angularDeltaDeg(10, 350)).toBe(20);
  });

  it('handles 180 correctly', () => {
    expect(angularDeltaDeg(0, 180)).toBe(180);
  });
});

describe('calculateSinuosity', () => {
  it('returns zero for a 2-coord straight line (no bearings to compare)', () => {
    const report = calculateSinuosity([NORTH, EAST]);
    expect(report.score).toBe(0);
  });

  it('returns zero for an empty / too-short route', () => {
    expect(calculateSinuosity([]).score).toBe(0);
    expect(calculateSinuosity([NORTH]).score).toBe(0);
    expect(calculateSinuosity([NORTH, EAST]).score).toBe(0);
  });

  it('returns a positive score for a route with a turn', () => {
    // North, then turn east -> 90deg turn
    const coords: RouteCoordinate[] = [NORTH, NORTH_PLUS, NE];
    const report = calculateSinuosity(coords);
    expect(report.totalAngleChangeDeg).toBeGreaterThan(30);
    expect(report.totalDistanceKm).toBeGreaterThan(0);
    expect(report.score).toBeGreaterThan(0);
  });

  it('higher score for a zigzag than for a straight line of equal length', () => {
    // Straight northward chain
    const straight: RouteCoordinate[] = [
      { latitude: 0, longitude: 0 },
      { latitude: 0.001, longitude: 0 },
      { latitude: 0.002, longitude: 0 },
      { latitude: 0.003, longitude: 0 },
    ];
    // Zigzag: alternating east-west jitter
    const zigzag: RouteCoordinate[] = [
      { latitude: 0, longitude: 0 },
      { latitude: 0.001, longitude: 0.0005 },
      { latitude: 0.002, longitude: -0.0005 },
      { latitude: 0.003, longitude: 0.0005 },
    ];
    const straightScore = calculateSinuosity(straight).score;
    const zigzagScore = calculateSinuosity(zigzag).score;
    expect(zigzagScore).toBeGreaterThan(straightScore);
  });
});

describe('pickMostSinuousIndex', () => {
  it('returns 0 for an empty list', () => {
    expect(pickMostSinuousIndex([])).toBe(0);
  });

  it('picks the alternative with the most curves', () => {
    const straight = {
      coordinates: [
        { latitude: 0, longitude: 0 },
        { latitude: 0.001, longitude: 0 },
        { latitude: 0.002, longitude: 0 },
      ],
    };
    const curvy = {
      coordinates: [
        { latitude: 0, longitude: 0 },
        { latitude: 0.001, longitude: 0.0005 },
        { latitude: 0.002, longitude: -0.0005 },
        { latitude: 0.003, longitude: 0.0005 },
      ],
    };
    expect(pickMostSinuousIndex([straight, curvy])).toBe(1);
    expect(pickMostSinuousIndex([curvy, straight])).toBe(0);
  });
});
