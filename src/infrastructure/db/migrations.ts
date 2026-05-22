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
