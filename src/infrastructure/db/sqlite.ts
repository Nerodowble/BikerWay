import * as SQLite from 'expo-sqlite';

import { runMigrations } from './migrations';

export const DB_NAME = 'bikerway.db';

let _db: SQLite.SQLiteDatabase | null = null;

export async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync(DB_NAME);
  await _db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return _db;
}

export async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  const db = await openDatabase();
  await runMigrations(db);
  return db;
}

export function _resetDatabaseForTests(): void {
  _db = null;
}
