import {
  MAX_DISTANCE_KM,
  useIncomingSOSStore,
} from '@/state/incomingSOSStore';

const baseInput = {
  alert_id: 'a-1',
  rider_name: 'Carlos',
  problem_type: 'pneu_furado' as const,
  latitude: -23.5,
  longitude: -46.6,
  created_at: 1700000000000,
  receiver_latitude: -23.5,
  receiver_longitude: -46.6,
};

describe('incomingSOSStore.receive', () => {
  beforeEach(() => {
    useIncomingSOSStore.setState({ alerts: [] });
  });

  it('aceita alerta proximo (dentro do raio de 15km)', () => {
    const result = useIncomingSOSStore.getState().receive(baseInput);
    expect(result).toBe('accepted');
    const state = useIncomingSOSStore.getState();
    expect(state.alerts).toHaveLength(1);
    expect(state.alerts[0]?.distance_km).toBeLessThan(0.1);
  });

  it('rejeita alerta acima do raio maximo', () => {
    // Sao Paulo capital → Rio = ~360km. Bem acima dos 15km.
    const result = useIncomingSOSStore.getState().receive({
      ...baseInput,
      latitude: -22.91,
      longitude: -43.17,
    });
    expect(result).toBe('too_far');
    expect(useIncomingSOSStore.getState().alerts).toHaveLength(0);
  });

  it('descarta duplicata pelo alert_id', () => {
    useIncomingSOSStore.getState().receive(baseInput);
    const second = useIncomingSOSStore.getState().receive(baseInput);
    expect(second).toBe('duplicate');
    expect(useIncomingSOSStore.getState().alerts).toHaveLength(1);
  });

  it('aceita alerta na borda do raio mas rejeita logo apos', () => {
    // ~14km de SP — dentro
    const close = useIncomingSOSStore.getState().receive({
      ...baseInput,
      alert_id: 'a-close',
      latitude: -23.5,
      longitude: -46.46,
    });
    // ~17km — fora
    const far = useIncomingSOSStore.getState().receive({
      ...baseInput,
      alert_id: 'a-far',
      latitude: -23.5,
      longitude: -46.43,
    });
    expect(close).toBe('accepted');
    expect(far).toBe('too_far');
  });

  it('expoe MAX_DISTANCE_KM como 15', () => {
    // Trava o numero pra que mudanca acidental em 1 lugar quebre o teste.
    expect(MAX_DISTANCE_KM).toBe(15);
  });

  it('dismissAlert remove pelo alert_id', () => {
    useIncomingSOSStore.getState().receive(baseInput);
    useIncomingSOSStore.getState().receive({
      ...baseInput,
      alert_id: 'a-2',
    });
    useIncomingSOSStore.getState().dismissAlert('a-1');
    const state = useIncomingSOSStore.getState();
    expect(state.alerts).toHaveLength(1);
    expect(state.alerts[0]?.alert_id).toBe('a-2');
  });

  it('pruneExpired remove alertas com mais de 5 minutos', () => {
    useIncomingSOSStore.getState().receive(baseInput);
    const now = Date.now();
    // Forca o received_at pra > 5min no passado
    useIncomingSOSStore.setState({
      alerts: useIncomingSOSStore.getState().alerts.map((a) => ({
        ...a,
        received_at: now - 6 * 60 * 1000,
      })),
    });
    useIncomingSOSStore.getState().pruneExpired(now);
    expect(useIncomingSOSStore.getState().alerts).toHaveLength(0);
  });

  it('pruneExpired preserva alertas frescos', () => {
    useIncomingSOSStore.getState().receive(baseInput);
    useIncomingSOSStore.getState().pruneExpired();
    expect(useIncomingSOSStore.getState().alerts).toHaveLength(1);
  });
});
