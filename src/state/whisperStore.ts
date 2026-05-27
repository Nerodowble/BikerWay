import { create } from 'zustand';
import {
  findDuplicate,
  mergeReport,
  pruneExpired,
} from '@/domains/whisper/rules';
import type { WhisperKind, WhisperReport } from '@/domains/whisper/types';
import { WHISPER_ALIAS_MAX_LEN } from '@/domains/whisper/types';
import { getWhisperTransport } from '@/infrastructure/whisper/transport';

/**
 * F35.9 — Estado dos avisos Whisper por rota. Mantem `reportsByRota`
 * (Record<rotaId, WhisperReport[]>) populado a partir do transport.
 * Apenas avisos cuja rota corresponde a uma das `joinedRotaIds` sao
 * persistidos no Map — quando piloto sai do canal, drop.
 *
 * Anti-abuso e dedup ficam no `domains/whisper/rules.ts` (puros). Store
 * orquestra: cooldown por rota_id, validacao na hora do publish, dedup
 * no merge.
 */

export interface WhisperStoreState {
  joinedRotaIds: ReadonlySet<string>;
  reportsByRota: Record<string, WhisperReport[]>;
  /** Apelido livre pra associar aos reports do proprio piloto. Default
   *  "@piloto" se nada informado. */
  alias: string;
  setAlias: (alias: string) => void;
  /** Entra no canal da rota. Inscreve no transport, mantem reports em
   *  state. Idempotente. */
  joinRoute: (rotaId: string) => Promise<void>;
  /** Sai do canal — limpa reports daquela rota da memoria. */
  leaveRoute: (rotaId: string) => Promise<void>;
  /** Tenta publicar um report. Retorna `{ok:true}` ou `{ok:false,reason}`.
   *  Reason possiveis: 'duplicate', 'transport_error'. Sem cooldown global
   *  por tempo — o anti-spam vira so o dedup (mesmo kind + ate 1km + 30min).
   *  Cenario real: piloto pode reportar neblina agora + buraco 1km depois
   *  sem bloqueio. */
  publish: (input: {
    rotaId: string;
    kind: WhisperKind;
    latitude: number;
    longitude: number;
    routeKm?: number;
  }) => Promise<{ ok: true; report: WhisperReport } | { ok: false; reason: string }>;
  /** Limpa expirados em todas as rotas. UI pode chamar em interval. */
  prune: () => void;
}

function genReportId(rotaId: string): string {
  return `${rotaId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

let unsubscribeTransport: (() => void) | null = null;

function ensureTransportSubscription(): void {
  if (unsubscribeTransport !== null) return;
  const transport = getWhisperTransport();
  unsubscribeTransport = transport.subscribe((incoming) => {
    useWhisperStore.setState((prev) => {
      if (!prev.joinedRotaIds.has(incoming.rotaId)) return prev;
      const existing = prev.reportsByRota[incoming.rotaId] ?? [];
      const next = mergeReport(existing, incoming);
      if (next === existing) return prev;
      return {
        reportsByRota: {
          ...prev.reportsByRota,
          [incoming.rotaId]: next,
        },
      };
    });
  });
}

export const useWhisperStore = create<WhisperStoreState>((set, get) => ({
  joinedRotaIds: new Set<string>(),
  reportsByRota: {},
  alias: '@piloto',

  setAlias: (alias) => {
    const trimmed = alias.trim().slice(0, WHISPER_ALIAS_MAX_LEN);
    set({ alias: trimmed.length === 0 ? '@piloto' : trimmed });
  },

  joinRoute: async (rotaId) => {
    ensureTransportSubscription();
    const state = get();
    if (state.joinedRotaIds.has(rotaId)) return;
    const nextSet = new Set(state.joinedRotaIds);
    nextSet.add(rotaId);
    set({ joinedRotaIds: nextSet });
    try {
      await getWhisperTransport().join(rotaId);
    } catch {
      // best-effort — transport falhou, ainda assim mantem o slot ativo
      // pra o UI poder mostrar mensagem de erro depois
    }
  },

  leaveRoute: async (rotaId) => {
    const state = get();
    if (!state.joinedRotaIds.has(rotaId)) return;
    const nextSet = new Set(state.joinedRotaIds);
    nextSet.delete(rotaId);
    const nextReports = { ...state.reportsByRota };
    delete nextReports[rotaId];
    set({ joinedRotaIds: nextSet, reportsByRota: nextReports });
    try {
      await getWhisperTransport().leave(rotaId);
    } catch {
      // best-effort
    }
  },

  publish: async ({ rotaId, kind, latitude, longitude, routeKm }) => {
    const state = get();
    const now = Date.now();
    // Anti-spam: SO dedup (mesmo kind + raio 1km + 30min). Sem cooldown
    // global — outro kind ou local diferente passa livre.
    const existing = state.reportsByRota[rotaId] ?? [];
    const dup = findDuplicate(existing, {
      kind,
      latitude,
      longitude,
      createdAt: now,
    });
    if (dup !== null) {
      return { ok: false, reason: 'duplicate' };
    }
    const report: WhisperReport = {
      id: genReportId(rotaId),
      rotaId,
      kind,
      latitude,
      longitude,
      createdAt: now,
      reporterAlias: state.alias,
      ...(routeKm !== undefined ? { routeKm } : {}),
    };
    try {
      await getWhisperTransport().publish(report);
    } catch {
      return { ok: false, reason: 'transport_error' };
    }
    // Atualiza state local imediato — nao espera o broadcast voltar.
    set((prev) => ({
      reportsByRota: {
        ...prev.reportsByRota,
        [rotaId]: mergeReport(prev.reportsByRota[rotaId] ?? [], report, now),
      },
    }));
    return { ok: true, report };
  },

  prune: () => {
    const now = Date.now();
    set((prev) => {
      const next: Record<string, WhisperReport[]> = {};
      let changed = false;
      for (const [rotaId, list] of Object.entries(prev.reportsByRota)) {
        const pruned = pruneExpired(list, now);
        next[rotaId] = pruned;
        if (pruned.length !== list.length) changed = true;
      }
      return changed ? { reportsByRota: next } : prev;
    });
  },
}));

/** Referencia estavel pra lista vazia. Sem isso, `state.reportsByRota[rotaId] ?? []`
 *  cria um novo array a cada render → Zustand vê referencia diferente →
 *  componente re-renderiza → loop infinito. */
const EMPTY_REPORTS: ReadonlyArray<WhisperReport> = [];

/** Selector helper: reports pra uma rota especifica, com referencia
 *  estavel mesmo quando a rota nao tem entry no Map. */
export function selectReportsForRota(
  state: WhisperStoreState,
  rotaId: string,
): ReadonlyArray<WhisperReport> {
  return state.reportsByRota[rotaId] ?? EMPTY_REPORTS;
}

