// O store faz varias chamadas `getRideHistoryRepo()`: recordTripCompleted
// na conclusao, recordCoveredIndex a cada novo ponto, clearCoveredIndicesForTrip
// no cleanup, getCoveredIndicesForTrip no startTracking. Mockamos todos.
const mockRecordTripCompleted = jest.fn();
const mockRecordCoveredIndex = jest.fn();
const mockClearCoveredIndices = jest.fn();
const mockGetCoveredIndices = jest.fn(async () => [] as number[]);

jest.mock('@/infrastructure/db/rideHistoryRepository', () => ({
  getRideHistoryRepo: async () => ({
    recordTripCompleted: mockRecordTripCompleted,
    recordCoveredIndex: mockRecordCoveredIndex,
    clearCoveredIndicesForTrip: mockClearCoveredIndices,
    getCoveredIndicesForTrip: mockGetCoveredIndices,
  }),
}));

import { useTripCompletionStore } from '@/state/tripCompletionStore';
import { useNavigationStore } from '@/state/navigationStore';

// Spacing ~770m entre pontos consecutivos (0.007 deg lat). Maior que o
// raio de cobertura (500m) pra que cada sample marque so o indice mais
// proximo — assim podemos testar a evolucao gradual da coverage sample a
// sample.
const polyline = [
  { latitude: 0, longitude: 0 },
  { latitude: 0.007, longitude: 0 },
  { latitude: 0.014, longitude: 0 },
  { latitude: 0.021, longitude: 0 },
  { latitude: 0.028, longitude: 0 },
];

const fim = { latitude: 0.028, longitude: 0 };

function flushMicrotasks(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe('tripCompletionStore', () => {
  beforeEach(() => {
    mockRecordTripCompleted.mockClear();
    mockRecordCoveredIndex.mockClear();
    mockClearCoveredIndices.mockClear();
    mockGetCoveredIndices.mockClear();
    mockGetCoveredIndices.mockImplementation(async () => []);
    useTripCompletionStore.getState().stopTracking();
    useTripCompletionStore.setState({ lastCompletedStamp: null });
  });

  it('startTracking ativa o tracker e zera coverage', async () => {
    await useTripCompletionStore.getState().startTracking({
      tripId: 42,
      rotaId: 'rota-a',
      polyline,
      coordenadaFim: fim,
      routeDistanceKm: 50,
    });
    const state = useTripCompletionStore.getState();
    expect(state.active).toBe(true);
    expect(state.tripId).toBe(42);
    expect(state.rotaId).toBe('rota-a');
    expect(state.coveredIndices.size).toBe(0);
  });

  it('startTracking hidrata coveredIndices do SQLite quando o trip foi retomado', async () => {
    mockGetCoveredIndices.mockImplementationOnce(async () => [0, 1, 2, 3]);
    await useTripCompletionStore.getState().startTracking({
      tripId: 99,
      rotaId: 'rota-resume',
      polyline,
      coordenadaFim: fim,
      routeDistanceKm: 50,
    });
    const state = useTripCompletionStore.getState();
    expect(state.coveredIndices.size).toBe(4);
    expect(state.completionRatio).toBeCloseTo(4 / polyline.length, 4);
    expect(mockGetCoveredIndices).toHaveBeenCalledWith(99);
  });

  it('onPosition acumula coverage e persiste indices novos via repo', async () => {
    // Polilinha longa o suficiente pra cobertura parcial NAO atingir 80%
    // (evita completion automatico no meio do teste).
    const longPolyline = Array.from({ length: 20 }, (_, i) => ({
      latitude: i * 0.007,
      longitude: 0,
    }));
    const longFim = longPolyline[longPolyline.length - 1]!;

    await useTripCompletionStore.getState().startTracking({
      tripId: 1,
      rotaId: 'rota-b',
      polyline: longPolyline,
      coordenadaFim: longFim,
      routeDistanceKm: 50,
    });

    useTripCompletionStore.getState().onPosition(longPolyline[0]!);
    expect(useTripCompletionStore.getState().completionRatio).toBeGreaterThan(0);
    expect(useTripCompletionStore.getState().coveredIndices.has(0)).toBe(true);
    await flushMicrotasks();
    // Cobertura por segmento: passando perto do ponto 0 marca segmento (0,1)
    // e portanto indices 0 e 1. Persiste AMBOS via repo.
    expect(mockRecordCoveredIndex).toHaveBeenCalledWith(1, 0);
    expect(mockRecordCoveredIndex).toHaveBeenCalledWith(1, 1);

    mockRecordCoveredIndex.mockClear();
    useTripCompletionStore.getState().onPosition(longPolyline[3]!);
    expect(useTripCompletionStore.getState().coveredIndices.has(3)).toBe(true);
    await flushMicrotasks();
    expect(mockRecordCoveredIndex).toHaveBeenCalled();
  });

  it('completa o trip quando >=80% coberto + perto do fim — chama recordTripCompleted + clearCoveredIndicesForTrip', async () => {
    await useTripCompletionStore.getState().startTracking({
      tripId: 7,
      rotaId: 'rota-c',
      polyline,
      coordenadaFim: fim,
      routeDistanceKm: 50,
      startedAt: Date.now() - 30 * 60 * 1000,
    });

    for (const p of polyline) {
      useTripCompletionStore.getState().onPosition(p);
    }
    useTripCompletionStore.getState().onPosition(fim);

    await flushMicrotasks();

    const state = useTripCompletionStore.getState();
    expect(state.active).toBe(false);
    expect(state.lastCompletedStamp).not.toBeNull();
    expect(state.lastCompletedStamp?.rotaId).toBe('rota-c');
    expect(state.lastCompletedStamp?.durationMinutes).toBeGreaterThanOrEqual(29);

    expect(mockRecordTripCompleted).toHaveBeenCalledTimes(1);
    expect(mockRecordTripCompleted).toHaveBeenCalledWith(
      7,
      expect.any(Number),
      expect.any(Number),
      // distance vem do navigationStore.distanceTraveledKm (=0 nos testes,
      // entao cai no fallback `routeDistanceKm=50`)
      50,
    );
    expect(mockClearCoveredIndices).toHaveBeenCalledWith(7);
  });

  it('nao dispara recordTripCompleted novamente apos completar', async () => {
    await useTripCompletionStore.getState().startTracking({
      tripId: 8,
      rotaId: 'rota-d',
      polyline,
      coordenadaFim: fim,
      routeDistanceKm: 10,
    });
    for (const p of polyline) {
      useTripCompletionStore.getState().onPosition(p);
    }
    useTripCompletionStore.getState().onPosition(fim);
    await flushMicrotasks();

    expect(mockRecordTripCompleted).toHaveBeenCalledTimes(1);
    mockRecordTripCompleted.mockClear();

    useTripCompletionStore.getState().onPosition(fim);
    useTripCompletionStore.getState().onPosition(fim);
    await flushMicrotasks();
    expect(mockRecordTripCompleted).not.toHaveBeenCalled();
  });

  it('stopTracking sem cobertura suficiente apenas limpa state', async () => {
    await useTripCompletionStore.getState().startTracking({
      tripId: 9,
      rotaId: 'rota-e',
      polyline,
      coordenadaFim: fim,
      routeDistanceKm: 5,
    });
    useTripCompletionStore.getState().stopTracking();
    const state = useTripCompletionStore.getState();
    expect(state.active).toBe(false);
    expect(state.tripId).toBeNull();
    expect(state.lastCompletedStamp).toBeNull();
    expect(mockRecordTripCompleted).not.toHaveBeenCalled();
  });

  it('stopTracking com >=80% e dentro de 5km do fim persiste como completado (margem)', async () => {
    // Pra exercitar especificamente o caminho do stopTracking-com-margem,
    // setamos manualmente o estado: 100% coberto, mas posicao do GPS 4km
    // ao norte do fim (fora dos 2km do auto-complete, dentro dos 5km da
    // margem). Sem chamar onPosition.
    useNavigationStore.setState({
      currentPosition: {
        latitude: fim.latitude + 0.036, // ~4km ao norte
        longitude: fim.longitude,
        timestamp: Date.now(),
      },
      distanceTraveledKm: 27,
    });
    useTripCompletionStore.setState({
      active: true,
      tripId: 10,
      rotaId: 'rota-margem',
      polyline,
      coordenadaFim: fim,
      routeDistanceKm: 25,
      startedAt: Date.now() - 10 * 60 * 1000,
      coveredIndices: new Set([0, 1, 2, 3, 4]),
      completionRatio: 1.0,
    });
    mockRecordTripCompleted.mockClear();

    useTripCompletionStore.getState().stopTracking();
    await flushMicrotasks();

    expect(mockRecordTripCompleted).toHaveBeenCalledTimes(1);
    const callArgs = mockRecordTripCompleted.mock.calls[0];
    expect(callArgs?.[0]).toBe(10);
    expect(callArgs?.[3]).toBe(27);
    expect(useTripCompletionStore.getState().lastCompletedStamp?.rotaId).toBe(
      'rota-margem',
    );
  });

  it('stopTracking com >=80% mas longe demais do fim apenas limpa', async () => {
    await useTripCompletionStore.getState().startTracking({
      tripId: 11,
      rotaId: 'rota-longe',
      polyline,
      coordenadaFim: fim,
      routeDistanceKm: 25,
    });
    useTripCompletionStore.setState({
      coveredIndices: new Set([0, 1, 2, 3, 4]),
      completionRatio: 1.0,
    });

    useNavigationStore.setState({
      currentPosition: {
        latitude: fim.latitude + 0.1, // ~11km longe — alem da margem 5km
        longitude: fim.longitude,
        timestamp: Date.now(),
      },
      distanceTraveledKm: 27,
    });

    useTripCompletionStore.getState().stopTracking();
    await flushMicrotasks();

    expect(mockRecordTripCompleted).not.toHaveBeenCalled();
    expect(useTripCompletionStore.getState().active).toBe(false);
  });

  it('acknowledgeStamp limpa o banner pendente', () => {
    useTripCompletionStore.setState({
      lastCompletedStamp: {
        rotaId: 'rota-x',
        completedAt: 1000,
        durationMinutes: 30,
        distanceKm: 100,
      },
    });
    useTripCompletionStore.getState().acknowledgeStamp();
    expect(useTripCompletionStore.getState().lastCompletedStamp).toBeNull();
  });

  it('onPosition em tracker inativo e no-op', () => {
    expect(useTripCompletionStore.getState().active).toBe(false);
    useTripCompletionStore.getState().onPosition({ latitude: 0, longitude: 0 });
    expect(useTripCompletionStore.getState().completionRatio).toBe(0);
    expect(mockRecordTripCompleted).not.toHaveBeenCalled();
  });
});
