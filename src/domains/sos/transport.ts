import type { SOSWireMessage } from './network';

/**
 * Interface estavel entre o domain de SOS e a camada de rede (F29.2).
 *
 * Implementacoes possiveis:
 *   - LoopbackTransport: in-process, util pra testes e self-test no celular
 *     do user (ele dispara SOS e ve o alerta chegar no proprio device).
 *   - PeerJSBrokerTransport (F29.2b): broker model em PeerJS via WebView,
 *     deterministic ID baseado no geohash atual do piloto.
 *   - SupabaseRealtimeTransport (futuro): canal pubsub anonimo, mais
 *     robusto que P2P mas exige backend.
 *
 * Contrato:
 *   - `setGeohashRoom(roomId)` define em que "canal" o transport vai
 *     publicar/escutar. O sosNetworkStore chama isso sempre que o
 *     geohash do piloto muda.
 *   - `broadcast(message)` publica para todos os peers no canal atual.
 *     Idempotente — chamar duas vezes com mesmo alert_id manda duas
 *     copias; o receptor que dedup.
 *   - `onMessage(handler)` registra callback para mensagens recebidas.
 *     Retorna um unsubscriber.
 *   - `teardown()` libera recursos (fecha conexoes, remove listeners).
 *
 * Erros sao reportados via callback opcional `onError`. Falhas nao
 * derrubam o app — SOS comunitario e best-effort.
 */
export interface SOSTransport {
  setGeohashRoom: (roomId: string) => Promise<void> | void;
  broadcast: (message: SOSWireMessage) => Promise<void> | void;
  /**
   * Handlers recebem o payload BRUTO (unknown) — em PeerJS data channel
   * vem como JSON parseado mas sem garantia de shape. O consumer deve
   * passar por `parseWireMessage()` antes de usar. Forca validacao no
   * boundary, igual ao catalogClient pickValidatedOptional.
   */
  onMessage: (handler: (raw: unknown) => void) => () => void;
  teardown: () => Promise<void> | void;
}

/**
 * Loopback transport — broadcast vai pros listeners DENTRO do mesmo
 * processo. Util pra testes automatizados e pra dev validar o fluxo
 * sem precisar de outro device. Em producao real, troca por
 * PeerJSBrokerTransport.
 *
 * Detalhe: o broadcast e ASSINCRONO via setTimeout(0) pra simular o
 * comportamento de rede (mensagem nao chega no mesmo tick do dispatch),
 * evitando que o callback execute durante o reducer do sosStore.
 */
export function createLoopbackTransport(): SOSTransport {
  const handlers = new Set<(raw: unknown) => void>();
  let currentRoom: string | null = null;

  return {
    setGeohashRoom: (roomId) => {
      currentRoom = roomId;
    },
    broadcast: (message) => {
      // Sem sala configurada nao broadcasta — simula comportamento PeerJS
      // (transport nao envia se o canal nao foi estabelecido).
      if (currentRoom === null) return;
      // Simula serializacao round-trip da rede: payload chega no receiver
      // como objeto puro, sem prototype chain do que foi enviado. Isso
      // espelha o comportamento do PeerJS data channel (JSON.stringify
      // no envio + JSON.parse na chegada) e mantem o LoopbackTransport
      // honesto sobre quem precisa validar.
      const serialized: unknown = JSON.parse(JSON.stringify(message)) as unknown;
      setTimeout(() => {
        for (const h of handlers) {
          try {
            h(serialized);
          } catch {
            // Handler nao pode derrubar o broadcast pra outros listeners.
          }
        }
      }, 0);
    },
    onMessage: (handler) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    teardown: () => {
      handlers.clear();
      currentRoom = null;
    },
  };
}
