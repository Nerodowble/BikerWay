import * as SQLite from 'expo-sqlite';
import { initDatabase } from './sqlite';
import type { Poi, PoiCategory } from '@/domains/poi/types';

/**
 * F36.4 — Cache write-through do `overpassClient` em SQLite. Sobrevive
 * kill do app e funciona offline em regioes ja consultadas.
 *
 * Estrategia identica ao OSRM cache (F36.2): TTL 30d + LRU cap 100
 * entradas. Cleanup roda 1x por boot. Read path do overpassClient: LRU
 * RAM → SQLite → fetch real → write-through.
 */

const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 100;

const VALID_CATEGORIES: ReadonlySet<PoiCategory> = new Set([
  'fuel',
  'tyres',
  'mechanic',
  'restaurante',
  'hotel',
  'pousada',
]);

export interface PoiCacheRepository {
  set: (key: string, pois: ReadonlyArray<Poi>, now?: number) => Promise<void>;
  get: (key: string, now?: number) => Promise<Poi[] | null>;
  cleanup: (now?: number) => Promise<number>;
  clear: () => Promise<void>;
}

interface CacheRow {
  key: string;
  payload: string;
  cached_at: number;
}

function isValidPoi(value: unknown): value is Poi {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<Poi>;
  if (typeof v.id !== 'string') return false;
  if (typeof v.name !== 'string') return false;
  if (typeof v.latitude !== 'number') return false;
  if (typeof v.longitude !== 'number') return false;
  if (typeof v.category !== 'string') return false;
  if (!VALID_CATEGORIES.has(v.category as PoiCategory)) return false;
  return true;
}

function parsePois(json: string): Poi[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;
  if (!raw.every(isValidPoi)) return null;
  return raw;
}

export function createSqlitePoiCacheRepository(
  db: SQLite.SQLiteDatabase,
): PoiCacheRepository {
  return {
    set: async (key, pois, now = Date.now()) => {
      const payload = JSON.stringify(pois);
      await db.runAsync(
        `INSERT INTO poi_cache (key, payload, cached_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             payload = excluded.payload,
             cached_at = excluded.cached_at;`,
        [key, payload, now],
      );
    },
    get: async (key, now = Date.now()) => {
      const row = await db.getFirstAsync<CacheRow>(
        'SELECT * FROM poi_cache WHERE key = ? LIMIT 1;',
        [key],
      );
      if (!row) return null;
      if (now - row.cached_at > TTL_MS) return null;
      return parsePois(row.payload);
    },
    cleanup: async (now = Date.now()) => {
      const cutoff = now - TTL_MS;
      const expiredResult = await db.runAsync(
        'DELETE FROM poi_cache WHERE cached_at < ?;',
        [cutoff],
      );
      const countRow = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM poi_cache;',
      );
      const total = countRow?.count ?? 0;
      if (total <= MAX_ENTRIES) return expiredResult.changes;
      const excess = total - MAX_ENTRIES;
      await db.runAsync(
        `DELETE FROM poi_cache
           WHERE key IN (
             SELECT key FROM poi_cache ORDER BY cached_at ASC LIMIT ?
           );`,
        [excess],
      );
      return expiredResult.changes + excess;
    },
    clear: async () => {
      await db.runAsync('DELETE FROM poi_cache;');
    },
  };
}

let _singleton: PoiCacheRepository | null = null;

export async function getPoiCacheRepo(): Promise<PoiCacheRepository> {
  if (_singleton) return _singleton;
  const db = await initDatabase();
  _singleton = createSqlitePoiCacheRepository(db);
  return _singleton;
}

export function _resetPoiCacheRepoForTests(): void {
  _singleton = null;
}
