import * as SQLite from 'expo-sqlite';
import { initDatabase } from './sqlite';
import type {
  SavedTrip,
  SavedTripInput,
} from '@/domains/trips/types';

/**
 * F35.7 — Persistencia das trips salvas pelo piloto. Modelo simples:
 * insert / list / get / update / delete. Sem soft-delete: o builder
 * grava, o piloto deleta com "Excluir trip". Cada trip e independente.
 *
 * Note: `rota_ids` e `pernoite_locations` sao serializados como JSON.
 * O caller envia/recebe arrays ja decodificados — JSON e detalhe de
 * armazenamento.
 */

export interface SavedTripsRepository {
  create: (input: SavedTripInput, now?: number) => Promise<number>;
  list: () => Promise<SavedTrip[]>;
  getById: (id: number) => Promise<SavedTrip | null>;
  update: (id: number, input: SavedTripInput) => Promise<void>;
  markCompleted: (id: number, completedAt?: number) => Promise<void>;
  delete: (id: number) => Promise<void>;
  clear: () => Promise<void>;
}

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

function safeJsonParseArray(value: string | null | undefined): string[] {
  if (!value || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

function mapRow(row: SavedTripRow): SavedTrip {
  const trip: SavedTrip = {
    id: row.id,
    name: row.name,
    rotaIds: safeJsonParseArray(row.rota_ids),
    createdAt: row.created_at,
  };
  const pernoites = safeJsonParseArray(row.pernoite_locations);
  if (pernoites.length > 0) trip.pernoiteLocations = pernoites;
  if (row.scheduled_for !== null) trip.scheduledFor = row.scheduled_for;
  if (row.notes !== null && row.notes.length > 0) trip.notes = row.notes;
  if (row.completed_at !== null) trip.completedAt = row.completed_at;
  return trip;
}

export function createSqliteSavedTripsRepository(
  db: SQLite.SQLiteDatabase,
): SavedTripsRepository {
  return {
    create: async (input, now = Date.now()) => {
      const rotaIdsJson = JSON.stringify(input.rotaIds);
      const pernoiteJson =
        input.pernoiteLocations && input.pernoiteLocations.length > 0
          ? JSON.stringify(input.pernoiteLocations)
          : null;
      const result = await db.runAsync(
        `INSERT INTO saved_trips
           (name, rota_ids, pernoite_locations, scheduled_for, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?);`,
        [
          input.name,
          rotaIdsJson,
          pernoiteJson,
          input.scheduledFor ?? null,
          input.notes ?? null,
          now,
        ],
      );
      return result.lastInsertRowId;
    },

    list: async () => {
      const rows = await db.getAllAsync<SavedTripRow>(
        'SELECT * FROM saved_trips ORDER BY created_at DESC;',
      );
      return rows.map(mapRow);
    },

    getById: async (id) => {
      const row = await db.getFirstAsync<SavedTripRow>(
        'SELECT * FROM saved_trips WHERE id = ? LIMIT 1;',
        [id],
      );
      return row ? mapRow(row) : null;
    },

    update: async (id, input) => {
      const rotaIdsJson = JSON.stringify(input.rotaIds);
      const pernoiteJson =
        input.pernoiteLocations && input.pernoiteLocations.length > 0
          ? JSON.stringify(input.pernoiteLocations)
          : null;
      await db.runAsync(
        `UPDATE saved_trips
           SET name = ?, rota_ids = ?, pernoite_locations = ?,
               scheduled_for = ?, notes = ?
           WHERE id = ?;`,
        [
          input.name,
          rotaIdsJson,
          pernoiteJson,
          input.scheduledFor ?? null,
          input.notes ?? null,
          id,
        ],
      );
    },

    markCompleted: async (id, completedAt = Date.now()) => {
      await db.runAsync(
        'UPDATE saved_trips SET completed_at = ? WHERE id = ?;',
        [completedAt, id],
      );
    },

    delete: async (id) => {
      await db.runAsync('DELETE FROM saved_trips WHERE id = ?;', [id]);
    },

    clear: async () => {
      await db.runAsync('DELETE FROM saved_trips;');
    },
  };
}

let _singleton: SavedTripsRepository | null = null;

export async function getSavedTripsRepo(): Promise<SavedTripsRepository> {
  if (_singleton) return _singleton;
  const db = await initDatabase();
  _singleton = createSqliteSavedTripsRepository(db);
  return _singleton;
}

export function _resetSavedTripsRepoForTests(): void {
  _singleton = null;
}
