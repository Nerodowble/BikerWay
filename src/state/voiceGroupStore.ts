import { create } from 'zustand';
import {
  buildComboioToken,
  isValidComboioCode,
} from '@/domains/voice/token';
import type {
  ComboioToken,
  VoiceConnectionStatus,
  VoiceParticipant,
} from '@/domains/voice/types';

/**
 * Phone (earpiece/Bluetooth helmet) vs. speaker (loud "viva-voz") output
 * preference. We only TRACK this in state today — actually flipping audio
 * routing requires native modules we don't ship yet (see ComboioScreen).
 */
export type VoiceAudioOutput = 'phone' | 'speaker';

/**
 * Latest GPS position broadcasted by one comboio member over the PeerJS
 * DataChannel mesh. The `timestamp` is used by `purgeStalePeerPositions` to
 * drop entries from peers whose device went to sleep or lost GPS — without
 * that prune the map would keep stale pins forever.
 */
export interface ComboioPeerPosition {
  id: string;          // peer id (matches `VoiceParticipant.id`)
  displayName?: string;
  latitude: number;
  longitude: number;
  heading?: number | null;
  speed?: number | null;
  timestamp: number;   // epoch ms — used by purge to drop stale entries
}

export interface VoiceGroupStoreState {
  token: ComboioToken | null;
  displayName: string;
  status: VoiceConnectionStatus;
  isLocalMuted: boolean;
  audioOutput: VoiceAudioOutput;
  participants: VoiceParticipant[];
  dominantSpeakerId: string | null;
  lastError: string | null;
  /**
   * Latest GPS positions broadcasted by other comboio members. Keyed by
   * peer id. Old entries are pruned by `purgeStalePeerPositions(maxAgeMs)`.
   */
  peerPositions: Record<string, ComboioPeerPosition>;
  /**
   * F30: toggle local — quando true, suprime a renderizacao dos pins dos
   * peers no MEU mapa. NAO afeta o broadcast (outros peers continuam me
   * vendo) nem o processamento de peerPositions no store. Reseta pra
   * false em `leaveComboio` pra o proximo comboio comecar limpo.
   */
  peerPinsHidden: boolean;
  /**
   * F30: toggle local — quando true, muta o AUDIO RECEBIDO de todos os
   * peers. O VoiceSessionMount propaga pra WebView que seta
   * `audio.muted = true` em cada `<audio>` remoto. Diferente de
   * `isLocalMuted` (que silencia MEU mic — afeta o que os outros ouvem).
   * Reseta em `leaveComboio`.
   */
  incomingAudioMuted: boolean;
  /**
   * F34.2 — Marca que o usuario LOCAL e o criador desse comboio (admin).
   * Define quem ve as opcoes de "definir sucessor" + ganha coroa visual.
   * Em V1, e local-only (nao propaga via wire). Reset em `leaveComboio`.
   *
   * Limitacao consciente: outros peers veem o admin local como peer
   * comum ate F34.2.1 implementar `admin.designate`/`admin.handoff` wire.
   */
  isLocalAdmin: boolean;
  /**
   * F34.2 — Peer id escolhido pelo admin como SUCESSOR (recebe coroa
   * quando o admin atual sair, antes da cascata FIFO). Local-only em V1.
   */
  successorPeerId: string | null;

  // Lifecycle — the JitsiWebView is mounted in the screen tree and feeds
  // events back into these reducers via the screen. The store deliberately
  // does NOT hold a ref to the WebView itself.
  createComboio: (displayName: string) => ComboioToken;
  joinComboio: (code: string, displayName: string) => ComboioToken | null;
  leaveComboio: () => void;
  setStatus: (s: VoiceConnectionStatus) => void;
  setLocalMuted: (muted: boolean) => void;
  setAudioOutput: (o: VoiceAudioOutput) => void;
  upsertParticipant: (p: VoiceParticipant) => void;
  removeParticipant: (id: string) => void;
  setDominantSpeaker: (id: string | null) => void;
  setError: (msg: string | null) => void;
  updatePeerPosition: (entry: ComboioPeerPosition) => void;
  purgeStalePeerPositions: (maxAgeMs: number) => void;
  clearPeerPositions: () => void;
  setPeerPinsHidden: (hidden: boolean) => void;
  setIncomingAudioMuted: (muted: boolean) => void;
  /** F34.2 — Define peer id sucessor. null = cancela escolha. */
  setSuccessorPeerId: (id: string | null) => void;

  /**
   * Mark the session as silently reconnecting after a transient network drop.
   *
   * Why this is NOT a plain `setStatus('reconnecting')`:
   *   - Participants and peerPositions are deliberately preserved so the map
   *     and roster keep their last-known state during the outage. A user
   *     riding through a dead-zone should still see where their group was
   *     a few seconds ago instead of an empty mesh.
   *   - We never write to `lastError` here. The whole point of silent
   *     reconnect is that the rider sees no banner/modal/alert for a
   *     transient drop — just the badge turning yellow.
   */
  markReconnecting: () => void;
  /**
   * Mark the session as back online after a successful PeerJS reconnect.
   * Resets `lastError` only when it was set by a transient network reason
   * (we never owned that string from this flow, so a plain reset is fine).
   */
  markConnected: () => void;
}

const INITIAL_AUDIO_OUTPUT: VoiceAudioOutput = 'speaker';

interface InitialResetShape {
  token: ComboioToken | null;
  displayName: string;
  status: VoiceConnectionStatus;
  isLocalMuted: boolean;
  participants: VoiceParticipant[];
  dominantSpeakerId: string | null;
  lastError: string | null;
  peerPositions: Record<string, ComboioPeerPosition>;
  peerPinsHidden: boolean;
  incomingAudioMuted: boolean;
  isLocalAdmin: boolean;
  successorPeerId: string | null;
}

const RESET_FIELDS: InitialResetShape = {
  token: null,
  displayName: '',
  status: 'idle',
  isLocalMuted: false,
  participants: [],
  dominantSpeakerId: null,
  lastError: null,
  peerPositions: {},
  peerPinsHidden: false,
  incomingAudioMuted: false,
  isLocalAdmin: false,
  successorPeerId: null,
};

export const useVoiceGroupStore = create<VoiceGroupStoreState>((set, get) => ({
  token: null,
  displayName: '',
  status: 'idle',
  isLocalMuted: false,
  audioOutput: INITIAL_AUDIO_OUTPUT,
  participants: [],
  dominantSpeakerId: null,
  lastError: null,
  peerPositions: {},
  peerPinsHidden: false,
  incomingAudioMuted: false,
  isLocalAdmin: false,
  successorPeerId: null,

  createComboio: (displayName) => {
    const token = buildComboioToken();
    set({
      token,
      displayName,
      status: 'connecting',
      isLocalMuted: false,
      participants: [],
      dominantSpeakerId: null,
      lastError: null,
      peerPositions: {},
      peerPinsHidden: false,
      incomingAudioMuted: false,
      // F34.2 — Quem CRIA o comboio e o admin local.
      isLocalAdmin: true,
      successorPeerId: null,
    });
    return token;
  },

  joinComboio: (code, displayName) => {
    if (!isValidComboioCode(code)) {
      set({ lastError: 'Código inválido. Use 4 caracteres (A-Z, 2-9).' });
      return null;
    }
    const token = buildComboioToken(code);
    set({
      token,
      displayName,
      status: 'connecting',
      isLocalMuted: false,
      participants: [],
      dominantSpeakerId: null,
      lastError: null,
      peerPositions: {},
      peerPinsHidden: false,
      incomingAudioMuted: false,
      // F34.2 — Quem ENTRA em comboio existente NAO e admin.
      isLocalAdmin: false,
      successorPeerId: null,
    });
    return token;
  },

  leaveComboio: () => {
    // Preserve the user's audioOutput preference across sessions; everything
    // else returns to its initial value.
    const audioOutput = get().audioOutput;
    set({ ...RESET_FIELDS, audioOutput });
  },

  setStatus: (s) => set({ status: s }),
  setLocalMuted: (muted) => set({ isLocalMuted: muted }),
  setAudioOutput: (o) => set({ audioOutput: o }),
  setPeerPinsHidden: (hidden) => set({ peerPinsHidden: hidden }),
  setIncomingAudioMuted: (muted) => set({ incomingAudioMuted: muted }),
  setSuccessorPeerId: (id) => {
    // Idempotente: toggle off se for o mesmo id ja escolhido. Mantem o
    // setter robusto pra UI que liga/desliga sem precisar saber o estado.
    const current = get().successorPeerId;
    if (current === id) return;
    set({ successorPeerId: id });
  },

  upsertParticipant: (p) => {
    const list = get().participants;
    const idx = list.findIndex((existing) => existing.id === p.id);
    if (idx === -1) {
      set({ participants: [...list, p] });
      return;
    }
    const existing = list[idx];
    if (!existing) {
      // Defensive: findIndex returned >= 0 so this can't actually happen,
      // but noUncheckedIndexedAccess widens the lookup to `T | undefined`.
      set({ participants: [...list, p] });
      return;
    }
    const next = list.slice();
    next[idx] = { ...existing, ...p };
    set({ participants: next });
  },

  removeParticipant: (id) => {
    const next = get().participants.filter((p) => p.id !== id);
    const dominant =
      get().dominantSpeakerId === id ? null : get().dominantSpeakerId;
    // Drop the matching peer position so the map pin disappears in sync with
    // the participant row. We rebuild the object rather than mutate it so
    // Zustand sees a new reference and re-renders subscribers.
    const positions = get().peerPositions;
    let nextPositions = positions;
    if (Object.prototype.hasOwnProperty.call(positions, id)) {
      const copy = { ...positions };
      delete copy[id];
      nextPositions = copy;
    }
    // F34.2 — Se o sucessor sair do comboio, limpa a escolha pro admin
    // ter que escolher de novo.
    const successor = get().successorPeerId;
    const nextSuccessor = successor === id ? null : successor;
    set({
      participants: next,
      dominantSpeakerId: dominant,
      peerPositions: nextPositions,
      successorPeerId: nextSuccessor,
    });
  },

  setDominantSpeaker: (id) => set({ dominantSpeakerId: id }),
  setError: (msg) => set({ lastError: msg }),

  updatePeerPosition: (entry) => {
    // Upsert by id, but reject older-than-current timestamps so an out-of-order
    // delivery from PeerJS cannot rewind a fresher fix backwards in time.
    const positions = get().peerPositions;
    const existing = positions[entry.id];
    if (existing && existing.timestamp >= entry.timestamp) {
      return;
    }
    set({ peerPositions: { ...positions, [entry.id]: entry } });
  },

  purgeStalePeerPositions: (maxAgeMs) => {
    const cutoff = Date.now() - maxAgeMs;
    const positions = get().peerPositions;
    const ids = Object.keys(positions);
    if (ids.length === 0) return;
    const next: Record<string, ComboioPeerPosition> = {};
    let mutated = false;
    for (const id of ids) {
      const entry = positions[id];
      if (!entry) continue;
      if (entry.timestamp >= cutoff) {
        next[id] = entry;
      } else {
        mutated = true;
      }
    }
    if (mutated) {
      set({ peerPositions: next });
    }
  },

  clearPeerPositions: () => {
    if (Object.keys(get().peerPositions).length === 0) return;
    set({ peerPositions: {} });
  },

  markReconnecting: () => {
    // Idempotent: avoid an extra render if we already announced the drop.
    // We do NOT touch `participants` or `peerPositions` here — the map and
    // roster need to keep showing the last-known mesh so the rider does
    // not lose visual context during a 2-5s dead-zone.
    const prev = get().status;
    if (prev === 'reconnecting') return;
    set({ status: 'reconnecting' });
  },

  markConnected: () => {
    // Skip a redundant set when we are already connected (the WebView pings
    // 'voice-status: connected' periodically as a heartbeat in some paths).
    const prev = get().status;
    if (prev === 'connected') return;
    // Clear lastError only if there is one — keeps the store reference
    // stable for subscribers that only care about real changes.
    const patch: Partial<VoiceGroupStoreState> =
      get().lastError === null
        ? { status: 'connected' }
        : { status: 'connected', lastError: null };
    set(patch);
  },
}));
