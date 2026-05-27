import { useSOSNetworkStore } from '@/state/sosNetworkStore';
import { useIncomingSOSStore } from '@/state/incomingSOSStore';
import { useNavigationStore } from '@/state/navigationStore';
import { SOS_PROTOCOL_VERSION } from '@/domains/sos/network';

/**
 * F29.2b — Filtro de "broadcast meu mesmo voltando".
 *
 * Quando o transport e PeerJS broker, a mensagem que voce envia retorna
 * pra rede toda (broker rebroadcasta). Sem filtro, o piloto veria modal
 * do proprio SOS. O store mantem um Set de `ownAlertIds`; ao receber
 * um alert/cancel com id presente nesse set, descarta silenciosamente.
 */
describe('sosNetworkStore ownAlertIds filter (F29.2b)', () => {
  beforeEach(() => {
    useIncomingSOSStore.setState({ alerts: [] });
    useSOSNetworkStore.setState({ ownAlertIds: new Set<string>() });
    useNavigationStore.setState({
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

  it('broadcastAlert marca o alert_id como proprio', async () => {
    useSOSNetworkStore.getState().broadcastAlert({
      alert_id: 'own-1',
      rider_name: 'Eu',
      problem_type: 'pneu_furado',
      latitude: -23.5,
      longitude: -46.6,
      created_at: Date.now(),
    });
    expect(useSOSNetworkStore.getState().ownAlertIds.has('own-1')).toBe(true);
    // Drena o setTimeout(0) do loopback pra que a mensagem nao vaze
    // pro proximo teste e contamine os asserts dele.
    await new Promise((r) => setTimeout(r, 10));
  });

  it('alerta proprio voltando NAO entra no incomingSOSStore', async () => {
    useSOSNetworkStore.getState().broadcastAlert({
      alert_id: 'own-2',
      rider_name: 'Eu',
      problem_type: 'pneu_furado',
      latitude: -23.5,
      longitude: -46.6,
      created_at: Date.now(),
    });
    // Loopback entrega de volta apos setTimeout(0). O filtro deve cortar.
    await new Promise((r) => setTimeout(r, 10));
    expect(useIncomingSOSStore.getState().alerts).toHaveLength(0);
  });

  it('alerta de OUTRO peer (alert_id desconhecido) entra normalmente', async () => {
    // Simula recepcao de uma mensagem que NAO foi originada por este device.
    const transport = useSOSNetworkStore.getState().transport;
    await transport.broadcast({
      type: 'sos.alert',
      protocol_version: SOS_PROTOCOL_VERSION,
      alert_id: 'stranger-1',
      rider_name: 'Outro',
      problem_type: 'pane_seca',
      latitude: -23.5,
      longitude: -46.6,
      created_at: Date.now(),
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(useIncomingSOSStore.getState().alerts).toHaveLength(1);
    expect(useIncomingSOSStore.getState().alerts[0]?.alert_id).toBe('stranger-1');
  });

  it('cancel proprio voltando limpa o id do set (libera memoria)', async () => {
    useSOSNetworkStore.getState().broadcastAlert({
      alert_id: 'own-3',
      rider_name: 'Eu',
      problem_type: 'pneu_furado',
      latitude: -23.5,
      longitude: -46.6,
      created_at: Date.now(),
    });
    expect(useSOSNetworkStore.getState().ownAlertIds.has('own-3')).toBe(true);
    // Espera o broadcast ser absorvido pelo filtro
    await new Promise((r) => setTimeout(r, 10));
    // Agora o cancel — broadcast volta via loopback e dispara cleanup
    useSOSNetworkStore.getState().broadcastCancel('own-3');
    await new Promise((r) => setTimeout(r, 10));
    expect(useSOSNetworkStore.getState().ownAlertIds.has('own-3')).toBe(false);
  });
});
