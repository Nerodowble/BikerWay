import { createPeerJSTransport } from '@/infrastructure/sos/peerJSTransport';
import { SOS_PROTOCOL_VERSION } from '@/domains/sos/network';
import type { SOSPeerJSWebViewHandle } from '@/shared/components/sos/SOSPeerJSWebView';

/**
 * F29.2b — Cobertura unitaria do transport PeerJS.
 *
 * Nao testamos a WebView (precisa de runtime DOM) — apenas a logica
 * de routing entre handler/handle/sink que o transport gerencia.
 */
describe('createPeerJSTransport', () => {
  it('broadcast serializa e chama handle.broadcast com JSON string', () => {
    const broadcastSpy = jest.fn();
    const handle: SOSPeerJSWebViewHandle = {
      broadcast: broadcastSpy,
      teardown: jest.fn(),
    };
    const transport = createPeerJSTransport({
      getHandle: () => handle,
      registerSink: () => () => {},
    });
    transport.broadcast({
      type: 'sos.alert',
      protocol_version: SOS_PROTOCOL_VERSION,
      alert_id: 'a-1',
      rider_name: 'X',
      problem_type: 'pneu_furado',
      latitude: -23.5,
      longitude: -46.6,
      created_at: 1700000000000,
    });
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    const arg = broadcastSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(arg) as { alert_id: string; type: string };
    expect(parsed.alert_id).toBe('a-1');
    expect(parsed.type).toBe('sos.alert');
  });

  it('broadcast e no-op quando getHandle retorna null (WebView nao montada)', () => {
    const transport = createPeerJSTransport({
      getHandle: () => null,
      registerSink: () => () => {},
    });
    expect(() =>
      transport.broadcast({
        type: 'sos.cancel',
        protocol_version: SOS_PROTOCOL_VERSION,
        alert_id: 'a-2',
      }),
    ).not.toThrow();
  });

  it('handlers registrados via onMessage recebem o que o sink dispara', () => {
    let sinkFn: ((raw: unknown) => void) | null = null;
    const transport = createPeerJSTransport({
      getHandle: () => null,
      registerSink: (sink) => {
        sinkFn = sink;
        return () => {
          sinkFn = null;
        };
      },
    });
    const received: unknown[] = [];
    transport.onMessage((raw) => received.push(raw));
    expect(sinkFn).not.toBeNull();
    if (sinkFn === null) return;
    (sinkFn as (raw: unknown) => void)({ hello: 'world' });
    (sinkFn as (raw: unknown) => void)(42);
    expect(received).toHaveLength(2);
    expect(received[0]).toEqual({ hello: 'world' });
    expect(received[1]).toBe(42);
  });

  it('teardown chama handle.teardown e libera o sink', () => {
    const teardownSpy = jest.fn();
    let sinkUnregistered = false;
    const handle: SOSPeerJSWebViewHandle = {
      broadcast: jest.fn(),
      teardown: teardownSpy,
    };
    const transport = createPeerJSTransport({
      getHandle: () => handle,
      registerSink: () => () => {
        sinkUnregistered = true;
      },
    });
    transport.teardown();
    expect(teardownSpy).toHaveBeenCalledTimes(1);
    expect(sinkUnregistered).toBe(true);
  });

  it('onMessage unsubscriber para de receber callbacks', () => {
    let sinkFn: ((raw: unknown) => void) | null = null;
    const transport = createPeerJSTransport({
      getHandle: () => null,
      registerSink: (sink) => {
        sinkFn = sink;
        return () => {
          sinkFn = null;
        };
      },
    });
    const received: unknown[] = [];
    const unsub = transport.onMessage((raw) => received.push(raw));
    if (sinkFn !== null) (sinkFn as (raw: unknown) => void)('first');
    unsub();
    if (sinkFn !== null) (sinkFn as (raw: unknown) => void)('second');
    expect(received).toEqual(['first']);
  });
});
