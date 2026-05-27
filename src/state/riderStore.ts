import { create } from 'zustand';
import type {
  RiderProfile,
  RiderProfileInput,
} from '../domains/rider/types';
import { initDatabase } from '../infrastructure/db/sqlite';
import {
  createSqliteRiderRepository,
  type RiderRepository,
} from '../infrastructure/db/riderRepository';

// Singleton repo cache — initDatabase() is idempotent but we still avoid the
// round-trip on every call. Mirrors the pattern in motorcycleStore.
let repo: RiderRepository | null = null;

async function getRepo(): Promise<RiderRepository> {
  if (repo) return repo;
  const db = await initDatabase();
  repo = createSqliteRiderRepository(db);
  return repo;
}

export interface RiderStoreState {
  /** null when the user has not saved a profile yet. */
  profile: RiderProfile | null;
  isLoading: boolean;
  isHydrated: boolean;
  hydrationError: string | null;
  /** Upsert the rider profile. Resolves to the saved record. */
  saveProfile: (input: RiderProfileInput) => Promise<RiderProfile>;
  /** Reads from SQLite and replaces in-memory profile. */
  loadProfile: () => Promise<void>;
  /** Clears the rider profile (used on logout/reset flows). */
  clearProfile: () => Promise<void>;
}

// EXPOSED for tests: reset the cached repository so a `jest.mock` of
// `@/infrastructure/db/sqlite` is picked up between test files.
export function _resetRiderRepoForTests(): void {
  repo = null;
}

export const useRiderStore = create<RiderStoreState>((set) => ({
  profile: null,
  isLoading: false,
  isHydrated: false,
  hydrationError: null,

  loadProfile: async () => {
    set({ isLoading: true });
    try {
      const r = await getRepo();
      const loaded = await r.get();
      set({
        profile: loaded,
        hydrationError: null,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown rider load error';
      set({ hydrationError: message });
    } finally {
      // Always settle so subscribers waiting on hydration can proceed even
      // when SQLite is unhappy (e.g. fresh install before migrations land).
      set({ isLoading: false, isHydrated: true });
    }
  },

  saveProfile: async (input) => {
    set({ isLoading: true });
    try {
      const r = await getRepo();
      const saved = await r.save(input);
      set({ profile: saved, hydrationError: null });
      return saved;
    } finally {
      set({ isLoading: false, isHydrated: true });
    }
  },

  clearProfile: async () => {
    set({ isLoading: true });
    try {
      const r = await getRepo();
      await r.clear();
      set({ profile: null });
    } finally {
      set({ isLoading: false });
    }
  },
}));

/** Selector helper for callers that only need the city+state combo. */
export function selectRiderCityState(s: RiderStoreState): string | null {
  if (!s.profile) return null;
  const { cidade, estado } = s.profile;
  if (!cidade || !estado) return null;
  return `${cidade}, ${estado}`;
}
