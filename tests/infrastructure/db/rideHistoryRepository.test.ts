import {
  createSqliteRideHistoryRepository,
  type RideHistoryRepository,
} from '@/infrastructure/db/rideHistoryRepository';

/**
 * Fake in-memory db que cobre as queries que `rideHistoryRepository` usa.
 * Padrao validado no `sosStore.test.ts` — em vez de carregar `expo-sqlite`
 * num ambiente Node (que nao funciona), reproduzimos a forma das tabelas
 * como arrays e roteamos SQL por prefixo. So precisamos cobrir EXATAMENTE
 * os enunciados que o repo dispara.
 */
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

interface ProgressRow {
  trip_id: number;
  covered_index: number;
  recorded_at: number;
}

function makeFakeDb(): {
  db: Parameters<typeof createSqliteRideHistoryRepository>[0];
  routeEvents: RouteEventRow[];
  trips: TripRow[];
  progress: ProgressRow[];
} {
  const routeEvents: RouteEventRow[] = [];
  const trips: TripRow[] = [];
  const progress: ProgressRow[] = [];
  let routeId = 0;
  let tripId = 0;

  // Casts para o tipo `SQLite.SQLiteDatabase` ficam locais — pra teste so
  // precisamos das funcoes que o repo usa.
  const db = {
    runAsync: async (
      sql: string,
      params: Array<string | number | null>,
    ): Promise<{ lastInsertRowId: number; changes: number }> => {
      if (sql.startsWith('INSERT INTO route_history')) {
        routeId += 1;
        routeEvents.push({
          id: routeId,
          rota_id: params[0] as string,
          action: params[1] as string,
          occurred_at: params[2] as number,
        });
        return { lastInsertRowId: routeId, changes: 1 };
      }
      if (sql.startsWith('INSERT INTO trip_history')) {
        tripId += 1;
        trips.push({
          id: tripId,
          rota_id: params[0] as string,
          started_at: params[1] as number,
          completed_at: null,
          duration_minutes: null,
          distance_km: null,
          notes: null,
        });
        return { lastInsertRowId: tripId, changes: 1 };
      }
      if (sql.startsWith('UPDATE trip_history')) {
        const id = params[3] as number;
        const row = trips.find((t) => t.id === id);
        if (row) {
          row.completed_at = params[0] as number;
          row.duration_minutes = params[1] as number;
          row.distance_km = params[2] as number;
        }
        return { lastInsertRowId: 0, changes: row ? 1 : 0 };
      }
      if (sql.startsWith('INSERT OR IGNORE INTO trip_progress')) {
        const tid = params[0] as number;
        const idx = params[1] as number;
        const already = progress.some(
          (p) => p.trip_id === tid && p.covered_index === idx,
        );
        if (!already) {
          progress.push({
            trip_id: tid,
            covered_index: idx,
            recorded_at: params[2] as number,
          });
        }
        return { lastInsertRowId: 0, changes: already ? 0 : 1 };
      }
      if (sql.startsWith('DELETE FROM trip_progress WHERE trip_id')) {
        const tid = params[0] as number;
        for (let i = progress.length - 1; i >= 0; i -= 1) {
          if (progress[i]?.trip_id === tid) progress.splice(i, 1);
        }
        return { lastInsertRowId: 0, changes: 0 };
      }
      if (sql.startsWith('DELETE FROM trip_progress')) {
        progress.length = 0;
        return { lastInsertRowId: 0, changes: 0 };
      }
      if (sql.startsWith('DELETE FROM trip_history WHERE id')) {
        const id = params[0] as number;
        const i = trips.findIndex((t) => t.id === id);
        if (i >= 0) trips.splice(i, 1);
        return { lastInsertRowId: 0, changes: i >= 0 ? 1 : 0 };
      }
      if (sql.startsWith('DELETE FROM trip_history')) {
        trips.length = 0;
        return { lastInsertRowId: 0, changes: 0 };
      }
      if (sql.startsWith('DELETE FROM route_history')) {
        routeEvents.length = 0;
        return { lastInsertRowId: 0, changes: 0 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    getFirstAsync: async <T>(
      sql: string,
      params: Array<string | number | null>,
    ): Promise<T | null> => {
      if (sql.startsWith('SELECT COUNT(*) as count FROM route_history')) {
        const rota = params[0] as string;
        const count = routeEvents.filter((e) => e.rota_id === rota).length;
        return { count } as unknown as T;
      }
      if (
        sql.startsWith(
          'SELECT * FROM trip_history\n           WHERE completed_at IS NULL\n           ORDER BY started_at DESC',
        )
      ) {
        // getMostRecentActiveTrip — sem filtro de rota.
        const match = trips
          .filter((t) => t.completed_at === null)
          .sort((a, b) => b.started_at - a.started_at)[0];
        return (match ?? null) as unknown as T | null;
      }
      if (sql.startsWith('SELECT * FROM trip_history')) {
        // getActiveTripForRoute OU pre-check do recordTripStarted (resume).
        const rota = params[0] as string;
        const match = trips
          .filter((t) => t.rota_id === rota && t.completed_at === null)
          .sort((a, b) => b.started_at - a.started_at)[0];
        return (match ?? null) as unknown as T | null;
      }
      throw new Error(`Unexpected getFirstAsync SQL: ${sql}`);
    },
    getAllAsync: async <T>(
      sql: string,
      params: Array<string | number | null>,
    ): Promise<T[]> => {
      if (sql.startsWith('SELECT * FROM trip_history ORDER BY')) {
        return [...trips].sort((a, b) => b.started_at - a.started_at) as unknown as T[];
      }
      if (sql.startsWith('SELECT * FROM route_history')) {
        const rota = params[0] as string;
        return routeEvents
          .filter((e) => e.rota_id === rota)
          .sort((a, b) => b.occurred_at - a.occurred_at) as unknown as T[];
      }
      if (sql.startsWith('SELECT covered_index FROM trip_progress')) {
        const tid = params[0] as number;
        return progress
          .filter((p) => p.trip_id === tid)
          .sort((a, b) => a.covered_index - b.covered_index)
          .map((p) => ({ covered_index: p.covered_index })) as unknown as T[];
      }
      if (sql.startsWith('SELECT id FROM trip_history')) {
        const cutoff = params[0] as number;
        return trips
          .filter((t) => t.completed_at === null && t.started_at < cutoff)
          .map((t) => ({ id: t.id })) as unknown as T[];
      }
      throw new Error(`Unexpected getAllAsync SQL: ${sql}`);
    },
    withTransactionAsync: async (fn: () => Promise<void>): Promise<void> => {
      // O fake nao implementa rollback — pra esse repo, o teste de
      // transacao verifica o "happy path" das duas writes; testes
      // separados podem cobrir o rollback se a logica crescer.
      await fn();
    },
    // Outras funcoes que o repo nao usa (mas o tipo SQLiteDatabase
    // exporta) sao no-ops pra satisfazer o cast.
    execAsync: async (): Promise<void> => undefined,
    closeAsync: async (): Promise<void> => undefined,
  } as unknown as Parameters<typeof createSqliteRideHistoryRepository>[0];

  return { db, routeEvents, trips, progress };
}

describe('rideHistoryRepository', () => {
  let repo: RideHistoryRepository;
  let fake: ReturnType<typeof makeFakeDb>;

  beforeEach(() => {
    fake = makeFakeDb();
    repo = createSqliteRideHistoryRepository(fake.db);
  });

  it('recordRouteOpen incrementa o contador de aberturas da rota', async () => {
    await repo.recordRouteOpen('serra-mantiqueira-sp', 1000);
    await repo.recordRouteOpen('serra-mantiqueira-sp', 2000);
    await repo.recordRouteOpen('outra-rota', 3000);

    expect(await repo.getRouteOpenCount('serra-mantiqueira-sp')).toBe(2);
    expect(await repo.getRouteOpenCount('outra-rota')).toBe(1);
    expect(await repo.getRouteOpenCount('inexistente')).toBe(0);
  });

  it('recordTripStarted insere em ambas as tabelas e retorna o id do trip', async () => {
    const tripId = await repo.recordTripStarted('rota-teste', 5000);

    expect(tripId).toBe(1);
    // route_history ganhou linha com action='started' alem da 'opened'
    expect(fake.routeEvents).toHaveLength(1);
    expect(fake.routeEvents[0]).toMatchObject({
      rota_id: 'rota-teste',
      action: 'started',
      occurred_at: 5000,
    });
    // trip_history tem o trip iniciado
    expect(fake.trips).toHaveLength(1);
    expect(fake.trips[0]).toMatchObject({
      rota_id: 'rota-teste',
      started_at: 5000,
      completed_at: null,
    });
  });

  it('getActiveTripForRoute retorna trip pendente; null quando ja completado', async () => {
    const tripId = await repo.recordTripStarted('rota-x', 1000);
    const active = await repo.getActiveTripForRoute('rota-x');
    expect(active).not.toBeNull();
    expect(active?.id).toBe(tripId);
    expect(active?.completedAt).toBeUndefined();

    await repo.recordTripCompleted(tripId, 2000, 60, 120);
    const afterCompletion = await repo.getActiveTripForRoute('rota-x');
    expect(afterCompletion).toBeNull();
  });

  it('listTrips retorna trips em ordem decrescente por started_at, com campos opcionais preenchidos quando aplicaveis', async () => {
    const idA = await repo.recordTripStarted('rota-a', 1000);
    await repo.recordTripStarted('rota-b', 2000);
    await repo.recordTripCompleted(idA, 1500, 30, 50);

    const trips = await repo.listTrips();
    expect(trips).toHaveLength(2);
    // Mais recente primeiro
    expect(trips[0]?.rotaId).toBe('rota-b');
    expect(trips[0]?.completedAt).toBeUndefined();
    expect(trips[1]?.rotaId).toBe('rota-a');
    expect(trips[1]?.completedAt).toBe(1500);
    expect(trips[1]?.durationMinutes).toBe(30);
    expect(trips[1]?.distanceKm).toBe(50);
  });

  it('listRouteEvents retorna eventos da rota em ordem decrescente, com action normalizado', async () => {
    await repo.recordRouteOpen('rota-y', 1000);
    await repo.recordTripStarted('rota-y', 2000);
    await repo.recordRouteOpen('rota-y', 3000);

    const events = await repo.listRouteEvents('rota-y');
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.occurredAt)).toEqual([3000, 2000, 1000]);
    expect(events.map((e) => e.action)).toEqual(['opened', 'started', 'opened']);
  });

  it('recordTripStarted reusa trip pendente da mesma rota dentro de 24h', async () => {
    const now = 1_000_000_000_000;
    const idA = await repo.recordTripStarted('rota-resume', now);
    // 2 horas depois — dentro da janela
    const idB = await repo.recordTripStarted('rota-resume', now + 2 * 60 * 60 * 1000);
    expect(idB).toBe(idA);
    // Apenas UMA linha em trip_history
    expect(fake.trips).toHaveLength(1);
    // Mas DUAS linhas em route_history (dois eventos 'started')
    const startedCount = fake.routeEvents.filter(
      (e) => e.rota_id === 'rota-resume' && e.action === 'started',
    ).length;
    expect(startedCount).toBe(2);
  });

  it('recordTripStarted cria trip novo quando o pendente passou da janela de 24h', async () => {
    const now = 1_000_000_000_000;
    const idA = await repo.recordTripStarted('rota-velha', now);
    // 25 horas depois — fora da janela
    const idB = await repo.recordTripStarted(
      'rota-velha',
      now + 25 * 60 * 60 * 1000,
    );
    expect(idB).not.toBe(idA);
    expect(fake.trips).toHaveLength(2);
  });

  it('recordCoveredIndex persiste o indice de forma idempotente', async () => {
    const tid = await repo.recordTripStarted('rota-prog', 1000);
    await repo.recordCoveredIndex(tid, 0);
    await repo.recordCoveredIndex(tid, 0); // duplicata — INSERT OR IGNORE
    await repo.recordCoveredIndex(tid, 1);
    const idx = await repo.getCoveredIndicesForTrip(tid);
    expect(idx).toEqual([0, 1]);
  });

  it('clearCoveredIndicesForTrip remove so do trip alvo', async () => {
    const idA = await repo.recordTripStarted('rota-a', 1000);
    const idB = await repo.recordTripStarted('rota-b', 2000);
    await repo.recordCoveredIndex(idA, 0);
    await repo.recordCoveredIndex(idA, 1);
    await repo.recordCoveredIndex(idB, 0);

    await repo.clearCoveredIndicesForTrip(idA);
    expect(await repo.getCoveredIndicesForTrip(idA)).toEqual([]);
    expect(await repo.getCoveredIndicesForTrip(idB)).toEqual([0]);
  });

  it('getMostRecentActiveTrip retorna o trip pendente mais recente em qualquer rota', async () => {
    expect(await repo.getMostRecentActiveTrip()).toBeNull();
    await repo.recordTripStarted('rota-a', 1000);
    const idB = await repo.recordTripStarted('rota-b', 2000);
    const recent = await repo.getMostRecentActiveTrip();
    expect(recent?.id).toBe(idB);
    expect(recent?.rotaId).toBe('rota-b');
  });

  it('cleanupAbandonedTrips remove trips >24h sem completar + progress associado', async () => {
    const now = 10_000_000_000;
    const oldTrip = await repo.recordTripStarted('rota-abandonada', now - 26 * 60 * 60 * 1000);
    await repo.recordCoveredIndex(oldTrip, 0, now - 26 * 60 * 60 * 1000);
    const recentTrip = await repo.recordTripStarted('rota-recente', now - 2 * 60 * 60 * 1000);
    await repo.recordCoveredIndex(recentTrip, 0, now - 2 * 60 * 60 * 1000);

    const removed = await repo.cleanupAbandonedTrips(
      24 * 60 * 60 * 1000,
      now,
    );
    expect(removed).toBe(1);
    expect(fake.trips.map((t) => t.id)).toEqual([recentTrip]);
    expect(await repo.getCoveredIndicesForTrip(oldTrip)).toEqual([]);
    expect(await repo.getCoveredIndicesForTrip(recentTrip)).toEqual([0]);
  });
});
