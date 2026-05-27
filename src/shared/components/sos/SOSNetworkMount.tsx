import { useEffect } from 'react';
import { useNavigationStore } from '@/state/navigationStore';
import { useSOSNetworkStore } from '@/state/sosNetworkStore';
import { useIncomingSOSStore } from '@/state/incomingSOSStore';

/**
 * Headless mount (sem render) que mantem a camada de rede de SOS viva
 * pelo tempo de vida do app (F29.2). Roda no root da arvore, ao lado do
 * VoiceSessionMount, pra que o canal de SOS funcione independente da
 * tela em que o piloto esteja.
 *
 * Responsabilidades:
 *   - Recalcular o geohash room conforme a posicao do piloto muda.
 *     Atualizar a cada movimento e disperdicio; usamos um throttle de
 *     30s pra evitar trashing de troca de canal se o piloto cruzar
 *     limite de celula varias vezes (sinal GPS jitter).
 *   - Limpar alertas recebidos expirados (TTL 5min) periodicamente, pra
 *     que um alerta antigo nao continue plotado no mapa apos ja ter sido
 *     resolvido por outro piloto que chegou primeiro.
 *
 * O broadcast em si (quando o piloto local dispara SOS) e iniciado pelo
 * SOSScreen via `sosNetworkStore.broadcastAlert()` — esse componente nao
 * intercepta o sosStore diretamente pra manter o fluxo explicito e
 * facil de auditar.
 */

const ROOM_REFRESH_THROTTLE_MS = 30_000;
const PRUNE_INTERVAL_MS = 30_000;

export const SOSNetworkMount: React.FC = () => {
  useEffect(() => {
    let lastRoomRefresh = 0;
    const unsubPos = useNavigationStore.subscribe((state, prev) => {
      if (state.currentPosition === prev.currentPosition) return;
      const now = Date.now();
      if (now - lastRoomRefresh < ROOM_REFRESH_THROTTLE_MS) return;
      lastRoomRefresh = now;
      useSOSNetworkStore.getState().refreshRoom();
    });
    // Primeira tentativa de room — caso ja exista posicao quando o mount
    // sobe (cold start com GPS cached).
    useSOSNetworkStore.getState().refreshRoom();
    return unsubPos;
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      useIncomingSOSStore.getState().pruneExpired();
    }, PRUNE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return null;
};
