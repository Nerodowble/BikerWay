import { create } from 'zustand';
import {
  DEFAULT_COMBOIO_PREFERENCES,
  type ComboioPreferences,
} from '@/domains/comboio/preferences';
import { getComboioPreferencesRepo } from '@/infrastructure/db/comboioPreferencesRepository';

/**
 * F34.0 — Store das 6 preferências do comboio. Carregadas no boot, refletem
 * imediatamente nos consumidores (SettingsScreen UI, pin no mapa, etc).
 *
 * Persiste em fire-and-forget no SQLite — toggles não bloqueiam a UI.
 * Race possível: usuário troca 2 toggles muito rápido em paralelo, último
 * write vence (transação garante consistência por toggle).
 */

interface ComboioPreferencesState {
  preferences: ComboioPreferences;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  toggle: <K extends keyof ComboioPreferences>(key: K) => void;
  set: <K extends keyof ComboioPreferences>(
    key: K,
    value: ComboioPreferences[K],
  ) => void;
  reset: () => void;
}

export const useComboioPreferencesStore = create<ComboioPreferencesState>(
  (set, get) => ({
    preferences: { ...DEFAULT_COMBOIO_PREFERENCES },
    hydrated: false,

    hydrate: async () => {
      try {
        const repo = await getComboioPreferencesRepo();
        const loaded = await repo.load();
        set({ preferences: loaded, hydrated: true });
      } catch {
        // best-effort — defaults ja estao em memoria
        set({ hydrated: true });
      }
    },

    toggle: (key) => {
      const current = get().preferences;
      const next: ComboioPreferences = { ...current, [key]: !current[key] };
      set({ preferences: next });
      void (async () => {
        try {
          const repo = await getComboioPreferencesRepo();
          await repo.save(next);
        } catch {
          // best-effort: se falhar, em-memoria continua certo ate o
          // proximo boot. UI nao reverte automaticamente — assumimos
          // SQLite confiavel.
        }
      })();
    },

    set: (key, value) => {
      const current = get().preferences;
      if (current[key] === value) return;
      const next: ComboioPreferences = { ...current, [key]: value };
      set({ preferences: next });
      void (async () => {
        try {
          const repo = await getComboioPreferencesRepo();
          await repo.save(next);
        } catch {
          // best-effort
        }
      })();
    },

    reset: () => {
      set({ preferences: { ...DEFAULT_COMBOIO_PREFERENCES } });
      void (async () => {
        try {
          const repo = await getComboioPreferencesRepo();
          await repo.clear();
        } catch {
          // best-effort
        }
      })();
    },
  }),
);
