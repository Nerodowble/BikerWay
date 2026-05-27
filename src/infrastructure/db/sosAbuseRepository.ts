import * as SQLite from 'expo-sqlite';

/**
 * F29.4 — Persistencia do historico de cancelamentos de SOS, usada pelo
 * anti-abuso local. Mantemos apenas o timestamp epoch ms de cada cancel
 * (sem ligacao com a tabela de motorcycles/riders) pra reduzir
 * superficie de bug e PII: nao precisamos saber QUAL alerta foi
 * cancelado, so QUANDO.
 *
 * Auto-cleanup: a cada `recordCancel`, removemos entradas mais antigas
 * que 14 dias (2x a janela de 7d). Isso evita crescimento ilimitado
 * sem precisar de cron job — a tabela vai ficar com dezenas de entradas
 * no pior caso, megas mesmo apos meses.
 */

export interface SosAbuseRepository {
  /** Insere um cancel no historico. Idempotente em re-tentativas porque cada
   *  chamada adiciona uma linha — o caller controla a chamada (sosStore so
   *  chama uma vez por cancel). */
  recordCancel: (now?: number) => Promise<void>;
  /** Retorna os timestamps de cancel nos ultimos `withinMs` ms (default
   *  7 dias). Em ordem decrescente (mais recente primeiro). */
  getRecentCancels: (withinMs?: number, now?: number) => Promise<number[]>;
  /** Apaga todos os cancels do historico (debug/reset). */
  clear: () => Promise<void>;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

interface CancelRow {
  cancelled_at: number;
}

export function createSqliteSosAbuseRepository(
  db: SQLite.SQLiteDatabase,
): SosAbuseRepository {
  return {
    recordCancel: async (now = Date.now()) => {
      await db.runAsync(
        'INSERT INTO sos_cancel_history (cancelled_at) VALUES (?);',
        [now],
      );
      // Cleanup oportunistico — barra-velha 14 dias.
      await db.runAsync(
        'DELETE FROM sos_cancel_history WHERE cancelled_at < ?;',
        [now - CLEANUP_AFTER_MS],
      );
    },

    getRecentCancels: async (withinMs = SEVEN_DAYS_MS, now = Date.now()) => {
      const rows = await db.getAllAsync<CancelRow>(
        'SELECT cancelled_at FROM sos_cancel_history WHERE cancelled_at > ? ORDER BY cancelled_at DESC;',
        [now - withinMs],
      );
      return rows.map((r) => r.cancelled_at);
    },

    clear: async () => {
      await db.runAsync('DELETE FROM sos_cancel_history;');
    },
  };
}
