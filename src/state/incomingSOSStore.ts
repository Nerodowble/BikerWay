import { create } from 'zustand';
import { calculateHaversineDistance } from '@/domains/catalog/haversine';
import type { SOSProblemType } from '@/domains/sos/types';

/**
 * F29.2 — Store dos SOS recebidos pela rede.
 *
 * Recebe broadcasts do `sosNetworkStore` ja filtrados por geohash de
 * canal, e aplica filtro adicional de raio em km (default 15km — escolha
 * do user em F29). SOS muito antigos ou de muito longe sao descartados
 * silenciosamente.
 *
 * Em F29.3 a HomeScreen vai assinar `selectFirstActive()` pra mostrar o
 * modal de alerta. Ao recusar/aceitar o piloto remove o alerta via
 * `dismissAlert(alert_id)`.
 */

export const MAX_DISTANCE_KM = 15;
const ALERT_TTL_MS = 5 * 60 * 1000; // 5 minutos — depois disso o alerta expira

export interface IncomingSOSAlert {
  alert_id: string;
  rider_name: string;
  rider_moto?: string;
  problem_type: SOSProblemType;
  message?: string;
  latitude: number;
  longitude: number;
  /** km do receptor ate o alerta (no momento da recepcao). */
  distance_km: number;
  /** epoch ms quando o alerta foi originalmente disparado. */
  created_at: number;
  /** epoch ms na recepcao. Usado para TTL/expiracao. */
  received_at: number;
}

interface IncomingSOSStore {
  alerts: IncomingSOSAlert[];
  receive: (input: {
    alert_id: string;
    rider_name: string;
    rider_moto?: string;
    problem_type: SOSProblemType;
    message?: string;
    latitude: number;
    longitude: number;
    created_at: number;
    receiver_latitude: number;
    receiver_longitude: number;
  }) => 'accepted' | 'too_far' | 'duplicate';
  dismissAlert: (alertId: string) => void;
  pruneExpired: (now?: number) => void;
}

export const useIncomingSOSStore = create<IncomingSOSStore>((set, get) => ({
  alerts: [],

  receive: (input) => {
    const existing = get().alerts.find((a) => a.alert_id === input.alert_id);
    if (existing !== undefined) {
      // Mesmo alerta chegando duas vezes (peer retransmite, broker rebroadcasta).
      // Idempotente: ja temos, ignoramos.
      return 'duplicate';
    }
    const distance_km = calculateHaversineDistance(
      { latitude: input.receiver_latitude, longitude: input.receiver_longitude },
      { latitude: input.latitude, longitude: input.longitude },
    );
    if (distance_km > MAX_DISTANCE_KM) {
      // Mais longe que o raio escolhido. Descarta sem persistir — nao
      // queremos manter historico de SOS irrelevantes.
      return 'too_far';
    }
    const alert: IncomingSOSAlert = {
      alert_id: input.alert_id,
      rider_name: input.rider_name,
      problem_type: input.problem_type,
      latitude: input.latitude,
      longitude: input.longitude,
      distance_km,
      created_at: input.created_at,
      received_at: Date.now(),
      ...(input.rider_moto !== undefined && input.rider_moto.length > 0
        ? { rider_moto: input.rider_moto }
        : {}),
      ...(input.message !== undefined && input.message.length > 0
        ? { message: input.message }
        : {}),
    };
    set({ alerts: [alert, ...get().alerts].slice(0, 20) });
    return 'accepted';
  },

  dismissAlert: (alertId) => {
    set({ alerts: get().alerts.filter((a) => a.alert_id !== alertId) });
  },

  pruneExpired: (now = Date.now()) => {
    const fresh = get().alerts.filter((a) => now - a.received_at < ALERT_TTL_MS);
    if (fresh.length !== get().alerts.length) {
      set({ alerts: fresh });
    }
  },
}));

export function selectFirstActive(state: IncomingSOSStore): IncomingSOSAlert | null {
  return state.alerts[0] ?? null;
}

export function selectActiveCount(state: IncomingSOSStore): number {
  return state.alerts.length;
}
