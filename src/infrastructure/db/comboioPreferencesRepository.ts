import * as SQLite from 'expo-sqlite';
import { initDatabase } from './sqlite';
import {
  COMBOIO_PREF_KEYS,
  DEFAULT_COMBOIO_PREFERENCES,
  parseBoolPref,
  type ComboioPreferences,
} from '@/domains/comboio/preferences';

/**
 * F34.0 — Persistência das preferências do comboio. Usa a tabela
 * `app_settings` existente (key-value) — sem migration nova. Cada toggle
 * vira UMA row tipo `comboio.recordReplay → "true"/"false"`.
 *
 * Set único: sobrescreve tudo de uma vez (idempotente). Get retorna o
 * objeto inteiro com defaults aplicados pra keys ausentes.
 */

export interface ComboioPreferencesRepository {
  /** Lê todas as 6 preferências. Keys ausentes caem nos defaults. */
  load: () => Promise<ComboioPreferences>;
  /** Persiste TODAS as 6 (sobrescreve). Usar em conjunto com get pra
   *  patches: `await set({ ...current, recordReplay: true })`. */
  save: (prefs: ComboioPreferences) => Promise<void>;
  /** Apaga as 6 chaves. Resetar pra defaults sem rebootar. */
  clear: () => Promise<void>;
}

interface AppSettingRow {
  value: string;
}

export function createSqliteComboioPreferencesRepository(
  db: SQLite.SQLiteDatabase,
): ComboioPreferencesRepository {
  return {
    load: async () => {
      // Le todas as keys em uma só pegada (mais simples que 6 queries).
      const keysArr = Object.values(COMBOIO_PREF_KEYS);
      const placeholders = keysArr.map(() => '?').join(',');
      const rows = await db.getAllAsync<AppSettingRow & { key: string }>(
        `SELECT key, value FROM app_settings WHERE key IN (${placeholders});`,
        keysArr,
      );
      const byKey = new Map<string, string>();
      for (const r of rows) byKey.set(r.key, r.value);
      const out: ComboioPreferences = { ...DEFAULT_COMBOIO_PREFERENCES };
      (
        Object.entries(COMBOIO_PREF_KEYS) as Array<
          [keyof ComboioPreferences, string]
        >
      ).forEach(([prefKey, sqlKey]) => {
        const raw = byKey.get(sqlKey);
        out[prefKey] = parseBoolPref(raw, DEFAULT_COMBOIO_PREFERENCES[prefKey]);
      });
      return out;
    },
    save: async (prefs) => {
      // UPSERT cada key. Em transação pra consistência (não queremos
      // 4 das 6 persistidas se uma falhar).
      await db.withTransactionAsync(async () => {
        for (const [prefKey, sqlKey] of Object.entries(COMBOIO_PREF_KEYS) as Array<
          [keyof ComboioPreferences, string]
        >) {
          const valueStr = prefs[prefKey] ? 'true' : 'false';
          await db.runAsync(
            `INSERT INTO app_settings (key, value) VALUES (?, ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
            [sqlKey, valueStr],
          );
        }
      });
    },
    clear: async () => {
      const keysArr = Object.values(COMBOIO_PREF_KEYS);
      const placeholders = keysArr.map(() => '?').join(',');
      await db.runAsync(
        `DELETE FROM app_settings WHERE key IN (${placeholders});`,
        keysArr,
      );
    },
  };
}

let _singleton: ComboioPreferencesRepository | null = null;

export async function getComboioPreferencesRepo(): Promise<ComboioPreferencesRepository> {
  if (_singleton) return _singleton;
  const db = await initDatabase();
  _singleton = createSqliteComboioPreferencesRepository(db);
  return _singleton;
}

export function _resetComboioPreferencesRepoForTests(): void {
  _singleton = null;
}
