import * as SQLite from 'expo-sqlite';

export interface Migration {
  id: number;
  name: string;
  up: (db: SQLite.SQLiteDatabase) => Promise<void>;
}

interface AppliedRow {
  id: number;
}

export const migrations: Migration[] = [
  {
    id: 1,
    name: 'initial_schema',
    up: async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS motorcycles (
          id TEXT PRIMARY KEY,
          brand TEXT NOT NULL,
          model TEXT NOT NULL,
          tank_capacity REAL NOT NULL,
          average_consump REAL NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
  {
    id: 2,
    name: 'add_owner_name_to_motorcycles',
    up: async (db) => {
      // ALTER TABLE adds a nullable column — existing rows get NULL which the
      // domain mapper treats as "no owner name set" (undefined / optional).
      await db.execAsync(
        'ALTER TABLE motorcycles ADD COLUMN owner_name TEXT;',
      );
    },
  },
  {
    id: 3,
    name: 'create_rider_profile',
    up: async (db) => {
      // Singleton table: by design holds AT MOST 1 row. The CHECK constraint
      // on `singleton_id = 1` plus PRIMARY KEY guarantees that — upserts
      // target the same row instead of inserting new ones. Everything else
      // is nullable so optional profile fields map to undefined cleanly.
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS rider_profile (
          singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
          id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          cidade TEXT NOT NULL,
          estado TEXT NOT NULL,
          anos_pilotando INTEGER,
          genero TEXT,
          estilo_pilotagem TEXT,
          preferencia_tempo TEXT,
          bio TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    id: 4,
    name: 'create_sos_cancel_history',
    up: async (db) => {
      // Anti-abuso do SOS Comunitario (F29.4). Guarda apenas o timestamp
      // epoch ms de cada cancel — sem foreign key, sem PII alem do tempo,
      // pra reduzir superficie de bug. Index acelera a query de "cancels
      // nos ultimos 7d" que o sosStore faz a cada disparo.
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS sos_cancel_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cancelled_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sos_cancel_history_at
          ON sos_cancel_history (cancelled_at);
      `);
    },
  },
  {
    id: 5,
    name: 'add_avatar_uri_to_rider_profile',
    up: async (db) => {
      // F32: avatar do piloto. URI persistente apontando pra
      // FileSystem.documentDirectory; nullable porque perfis antigos
      // (criados antes da F32) nao tem foto.
      await db.execAsync(
        'ALTER TABLE rider_profile ADD COLUMN avatar_uri TEXT;',
      );
    },
  },
  {
    id: 6,
    name: 'create_ride_history',
    up: async (db) => {
      // F35.1 — Fundacao pra Stamps Brasil (B) e Fim de Semana Perfeito (A).
      //
      // `route_history`: cada interacao com uma rota do catalogo (abertura
      //   do detail, inicio de navegacao). Usada pelo ranker (F35.5) pra
      //   computar score de novidade — "abriu 5x" vale menos que "nunca
      //   abriu". Sem PII alem do timestamp + rota_id.
      //
      // `trip_history`: viagens REALMENTE iniciadas. `started_at` sempre
      //   preenchido; `completed_at` permanece NULL ate F35.2 (deteccao
      //   "80% da polyline") marcar como completada. F35.3 (Stamps) le
      //   essa tabela pra montar o passaporte. Nada de GPS detalhado —
      //   isso e papel do Replay (F34.10).
      //
      // Indices: rota_id pra agregados ("quantas vezes abri X") e
      // started_at/occurred_at pra range queries do tipo "abriu na ultima
      // semana".
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS route_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rota_id TEXT NOT NULL,
          action TEXT NOT NULL,
          occurred_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_route_history_rota
          ON route_history (rota_id);
        CREATE INDEX IF NOT EXISTS idx_route_history_occurred_at
          ON route_history (occurred_at);

        CREATE TABLE IF NOT EXISTS trip_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rota_id TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          completed_at INTEGER,
          duration_minutes INTEGER,
          distance_km REAL,
          notes TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_trip_history_rota
          ON trip_history (rota_id);
        CREATE INDEX IF NOT EXISTS idx_trip_history_started_at
          ON trip_history (started_at);
      `);
    },
  },
  {
    id: 7,
    name: 'create_trip_progress',
    up: async (db) => {
      // F35.2 rev — Persistencia de `coveredIndices` entre sessoes do app.
      // Cada vez que um sample de GPS marca um indice novo como coberto,
      // gravamos uma linha aqui. UNIQUE(trip_id, covered_index) evita
      // duplicatas se o detector reprocessar o mesmo ponto. No boot, o
      // tripCompletionStore reidrata o Set lendo todos os indices do trip
      // ativo (completed_at IS NULL).
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS trip_progress (
          trip_id INTEGER NOT NULL,
          covered_index INTEGER NOT NULL,
          recorded_at INTEGER NOT NULL,
          PRIMARY KEY (trip_id, covered_index)
        );
        CREATE INDEX IF NOT EXISTS idx_trip_progress_trip
          ON trip_progress (trip_id);
      `);
    },
  },
  {
    id: 12,
    name: 'active_route_cache_add_nav_state',
    up: async (db) => {
      // F36.1.1 — Cache da rota ativa precisa lembrar TAMBEM se a navegacao
      // estava em curso quando salvou e o `tripStartedAt` original. Sem
      // isso, ao restaurar o piloto via uma "rota traçada parada" em vez
      // de continuar navegando. ALTER TABLE pra preservar dados existentes
      // (singleton ja persistido na sessao anterior).
      await db.execAsync(
        'ALTER TABLE active_route_cache ADD COLUMN was_navigating INTEGER NOT NULL DEFAULT 0;',
      );
      await db.execAsync(
        'ALTER TABLE active_route_cache ADD COLUMN trip_started_at INTEGER;',
      );
    },
  },
  {
    id: 11,
    name: 'create_poi_cache',
    up: async (db) => {
      // F36.4 — Cache write-through pro `overpassClient`. Chave = (categoria
      // + bbox snapped a grid de 110m), idem ao cache em RAM. Permite POIs
      // (postos, hoteis, mecanicos) sobreviverem kill do app + funcionarem
      // offline em area ja visitada.
      //
      // `payload` armazena Poi[] serializado. TTL 30 dias (POIs sao
      // razoavelmente estaveis no OSM). LRU cap 100 entradas (controlado
      // pelo cleanup).
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS poi_cache (
          key TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          cached_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_poi_cache_age
          ON poi_cache (cached_at);
      `);
    },
  },
  {
    id: 10,
    name: 'create_osrm_cache',
    up: async (db) => {
      // F36.2 — Cache write-through do `osrmClient`. Cada Route resolvido
      // pelo OSRM e gravado aqui pra sobreviver kill do app. Read path:
      // primeiro LRU em RAM → se miss, SQLite → se miss, fetch real.
      //
      // `key` = mesmo formato do LRU em RAM (lat,lng + settings) pra
      // facilitar replay no warm-start.
      // `cached_at` permite eviction por idade (TTL 7d) + LRU manual em
      // espaco quando passar de 200 entradas (gerenciado pelo repo).
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS osrm_cache (
          key TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          cached_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_osrm_cache_age
          ON osrm_cache (cached_at);
      `);
    },
  },
  {
    id: 9,
    name: 'create_active_route_cache',
    up: async (db) => {
      // F36.1 — Cache singleton da rota ATIVA (a que esta sendo navegada).
      // Persiste o Route OSRM completo (polyline + steps + metadata) pra
      // sobreviver kill do app. Bootstrap re-hidrata. Quando o piloto para
      // a navegacao, o singleton e limpado.
      //
      // Singleton via CHECK(id=1) + PRIMARY KEY garante AT MOST 1 row —
      // upserts targetam a mesma row em vez de inserir novas (mesmo
      // padrao do rider_profile).
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS active_route_cache (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          payload TEXT NOT NULL,
          destination TEXT,
          saved_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    id: 8,
    name: 'create_saved_trips',
    up: async (db) => {
      // F35.7 — Trips multi-dia salvas manualmente pelo piloto via
      // TripBuilderScreen. Separado de `trip_history` (rastreia EXECUCAO
      // de uma rota individual) porque saved_trips e PLANO: sequencia de
      // rota_ids prevista pra rodar no futuro.
      //
      // `rota_ids` e JSON array ORDENADO (dia 1, dia 2, ...). `notes` e
      // texto livre. `scheduled_for` epoch ms permite o lembrete pre-trip
      // (F35.8) saber quando notificar. `completed_at` so vira nao-null
      // se o piloto marcar "fiz" — sem auto-detect aqui (cada dia da
      // trip ja vira `trip_history` individual via F35.2).
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS saved_trips (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          rota_ids TEXT NOT NULL,
          pernoite_locations TEXT,
          scheduled_for INTEGER,
          notes TEXT,
          created_at INTEGER NOT NULL,
          completed_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_saved_trips_scheduled
          ON saved_trips (scheduled_for);
      `);
    },
  },
];

async function ensureMigrationsTable(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
}

export async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  await ensureMigrationsTable(db);

  const appliedRows = await db.getAllAsync<AppliedRow>(
    'SELECT id FROM schema_migrations'
  );
  const appliedIds = new Set<number>(appliedRows.map((r) => r.id));

  const pending = migrations
    .filter((m) => !appliedIds.has(m.id))
    .sort((a, b) => a.id - b.id);

  for (const migration of pending) {
    await db.withTransactionAsync(async () => {
      await migration.up(db);
      await db.runAsync(
        'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)',
        [migration.id, migration.name, Date.now()]
      );
    });
  }
}
