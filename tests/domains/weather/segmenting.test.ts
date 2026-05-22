import { segmentRouteByWeather } from '../../../src/domains/weather/segmenting';
import type {
  RouteForecastPoint,
  WeatherSeverity,
} from '../../../src/domains/weather/types';

function point(
  lat: number,
  lng: number,
  severity: WeatherSeverity,
  precipMm: number = 0,
  label: string = '',
): RouteForecastPoint {
  return {
    latitude: lat,
    longitude: lng,
    hoursAhead: 0,
    severity,
    precipitationMm: precipMm,
    label,
    weatherCode: 0,
    precipitationProbability: 0,
  };
}

function buildLine(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  count: number,
): Array<{ latitude: number; longitude: number }> {
  // Linear interpolation in lat/lng space. Distances at this scale are small
  // enough that we don't need great-circle math for the test fixtures.
  const out: Array<{ latitude: number; longitude: number }> = [];
  const last = count - 1;
  for (let i = 0; i < count; i++) {
    const t = last === 0 ? 0 : i / last;
    out.push({
      latitude: startLat + (endLat - startLat) * t,
      longitude: startLng + (endLng - startLng) * t,
    });
  }
  return out;
}

describe('segmentRouteByWeather', () => {
  it('returns an empty array when the route has fewer than 2 coordinates', () => {
    expect(segmentRouteByWeather([], [])).toEqual([]);
    expect(
      segmentRouteByWeather([{ latitude: -23.5, longitude: -46.6 }], []),
    ).toEqual([]);
  });

  it('returns a single ok segment when no forecasts are provided', () => {
    const route = buildLine(-23.5, -46.6, -23.6, -46.7, 5);
    const segments = segmentRouteByWeather(route, []);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.severity).toBe('ok');
    expect(segments[0]?.coordinates).toHaveLength(5);
    // Sanity: the segment preserves vertex order.
    expect(segments[0]?.coordinates[0]).toEqual(route[0]);
    expect(segments[0]?.coordinates[4]).toEqual(route[4]);
  });

  it('emits a single segment when every forecast is ok', () => {
    const route = buildLine(-23.5, -46.6, -23.6, -46.7, 6);
    const forecasts: RouteForecastPoint[] = [
      point(-23.5, -46.6, 'ok'),
      point(-23.55, -46.65, 'ok'),
      point(-23.6, -46.7, 'ok'),
    ];
    const segments = segmentRouteByWeather(route, forecasts);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.severity).toBe('ok');
    expect(segments[0]?.coordinates).toHaveLength(6);
  });

  it('produces a mix of ok + warning segments and joins them at the boundary', () => {
    // 10-vertex line; the first half is dry, the second half is rainy. The
    // forecast at the START is ok; the forecast at the END is warning. The
    // midpoint snaps to whichever forecast is closer — by placing both
    // forecasts at the endpoints we get a clean ~halfway split.
    const route = buildLine(0, 0, 0, 1, 10);
    const forecasts: RouteForecastPoint[] = [
      point(0, 0, 'ok'),
      point(0, 1, 'warning', 2, 'Chuva'),
    ];
    const segments = segmentRouteByWeather(route, forecasts);

    expect(segments.length).toBeGreaterThanOrEqual(2);
    // First segment is ok; last segment is warning.
    expect(segments[0]?.severity).toBe('ok');
    expect(segments[segments.length - 1]?.severity).toBe('warning');
    // Description / precipMm propagate from the underlying forecast.
    const warningSeg = segments.find((s) => s.severity === 'warning');
    expect(warningSeg?.description).toBe('Chuva');
    expect(warningSeg?.precipMm).toBe(2);
    // Zero-gap invariant: each segment's last coord equals the next
    // segment's first coord (by value).
    for (let i = 0; i < segments.length - 1; i++) {
      const cur = segments[i];
      const next = segments[i + 1];
      const lastOfCur = cur?.coordinates[cur.coordinates.length - 1];
      const firstOfNext = next?.coordinates[0];
      expect(firstOfNext).toEqual(lastOfCur);
    }
    // Coverage: concatenating all segment coords minus the shared boundary
    // points reproduces the original route length.
    let totalUnique = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!seg) continue;
      // First segment contributes all its points; subsequent segments skip
      // their first point because it's shared with the previous segment.
      totalUnique += i === 0 ? seg.coordinates.length : seg.coordinates.length - 1;
    }
    expect(totalUnique).toBe(route.length);
  });

  it('isolates a danger segment in the middle of the route', () => {
    // 9-vertex line; place 3 forecasts at 0%, 50%, 100%. The middle forecast
    // is danger; the endpoints are ok. We expect: ok -> danger -> ok.
    const route = buildLine(0, 0, 0, 1, 9);
    const forecasts: RouteForecastPoint[] = [
      point(0, 0, 'ok'),
      point(0, 0.5, 'danger', 8, 'Trovoada'),
      point(0, 1, 'ok'),
    ];
    const segments = segmentRouteByWeather(route, forecasts);

    // Three runs: ok, danger, ok.
    const severities = segments.map((s) => s.severity);
    expect(severities).toEqual(['ok', 'danger', 'ok']);

    const dangerSeg = segments.find((s) => s.severity === 'danger');
    expect(dangerSeg).toBeDefined();
    expect(dangerSeg?.description).toBe('Trovoada');
    expect(dangerSeg?.precipMm).toBe(8);
    expect(dangerSeg?.coordinates.length).toBeGreaterThanOrEqual(2);

    // Zero-gap invariant across all transitions.
    for (let i = 0; i < segments.length - 1; i++) {
      const cur = segments[i];
      const next = segments[i + 1];
      const lastOfCur = cur?.coordinates[cur.coordinates.length - 1];
      const firstOfNext = next?.coordinates[0];
      expect(firstOfNext).toEqual(lastOfCur);
    }
  });

  it('merges a degenerate single-coord trailing segment into the previous run', () => {
    // Construct a fixture where only the very LAST vertex flips severity:
    // forecasts at indices 0..n-2 are 'ok' and a single forecast right on
    // the last vertex is 'warning'. The last vertex would normally become a
    // 1-coord segment (not renderable). The segmenter should absorb it.
    const route = buildLine(0, 0, 0, 1, 6);
    const lastCoord = route[route.length - 1];
    if (!lastCoord) throw new Error('fixture');
    const forecasts: RouteForecastPoint[] = [
      // Nearest forecast for vertices 0..4 is the 'ok' anchor at (0, 0.4)
      // (closer than the warning anchor at the very last vertex).
      point(0, 0.4, 'ok'),
      point(lastCoord.latitude, lastCoord.longitude, 'warning', 3, 'Chuva'),
    ];
    const segments = segmentRouteByWeather(route, forecasts);
    // We should never see a degenerate single-coord segment — the segmenter
    // absorbs it into the previous run.
    for (const seg of segments) {
      expect(seg.coordinates.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('preserves vertex order within each segment', () => {
    const route = buildLine(0, 0, 1, 1, 8);
    const forecasts: RouteForecastPoint[] = [
      point(0, 0, 'ok'),
      point(1, 1, 'warning'),
    ];
    const segments = segmentRouteByWeather(route, forecasts);
    // Concatenate segments back skipping shared boundary points.
    const reconstructed: typeof route = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!seg) continue;
      const skipFirst = i > 0;
      for (let j = skipFirst ? 1 : 0; j < seg.coordinates.length; j++) {
        const c = seg.coordinates[j];
        if (c) reconstructed.push(c);
      }
    }
    expect(reconstructed).toEqual(route);
  });
});
