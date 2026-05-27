import * as SQLite from 'expo-sqlite';
import { initDatabase } from './sqlite';
import type { Route } from '@/domains/routing/types';

/**
 * F36.2 — Cache write-through do `osrmClient` em SQLite. Funciona como
 * extensao do LRU em RAM: o client sempre escreve aqui apos um fetch
 * bem-sucedido. Na leitura, o client primeiro consulta o LRU; se miss,
 * consulta este repo; se miss tambem, ai sim faz request.
 *
 * Cleanup: TTL de 7 dias + cap de 200 entradas (LRU). Roda no bootstrap.
 * Sem cleanup oportunistico no `set` pra nao bloquear o caminho quente.
 */

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

export interface OsrmCacheRepository {
  /** Grava uma entrada (sobrescreve se ja existe). */
  set: (key: string, route: Route, now?: number) => Promise<void>;
  /** Le uma entrada. Retorna null se nao existe ou se expirada. */
  get: (key: string, now?: number) => Promise<Route | null>;
  /** Remove entradas antigas (>TTL) + corta o excedente acima de
   *  MAX_ENTRIES pela `cached_at` mais antiga. Retorna numero removido. */
  cleanup: (now?: number) => Promise<number>;
  /** Apaga TODO o cache. Debug/reset. */
  clear: () => Promise<void>;
}

interface CacheRow {
  key: string;
  payload: string;
  cached_at: number;
}

function isValidCoordinate(value: unknown): value is { latitude: number; longitude: number } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { latitude?: unknown; longitude?: unknown };
  return typeof v.latitude === 'number' && typeof v.longitude === 'number';
}

function parseRoute(json: string): Route | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<Route>;
  if (!Array.isArray(r.coordinates)) return null;
  if (r.coordinates.length === 0) return null;
  if (!r.coordinates.every(isValidCoordinate)) return null;
  if (typeof r.distanceMeters !== 'number') return null;
  if (typeof r.durationSeconds !== 'number') return null;
  if (!Array.isArray(r.steps)) return null;
  const route: Route = {
    coordinates: r.coordinates as Route['coordinates'],
    distanceMeters: r.distanceMeters,
    durationSeconds: r.durationSeconds,
    steps: r.steps as Route['steps'],
    fetchedAt: typeof r.fetchedAt === 'number' ? r.fetchedAt : Date.now(),
    cacheHit: true,
  };
  if (typeof r.sinuosityScore === 'number') {
    route.sinuosityScore = r.sinuosityScore;
  }
  return route;
}

export function createSqliteOsrmCacheRepository(
  db: SQLite.SQLiteDatabase,
): OsrmCacheRepository {
  return {
    set: async (key, route, now = Date.now()) => {
      const payload = JSON.stringify(route);
      await db.runAsync(
        `INSERT INTO osrm_cache (key, payload, cached_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             payload = excluded.payload,
             cached_at = excluded.cached_at;`,
        [key, payload, now],
      );
    },
    get: async (key, now = Date.now()) => {
      const row = await db.getFirstAsync<CacheRow>(
        'SELECT * FROM osrm_cache WHERE key = ? LIMIT 1;',
        [key],
      );
      if (!row) return null;
      if (now - row.cached_at > TTL_MS) return null;
      return parseRoute(row.payload);
    },
    cleanup: async (now = Date.now()) => {
      const cutoff = now - TTL_MS;
      const expiredResult = await db.runAsync(
        'DELETE FROM osrm_cache WHERE cached_at < ?;',
        [cutoff],
      );
      // LRU cap: se ainda tem mais de MAX, remove os mais antigos
      const countRow = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM osrm_cache;',
      );
      const total = countRow?.count ?? 0;
      if (total <= MAX_ENTRIES) return expiredResult.changes;
      const excess = total - MAX_ENTRIES;
      await db.runAsync(
        `DELETE FROM osrm_cache
           WHERE key IN (
             SELECT key FROM osrm_cache ORDER BY cached_at ASC LIMIT ?
           );`,
        [excess],
      );
      return expiredResult.changes + excess;
    },
    clear: async () => {
      await db.runAsync('DELETE FROM osrm_cache;');
    },
  };
}

let _singleton: OsrmCacheRepository | null = null;

export async function getOsrmCacheRepo(): Promise<OsrmCacheRepository> {
  if (_singleton) return _singleton;
  const db = await initDatabase();
  _singleton = createSqliteOsrmCacheRepository(db);
  return _singleton;
}

export function _resetOsrmCacheRepoForTests(): void {
  _singleton = null;
}
