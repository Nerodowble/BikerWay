import {
  createSqliteOsrmCacheRepository,
  type OsrmCacheRepository,
} from '@/infrastructure/db/osrmCacheRepository';
import type { Route } from '@/domains/routing/types';

interface Row {
  key: string;
  payload: string;
  cached_at: number;
}

function makeFakeDb(): {
  db: Parameters<typeof createSqliteOsrmCacheRepository>[0];
  rows: Row[];
} {
  const rows: Row[] = [];
  const db = {
    runAsync: async (
      sql: string,
      params: Array<string | number | null>,
    ): Promise<{ lastInsertRowId: number; changes: number }> => {
      if (sql.startsWith('INSERT INTO osrm_cache')) {
        const key = params[0] as string;
        const idx = rows.findIndex((r) => r.key === key);
        const row: Row = {
          key,
          payload: params[1] as string,
          cached_at: params[2] as number,
        };
        if (idx >= 0) rows[idx] = row;
        else rows.push(row);
        return { lastInsertRowId: 0, changes: 1 };
      }
      if (sql.startsWith('DELETE FROM osrm_cache WHERE cached_at')) {
        const cutoff = params[0] as number;
        let removed = 0;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if ((rows[i]?.cached_at ?? 0) < cutoff) {
            rows.splice(i, 1);
            removed += 1;
          }
        }
        return { lastInsertRowId: 0, changes: removed };
      }
      if (sql.startsWith('DELETE FROM osrm_cache\n           WHERE key IN')) {
        const limit = params[0] as number;
        const sortedAsc = [...rows].sort((a, b) => a.cached_at - b.cached_at);
        const toRemove = new Set(sortedAsc.slice(0, limit).map((r) => r.key));
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (toRemove.has(rows[i]?.key ?? '')) rows.splice(i, 1);
        }
        return { lastInsertRowId: 0, changes: toRemove.size };
      }
      if (sql.startsWith('DELETE FROM osrm_cache')) {
        rows.length = 0;
        return { lastInsertRowId: 0, changes: 0 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    getFirstAsync: async <T>(
      sql: string,
      params: Array<string | number | null>,
    ): Promise<T | null> => {
      if (sql.startsWith('SELECT * FROM osrm_cache WHERE key')) {
        const key = params[0] as string;
        const row = rows.find((r) => r.key === key);
        return (row ?? null) as unknown as T | null;
      }
      if (sql.startsWith('SELECT COUNT(*) as count FROM osrm_cache')) {
        return { count: rows.length } as unknown as T;
      }
      throw new Error(`Unexpected getFirstAsync: ${sql}`);
    },
    execAsync: async (): Promise<void> => undefined,
  } as unknown as Parameters<typeof createSqliteOsrmCacheRepository>[0];
  return { db, rows };
}

function makeRoute(distance: number): Route {
  return {
    coordinates: [{ latitude: -23.5, longitude: -46.5 }],
    distanceMeters: distance,
    durationSeconds: 60,
    steps: [],
    fetchedAt: 1_000,
    cacheHit: false,
  };
}

describe('osrmCacheRepository', () => {
  let repo: OsrmCacheRepository;
  let fake: ReturnType<typeof makeFakeDb>;

  beforeEach(() => {
    fake = makeFakeDb();
    repo = createSqliteOsrmCacheRepository(fake.db);
  });

  it('set + get round-trip preserva os campos do Route', async () => {
    await repo.set('key1', makeRoute(1234), 1_000);
    const loaded = await repo.get('key1', 1_000);
    expect(loaded?.distanceMeters).toBe(1234);
    expect(loaded?.cacheHit).toBe(true);
  });

  it('get retorna null em entrada expirada (TTL 7d)', async () => {
    await repo.set('key1', makeRoute(100), 1_000);
    // 8 dias depois — passa do TTL
    const eightDaysLater = 1_000 + 8 * 24 * 60 * 60 * 1000;
    expect(await repo.get('key1', eightDaysLater)).toBeNull();
  });

  it('cleanup remove expirados', async () => {
    const now = 100_000_000;
    await repo.set('antiga', makeRoute(1), now - 8 * 24 * 60 * 60 * 1000);
    await repo.set('nova', makeRoute(2), now);
    const removed = await repo.cleanup(now);
    expect(removed).toBe(1);
    expect(await repo.get('nova', now)).not.toBeNull();
  });

  it('clear apaga tudo', async () => {
    await repo.set('k1', makeRoute(1), 1_000);
    await repo.set('k2', makeRoute(2), 2_000);
    await repo.clear();
    expect(fake.rows).toEqual([]);
  });

  it('get rejeita payload malformado', async () => {
    fake.rows.push({
      key: 'bad',
      payload: '{"not": "route"}',
      cached_at: Date.now(),
    });
    expect(await repo.get('bad')).toBeNull();
  });
});
