import {
  createSqliteActiveRouteRepository,
  type ActiveRouteRepository,
} from '@/infrastructure/db/activeRouteRepository';
import type { Route } from '@/domains/routing/types';

interface Row {
  id: number;
  payload: string;
  destination: string | null;
  saved_at: number;
  was_navigating: number;
  trip_started_at: number | null;
}

function makeFakeDb(): {
  db: Parameters<typeof createSqliteActiveRouteRepository>[0];
  rows: Row[];
} {
  const rows: Row[] = [];
  const db = {
    runAsync: async (
      sql: string,
      params: Array<string | number | null>,
    ): Promise<{ lastInsertRowId: number; changes: number }> => {
      if (sql.startsWith('INSERT INTO active_route_cache')) {
        const idx = rows.findIndex((r) => r.id === 1);
        const row: Row = {
          id: 1,
          payload: params[0] as string,
          destination: (params[1] as string | null) ?? null,
          saved_at: params[2] as number,
          was_navigating: (params[3] as number) ?? 0,
          trip_started_at: (params[4] as number | null) ?? null,
        };
        if (idx >= 0) rows[idx] = row;
        else rows.push(row);
        return { lastInsertRowId: 1, changes: 1 };
      }
      if (sql.startsWith('DELETE FROM active_route_cache')) {
        rows.length = 0;
        return { lastInsertRowId: 0, changes: 0 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    getFirstAsync: async <T>(sql: string): Promise<T | null> => {
      if (sql.startsWith('SELECT * FROM active_route_cache')) {
        return (rows[0] ?? null) as unknown as T | null;
      }
      throw new Error(`Unexpected getFirstAsync: ${sql}`);
    },
    execAsync: async (): Promise<void> => undefined,
  } as unknown as Parameters<typeof createSqliteActiveRouteRepository>[0];
  return { db, rows };
}

function makeRoute(): Route {
  return {
    coordinates: [
      { latitude: -23.5, longitude: -46.5 },
      { latitude: -23.4, longitude: -46.4 },
    ],
    distanceMeters: 1500,
    durationSeconds: 60,
    steps: [{ distanceMeters: 1500, durationSeconds: 60 }],
    fetchedAt: 1_000,
    cacheHit: false,
  };
}

describe('activeRouteRepository', () => {
  let repo: ActiveRouteRepository;
  let fake: ReturnType<typeof makeFakeDb>;

  beforeEach(() => {
    fake = makeFakeDb();
    repo = createSqliteActiveRouteRepository(fake.db);
  });

  it('save + load round-trip preserva campos da rota', async () => {
    const r = makeRoute();
    await repo.save(
      { route: r, destination: null, wasNavigating: false, tripStartedAt: null },
      5_000,
    );
    const loaded = await repo.load();
    expect(loaded?.route.coordinates).toEqual(r.coordinates);
    expect(loaded?.route.distanceMeters).toBe(1500);
    expect(loaded?.route.cacheHit).toBe(true);
    expect(loaded?.savedAt).toBe(5_000);
    expect(loaded?.wasNavigating).toBe(false);
    expect(loaded?.tripStartedAt).toBeNull();
  });

  it('save com wasNavigating=true preserva o flag + tripStartedAt', async () => {
    await repo.save(
      {
        route: makeRoute(),
        destination: null,
        wasNavigating: true,
        tripStartedAt: 12345,
      },
      1_000,
    );
    const loaded = await repo.load();
    expect(loaded?.wasNavigating).toBe(true);
    expect(loaded?.tripStartedAt).toBe(12345);
  });

  it('save sobrescreve a entrada singleton', async () => {
    await repo.save(
      { route: makeRoute(), destination: null, wasNavigating: false, tripStartedAt: null },
      1_000,
    );
    const newRoute: Route = { ...makeRoute(), distanceMeters: 9999 };
    await repo.save(
      { route: newRoute, destination: null, wasNavigating: true, tripStartedAt: 999 },
      2_000,
    );
    expect(fake.rows).toHaveLength(1);
    const loaded = await repo.load();
    expect(loaded?.route.distanceMeters).toBe(9999);
    expect(loaded?.wasNavigating).toBe(true);
    expect(loaded?.tripStartedAt).toBe(999);
  });

  it('save com destination preenche o campo', async () => {
    const dest = { latitude: -22.0, longitude: -47.0, timestamp: 100 };
    await repo.save(
      { route: makeRoute(), destination: dest, wasNavigating: false, tripStartedAt: null },
      1_000,
    );
    const loaded = await repo.load();
    expect(loaded?.destination?.latitude).toBe(-22.0);
    expect(loaded?.destination?.timestamp).toBe(100);
  });

  it('load retorna null em payload malformado', async () => {
    fake.rows.push({
      id: 1,
      payload: '{"not": "a route"}',
      destination: null,
      saved_at: 1_000,
      was_navigating: 0,
      trip_started_at: null,
    });
    expect(await repo.load()).toBeNull();
  });

  it('clear remove a entrada', async () => {
    await repo.save(
      { route: makeRoute(), destination: null, wasNavigating: false, tripStartedAt: null },
      1_000,
    );
    await repo.clear();
    expect(await repo.load()).toBeNull();
  });
});
