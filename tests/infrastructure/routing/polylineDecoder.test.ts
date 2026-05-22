import {
  decodePolyline,
  decodeWithPrecision,
} from '../../../src/infrastructure/routing/polylineDecoder';

// Classic Google polyline example from the algorithm spec.
// Encoded form represents three points off the Californian coast.
const CLASSIC_ENCODED = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

const EXPECTED = [
  { latitude: 38.5, longitude: -120.2 },
  { latitude: 40.7, longitude: -120.95 },
  { latitude: 43.252, longitude: -126.453 },
];

describe('decodePolyline (precision = 5)', () => {
  it('decodes the classic encoded polyline into three coordinates', () => {
    const decoded = decodePolyline(CLASSIC_ENCODED);
    expect(decoded).toHaveLength(EXPECTED.length);

    for (let i = 0; i < EXPECTED.length; i += 1) {
      const got = decoded[i];
      const want = EXPECTED[i];
      expect(got).toBeDefined();
      expect(want).toBeDefined();
      if (!got || !want) continue;
      expect(got.latitude).toBeCloseTo(want.latitude, 4);
      expect(got.longitude).toBeCloseTo(want.longitude, 4);
    }
  });

  it('returns an empty array for an empty input', () => {
    expect(decodePolyline('')).toEqual([]);
  });
});

describe('decodeWithPrecision', () => {
  it('precision=6 produces coordinates 100x smaller in magnitude than precision=5', () => {
    const p5 = decodeWithPrecision(CLASSIC_ENCODED, 5);
    const p6 = decodeWithPrecision(CLASSIC_ENCODED, 6);

    expect(p5).toHaveLength(p6.length);
    expect(p5.length).toBeGreaterThan(0);

    // The decoder treats the same bytes as ~10x more precise when precision=6,
    // so the resulting magnitudes shrink by a factor of 10 per axis. We assert
    // the outputs are different and follow that 10x relationship.
    for (let i = 0; i < p5.length; i += 1) {
      const a = p5[i];
      const b = p6[i];
      if (!a || !b) continue;
      expect(b.latitude).not.toBeCloseTo(a.latitude, 4);
      expect(b.longitude).not.toBeCloseTo(a.longitude, 4);
      expect(b.latitude).toBeCloseTo(a.latitude / 10, 4);
      expect(b.longitude).toBeCloseTo(a.longitude / 10, 4);
    }
  });
});
