import { create } from 'zustand';
import { encodeGeohash } from '@/domains/sos/geohash';
import {
  parseWireMessage,
  SOS_PROTOCOL_VERSION,
  type SOSAlertWireMessage,
  type SOSCancelWireMessage,
} from '@/domains/sos/network';
import type { SOSTransport } from '@/domains/sos/transport';
import { createLoopbackTransport } from '@/domains/sos/transport';
import { useIncomingSOSStore } from './incomingSOSStore';
import { useNavigationStore } from './navigationStore';
import { useAcceptedSOSStore } from './acceptedSOSStore';

/**
 * F29.2 — Orquestrador do canal de SOS Comunitario.
 *
 * Responsabilidades:
 *   1. Manter um `SOSTransport` ativo (default: Loopback; em F29.2b vira
 *      PeerJSBrokerTransport via WebView).
 *   2. Calcular e atualizar o geohash room conforme o piloto se move.
 *   3. Encaminhar mensagens recebidas pro `incomingSOSStore` aplicando o
 *      filtro de 15km de raio.
 *   4. Expor `broadcastAlert` e `broadcastCancel` para o sosStore chamar
 *      quando o piloto disparar/cancelar um SOS local.
 *
 * O design isola a camada de rede do dominio de SOS: o sosStore nao
 * conhece o transport e o transport nao conhece a UI.
 */

interface SOSNetworkStore {
  transport: SOSTransport;
  currentRoom: string | null;
  isReady: boolean;
  /**
   * F29.2b — alert_ids que ESTE device originou. O broker do PeerJS
   * rebroadcasta a propria mensagem de volta pra rede; usamos este set
   * pra filtrar e nao mostrar modal pro proprio piloto. Expirado quando
   * o cancel propagar (sai do set ao receber cancel proprio) ou apos 1h
   * via pruneOwnAlerts.
   */
  ownAlertIds: Set<string>;
  /** Substitui o transport ativo (chamado pelo PeerJS mount em F29.2b). */
  setTransport: (transport: SOSTransport) => void;
  /** Atualiza a sala com base na posicao atual; sem efeito se nada mudou. */
  refreshRoom: () => void;
  broadcastAlert: (msg: Omit<SOSAlertWireMessage, 'type' | 'protocol_version'>) => void;
  broadcastCancel: (alertId: string) => void;
}

function buildRoomId(geohash: string): string {
  return `bikerway-sos-${geohash}`;
}

/**
 * Cria o store COM um transport ja vinculado. A funcao default usa
 * Loopback, mas testes (e a futura integracao PeerJS) podem chamar
 * `setTransport` para trocar em runtime.
 */
function initialize(): SOSNetworkStore {
  const transport = createLoopbackTransport();

  const unsubscribe = transport.onMessage((msg) => routeIncoming(msg));
  // Guardamos o unsubscribe num closure que sera reaplicado se o
  // transport for trocado (setTransport limpa o antigo e reanexa).
  (transport as SOSTransport & { _unsubscribe?: () => void })._unsubscribe = unsubscribe;

  return {
    transport,
    currentRoom: null,
    isReady: true,
    ownAlertIds: new Set<string>(),
    setTransport: () => {
      // Implementado abaixo via set/get — placeholder pro shape.
    },
    refreshRoom: () => {},
    broadcastAlert: () => {},
    broadcastCancel: () => {},
  };
}

function routeIncoming(raw: unknown): void {
  // Parse defensivo: descarta payloads malformados ou de protocol_version
  // futura. parseWireMessage retorna null nesses casos e silenciamos —
  // SOS comunitario nao pode quebrar por causa de peer hostil/mais novo.
  const msg = parseWireMessage(raw);
  if (msg === null) return;

  // F29.2b: filtro de "broadcast meu mesmo voltando". O broker PeerJS
  // re-envia a mensagem pra rede toda, incluindo o emissor; sem este
  // filtro o piloto veria modal do proprio SOS ao disparar.
  const ownIds = useSOSNetworkStore.getState().ownAlertIds;
  if (ownIds.has(msg.alert_id)) {
    if (msg.type === 'sos.cancel') {
      // Cancel chegou de volta: limpa pra que o id possa ser reutilizado
      // hipoteticamente. Tambem libera o Set de crescer indefinidamente.
      const next = new Set(ownIds);
      next.delete(msg.alert_id);
      useSOSNetworkStore.setState({ ownAlertIds: next });
    }
    return;
  }

  if (msg.type === 'sos.alert') {
    const pos = useNavigationStore.getState().currentPosition;
    if (pos === null) {
      // Sem GPS local nao da pra calcular distancia — descarta.
      return;
    }
    useIncomingSOSStore.getState().receive({
      alert_id: msg.alert_id,
      rider_name: msg.rider_name,
      problem_type: msg.problem_type,
      latitude: msg.latitude,
      longitude: msg.longitude,
      created_at: msg.created_at,
      receiver_latitude: pos.latitude,
      receiver_longitude: pos.longitude,
      ...(msg.rider_moto !== undefined ? { rider_moto: msg.rider_moto } : {}),
      ...(msg.message !== undefined ? { message: msg.message } : {}),
    });
  } else if (msg.type === 'sos.cancel') {
    // F29.5: remove tanto da fila de alertas pendentes (caso o piloto
    // ainda nao tenha decidido) quanto do acceptedSOSStore (caso ele
    // ja tenha aceitado e esteja indo). Se a pilula esta ativa no mapa
    // pra esse alert_id, limpa — o emissor cancelou, nao tem mais
    // emergencia pra atender.
    useIncomingSOSStore.getState().dismissAlert(msg.alert_id);
    const acceptedActive = useAcceptedSOSStore.getState().active;
    if (acceptedActive !== null && acceptedActive.alert_id === msg.alert_id) {
      useAcceptedSOSStore.getState().clear();
      // O destination no navigationStore foi setado pra coord do SOS no
      // aceite (F29.3); limpar tambem evita um "destino fantasma" depois
      // do cancelamento remoto. O IncomingSOSMount nao reage a esse path
      // (so reage quando destination muda), entao precisamos zerar aqui.
      useNavigationStore.getState().setDestination(null);
    }
  }
}

export const useSOSNetworkStore = create<SOSNetworkStore>((set, get) => {
  const initial = initialize();
  return {
    ...initial,
    setTransport: (newTransport) => {
      const prev = get().transport as SOSTransport & { _unsubscribe?: () => void };
      try {
        prev._unsubscribe?.();
        void prev.teardown();
      } catch {
        // Teardown best-effort.
      }
      const unsubscribe = newTransport.onMessage((msg) => routeIncoming(msg));
      (newTransport as SOSTransport & { _unsubscribe?: () => void })._unsubscribe =
        unsubscribe;
      set({ transport: newTransport, currentRoom: null, isReady: true });
      get().refreshRoom();
    },
    refreshRoom: () => {
      const pos = useNavigationStore.getState().currentPosition;
      if (pos === null) return;
      const geohash = encodeGeohash(pos.latitude, pos.longitude, 4);
      const roomId = buildRoomId(geohash);
      if (roomId === get().currentRoom) return;
      void get().transport.setGeohashRoom(roomId);
      set({ currentRoom: roomId });
    },
    broadcastAlert: (input) => {
      // Garante room atualizada antes do disparo — pega caso o piloto
      // tenha entrado no app, dado SOS imediato e ainda nao houve refresh.
      get().refreshRoom();
      // F29.2b: marca o alert_id como proprio antes do broadcast, pra
      // que o filtro em routeIncoming descarte a copia que volta do
      // broker PeerJS.
      const next = new Set(get().ownAlertIds);
      next.add(input.alert_id);
      set({ ownAlertIds: next });
      const msg: SOSAlertWireMessage = {
        type: 'sos.alert',
        protocol_version: SOS_PROTOCOL_VERSION,
        ...input,
      };
      void get().transport.broadcast(msg);
    },
    broadcastCancel: (alertId) => {
      get().refreshRoom();
      const msg: SOSCancelWireMessage = {
        type: 'sos.cancel',
        protocol_version: SOS_PROTOCOL_VERSION,
        alert_id: alertId,
      };
      void get().transport.broadcast(msg);
    },
  };
});

// Exportado para testes que precisam parsear/injetar mensagens cruas.
export const _internal = { routeIncoming, parseWireMessage };
