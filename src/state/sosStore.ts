import { create } from 'zustand';
import type {
  SOSAlert,
  SOSProblemType,
  SOSStatus,
} from '@/domains/sos/types';
import { evaluateAbuseStatus, type AbuseStatus } from '@/domains/sos/abuse';
import { initDatabase } from '@/infrastructure/db/sqlite';
import {
  createSqliteSosAbuseRepository,
  type SosAbuseRepository,
} from '@/infrastructure/db/sosAbuseRepository';

/**
 * F29 SOS store. Mantem o alerta atual do piloto (so um por vez —
 * disparar com um aberto sobrescreve) e o historico recente em memoria.
 *
 * F29.4: o store passa a manter `recentCancels` (timestamps dos
 * cancelamentos nos ultimos 7 dias, hidratados do SQLite) pra alimentar
 * o anti-abuso. `selectAbuseStatus()` computa o estado de trava na hora,
 * sem cache derivado — a janela rolling de 7d torna qualquer cache mais
 * proximo de bug do que de otimizacao.
 *
 * A camada de rede (PeerJS broadcast em F29.2) assina `current` pra
 * disparar broadcast quando ele transicionar de null pra preenchido, e
 * ouve `cancel()` pra propagar o cancelamento.
 */

interface SOSStore {
  current: SOSAlert | null;
  history: SOSAlert[];
  /**
   * Timestamps (epoch ms) dos cancelamentos persistidos, em ordem
   * decrescente. Lista em memoria hidratada do SQLite no bootstrap.
   * Atualizada a cada `cancel()` (push prepend) mas nao persiste
   * automaticamente — `cancel()` agenda o write no repo.
   */
  recentCancels: number[];
  fire: (input: {
    problemType: SOSProblemType;
    latitude: number;
    longitude: number;
    message?: string;
  }) => { alert: SOSAlert | null; abuseBlocked: boolean };
  cancel: () => void;
  markResolved: () => void;
  /** Recarrega `recentCancels` do SQLite. Chamado no bootstrap. */
  hydrateAbuseHistory: () => Promise<void>;
}

let repo: SosAbuseRepository | null = null;

async function getRepo(): Promise<SosAbuseRepository> {
  if (repo) return repo;
  const db = await initDatabase();
  repo = createSqliteSosAbuseRepository(db);
  return repo;
}

/** Hook de testes: zera o repo em cache pra forcar re-init com mock. */
export function _resetSosAbuseRepoForTests(): void {
  repo = null;
}

function genId(): string {
  // UUID v4 leve sem dependencia. Suficiente pro escopo local: o id so
  // precisa ser unico dentro da janela de SOS aberto.
  return 'sos-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function transitionTo(
  store: SOSStore,
  status: SOSStatus,
): Partial<SOSStore> {
  if (store.current === null) return {};
  const closed: SOSAlert = { ...store.current, status };
  return {
    current: null,
    history: [closed, ...store.history].slice(0, 50),
  };
}

export const useSOSStore = create<SOSStore>((set, get) => ({
  current: null,
  history: [],
  recentCancels: [],

  fire: ({ problemType, latitude, longitude, message }) => {
    // F29.4: respeita a trava antes de criar o alerta. A UI ja deveria
    // ter desabilitado o slider via selectAbuseStatus, mas defendemos no
    // store contra atalhos (deep link, teste, etc).
    const status = evaluateAbuseStatus(get().recentCancels, Date.now());
    if (status.locked) {
      return { alert: null, abuseBlocked: true };
    }
    const alert: SOSAlert = {
      id: genId(),
      problem_type: problemType,
      latitude,
      longitude,
      created_at: Date.now(),
      status: 'open',
      ...(message !== undefined && message.trim().length > 0
        ? { message: message.trim() }
        : {}),
    };
    set({ current: alert });
    return { alert, abuseBlocked: false };
  },

  cancel: () => {
    if (get().current === null) return;
    const cancelledAt = Date.now();
    set({
      ...transitionTo(get(), 'cancelled'),
      recentCancels: [cancelledAt, ...get().recentCancels],
    });
    // Persiste fora do reducer pra nao bloquear o set sincrono. Best-effort:
    // se SQLite falhar, a trava local em memoria continua funcional ate o
    // proximo cold-start (quando vai re-hidratar do disco).
    void (async () => {
      try {
        const r = await getRepo();
        await r.recordCancel(cancelledAt);
      } catch {
        // Sem log pra nao poluir console. Falha so significa que a trava
        // nao sobrevive reinstalacao — known limitation.
      }
    })();
  },

  markResolved: () => {
    set(transitionTo(get(), 'resolved'));
    // Resolved NAO conta como abuso (foi ajuda real). Nao registra no
    // historico de cancels.
  },

  hydrateAbuseHistory: async () => {
    try {
      const r = await getRepo();
      const cancels = await r.getRecentCancels();
      set({ recentCancels: cancels });
    } catch {
      // Best-effort: deixa recentCancels em [] e a UI assume sem
      // historico ate a proxima tentativa.
    }
  },
}));

export function selectCurrentSOS(state: SOSStore): SOSAlert | null {
  return state.current;
}

export function selectSOSHistory(state: SOSStore): SOSAlert[] {
  return state.history;
}

/**
 * Computa o status de abuso a partir do `recentCancels` em cache. A UI
 * pode chamar isso a cada render — a janela rolling de 7 dias e
 * automaticamente respeitada pq evaluateAbuseStatus filtra por idade.
 */
export function selectAbuseStatus(
  state: SOSStore,
  now: number = Date.now(),
): AbuseStatus {
  return evaluateAbuseStatus(state.recentCancels, now);
}
