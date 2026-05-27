import type { SOSProblemType } from './types';

/**
 * Wire format do canal de SOS Comunitario (F29.2). Mensagens trafegam por
 * PeerJS DataChannel no formato JSON; o transport pode ser PeerJS broker,
 * Supabase Realtime, MQTT etc — esta interface mantem o domain agnostico.
 *
 * Versionamento via `protocol_version`: incrementar quando adicionar campo
 * obrigatorio. Mensagens com versao maior que o cliente suporta sao
 * silenciosamente descartadas (forward-compat seguro).
 */

export const SOS_PROTOCOL_VERSION = 1 as const;

export type SOSWireMessage = SOSAlertWireMessage | SOSCancelWireMessage;

/**
 * Disparo de um pedido de SOS. Inclui identidade (nome/moto) e contexto
 * (problema, mensagem livre, coordenadas). Receptores filtram por
 * distancia haversine antes de exibir.
 */
export interface SOSAlertWireMessage {
  type: 'sos.alert';
  protocol_version: typeof SOS_PROTOCOL_VERSION;
  /** UUID do alerta — usado para correlacionar com o cancel posterior. */
  alert_id: string;
  /** Nome do piloto. Vem do riderStore.profile.displayName. */
  rider_name: string;
  /** Moto display (ex: "Honda PCX 2020"). Opcional. */
  rider_moto?: string;
  problem_type: SOSProblemType;
  message?: string;
  latitude: number;
  longitude: number;
  /** epoch ms na origem (server-trust-less, so pra UX ordering). */
  created_at: number;
}

/**
 * Cancela um SOS previamente disparado pelo MESMO piloto. Receptores
 * removem o pin/modal correspondente ao alert_id.
 */
export interface SOSCancelWireMessage {
  type: 'sos.cancel';
  protocol_version: typeof SOS_PROTOCOL_VERSION;
  alert_id: string;
}

/**
 * Type guard pro parse seguro de mensagens recebidas. Descarta payloads
 * malformados — receptor nao deve crashar por causa de um peer hostil
 * mandando lixo.
 */
export function parseWireMessage(raw: unknown): SOSWireMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.protocol_version !== SOS_PROTOCOL_VERSION) return null;

  if (obj.type === 'sos.alert') {
    if (
      typeof obj.alert_id !== 'string' ||
      typeof obj.rider_name !== 'string' ||
      typeof obj.problem_type !== 'string' ||
      typeof obj.latitude !== 'number' ||
      typeof obj.longitude !== 'number' ||
      typeof obj.created_at !== 'number'
    ) {
      return null;
    }
    return {
      type: 'sos.alert',
      protocol_version: SOS_PROTOCOL_VERSION,
      alert_id: obj.alert_id,
      rider_name: obj.rider_name,
      problem_type: obj.problem_type as SOSProblemType,
      latitude: obj.latitude,
      longitude: obj.longitude,
      created_at: obj.created_at,
      ...(typeof obj.rider_moto === 'string' && obj.rider_moto.length > 0
        ? { rider_moto: obj.rider_moto }
        : {}),
      ...(typeof obj.message === 'string' && obj.message.length > 0
        ? { message: obj.message }
        : {}),
    };
  }

  if (obj.type === 'sos.cancel') {
    if (typeof obj.alert_id !== 'string') return null;
    return {
      type: 'sos.cancel',
      protocol_version: SOS_PROTOCOL_VERSION,
      alert_id: obj.alert_id,
    };
  }

  return null;
}
