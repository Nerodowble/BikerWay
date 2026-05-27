import React, { useCallback, useEffect } from 'react';
import {
  selectFirstActive,
  useIncomingSOSStore,
  type IncomingSOSAlert,
} from '@/state/incomingSOSStore';
import { useNavigationStore } from '@/state/navigationStore';
import { useAcceptedSOSStore } from '@/state/acceptedSOSStore';
import { IncomingSOSAlertModal } from './IncomingSOSAlertModal';

/**
 * F29.3 — Mount no App root que escuta `incomingSOSStore` e mostra o
 * modal de alerta sempre que houver SOS ativo.
 *
 * O modal aparece OVER qualquer tela (Home, Catalog, Comboio, etc) — o
 * piloto recebe o aviso onde quer que esteja. Multiplos alertas sao
 * tratados em FIFO: o mais antigo aparece primeiro; ao
 * aceitar/recusar, o proximo da fila sobe automaticamente porque o
 * selector le sempre o primeiro do array.
 *
 * Fluxo de aceite:
 *   1. setDestination com as coords do SOS
 *   2. dismissAlert do incomingSOSStore (sai da fila)
 *   3. Piloto e levado a HomeScreen pelo flow normal — em F29.3 nao
 *      forcamos navegacao; ele ve o destino setado e toca INICIAR ROTA
 *      manualmente. Em iteracao futura podemos automatizar.
 */
export const IncomingSOSMount: React.FC = () => {
  const activeAlert = useIncomingSOSStore(selectFirstActive);

  // Quando o piloto cancelar a navegacao ou setar um destino novo
  // (catalogo, busca livre), o marker SOS no mapa deve desaparecer
  // junto. Subscribe direto no destination — se foi pra null OU mudou
  // pra coords diferentes do SOS aceito, limpamos.
  useEffect(() => {
    const unsub = useNavigationStore.subscribe((state, prev) => {
      if (state.destination === prev.destination) return;
      const sos = useAcceptedSOSStore.getState().active;
      if (sos === null) return;
      if (state.destination === null) {
        useAcceptedSOSStore.getState().clear();
        return;
      }
      // Destination mudou pra outras coords (piloto setou destino novo
      // sem cancelar primeiro). Tambem limpa o pin SOS — o destino atual
      // ja nao e mais a emergencia.
      const matchesSOS =
        Math.abs(state.destination.latitude - sos.latitude) < 1e-6 &&
        Math.abs(state.destination.longitude - sos.longitude) < 1e-6;
      if (!matchesSOS) {
        useAcceptedSOSStore.getState().clear();
      }
    });
    return unsub;
  }, []);

  const handleAccept = useCallback((alert: IncomingSOSAlert) => {
    // GeoPosition para um destino estatico: omitimos accuracy/speed/heading
    // (que nao se aplicam a um ponto fixo, so a leitura GPS do piloto) e
    // timestamp e Date.now() pq o ponto e capturado nesse instante.
    useNavigationStore.getState().setDestination({
      latitude: alert.latitude,
      longitude: alert.longitude,
      timestamp: Date.now(),
    });
    // Tambem marca como "SOS aceito" pra o HomeScreen substituir o pin
    // regular pela pilula SOS vermelha (F29.3).
    useAcceptedSOSStore.getState().accept(alert);
    useIncomingSOSStore.getState().dismissAlert(alert.alert_id);
  }, []);

  const handleDecline = useCallback((alert: IncomingSOSAlert) => {
    useIncomingSOSStore.getState().dismissAlert(alert.alert_id);
  }, []);

  return (
    <IncomingSOSAlertModal
      alert={activeAlert}
      onAccept={handleAccept}
      onDecline={handleDecline}
    />
  );
};
