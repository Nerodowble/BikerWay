import { useSOSNetworkStore } from '@/state/sosNetworkStore';
import { useIncomingSOSStore } from '@/state/incomingSOSStore';
import { useAcceptedSOSStore } from '@/state/acceptedSOSStore';
import { useNavigationStore } from '@/state/navigationStore';
import { SOS_PROTOCOL_VERSION } from '@/domains/sos/network';

/**
 * F29.5 — Cancel propagation E2E pela camada de network/store. Cobre o
 * caso em que o piloto receptor JA aceitou o socorro e a pilula SOS
 * esta plotada no mapa; quando o emissor cancela, a pilula deve
 * desaparecer junto com o destino setado.
 */
describe('F29.5 cancel propagation', () => {
  beforeEach(() => {
    useIncomingSOSStore.setState({ alerts: [] });
    useAcceptedSOSStore.setState({ active: null });
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
    useSOSNetworkStore.getState().refreshRoom();
  });

  it('cancel remove alerta pendente (nao aceito) do incomingSOSStore', async () => {
    // F29.2b: usamos transport direto pra simular mensagem de OUTRO peer
    // (broadcastAlert marcaria own e o filtro descartaria).
    const transport = useSOSNetworkStore.getState().transport;
    await transport.broadcast({
      type: 'sos.alert',
      protocol_version: SOS_PROTOCOL_VERSION,
      alert_id: 'a-pending',
      rider_name: 'Carlos',
      problem_type: 'pneu_furado',
      latitude: -23.5,
      longitude: -46.6,
      created_at: Date.now(),
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(useIncomingSOSStore.getState().alerts).toHaveLength(1);

    await transport.broadcast({
      type: 'sos.cancel',
      protocol_version: SOS_PROTOCOL_VERSION,
      alert_id: 'a-pending',
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(useIncomingSOSStore.getState().alerts).toHaveLength(0);
  });

  it('cancel limpa pilula do mapa e destination quando alerta ja foi aceito', async () => {
    const transport = useSOSNetworkStore.getState().transport;
    await transport.broadcast({
      type: 'sos.alert',
      protocol_version: SOS_PROTOCOL_VERSION,
      alert_id: 'a-accepted',
      rider_name: 'Carlos',
      rider_moto: 'Honda Hornet',
      problem_type: 'pneu_furado',
      latitude: -23.51,
      longitude: -46.62,
      created_at: Date.now(),
    });
    await new Promise((r) => setTimeout(r, 10));
    const inAlert = useIncomingSOSStore.getState().alerts[0];
    expect(inAlert).toBeDefined();
    if (!inAlert) return;

    // Aceita (espelha o que IncomingSOSMount.handleAccept faz)
    useAcceptedSOSStore.getState().accept(inAlert);
    useNavigationStore.getState().setDestination({
      latitude: inAlert.latitude,
      longitude: inAlert.longitude,
      timestamp: Date.now(),
    });
    useIncomingSOSStore.getState().dismissAlert(inAlert.alert_id);
    expect(useAcceptedSOSStore.getState().active?.alert_id).toBe('a-accepted');

    // Emissor cancela — o receptor que ja aceitou deve ter pilula e
    // destination limpos.
    await transport.broadcast({
      type: 'sos.cancel',
      protocol_version: SOS_PROTOCOL_VERSION,
      alert_id: 'a-accepted',
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(useAcceptedSOSStore.getState().active).toBeNull();
    expect(useNavigationStore.getState().destination).toBeNull();
  });

  it('cancel de outro alert_id NAO afeta o aceito ativo', async () => {
    // Simula um SOS aceito
    useAcceptedSOSStore.getState().accept({
      alert_id: 'keep-me',
      rider_name: 'A',
      problem_type: 'pneu_furado',
      latitude: -23.5,
      longitude: -46.6,
      distance_km: 1,
      created_at: Date.now(),
      received_at: Date.now(),
    });
    useNavigationStore.getState().setDestination({
      latitude: -23.5,
      longitude: -46.6,
      timestamp: Date.now(),
    });

    useSOSNetworkStore.getState().broadcastCancel('different-id');
    await new Promise((r) => setTimeout(r, 10));

    expect(useAcceptedSOSStore.getState().active?.alert_id).toBe('keep-me');
    expect(useNavigationStore.getState().destination).not.toBeNull();
  });
});
