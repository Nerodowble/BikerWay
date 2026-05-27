import type { SOSWireMessage } from '@/domains/sos/network';
import type { SOSTransport } from '@/domains/sos/transport';
import type { SOSPeerJSWebViewHandle } from '@/shared/components/sos/SOSPeerJSWebView';

/**
 * F29.2b — Implementacao de `SOSTransport` em cima da SOSPeerJSWebView.
 *
 * O transport e leve: delega broadcast pra `webViewHandle.broadcast(...)` e
 * encaminha mensagens recebidas (que chegam via `onMessage` do componente
 * de WebView) pros listeners registrados. A WebView e gerenciada pelo
 * SOSPeerJSMount; aqui so trabalhamos sobre o handle.
 *
 * Sala/room:
 *  - `setGeohashRoom` em v1 e um no-op no transport: a sala e bound a
 *    pagina HTML inicial via `key={geohash}` no SOSPeerJSMount. Quando o
 *    geohash muda, o mount remonta a WebView (com `key` novo) — o
 *    sosNetworkStore.setTransport sera chamado de novo com novo handle.
 *    Mantemos o metodo no contrato pra cumprir a interface, mas a logica
 *    de troca de sala vive no mount.
 */
export interface CreatePeerJSTransportOptions {
  /** Handle da WebView ativa. Deve estar montada antes do primeiro uso. */
  getHandle: () => SOSPeerJSWebViewHandle | null;
  /** Notifica o transport que uma mensagem chegou da rede. Chamado pelo mount. */
  registerSink: (sink: (raw: unknown) => void) => () => void;
}

export function createPeerJSTransport(
  opts: CreatePeerJSTransportOptions,
): SOSTransport {
  const handlers = new Set<(raw: unknown) => void>();
  // Single sink registrado uma vez no mount. Dispara pra todos os
  // handlers internos do transport.
  const unregister = opts.registerSink((raw) => {
    for (const h of handlers) {
      try {
        h(raw);
      } catch {
        // Handler nao pode derrubar broadcast pra outros listeners.
      }
    }
  });

  return {
    setGeohashRoom: () => {
      // No-op em v1; sala e controlada pelo mount via remount com key.
    },
    broadcast: (message: SOSWireMessage) => {
      const handle = opts.getHandle();
      if (!handle) return;
      // Serializa explicitamente pra que a injecao na WebView seja
      // determinista (sem dependencia da implementacao do JSON.stringify
      // dentro do PeerJS).
      handle.broadcast(JSON.stringify(message));
    },
    onMessage: (handler) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    teardown: () => {
      handlers.clear();
      unregister();
      const handle = opts.getHandle();
      if (handle) {
        try {
          handle.teardown();
        } catch {
          // Best-effort.
        }
      }
    },
  };
}
