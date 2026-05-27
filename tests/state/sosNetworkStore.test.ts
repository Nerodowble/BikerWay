import { useSOSNetworkStore } from '@/state/sosNetworkStore';
import { useIncomingSOSStore } from '@/state/incomingSOSStore';
import { useNavigationStore } from '@/state/navigationStore';
import { SOS_PROTOCOL_VERSION } from '@/domains/sos/network';

describe('sosNetworkStore (Loopback transport)', () => {
  beforeEach(() => {
    useIncomingSOSStore.setState({ alerts: [] });
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

  it('refreshRoom seta a sala baseada no geohash da posicao atual', () => {
    const { currentRoom } = useSOSNetworkStore.getState();
    expect(currentRoom).toMatch(/^bikerway-sos-[a-z0-9]+$/);
  });

  it('mensagem de OUTRO peer (alert_id desconhecido) chega no incomingSOSStore', async () => {
    // F29.2b: usamos transport.broadcast direto pra simular mensagem
    // vinda de um peer remoto. broadcastAlert marcaria own e o filtro
    // descartaria — esse caminho seria coberto pelo ownFilter.test.ts.
    await useSOSNetworkStore.getState().transport.broadcast({
      type: 'sos.alert',
      protocol_version: SOS_PROTOCOL_VERSION,
      alert_id: 'tst-1',
      rider_name: 'Tester',
      problem_type: 'pneu_furado',
      latitude: -23.5,
      longitude: -46.6,
      created_at: Date.now(),
    });
    await new Promise((r) => setTimeout(r, 10));
    const alerts = useIncomingSOSStore.getState().alerts;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.alert_id).toBe('tst-1');
    expect(alerts[0]?.rider_name).toBe('Tester');
  });

  it('cancel remoto remove alerta previamente recebido', async () => {
    await useSOSNetworkStore.getState().transport.broadcast({
      type: 'sos.alert',
      protocol_version: SOS_PROTOCOL_VERSION,
      alert_id: 'tst-2',
      rider_name: 'Tester',
      problem_type: 'pane_seca',
      latitude: -23.5,
      longitude: -46.6,
      created_at: Date.now(),
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(useIncomingSOSStore.getState().alerts).toHaveLength(1);
    await useSOSNetworkStore.getState().transport.broadcast({
      type: 'sos.cancel',
      protocol_version: SOS_PROTOCOL_VERSION,
      alert_id: 'tst-2',
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(useIncomingSOSStore.getState().alerts).toHaveLength(0);
  });

  it('alerta de longe (acima de 15km) e filtrado mesmo entrando pelo loopback', async () => {
    await useSOSNetworkStore.getState().transport.broadcast({
      type: 'sos.alert',
      protocol_version: SOS_PROTOCOL_VERSION,
      alert_id: 'tst-far',
      rider_name: 'Tester',
      problem_type: 'pneu_furado',
      // Rio: ~360km de SP — fora do raio
      latitude: -22.91,
      longitude: -43.17,
      created_at: Date.now(),
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(useIncomingSOSStore.getState().alerts).toHaveLength(0);
  });

  it('mensagens com protocol_version invalido nao sao roteadas', async () => {
    const transport = useSOSNetworkStore.getState().transport;
    // Forca broadcast de um payload manipulado simulando um peer
    // hostil (test bypass do helper publico).
    await transport.broadcast({
      type: 'sos.alert',
      // @ts-expect-error testando proteção do parse defensivo em runtime
      protocol_version: 999,
      alert_id: 'tst-bad',
      rider_name: 'X',
      problem_type: 'pneu_furado',
      latitude: -23.5,
      longitude: -46.6,
      created_at: Date.now(),
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(useIncomingSOSStore.getState().alerts).toHaveLength(0);
  });

  it('SOS_PROTOCOL_VERSION expoe 1', () => {
    expect(SOS_PROTOCOL_VERSION).toBe(1);
  });
});
