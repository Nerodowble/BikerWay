import { create } from 'zustand';
import {
  PING_TTL_MS,
  pruneExpiredPings,
  type ComboioPing,
} from '@/domains/comboio/ping';

/**
 * F34.5 — Estado dos pings ativos no mapa. Cada peer (incluindo eu) tem
 * AT MOST 1 ping ativo. Novo ping substitui o antigo do mesmo peer.
 * Auto-cleanup via tick periodico OU on-demand via `prune()`.
 *
 * V1 nao escreve pra disco — pings sao volateis (TTL 45s). Tambem nao
 * propaga via PeerJS ainda; isso vira em F34.5.1.
 */

interface ComboioPingState {
  pings: ComboioPing[];
  /** Cria/substitui o ping de um peer. */
  setPing: (ping: ComboioPing) => void;
  /** Remove o ping de um peer especifico. */
  removePingFor: (peerId: string) => void;
  /** Remove TODOS os pings (ex: ao sair do comboio). */
  clear: () => void;
  /** Roda cleanup oportunistico (UI pode chamar em interval). */
  prune: () => void;
}

export const useComboioPingStore = create<ComboioPingState>((set, get) => ({
  pings: [],

  setPing: (ping) => {
    // Remove ping anterior do MESMO peer + prepend o novo.
    const filtered = get().pings.filter((p) => p.peerId !== ping.peerId);
    set({ pings: [ping, ...filtered] });
  },

  removePingFor: (peerId) => {
    const next = get().pings.filter((p) => p.peerId !== peerId);
    if (next.length === get().pings.length) return;
    set({ pings: next });
  },

  clear: () => {
    if (get().pings.length === 0) return;
    set({ pings: [] });
  },

  prune: () => {
    const next = pruneExpiredPings(get().pings);
    if (next.length === get().pings.length) return;
    set({ pings: next });
  },
}));

export { PING_TTL_MS };
