import { calculateHaversineDistance } from '../../../src/domains/catalog/haversine';

describe('calculateHaversineDistance', () => {
  it('returns 0 for identical points', () => {
    expect(
      calculateHaversineDistance(
        { latitude: -23.55, longitude: -46.63 },
        { latitude: -23.55, longitude: -46.63 },
      ),
    ).toBe(0);
  });

  it('returns ~20015km for antipodal points (north pole to south pole)', () => {
    const km = calculateHaversineDistance(
      { latitude: 90, longitude: 0 },
      { latitude: -90, longitude: 0 },
    );
    // Half the Earth's circumference (~40030/2). Allow 1km tolerance.
    expect(km).toBeGreaterThan(20014);
    expect(km).toBeLessThan(20016);
  });

  it('approximates known distance between São Paulo (Sé) and Rio (Copacabana) at ~358km', () => {
    const km = calculateHaversineDistance(
      { latitude: -23.5505, longitude: -46.6333 },
      { latitude: -22.9707, longitude: -43.1823 },
    );
    expect(km).toBeGreaterThan(355);
    expect(km).toBeLessThan(365);
  });

  it('returns 0 when any coordinate is non-finite', () => {
    expect(
      calculateHaversineDistance(
        { latitude: NaN, longitude: 0 },
        { latitude: 0, longitude: 0 },
      ),
    ).toBe(0);
    expect(
      calculateHaversineDistance(
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: Infinity },
      ),
    ).toBe(0);
  });

  it('is symmetric in its arguments', () => {
    const a = { latitude: -28.388889, longitude: -49.395833 };
    const b = { latitude: -23.443889, longitude: -46.917778 };
    expect(calculateHaversineDistance(a, b)).toBeCloseTo(
      calculateHaversineDistance(b, a),
      6,
    );
  });
});
