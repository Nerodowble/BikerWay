import type { OpenMeteoClient } from '../../src/infrastructure/weather/openMeteoClient';
import type {
  RouteForecastSample,
  WeatherSeverity,
} from '../../src/domains/weather/types';
import {
  __resetWeatherClientForTests,
  __setWeatherClientForTests,
  useWeatherStore,
} from '../../src/state/weatherStore';

function makeSample(
  hoursAhead: number,
  severity: WeatherSeverity,
  weatherCode: number = 0,
  precipitationMm: number = 0,
  precipitationProbability: number = 0,
): RouteForecastSample {
  return {
    hoursAhead,
    precipitationProbability,
    precipitationMm,
    weatherCode,
    label: severity === 'ok' ? 'Limpo' : severity === 'warning' ? 'Chuva' : 'Trovoada',
    severity,
  };
}

function resetStore(): void {
  useWeatherStore.setState({
    current: null,
    routeForecast: null,
    routeSegments: null,
    isFetching: false,
    lastError: null,
  });
}

function buildLine(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  count: number,
): Array<{ latitude: number; longitude: number }> {
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

describe('weatherStore.computeRouteForecast — segments', () => {
  let mockGetCurrent: jest.Mock;
  let mockGetHourly: jest.Mock;
  let mockClient: OpenMeteoClient;

  beforeEach(() => {
    mockGetCurrent = jest.fn();
    mockGetHourly = jest.fn();
    mockClient = {
      getCurrent: mockGetCurrent as unknown as OpenMeteoClient['getCurrent'],
      getHourlyForecast:
        mockGetHourly as unknown as OpenMeteoClient['getHourlyForecast'],
      clearCache: () => {},
    };
    __setWeatherClientForTests(mockClient);
    resetStore();
  });

  afterEach(() => {
    __resetWeatherClientForTests();
    resetStore();
  });

  it('stores route segments alongside the legacy forecast after success', async () => {
    // Two-point route, single forecast — exercises the happy path. The
    // store should produce a single 'ok' segment that covers both vertices.
    mockGetHourly.mockResolvedValue([makeSample(0, 'ok')]);
    const route = buildLine(-23.5, -46.6, -23.6, -46.7, 4);

    const forecast = await useWeatherStore
      .getState()
      .computeRouteForecast({
        routeCoordinates: route,
        durationSeconds: 3600,
      });

    expect(forecast).not.toBeNull();
    const segments = useWeatherStore.getState().routeSegments;
    expect(segments).not.toBeNull();
    expect(segments?.length ?? 0).toBeGreaterThanOrEqual(1);
    // All-ok forecast → exactly one ok segment.
    expect(segments?.every((s) => s.severity === 'ok')).toBe(true);
  });

  it('produces a non-ok segment when the hourly forecast returns warning', async () => {
    // Force every sample to be 'warning' (rain). The segmenter should emit
    // at least one warning segment.
    mockGetHourly.mockResolvedValue([makeSample(0, 'warning', 61, 1, 80)]);
    const route = buildLine(-23.5, -46.6, -23.6, -46.7, 6);

    await useWeatherStore.getState().computeRouteForecast({
      routeCoordinates: route,
      durationSeconds: 3600,
    });

    const segments = useWeatherStore.getState().routeSegments;
    expect(segments).not.toBeNull();
    expect(segments?.some((s) => s.severity === 'warning')).toBe(true);
  });

  it('clears segments when given an empty route', async () => {
    // Seed a fake segments value, then call with an empty route. The store
    // must wipe the cache (we don't want a stale rainbow on an empty map).
    useWeatherStore.setState({
      routeSegments: [
        { coordinates: [{ latitude: 0, longitude: 0 }], severity: 'warning' },
      ],
    });

    const forecast = await useWeatherStore
      .getState()
      .computeRouteForecast({ routeCoordinates: [], durationSeconds: 0 });

    expect(forecast).toBeNull();
    expect(useWeatherStore.getState().routeSegments).toBeNull();
  });

  it('clearRoute drops segments without wiping the current-conditions snapshot', () => {
    useWeatherStore.setState({
      current: {
        fetchedAt: Date.now(),
        latitude: 0,
        longitude: 0,
        weatherCode: 0,
        temperatureC: 22,
        windKmh: 5,
        precipitationMm: 0,
        label: 'Limpo',
        severity: 'ok',
      },
      routeSegments: [
        { coordinates: [{ latitude: 0, longitude: 0 }], severity: 'ok' },
      ],
    });

    useWeatherStore.getState().clearRoute();
    const state = useWeatherStore.getState();
    expect(state.routeSegments).toBeNull();
    expect(state.routeForecast).toBeNull();
    // The top-bar badge data is independent of the active route — it must
    // survive a per-route clear.
    expect(state.current).not.toBeNull();
  });

  it('wipes segments when the hourly client throws', async () => {
    useWeatherStore.setState({
      routeSegments: [
        { coordinates: [{ latitude: 0, longitude: 0 }], severity: 'warning' },
      ],
    });
    mockGetHourly.mockRejectedValueOnce(new Error('boom'));
    const route = buildLine(-23.5, -46.6, -23.6, -46.7, 4);

    const forecast = await useWeatherStore.getState().computeRouteForecast({
      routeCoordinates: route,
      durationSeconds: 3600,
    });

    expect(forecast).toBeNull();
    const state = useWeatherStore.getState();
    expect(state.routeSegments).toBeNull();
    expect(state.lastError).toBe('boom');
  });
});
