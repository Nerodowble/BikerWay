import {
  createSqliteSavedTripsRepository,
  type SavedTripsRepository,
} from '@/infrastructure/db/savedTripsRepository';

interface SavedTripRow {
  id: number;
  name: string;
  rota_ids: string;
  pernoite_locations: string | null;
  scheduled_for: number | null;
  notes: string | null;
  created_at: number;
  completed_at: number | null;
}

function makeFakeDb(): {
  db: Parameters<typeof createSqliteSavedTripsRepository>[0];
  rows: SavedTripRow[];
} {
  const rows: SavedTripRow[] = [];
  let nextId = 0;
  const db = {
    runAsync: async (
      sql: string,
      params: Array<string | number | null>,
    ): Promise<{ lastInsertRowId: number; changes: number }> => {
      if (sql.startsWith('INSERT INTO saved_trips')) {
        nextId += 1;
        rows.push({
          id: nextId,
          name: params[0] as string,
          rota_ids: params[1] as string,
          pernoite_locations: (params[2] as string | null) ?? null,
          scheduled_for: (params[3] as number | null) ?? null,
          notes: (params[4] as string | null) ?? null,
          created_at: params[5] as number,
          completed_at: null,
        });
        return { lastInsertRowId: nextId, changes: 1 };
      }
      if (sql.startsWith('UPDATE saved_trips SET completed_at')) {
        const id = params[1] as number;
        const r = rows.find((x) => x.id === id);
        if (r) r.completed_at = params[0] as number;
        return { lastInsertRowId: 0, changes: r ? 1 : 0 };
      }
      if (sql.startsWith('UPDATE saved_trips')) {
        const id = params[5] as number;
        const r = rows.find((x) => x.id === id);
        if (r) {
          r.name = params[0] as string;
          r.rota_ids = params[1] as string;
          r.pernoite_locations = (params[2] as string | null) ?? null;
          r.scheduled_for = (params[3] as number | null) ?? null;
          r.notes = (params[4] as string | null) ?? null;
        }
        return { lastInsertRowId: 0, changes: r ? 1 : 0 };
      }
      if (sql.startsWith('DELETE FROM saved_trips WHERE id')) {
        const id = params[0] as number;
        const i = rows.findIndex((x) => x.id === id);
        if (i >= 0) rows.splice(i, 1);
        return { lastInsertRowId: 0, changes: i >= 0 ? 1 : 0 };
      }
      if (sql.startsWith('DELETE FROM saved_trips')) {
        rows.length = 0;
        return { lastInsertRowId: 0, changes: 0 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    getAllAsync: async <T>(sql: string): Promise<T[]> => {
      if (sql.startsWith('SELECT * FROM saved_trips ORDER BY created_at')) {
        return [...rows].sort((a, b) => b.created_at - a.created_at) as unknown as T[];
      }
      throw new Error(`Unexpected getAllAsync: ${sql}`);
    },
    getFirstAsync: async <T>(
      sql: string,
      params: Array<string | number | null>,
    ): Promise<T | null> => {
      if (sql.startsWith('SELECT * FROM saved_trips WHERE id')) {
        const id = params[0] as number;
        const r = rows.find((x) => x.id === id);
        return (r ?? null) as unknown as T | null;
      }
      throw new Error(`Unexpected getFirstAsync: ${sql}`);
    },
    execAsync: async (): Promise<void> => undefined,
    withTransactionAsync: async (fn: () => Promise<void>): Promise<void> => {
      await fn();
    },
  } as unknown as Parameters<typeof createSqliteSavedTripsRepository>[0];
  return { db, rows };
}

describe('savedTripsRepository', () => {
  let repo: SavedTripsRepository;
  let fake: ReturnType<typeof makeFakeDb>;

  beforeEach(() => {
    fake = makeFakeDb();
    repo = createSqliteSavedTripsRepository(fake.db);
  });

  it('create + list + getById round-trip', async () => {
    const id = await repo.create({
      name: 'Litoral SP',
      rotaIds: ['tamoios', 'rio-santos'],
      pernoiteLocations: ['Caraguatatuba'],
      notes: 'Levar capa',
    });
    expect(id).toBe(1);

    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('Litoral SP');
    expect(list[0]?.rotaIds).toEqual(['tamoios', 'rio-santos']);
    expect(list[0]?.pernoiteLocations).toEqual(['Caraguatatuba']);
    expect(list[0]?.notes).toBe('Levar capa');

    const fetched = await repo.getById(id);
    expect(fetched?.name).toBe('Litoral SP');
  });

  it('list ordena por created_at desc', async () => {
    await repo.create({ name: 'Antigo', rotaIds: ['a'] }, 1_000);
    await repo.create({ name: 'Recente', rotaIds: ['b'] }, 2_000);
    const list = await repo.list();
    expect(list.map((t) => t.name)).toEqual(['Recente', 'Antigo']);
  });

  it('update sobrescreve campos', async () => {
    const id = await repo.create({ name: 'V1', rotaIds: ['a'] });
    await repo.update(id, { name: 'V2', rotaIds: ['a', 'b'], notes: 'novo' });
    const t = await repo.getById(id);
    expect(t?.name).toBe('V2');
    expect(t?.rotaIds).toEqual(['a', 'b']);
    expect(t?.notes).toBe('novo');
  });

  it('markCompleted seta completed_at', async () => {
    const id = await repo.create({ name: 'T', rotaIds: ['a'] });
    await repo.markCompleted(id, 5_000);
    const t = await repo.getById(id);
    expect(t?.completedAt).toBe(5_000);
  });

  it('delete remove definitivamente', async () => {
    const id = await repo.create({ name: 'T', rotaIds: ['a'] });
    await repo.delete(id);
    expect(await repo.getById(id)).toBeNull();
    expect(await repo.list()).toEqual([]);
  });

  it('aceita trip de 1 rota com 1 pernoite (caso fim-de-semana com ida e volta)', async () => {
    // F35.7.1 — Trip "1 dia mas pernoito la" = 1 rota + 1 pernoite no
    // destino. Validacao do repository nao deve restringir.
    const id = await repo.create({
      name: 'Fim de semana em Caraguá',
      rotaIds: ['tamoios'],
      pernoiteLocations: ['Caraguatatuba'],
    });
    const trip = await repo.getById(id);
    expect(trip?.rotaIds).toEqual(['tamoios']);
    expect(trip?.pernoiteLocations).toEqual(['Caraguatatuba']);
  });

  it('omite campos opcionais quando undefined no input', async () => {
    const id = await repo.create({ name: 'Minima', rotaIds: ['x'] });
    const t = await repo.getById(id);
    expect(t?.notes).toBeUndefined();
    expect(t?.scheduledFor).toBeUndefined();
    expect(t?.pernoiteLocations).toBeUndefined();
  });
});
