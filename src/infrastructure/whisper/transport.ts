import type { WhisperReport } from '@/domains/whisper/types';

/**
 * F35.9 — Interface de transport pro Whisper. Permite plugar diferentes
 * backends:
 *   - `LoopbackWhisperTransport` (in-process, default ate plug do PeerJS).
 *     Self-testavel sem dependencia de rede. Padrao validado no SOS e
 *     comboio (ver `pattern_loopback_transport` na memoria).
 *   - PeerJS broker model com canal por rota (sub-fase futura). Mesma API.
 */

export type WhisperListener = (report: WhisperReport) => void;

export interface WhisperTransport {
  /** Conecta ao canal da rota. Idempotente — chamar varias vezes
   *  pra mesma rotaId retorna o mesmo canal aberto. */
  join: (rotaId: string) => Promise<void>;
  /** Desconecta do canal. Chamado quando o piloto encerra navegacao ou
   *  troca de rota. */
  leave: (rotaId: string) => Promise<void>;
  /** Envia (broadcast) o report pros outros peers no canal. */
  publish: (report: WhisperReport) => Promise<void>;
  /** Subscribe a reports recebidos. Retorna unsubscribe. */
  subscribe: (listener: WhisperListener) => () => void;
}

/**
 * Transport in-process: simula um broker local que roteia mensagens entre
 * publishers e subscribers no mesmo runtime. Usado pra dev + tests; em
 * producao um transport baseado em PeerJS DataChannel substitui sem mudar
 * a API.
 *
 * Pra simular "ja recebi avisos quando entrei no canal", o transport
 * mantem um cache TTL-aware por rotaId (in-RAM). Quando um listener faz
 * join + subscribe, recebe os reports cacheados serializados via
 * setTimeout(0) — mesmo padrao do loopback do voiceGroup.
 */
export function createLoopbackWhisperTransport(options?: {
  /** Override do clock pra tests deterministicos. */
  now?: () => number;
}): WhisperTransport {
  const now = options?.now ?? Date.now;
  const channelsJoined = new Set<string>();
  const cacheByChannel = new Map<string, WhisperReport[]>();
  const listeners = new Set<WhisperListener>();

  function emitToAll(report: WhisperReport): void {
    // JSON round-trip mimick do data channel pra garantir que payloads
    // nao serializaveis quebram cedo (objects com Date etc.).
    let serialized: string;
    try {
      serialized = JSON.stringify(report);
    } catch {
      return;
    }
    setTimeout(() => {
      let parsed: WhisperReport;
      try {
        parsed = JSON.parse(serialized) as WhisperReport;
      } catch {
        return;
      }
      for (const l of listeners) {
        try {
          l(parsed);
        } catch {
          // listener errors nao podem matar o transport
        }
      }
    }, 0);
  }

  return {
    join: async (rotaId) => {
      channelsJoined.add(rotaId);
      // Re-emite cache pra novos subscribers verem o historico recente.
      const cached = cacheByChannel.get(rotaId);
      if (!cached || cached.length === 0) return;
      const cutoff = now() - 6 * 60 * 60 * 1000; // TTL 6h
      for (const r of cached) {
        if (r.createdAt < cutoff) continue;
        emitToAll(r);
      }
    },
    leave: async (rotaId) => {
      channelsJoined.delete(rotaId);
      // Nao limpa o cache: outro listener pode reentrar e querer o
      // historico ainda fresco.
    },
    publish: async (report) => {
      // Push pro cache local desse canal
      const cached = cacheByChannel.get(report.rotaId) ?? [];
      const next = [report, ...cached.filter((r) => r.id !== report.id)];
      cacheByChannel.set(report.rotaId, next);
      // Broadcast pros listeners locais (em-process). Em rede real, o
      // PeerJS DataChannel cuidaria do envio aos peers remotos.
      emitToAll(report);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
  };
}

/** Singleton do loopback usado pelo whisperStore enquanto o transport
 *  PeerJS real nao chega. */
let _singleton: WhisperTransport | null = null;

export function getWhisperTransport(): WhisperTransport {
  if (_singleton) return _singleton;
  _singleton = createLoopbackWhisperTransport();
  return _singleton;
}

export function _resetWhisperTransportForTests(): void {
  _singleton = null;
}
