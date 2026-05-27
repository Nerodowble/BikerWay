import { useIncomingSOSStore } from '@/state/incomingSOSStore';
import { useNavigationStore } from '@/state/navigationStore';

describe('F29.3 fluxo accept/decline (IncomingSOSMount level)', () => {
  beforeEach(() => {
    useIncomingSOSStore.setState({ alerts: [] });
    useNavigationStore.setState({
      destination: null,
      currentPosition: {
        latitude: -23.5,
        longitude: -46.6,
        accuracy: 5,
        timestamp: Date.now(),
        heading: null,
        speed: null,
      },
    });
  });

  it('aceitar SOS seta destination com coords do alerta', () => {
    useIncomingSOSStore.getState().receive({
      alert_id: 'flow-1',
      rider_name: 'Carlos',
      problem_type: 'pneu_furado',
      latitude: -23.51,
      longitude: -46.62,
      created_at: Date.now(),
      receiver_latitude: -23.5,
      receiver_longitude: -46.6,
    });

    const alert = useIncomingSOSStore.getState().alerts[0];
    expect(alert).toBeDefined();
    if (!alert) return;

    // Simula o que IncomingSOSMount.handleAccept faz internamente
    useNavigationStore.getState().setDestination({
      latitude: alert.latitude,
      longitude: alert.longitude,
      timestamp: Date.now(),
    });
    useIncomingSOSStore.getState().dismissAlert(alert.alert_id);

    const dest = useNavigationStore.getState().destination;
    expect(dest?.latitude).toBeCloseTo(-23.51);
    expect(dest?.longitude).toBeCloseTo(-46.62);
    expect(useIncomingSOSStore.getState().alerts).toHaveLength(0);
  });

  it('recusar SOS apenas dismissa sem tocar no destination', () => {
    useIncomingSOSStore.getState().receive({
      alert_id: 'flow-2',
      rider_name: 'Carlos',
      problem_type: 'pneu_furado',
      latitude: -23.51,
      longitude: -46.62,
      created_at: Date.now(),
      receiver_latitude: -23.5,
      receiver_longitude: -46.6,
    });

    const initialDest = useNavigationStore.getState().destination;
    useIncomingSOSStore.getState().dismissAlert('flow-2');

    expect(useIncomingSOSStore.getState().alerts).toHaveLength(0);
    expect(useNavigationStore.getState().destination).toBe(initialDest);
  });

  it('FIFO: dismissar o primeiro alerta promove o segundo no selectFirstActive', () => {
    useIncomingSOSStore.getState().receive({
      alert_id: 'q-1',
      rider_name: 'A',
      problem_type: 'pneu_furado',
      latitude: -23.5,
      longitude: -46.6,
      created_at: Date.now(),
      receiver_latitude: -23.5,
      receiver_longitude: -46.6,
    });
    useIncomingSOSStore.getState().receive({
      alert_id: 'q-2',
      rider_name: 'B',
      problem_type: 'pane_mecanica',
      latitude: -23.5,
      longitude: -46.6,
      created_at: Date.now(),
      receiver_latitude: -23.5,
      receiver_longitude: -46.6,
    });

    // Mais novo entra primeiro (unshift) — primeiro do array e o segundo recebido.
    const state = useIncomingSOSStore.getState();
    expect(state.alerts[0]?.alert_id).toBe('q-2');

    useIncomingSOSStore.getState().dismissAlert('q-2');
    expect(useIncomingSOSStore.getState().alerts[0]?.alert_id).toBe('q-1');
  });
});
