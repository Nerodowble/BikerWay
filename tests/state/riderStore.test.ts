// Mock the sqlite module BEFORE importing the store so the repo cache picks
// up the fake DB. The store does its own lazy `initDatabase()` so the fake
// here just needs to satisfy the createSqliteRiderRepository surface.
//
// We back the fake DB with an in-memory object that emulates the row stored
// by the singleton table — this lets us exercise the real repo code (which
// does the rowToDomain mapping) instead of stubbing the whole repository out.

type Row = {
  id: string;
  display_name: string;
  cidade: string;
  estado: string;
  anos_pilotando: number | null;
  genero: string | null;
  estilo_pilotagem: string | null;
  preferencia_tempo: string | null;
  bio: string | null;
  avatar_uri: string | null;
  created_at: number;
  updated_at: number;
};

let mockFakeRow: Row | null = null;

jest.mock('@/infrastructure/db/sqlite', () => ({
  initDatabase: async () => ({
    runAsync: async (
      sql: string,
      params: Array<string | number | null>,
    ): Promise<void> => {
      // Only the two writes the repo issues matter: the INSERT...ON CONFLICT
      // upsert and the DELETE-where-singleton. Anything else is a programmer
      // error the test should surface.
      if (sql.startsWith('INSERT INTO rider_profile')) {
        // F32: schema ganhou avatar_uri (param index 9); createdAt e
        // updatedAt deslocaram pra 10 e 11.
        const [
          id,
          displayName,
          cidade,
          estado,
          anosPilotando,
          genero,
          estilo,
          preferencia,
          bio,
          avatarUri,
          createdAt,
          updatedAt,
        ] = params;
        mockFakeRow = {
          id: id as string,
          display_name: displayName as string,
          cidade: cidade as string,
          estado: estado as string,
          anos_pilotando:
            typeof anosPilotando === 'number' ? anosPilotando : null,
          genero: typeof genero === 'string' ? genero : null,
          estilo_pilotagem: typeof estilo === 'string' ? estilo : null,
          preferencia_tempo:
            typeof preferencia === 'string' ? preferencia : null,
          bio: typeof bio === 'string' ? bio : null,
          avatar_uri: typeof avatarUri === 'string' ? avatarUri : null,
          created_at: createdAt as number,
          updated_at: updatedAt as number,
        };
        return;
      }
      if (sql.startsWith('DELETE FROM rider_profile')) {
        mockFakeRow = null;
        return;
      }
      throw new Error(`Unhandled SQL in fake DB: ${sql}`);
    },
    getFirstAsync: async (sql: string): Promise<Row | null> => {
      if (sql.startsWith('SELECT')) {
        return mockFakeRow;
      }
      throw new Error(`Unhandled SELECT in fake DB: ${sql}`);
    },
    getAllAsync: async () => [],
    execAsync: async () => {},
    withTransactionAsync: async (fn: () => Promise<void>) => {
      await fn();
    },
  }),
  openDatabase: async () => {
    throw new Error('openDatabase should not be called by riderStore');
  },
}));

import {
  _resetRiderRepoForTests,
  useRiderStore,
} from '../../src/state/riderStore';

function resetStore(): void {
  useRiderStore.setState({
    profile: null,
    isLoading: false,
    isHydrated: false,
    hydrationError: null,
  });
}

beforeEach(() => {
  mockFakeRow = null;
  resetStore();
  _resetRiderRepoForTests();
});

describe('riderStore', () => {
  it('loadProfile returns null when no row exists yet', async () => {
    await useRiderStore.getState().loadProfile();
    const state = useRiderStore.getState();
    expect(state.profile).toBeNull();
    expect(state.isHydrated).toBe(true);
    expect(state.hydrationError).toBeNull();
  });

  it('saveProfile inserts the singleton and exposes it through the store', async () => {
    const saved = await useRiderStore.getState().saveProfile({
      displayName: 'Willian',
      cidade: 'Diadema',
      estado: 'SP',
      anosPilotando: 4,
      genero: 'masculino',
      estiloPilotagem: 'urbano',
    });

    expect(saved.displayName).toBe('Willian');
    expect(saved.cidade).toBe('Diadema');
    expect(saved.estado).toBe('SP');
    expect(saved.anosPilotando).toBe(4);
    expect(saved.genero).toBe('masculino');
    expect(saved.estiloPilotagem).toBe('urbano');
    // Bio was not provided so the domain field must be absent.
    expect(saved.bio).toBeUndefined();

    const stored = useRiderStore.getState().profile;
    expect(stored).not.toBeNull();
    expect(stored?.displayName).toBe('Willian');
  });

  it('saveProfile preserves the id+createdAt across subsequent upserts', async () => {
    const first = await useRiderStore.getState().saveProfile({
      displayName: 'Willian',
      cidade: 'Diadema',
      estado: 'SP',
    });
    const firstId = first.id;
    const firstCreatedAt = first.createdAt;

    // Force the wall-clock forward so updated_at deltas are observable.
    const realNow = Date.now;
    jest.spyOn(Date, 'now').mockReturnValue(realNow() + 5_000);

    const second = await useRiderStore.getState().saveProfile({
      displayName: 'Will',
      cidade: 'Sao Paulo',
      estado: 'SP',
    });

    expect(second.id).toBe(firstId);
    expect(second.createdAt).toBe(firstCreatedAt);
    expect(second.updatedAt).toBeGreaterThanOrEqual(firstCreatedAt);
    expect(second.displayName).toBe('Will');

    jest.restoreAllMocks();
  });

  it('loadProfile rehydrates the same record that saveProfile wrote', async () => {
    await useRiderStore.getState().saveProfile({
      displayName: 'Willian',
      cidade: 'Diadema',
      estado: 'SP',
      bio: 'Rodando muito',
    });

    // Simulate a cold start: blow away in-memory state then re-load. The
    // singleton SQLite row should resurrect the same profile.
    resetStore();
    expect(useRiderStore.getState().profile).toBeNull();

    await useRiderStore.getState().loadProfile();
    const reloaded = useRiderStore.getState().profile;
    expect(reloaded).not.toBeNull();
    expect(reloaded?.displayName).toBe('Willian');
    expect(reloaded?.bio).toBe('Rodando muito');
  });

  it('clearProfile removes the singleton row', async () => {
    await useRiderStore.getState().saveProfile({
      displayName: 'Willian',
      cidade: 'Diadema',
      estado: 'SP',
    });
    expect(useRiderStore.getState().profile).not.toBeNull();

    await useRiderStore.getState().clearProfile();
    expect(useRiderStore.getState().profile).toBeNull();

    // And a subsequent load returns null (the row really is gone, not just
    // cleared from memory).
    await useRiderStore.getState().loadProfile();
    expect(useRiderStore.getState().profile).toBeNull();
  });
});
