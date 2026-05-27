import * as SQLite from 'expo-sqlite';
import { initDatabase } from './sqlite';
import type {
  RouteHistoryAction,
  RouteHistoryEvent,
  TripHistoryEntry,
} from '@/domains/rideHistory/types';

/**
 * F35.1 — Persistencia das tabelas `route_history` + `trip_history`.
 *
 * Padrao seguido do `sosAbuseRepository`: factory recebe o db, exporta um
 * objeto de acoes typed. Sem singleton — os consumidores (RouteDetail,
 * navigation handler) abrem o db via `openDatabase()` e instanciam o repo
 * quando precisam.
 *
 * Nao ha auto-cleanup aqui: ao contrario do sos_cancel (anti-abuso 7d), o
 * historico de rotas e gamificacao de longo prazo — o piloto QUER ver
 * "completei a Serra da Mantiqueira em outubro de 2024". O crescimento e
 * lento (poucas viagens por mes) e local.
 */

export interface RideHistoryRepository {
  /** Registra uma interacao com a rota — usado pelo RouteDetail no mount.
   *  Cada chamada insere uma linha; o caller controla quando chama (sem
   *  debounce aqui pra manter o repo simples e testavel). */
  recordRouteOpen: (rotaId: string, now?: number) => Promise<void>;
  /** Marca o inicio de uma navegacao pela rota. Dois efeitos: insere em
   *  `route_history` (action='started') e em `trip_history` (com
   *  `started_at`, `completed_at` null). Retorna o id do trip — F35.2
   *  vai usar pra fazer UPDATE quando detectar a conclusao. */
  recordTripStarted: (rotaId: string, now?: number) => Promise<number>;
  /** Marca um trip como completado. F35.2 chama isso quando detectar
   *  >=80% da polyline coberta. Nao-op silencioso se o id nao existe. */
  recordTripCompleted: (
    tripId: number,
    completedAt: number,
    durationMinutes: number,
    distanceKm: number,
  ) => Promise<void>;
  /** Conta quantas vezes a rota foi aberta (qualquer action). Usado pelo
   *  ranker de novidade (F35.5). 0 = piloto nunca tocou. */
  getRouteOpenCount: (rotaId: string) => Promise<number>;
  /** Retorna o trip mais recente da rota que ainda nao foi completado.
   *  null se nao houver trip iniciado pendente. F35.2 chama pra achar o id
   *  a ser atualizado quando detecta conclusao. */
  getActiveTripForRoute: (rotaId: string) => Promise<TripHistoryEntry | null>;
  /** Retorna todos os trips ja iniciados (com ou sem completed_at).
   *  Ordenado por started_at DESC. Usado pelo Stamps + Feed. */
  listTrips: () => Promise<TripHistoryEntry[]>;
  /** Retorna os ultimos eventos de uma rota especifica. Util pra debug + pro
   *  ranker que quer "abri quando" alem de "quantas vezes". */
  listRouteEvents: (rotaId: string) => Promise<RouteHistoryEvent[]>;
  /** F35.2 rev — Persiste um indice novo coberto pelo tracker. Idempotente
   *  via PRIMARY KEY composto — chamar duas vezes pro mesmo (trip, index)
   *  e no-op. Best-effort: erros sao silenciados internamente pra nao
   *  travar samples de GPS. */
  recordCoveredIndex: (
    tripId: number,
    coveredIndex: number,
    now?: number,
  ) => Promise<void>;
  /** F35.2 rev — Carrega todos os indices ja cobertos pro trip dado. Usado
   *  pelo boot do tripCompletionStore pra rehidratar `coveredIndices`
   *  apos restart do app. */
  getCoveredIndicesForTrip: (tripId: number) => Promise<number[]>;
  /** F35.2 rev — Remove todos os indices cobertos de um trip. Chamado
   *  quando o trip e completado (cleanup) ou abandonado (>24h). */
  clearCoveredIndicesForTrip: (tripId: number) => Promise<void>;
  /** F35.2 rev — Pega o trip ativo mais recente em qualquer rota — usado
   *  pelo boot pra restaurar o tracker quando o app foi morto no meio.
   *  null se nao houver trip pendente. */
  getMostRecentActiveTrip: () => Promise<TripHistoryEntry | null>;
  /** F35.2 rev — Apaga trips iniciados ha mais de `maxAgeMs` sem completar.
   *  Limpa o trip_progress associado tambem. Roda no bootstrap pra impedir
   *  que trips abandonados fiquem ressuscitando ao abrir o app dias
   *  depois. Retorna numero de trips removidos. */
  cleanupAbandonedTrips: (maxAgeMs?: number, now?: number) => Promise<number>;
  /** Apaga todo o historico. Debug/reset — nao usado em fluxo normal. */
  clear: () => Promise<void>;
}

interface RouteEventRow {
  id: number;
  rota_id: string;
  action: string;
  occurred_at: number;
}

interface TripRow {
  id: number;
  rota_id: string;
  started_at: number;
  completed_at: number | null;
  duration_minutes: number | null;
  distance_km: number | null;
  notes: string | null;
}

interface CountRow {
  count: number;
}

function mapTripRow(row: TripRow): TripHistoryEntry {
  const entry: TripHistoryEntry = {
    id: row.id,
    rotaId: row.rota_id,
    startedAt: row.started_at,
  };
  if (row.completed_at !== null) entry.completedAt = row.completed_at;
  if (row.duration_minutes !== null) entry.durationMinutes = row.duration_minutes;
  if (row.distance_km !== null) entry.distanceKm = row.distance_km;
  if (row.notes !== null && row.notes.length > 0) entry.notes = row.notes;
  return entry;
}

function mapEventRow(row: RouteEventRow): RouteHistoryEvent {
  // Defensiva: se o `action` no DB for um valor fora do union (corrupcao
  // ou migracao manual), normaliza pra 'opened' que e o caso mais
  // generico. O alternativo seria filtrar — mas a chamada espera array
  // alinhado e o ranker so faz contagem, entao 'opened' nao gera falso
  // positivo de "completed".
  const action: RouteHistoryAction =
    row.action === 'started' ? 'started' : 'opened';
  return {
    id: row.id,
    rotaId: row.rota_id,
    action,
    occurredAt: row.occurred_at,
  };
}

export function createSqliteRideHistoryRepository(
  db: SQLite.SQLiteDatabase,
): RideHistoryRepository {
  return {
    recordRouteOpen: async (rotaId, now = Date.now()) => {
      await db.runAsync(
        'INSERT INTO route_history (rota_id, action, occurred_at) VALUES (?, ?, ?);',
        [rotaId, 'opened', now],
      );
    },

    recordTripStarted: async (rotaId, now = Date.now()) => {
      // F35.2 rev — Resume window: se existe trip pendente da mesma rota
      // iniciado ha menos de 24h, reusamos o id (sem novo INSERT no
      // trip_history) pra preservar os indices ja cobertos no
      // trip_progress. Apenas o evento de 'started' no route_history e
      // adicionado de novo. Cobre "piloto fechou o app no meio, abre 2h
      // depois e toca INICIAR NAVEGAÇÃO" — continua de onde parou.
      const RESUME_WINDOW_MS = 24 * 60 * 60 * 1000;
      const existing = await db.getFirstAsync<TripRow>(
        `SELECT * FROM trip_history
           WHERE rota_id = ? AND completed_at IS NULL
           ORDER BY started_at DESC LIMIT 1;`,
        [rotaId],
      );
      if (existing && now - existing.started_at < RESUME_WINDOW_MS) {
        await db.runAsync(
          'INSERT INTO route_history (rota_id, action, occurred_at) VALUES (?, ?, ?);',
          [rotaId, 'started', now],
        );
        return existing.id;
      }
      // Caso normal: cria trip novo em transacao.
      let tripId = 0;
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          'INSERT INTO route_history (rota_id, action, occurred_at) VALUES (?, ?, ?);',
          [rotaId, 'started', now],
        );
        const result = await db.runAsync(
          'INSERT INTO trip_history (rota_id, started_at) VALUES (?, ?);',
          [rotaId, now],
        );
        tripId = result.lastInsertRowId;
      });
      return tripId;
    },

    recordTripCompleted: async (
      tripId,
      completedAt,
      durationMinutes,
      distanceKm,
    ) => {
      await db.runAsync(
        `UPDATE trip_history
           SET completed_at = ?, duration_minutes = ?, distance_km = ?
           WHERE id = ?;`,
        [completedAt, durationMinutes, distanceKm, tripId],
      );
    },

    getRouteOpenCount: async (rotaId) => {
      const row = await db.getFirstAsync<CountRow>(
        'SELECT COUNT(*) as count FROM route_history WHERE rota_id = ?;',
        [rotaId],
      );
      return row?.count ?? 0;
    },

    getActiveTripForRoute: async (rotaId) => {
      const row = await db.getFirstAsync<TripRow>(
        `SELECT * FROM trip_history
           WHERE rota_id = ? AND completed_at IS NULL
           ORDER BY started_at DESC LIMIT 1;`,
        [rotaId],
      );
      return row ? mapTripRow(row) : null;
    },

    listTrips: async () => {
      const rows = await db.getAllAsync<TripRow>(
        'SELECT * FROM trip_history ORDER BY started_at DESC;',
      );
      return rows.map(mapTripRow);
    },

    listRouteEvents: async (rotaId) => {
      const rows = await db.getAllAsync<RouteEventRow>(
        'SELECT * FROM route_history WHERE rota_id = ? ORDER BY occurred_at DESC;',
        [rotaId],
      );
      return rows.map(mapEventRow);
    },

    recordCoveredIndex: async (tripId, coveredIndex, now = Date.now()) => {
      // INSERT OR IGNORE — PRIMARY KEY composto evita duplicatas. Sem
      // throw em conflito; o caller (tracker) chama em fire-and-forget.
      await db.runAsync(
        'INSERT OR IGNORE INTO trip_progress (trip_id, covered_index, recorded_at) VALUES (?, ?, ?);',
        [tripId, coveredIndex, now],
      );
    },

    getCoveredIndicesForTrip: async (tripId) => {
      const rows = await db.getAllAsync<{ covered_index: number }>(
        'SELECT covered_index FROM trip_progress WHERE trip_id = ? ORDER BY covered_index ASC;',
        [tripId],
      );
      return rows.map((r) => r.covered_index);
    },

    clearCoveredIndicesForTrip: async (tripId) => {
      await db.runAsync(
        'DELETE FROM trip_progress WHERE trip_id = ?;',
        [tripId],
      );
    },

    getMostRecentActiveTrip: async () => {
      const row = await db.getFirstAsync<TripRow>(
        `SELECT * FROM trip_history
           WHERE completed_at IS NULL
           ORDER BY started_at DESC LIMIT 1;`,
      );
      return row ? mapTripRow(row) : null;
    },

    cleanupAbandonedTrips: async (
      maxAgeMs = 24 * 60 * 60 * 1000,
      now = Date.now(),
    ) => {
      const cutoff = now - maxAgeMs;
      // Coletamos os ids antes do DELETE pra remover o progress associado.
      const abandoned = await db.getAllAsync<{ id: number }>(
        'SELECT id FROM trip_history WHERE completed_at IS NULL AND started_at < ?;',
        [cutoff],
      );
      if (abandoned.length === 0) return 0;
      await db.withTransactionAsync(async () => {
        for (const row of abandoned) {
          await db.runAsync(
            'DELETE FROM trip_progress WHERE trip_id = ?;',
            [row.id],
          );
          await db.runAsync(
            'DELETE FROM trip_history WHERE id = ?;',
            [row.id],
          );
        }
      });
      return abandoned.length;
    },

    clear: async () => {
      await db.runAsync('DELETE FROM trip_progress;');
      await db.runAsync('DELETE FROM trip_history;');
      await db.runAsync('DELETE FROM route_history;');
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton facade — consumers (RouteDetailScreen, navigation handlers) usam
// `getRideHistoryRepo()` pra disparar fire-and-forget sem ter que carregar o
// db sozinhos. Mesmo padrao do sosStore.
// ---------------------------------------------------------------------------

let _singleton: RideHistoryRepository | null = null;

export async function getRideHistoryRepo(): Promise<RideHistoryRepository> {
  if (_singleton) return _singleton;
  const db = await initDatabase();
  _singleton = createSqliteRideHistoryRepository(db);
  return _singleton;
}

/** Hook de testes pra zerar o singleton entre cenarios. */
export function _resetRideHistoryRepoForTests(): void {
  _singleton = null;
}

