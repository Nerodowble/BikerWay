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
