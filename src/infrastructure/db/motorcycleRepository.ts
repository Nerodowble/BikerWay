import * as SQLite from 'expo-sqlite';
import { Motorcycle, MotorcycleInput } from '../../domains/motorcycle/types';
import { createId } from '../../shared/utils/id';

export interface MotorcycleRepository {
  list(): Promise<Motorcycle[]>;
  getById(id: string): Promise<Motorcycle | null>;
  create(input: MotorcycleInput): Promise<Motorcycle>;
  update(id: string, input: Partial<MotorcycleInput>): Promise<Motorcycle>;
  delete(id: string): Promise<void>;
}

interface MotorcycleRow {
  id: string;
  brand: string;
  model: string;
  tank_capacity: number;
  average_consump: number;
  created_at: number;
  updated_at: number;
  owner_name: string | null;
}

const SELECT_COLUMNS =
  'id, brand, model, tank_capacity, average_consump, created_at, updated_at, owner_name';

function rowToDomain(row: MotorcycleRow): Motorcycle {
  const result: Motorcycle = {
    id: row.id,
    brand: row.brand,
    model: row.model,
    tankCapacity: row.tank_capacity,
    averageConsump: row.average_consump,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (typeof row.owner_name === 'string' && row.owner_name.length > 0) {
    result.ownerName = row.owner_name;
  }
  return result;
}

const INPUT_TO_COLUMN: Record<keyof MotorcycleInput, string> = {
  brand: 'brand',
  model: 'model',
  tankCapacity: 'tank_capacity',
  averageConsump: 'average_consump',
  ownerName: 'owner_name',
};

export function createSqliteMotorcycleRepository(
  db: SQLite.SQLiteDatabase
): MotorcycleRepository {
  return {
    async list(): Promise<Motorcycle[]> {
      const rows = await db.getAllAsync<MotorcycleRow>(
        `SELECT ${SELECT_COLUMNS} FROM motorcycles ORDER BY created_at ASC`,
      );
      return rows.map(rowToDomain);
    },

    async getById(id: string): Promise<Motorcycle | null> {
      const row = await db.getFirstAsync<MotorcycleRow>(
        `SELECT ${SELECT_COLUMNS} FROM motorcycles WHERE id = ?`,
        [id],
      );
      return row ? rowToDomain(row) : null;
    },

    async create(input: MotorcycleInput): Promise<Motorcycle> {
      const id = createId();
      const now = Date.now();
      await db.runAsync(
        'INSERT INTO motorcycles (id, brand, model, tank_capacity, average_consump, created_at, updated_at, owner_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          id,
          input.brand,
          input.model,
          input.tankCapacity,
          input.averageConsump,
          now,
          now,
          input.ownerName ?? null,
        ],
      );
      const created: Motorcycle = {
        id,
        brand: input.brand,
        model: input.model,
        tankCapacity: input.tankCapacity,
        averageConsump: input.averageConsump,
        createdAt: now,
        updatedAt: now,
      };
      if (input.ownerName) {
        created.ownerName = input.ownerName;
      }
      return created;
    },

    async update(
      id: string,
      input: Partial<MotorcycleInput>
    ): Promise<Motorcycle> {
      const setClauses: string[] = [];
      const params: Array<string | number | null> = [];

      (Object.keys(input) as Array<keyof MotorcycleInput>).forEach((key) => {
        const value = input[key];
        if (value === undefined) return;
        const column = INPUT_TO_COLUMN[key];
        setClauses.push(`${column} = ?`);
        // ownerName is the only column that may store an empty-string / null
        // sentinel from the form; everything else is a positive number / non-empty string.
        if (key === 'ownerName') {
          params.push(typeof value === 'string' && value.length > 0 ? value : null);
        } else {
          params.push(value as string | number);
        }
      });

      const now = Date.now();
      setClauses.push('updated_at = ?');
      params.push(now);
      params.push(id);

      const sql = `UPDATE motorcycles SET ${setClauses.join(', ')} WHERE id = ?`;
      const result = await db.runAsync(sql, params);

      if (result.changes === 0) {
        throw new Error('Motorcycle not found');
      }

      const updated = await db.getFirstAsync<MotorcycleRow>(
        `SELECT ${SELECT_COLUMNS} FROM motorcycles WHERE id = ?`,
        [id],
      );
      if (!updated) {
        throw new Error('Motorcycle not found');
      }
      return rowToDomain(updated);
    },

    async delete(id: string): Promise<void> {
      const result = await db.runAsync(
        'DELETE FROM motorcycles WHERE id = ?',
        [id]
      );
      if (result.changes === 0) {
        throw new Error('Motorcycle not found');
      }
    },
  };
}
