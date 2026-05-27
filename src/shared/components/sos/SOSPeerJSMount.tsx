import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { encodeGeohash } from '@/domains/sos/geohash';
import { createPeerJSTransport } from '@/infrastructure/sos/peerJSTransport';
import type { SOSTransport } from '@/domains/sos/transport';
import { useNavigationStore } from '@/state/navigationStore';
import { useSOSNetworkStore } from '@/state/sosNetworkStore';
import {
  SOSPeerJSWebView,
  type SOSPeerJSWebViewHandle,
} from './SOSPeerJSWebView';

/**
 * F29.2b — Mount no App root que mantem a WebView SOS viva e a integra
 * com o `sosNetworkStore` via `createPeerJSTransport`.
 *
 * Ciclo de vida:
 *   1. App boot — GPS nao chegou ainda → render null. `sosNetworkStore`
 *      continua com transport Loopback (do create()).
 *   2. GPS chega → calcula geohash4 → renderiza `SOSPeerJSWebView` com
 *      `key={geohash}` pra forcar remount em mudanca de celula.
 *   3. WebView termina boot → dispara `onBridgeReady` → criamos um
 *      `SOSTransport` PeerJS e chamamos `setTransport`. A partir daqui
 *      broadcasts vao pela rede.
 *   4. Geohash muda (piloto cruzou pra outra celula) → `key` muda → React
 *      desmonta a WebView antiga (chama teardown via `window.bwSosTeardown`)
 *      e monta uma nova. Quando a nova ficar ready, instalamos um
 *      transport novo. Durante o gap (~1-3s) broadcasts sao perdidos —
 *      aceitavel pra v1.
 *
 * Mensagens inbound: a WebView dispara `onMessage(raw)`; encaminhamos pro
 * sink registrado pelo transport (que por sua vez dispara pros handlers
 * do sosNetworkStore -> routeIncoming).
 */

export const SOSPeerJSMount: React.FC = () => {
  const currentPosition = useNavigationStore((s) => s.currentPosition);

  const handleRef = useRef<SOSPeerJSWebViewHandle | null>(null);
  // Sink ativo do transport corrente. Setado quando o transport chama
  // `registerSink`; null quando ninguem ta escutando. Encapsulado em ref
  // pra que onMessage do WebView possa entregar sem precisar de re-bind.
  const sinkRef = useRef<((raw: unknown) => void) | null>(null);
  const transportRef = useRef<SOSTransport | null>(null);

  const geohash = useMemo(() => {
    if (currentPosition === null) return null;
    try {
      return encodeGeohash(currentPosition.latitude, currentPosition.longitude, 4);
    } catch {
      return null;
    }
  }, [currentPosition]);

  const handleBridgeReady = useCallback(() => {
    if (transportRef.current) {
      try {
        transportRef.current.teardown();
      } catch {
        // best-effort
      }
      transportRef.current = null;
    }
    const transport = createPeerJSTransport({
      getHandle: () => handleRef.current,
      registerSink: (sink) => {
        sinkRef.current = sink;
        return () => {
          if (sinkRef.current === sink) sinkRef.current = null;
        };
      },
    });
    transportRef.current = transport;
    useSOSNetworkStore.getState().setTransport(transport);
  }, []);

  const handleMessage = useCallback((raw: unknown) => {
    sinkRef.current?.(raw);
  }, []);

  // No unmount do mount inteiro (app desligando), libera o transport.
  // NAO revertemos pra Loopback aqui porque app ta morrendo — gasto inutil.
  useEffect(() => {
    return () => {
      if (transportRef.current) {
        try {
          transportRef.current.teardown();
        } catch {
          // best-effort
        }
        transportRef.current = null;
      }
    };
  }, []);

  if (geohash === null) return null;

  return (
    <SOSPeerJSWebView
      key={geohash}
      ref={handleRef}
      geohash={geohash}
      onBridgeReady={handleBridgeReady}
      onMessage={handleMessage}
    />
  );
};
