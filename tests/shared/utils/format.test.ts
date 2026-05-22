import {
  formatDistance,
  formatDuration,
  formatKmWhole,
} from '../../../src/shared/utils/format';

describe('formatDistance', () => {
  it('formats sub-kilometer values in meters without decimals', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(450.4)).toBe('450 m');
    expect(formatDistance(999)).toBe('999 m');
  });

  it('formats kilometer values with a single decimal', () => {
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(12_360)).toBe('12.4 km');
  });
});

describe('formatDuration', () => {
  it('formats sub-minute values in seconds', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45)).toBe('45s');
  });

  it('formats sub-hour values in whole minutes', () => {
    expect(formatDuration(60)).toBe('1 min');
    expect(formatDuration(125)).toBe('2 min');
    expect(formatDuration(3599)).toBe('60 min');
  });

  it('formats hour-scale values as "Xh Ymin"', () => {
    expect(formatDuration(3600)).toBe('1h 0min');
    expect(formatDuration(3600 + 17 * 60)).toBe('1h 17min');
    expect(formatDuration(2 * 3600 + 30 * 60)).toBe('2h 30min');
  });
});

describe('formatKmWhole', () => {
  it('handles the zero boundary', () => {
    expect(formatKmWhole(0)).toBe('0 km');
  });

  it('rounds sub-unit and exact-unit values', () => {
    expect(formatKmWhole(0.4)).toBe('0 km');
    expect(formatKmWhole(0.6)).toBe('1 km');
    expect(formatKmWhole(42)).toBe('42 km');
  });

  it('clamps negative and non-finite values to zero', () => {
    expect(formatKmWhole(-12)).toBe('0 km');
    expect(formatKmWhole(Number.NaN)).toBe('0 km');
    expect(formatKmWhole(Number.POSITIVE_INFINITY)).toBe('0 km');
  });

  it('formats large values', () => {
    expect(formatKmWhole(1234)).toBe('1234 km');
  });
});
