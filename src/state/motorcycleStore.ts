import { create } from 'zustand';
import { Motorcycle, MotorcycleInput } from '../domains/motorcycle/types';
import { initDatabase, openDatabase } from '../infrastructure/db/sqlite';
import {
  createSqliteMotorcycleRepository,
  MotorcycleRepository,
} from '../infrastructure/db/motorcycleRepository';

const ACTIVE_MOTO_SETTING_KEY = 'active_motorcycle_id';

interface AppSettingRow {
  value: string;
}

let repo: MotorcycleRepository | null = null;

async function getRepo(): Promise<MotorcycleRepository> {
  if (repo) return repo;
  const db = await initDatabase();
  repo = createSqliteMotorcycleRepository(db);
  return repo;
}

async function readActiveMotorcycleSetting(): Promise<string | null> {
  try {
    const db = await openDatabase();
    const row = await db.getFirstAsync<AppSettingRow>(
      'SELECT value FROM app_settings WHERE key = ?',
      [ACTIVE_MOTO_SETTING_KEY]
    );
    return row ? row.value : null;
  } catch {
    return null;
  }
}

async function writeActiveMotorcycleSetting(id: string | null): Promise<void> {
  try {
    const db = await openDatabase();
    if (id === null) {
      await db.runAsync('DELETE FROM app_settings WHERE key = ?', [
        ACTIVE_MOTO_SETTING_KEY,
      ]);
      return;
    }
    await db.runAsync(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [ACTIVE_MOTO_SETTING_KEY, id]
    );
  } catch {
    // best effort, swallow
  }
}

export interface MotorcycleStoreState {
  motorcycles: Motorcycle[];
  activeMotorcycleId: string | null;
  isHydrated: boolean;
  hydrationError: string | null;
  hydrate: () => Promise<void>;
  addMotorcycle: (input: MotorcycleInput) => Promise<Motorcycle>;
  updateMotorcycle: (
    id: string,
    input: Partial<MotorcycleInput>
  ) => Promise<void>;
  deleteMotorcycle: (id: string) => Promise<void>;
  setActiveMotorcycle: (id: string | null) => void;
}

export const useMotorcycleStore = create<MotorcycleStoreState>((set, get) => ({
  motorcycles: [],
  activeMotorcycleId: null,
  isHydrated: false,
  hydrationError: null,

  hydrate: async () => {
    try {
      const r = await getRepo();
      const list = await r.list();
      const persistedActive = await readActiveMotorcycleSetting();
      const activeId =
        persistedActive && list.some((m) => m.id === persistedActive)
          ? persistedActive
          : list[0]?.id ?? null;
      set({
        motorcycles: list,
        activeMotorcycleId: activeId,
        hydrationError: null,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown hydration error';
      set({
        motorcycles: [],
        activeMotorcycleId: null,
        hydrationError: message,
      });
    } finally {
      // Always mark as hydrated regardless of success/failure so the rest of
      // the app can proceed instead of staying stuck on a loading screen.
      set({ isHydrated: true });
    }
  },

  addMotorcycle: async (input) => {
    if (!get().isHydrated) {
      await get().hydrate();
    }
    const r = await getRepo();
    const created = await r.create(input);
    const next = [...get().motorcycles, created];
    const activeId = get().activeMotorcycleId ?? created.id;
    set({ motorcycles: next, activeMotorcycleId: activeId });
    if (activeId === created.id) {
      void writeActiveMotorcycleSetting(activeId);
    }
    return created;
  },

  updateMotorcycle: async (id, input) => {
    if (!get().isHydrated) {
      await get().hydrate();
    }
    const r = await getRepo();
    const updated = await r.update(id, input);
    const next = get().motorcycles.map((m) => (m.id === id ? updated : m));
    set({ motorcycles: next });
  },

  deleteMotorcycle: async (id) => {
    if (!get().isHydrated) {
      await get().hydrate();
    }
    const r = await getRepo();
    await r.delete(id);
    const next = get().motorcycles.filter((m) => m.id !== id);
    let activeId = get().activeMotorcycleId;
    if (activeId === id) {
      activeId = next[0]?.id ?? null;
      void writeActiveMotorcycleSetting(activeId);
    }
    set({ motorcycles: next, activeMotorcycleId: activeId });
  },

  setActiveMotorcycle: (id) => {
    set({ activeMotorcycleId: id });
    void writeActiveMotorcycleSetting(id);
  },
}));

export function selectActiveMotorcycle(
  s: MotorcycleStoreState
): Motorcycle | null {
  if (!s.activeMotorcycleId) return null;
  return s.motorcycles.find((m) => m.id === s.activeMotorcycleId) ?? null;
}
