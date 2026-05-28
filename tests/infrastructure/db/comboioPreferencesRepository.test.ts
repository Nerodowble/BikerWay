import {
  createSqliteComboioPreferencesRepository,
  type ComboioPreferencesRepository,
} from '@/infrastructure/db/comboioPreferencesRepository';
import { DEFAULT_COMBOIO_PREFERENCES } from '@/domains/comboio/preferences';

interface AppSettingRow {
  key: string;
  value: string;
}

function makeFakeDb(): {
  db: Parameters<typeof createSqliteComboioPreferencesRepository>[0];
  rows: AppSettingRow[];
} {
  const rows: AppSettingRow[] = [];
  const db = {
    runAsync: async (
      sql: string,
      params: Array<string | number | null>,
    ): Promise<{ lastInsertRowId: number; changes: number }> => {
      if (sql.startsWith('INSERT INTO app_settings')) {
        const key = params[0] as string;
        const value = params[1] as string;
        const existing = rows.find((r) => r.key === key);
        if (existing) existing.value = value;
        else rows.push({ key, value });
        return { lastInsertRowId: 0, changes: 1 };
      }
      if (sql.startsWith('DELETE FROM app_settings')) {
        const keys = (params as string[]).map((s) => String(s));
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (keys.includes(rows[i]?.key ?? '')) rows.splice(i, 1);
        }
        return { lastInsertRowId: 0, changes: keys.length };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    getAllAsync: async <T>(
      sql: string,
      params: Array<string | number | null>,
    ): Promise<T[]> => {
      if (sql.startsWith('SELECT key, value FROM app_settings')) {
        const keys = (params as string[]).map((s) => String(s));
        return rows.filter((r) => keys.includes(r.key)) as unknown as T[];
      }
      throw new Error(`Unexpected getAllAsync: ${sql}`);
    },
    withTransactionAsync: async (fn: () => Promise<void>): Promise<void> => {
      await fn();
    },
    execAsync: async (): Promise<void> => undefined,
  } as unknown as Parameters<
    typeof createSqliteComboioPreferencesRepository
  >[0];
  return { db, rows };
}

describe('comboioPreferencesRepository', () => {
  let repo: ComboioPreferencesRepository;
  let fake: ReturnType<typeof makeFakeDb>;

  beforeEach(() => {
    fake = makeFakeDb();
    repo = createSqliteComboioPreferencesRepository(fake.db);
  });

  it('load retorna defaults quando SQLite esta vazio', async () => {
    const prefs = await repo.load();
    expect(prefs).toEqual(DEFAULT_COMBOIO_PREFERENCES);
  });

  it('save + load round-trip preserva flags', async () => {
    await repo.save({
      ...DEFAULT_COMBOIO_PREFERENCES,
      recordReplay: true,
      showSpeedOnPin: true,
    });
    const prefs = await repo.load();
    expect(prefs.recordReplay).toBe(true);
    expect(prefs.showSpeedOnPin).toBe(true);
    expect(prefs.highlightStopped).toBe(true); // default mantido
  });

  it('save sobrescreve valores existentes', async () => {
    await repo.save({ ...DEFAULT_COMBOIO_PREFERENCES, recordReplay: true });
    await repo.save({ ...DEFAULT_COMBOIO_PREFERENCES, recordReplay: false });
    const prefs = await repo.load();
    expect(prefs.recordReplay).toBe(false);
  });

  it('clear apaga todas as 6 keys', async () => {
    await repo.save({
      ...DEFAULT_COMBOIO_PREFERENCES,
      recordReplay: true,
      showSpeedOnPin: true,
    });
    await repo.clear();
    expect(fake.rows).toHaveLength(0);
    const prefs = await repo.load();
    expect(prefs).toEqual(DEFAULT_COMBOIO_PREFERENCES);
  });
});
