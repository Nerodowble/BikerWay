import type { OpenMeteoClient } from '../../src/infrastructure/weather/openMeteoClient';
import type { WeatherSnapshot } from '../../src/domains/weather/types';
import {
  __resetWeatherClientForTests,
  __setWeatherClientForTests,
  useWeatherStore,
} from '../../src/state/weatherStore';

function makeSnapshot(
  lat: number,
  lng: number,
  fetchedAt: number,
): WeatherSnapshot {
  return {
    fetchedAt,
    latitude: lat,
    longitude: lng,
    weatherCode: 0,
    temperatureC: 22,
    windKmh: 5,
    precipitationMm: 0,
    label: 'Limpo',
    severity: 'ok',
  };
}

function resetStore(): void {
  useWeatherStore.setState({
    current: null,
    routeForecast: null,
    isFetching: false,
    lastError: null,
  });
}

describe('weatherStore.refreshCurrent', () => {
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

  it('first call always fetches and stores the snapshot', async () => {
    const snap = makeSnapshot(-23.5, -46.6, Date.now());
    mockGetCurrent.mockResolvedValueOnce(snap);
    await useWeatherStore.getState().refreshCurrent(-23.5, -46.6);
    expect(mockGetCurrent).toHaveBeenCalledTimes(1);
    expect(useWeatherStore.getState().current).toEqual(snap);
  });

  it('skips network when called within 15min AND less than 10km from prior fetch', async () => {
    const now = Date.now();
    const snap = makeSnapshot(-23.5, -46.6, now);
    mockGetCurrent.mockResolvedValueOnce(snap);
    await useWeatherStore.getState().refreshCurrent(-23.5, -46.6);
    expect(mockGetCurrent).toHaveBeenCalledTimes(1);

    // Second call: same coords (0 km away), well within 15 min — must skip.
    await useWeatherStore.getState().refreshCurrent(-23.5, -46.6);
    expect(mockGetCurrent).toHaveBeenCalledTimes(1);

    // Tiny nudge of ~100m — still inside the 10km gate — also skips.
    await useWeatherStore.getState().refreshCurrent(-23.5009, -46.6);
    expect(mockGetCurrent).toHaveBeenCalledTimes(1);
  });

  it('force=true always fetches even when inside the throttle window', async () => {
    const now = Date.now();
    const snap1 = makeSnapshot(-23.5, -46.6, now);
    const snap2 = makeSnapshot(-23.5, -46.6, now);
    mockGetCurrent.mockResolvedValueOnce(snap1).mockResolvedValueOnce(snap2);

    await useWeatherStore.getState().refreshCurrent(-23.5, -46.6);
    expect(mockGetCurrent).toHaveBeenCalledTimes(1);

    await useWeatherStore.getState().refreshCurrent(-23.5, -46.6, true);
    expect(mockGetCurrent).toHaveBeenCalledTimes(2);
  });

  it('refetches when moved more than 10 km from the prior fetch position', async () => {
    const now = Date.now();
    const snap1 = makeSnapshot(-23.5, -46.6, now);
    const snap2 = makeSnapshot(-23.7, -46.6, now);
    mockGetCurrent.mockResolvedValueOnce(snap1).mockResolvedValueOnce(snap2);

    await useWeatherStore.getState().refreshCurrent(-23.5, -46.6);
    expect(mockGetCurrent).toHaveBeenCalledTimes(1);

    // ~22 km south — outside the 10km gate, so must fetch.
    await useWeatherStore.getState().refreshCurrent(-23.7, -46.6);
    expect(mockGetCurrent).toHaveBeenCalledTimes(2);
  });

  it('records lastError when the client throws and does not overwrite snapshot', async () => {
    mockGetCurrent.mockRejectedValueOnce(new Error('boom'));
    await useWeatherStore.getState().refreshCurrent(-23.5, -46.6);
    const state = useWeatherStore.getState();
    expect(state.lastError).toBe('boom');
    expect(state.current).toBeNull();
    expect(state.isFetching).toBe(false);
  });
});
