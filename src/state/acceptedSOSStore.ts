import { create } from 'zustand';
import type { IncomingSOSAlert } from './incomingSOSStore';

/**
 * F29.3 — Pílula de alerta no mapa.
 *
 * Quando o piloto aceita um SOS recebido ("SIM, ESTOU A CAMINHO"), o
 * `IncomingSOSMount` grava o alerta aqui ALEM de setar destination no
 * navigationStore. O HomeScreen le este store e passa pro
 * BikerMapView, que substitui o `DestinationMarker` regular por um
 * `SOSAlertMarker` (pilula vermelha "SOS") nas coordenadas do alerta.
 *
 * Por que um store separado em vez de campos no navigationStore:
 *   - O navigationStore ja e grande (~600 linhas) e mistura GPS, rota,
 *     waypoints, viagem, sample. Colocar metadado de marker visual la
 *     dentro acopla camadas. Aqui o escopo e pequeno e isolado.
 *   - Permite que o pin desapareca naturalmente quando o piloto chegar
 *     ou cancelar a rota — basta limpar este store, sem reescrever a
 *     contrato do destination.
 *
 * O store NAO se auto-limpa em mudancas do destination — quem aceita
 * outro SOS ou cancela a navegacao tem que chamar clear() explicitamente
 * (HomeScreen integra isso na limpeza de stopNavigation).
 */

interface AcceptedSOSStore {
  active: IncomingSOSAlert | null;
  accept: (alert: IncomingSOSAlert) => void;
  clear: () => void;
}

export const useAcceptedSOSStore = create<AcceptedSOSStore>((set) => ({
  active: null,
  accept: (alert) => set({ active: alert }),
  clear: () => set({ active: null }),
}));

export function selectActiveSOSDestination(
  state: AcceptedSOSStore,
): IncomingSOSAlert | null {
  return state.active;
}
