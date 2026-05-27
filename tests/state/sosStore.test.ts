// Mocks vem ANTES de importar o store, pq o store faz lazy require do
// repo via initDatabase() na primeira chamada de cancel/hydrate. Mantemos
// um fake DB em memoria com `cancels: number[]` que emula as 3 queries
// que sosAbuseRepository usa.
const mockCancels: number[] = [];

jest.mock('@/infrastructure/db/sqlite', () => ({
  initDatabase: async () => ({
    runAsync: async (
      sql: string,
      params: Array<string | number | null>,
    ): Promise<void> => {
      if (sql.startsWith('INSERT INTO sos_cancel_history')) {
        mockCancels.push(params[0] as number);
      } else if (sql.startsWith('DELETE FROM sos_cancel_history WHERE cancelled_at')) {
        const cutoff = params[0] as number;
        for (let i = mockCancels.length - 1; i >= 0; i -= 1) {
          const v = mockCancels[i];
          if (v !== undefined && v < cutoff) mockCancels.splice(i, 1);
        }
      } else if (sql.startsWith('DELETE FROM sos_cancel_history')) {
        mockCancels.length = 0;
      } else {
        throw new Error(`Unexpected SQL in sosStore test: ${sql}`);
      }
    },
    getAllAsync: async (
      sql: string,
      params: Array<string | number | null>,
    ): Promise<Array<{ cancelled_at: number }>> => {
      if (sql.startsWith('SELECT cancelled_at FROM sos_cancel_history')) {
        const cutoff = params[0] as number;
        return mockCancels
          .filter((v) => v > cutoff)
          .sort((a, b) => b - a)
          .map((cancelled_at) => ({ cancelled_at }));
      }
      throw new Error(`Unexpected SQL in sosStore test: ${sql}`);
    },
  }),
}));

import {
  useSOSStore,
  _resetSosAbuseRepoForTests,
  selectAbuseStatus,
} from '@/state/sosStore';

async function flushAsync(): Promise<void> {
  // Espera o microtask do void getRepo().recordCancel() em cancel() resolver
  await new Promise((r) => setTimeout(r, 0));
}

describe('sosStore', () => {
  beforeEach(() => {
    mockCancels.length = 0;
    _resetSosAbuseRepoForTests();
    useSOSStore.setState({ current: null, history: [], recentCancels: [] });
  });

  it('cria alerta open ao disparar fire()', () => {
    const { alert, abuseBlocked } = useSOSStore.getState().fire({
      problemType: 'pneu_furado',
      latitude: -23.5,
      longitude: -46.6,
    });
    expect(abuseBlocked).toBe(false);
    expect(alert).not.toBeNull();
    expect(alert?.status).toBe('open');
    expect(alert?.problem_type).toBe('pneu_furado');
    expect(useSOSStore.getState().current?.id).toBe(alert?.id);
  });

  it('grava mensagem opcional quando fornecida', () => {
    const { alert } = useSOSStore.getState().fire({
      problemType: 'pane_mecanica',
      latitude: -23.5,
      longitude: -46.6,
      message: 'Sem ferramentas',
    });
    expect(alert?.message).toBe('Sem ferramentas');
  });

  it('descarta mensagem vazia ou so com espaco', () => {
    const { alert } = useSOSStore.getState().fire({
      problemType: 'pane_eletrica',
      latitude: -23.5,
      longitude: -46.6,
      message: '   ',
    });
    expect(alert?.message).toBeUndefined();
  });

  it('move alerta para historico ao cancelar', async () => {
    const { alert } = useSOSStore.getState().fire({
      problemType: 'pneu_furado',
      latitude: -23.5,
      longitude: -46.6,
    });
    useSOSStore.getState().cancel();
    await flushAsync();
    const state = useSOSStore.getState();
    expect(state.current).toBeNull();
    expect(state.history).toHaveLength(1);
    expect(state.history[0]?.id).toBe(alert?.id);
    expect(state.history[0]?.status).toBe('cancelled');
  });

  it('marca como resolved quando markResolved e chamado', () => {
    useSOSStore.getState().fire({
      problemType: 'saude',
      latitude: -23.5,
      longitude: -46.6,
    });
    useSOSStore.getState().markResolved();
    expect(useSOSStore.getState().current).toBeNull();
    expect(useSOSStore.getState().history[0]?.status).toBe('resolved');
  });

  it('e idempotente ao cancelar com nenhum alerta aberto', () => {
    useSOSStore.getState().cancel();
    expect(useSOSStore.getState().current).toBeNull();
    expect(useSOSStore.getState().history).toHaveLength(0);
    expect(useSOSStore.getState().recentCancels).toHaveLength(0);
  });

  it('limita historico em memoria a 50 entradas mais recentes (via markResolved)', () => {
    // Usamos markResolved pra evitar a trava do anti-abuso (cancel limita
    // o disparo apos 3 cancels em 7d). Aqui interessa so o cap do array.
    for (let i = 0; i < 55; i += 1) {
      useSOSStore.getState().fire({
        problemType: 'pneu_furado',
        latitude: -23.5,
        longitude: -46.6,
      });
      useSOSStore.getState().markResolved();
    }
    expect(useSOSStore.getState().history.length).toBe(50);
  });

  it('disparar SOS enquanto outro aberto sobrescreve current sem mover pro historico', () => {
    const first = useSOSStore.getState().fire({
      problemType: 'pneu_furado',
      latitude: -23.5,
      longitude: -46.6,
    });
    const second = useSOSStore.getState().fire({
      problemType: 'pane_mecanica',
      latitude: -23.5,
      longitude: -46.6,
    });
    const state = useSOSStore.getState();
    expect(state.current?.id).toBe(second.alert?.id);
    expect(state.current?.id).not.toBe(first.alert?.id);
    expect(state.history).toHaveLength(0);
  });
});

describe('sosStore anti-abuso (F29.4)', () => {
  beforeEach(() => {
    mockCancels.length = 0;
    _resetSosAbuseRepoForTests();
    useSOSStore.setState({ current: null, history: [], recentCancels: [] });
  });

  it('bloqueia fire() apos 3 cancels em 7 dias', async () => {
    for (let i = 0; i < 3; i += 1) {
      useSOSStore.getState().fire({
        problemType: 'pneu_furado',
        latitude: -23.5,
        longitude: -46.6,
      });
      useSOSStore.getState().cancel();
      await flushAsync();
    }
    const result = useSOSStore.getState().fire({
      problemType: 'pneu_furado',
      latitude: -23.5,
      longitude: -46.6,
    });
    expect(result.abuseBlocked).toBe(true);
    expect(result.alert).toBeNull();
    expect(useSOSStore.getState().current).toBeNull();
  });

  it('permite disparar normalmente com menos de 3 cancels', async () => {
    for (let i = 0; i < 2; i += 1) {
      useSOSStore.getState().fire({
        problemType: 'pneu_furado',
        latitude: -23.5,
        longitude: -46.6,
      });
      useSOSStore.getState().cancel();
      await flushAsync();
    }
    const result = useSOSStore.getState().fire({
      problemType: 'pneu_furado',
      latitude: -23.5,
      longitude: -46.6,
    });
    expect(result.abuseBlocked).toBe(false);
    expect(result.alert).not.toBeNull();
  });

  it('selectAbuseStatus reflete a contagem em janela de 7d', () => {
    const now = 1_700_000_000_000;
    useSOSStore.setState({
      recentCancels: [now - 1000, now - 2000, now - 3000],
    });
    const status = selectAbuseStatus(useSOSStore.getState(), now);
    expect(status.locked).toBe(true);
    expect(status.cancelsLast7d).toBe(3);
    expect(status.unlockAt).toBe(now - 1000 + 24 * 60 * 60 * 1000);
  });

  it('selectAbuseStatus ignora cancels mais antigos que 7 dias', () => {
    const now = 1_700_000_000_000;
    const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
    useSOSStore.setState({
      recentCancels: [eightDaysAgo, eightDaysAgo - 1, eightDaysAgo - 2],
    });
    const status = selectAbuseStatus(useSOSStore.getState(), now);
    expect(status.locked).toBe(false);
    expect(status.cancelsLast7d).toBe(0);
  });

  it('hydrateAbuseHistory carrega timestamps do SQLite', async () => {
    mockCancels.push(Date.now() - 1000, Date.now() - 2000);
    await useSOSStore.getState().hydrateAbuseHistory();
    expect(useSOSStore.getState().recentCancels).toHaveLength(2);
  });

  it('cancel adiciona timestamp em recentCancels e persiste', async () => {
    useSOSStore.getState().fire({
      problemType: 'pneu_furado',
      latitude: -23.5,
      longitude: -46.6,
    });
    useSOSStore.getState().cancel();
    expect(useSOSStore.getState().recentCancels).toHaveLength(1);
    await flushAsync();
    expect(mockCancels).toHaveLength(1);
  });

  it('markResolved NAO conta como abuso (nao registra em recentCancels)', () => {
    useSOSStore.getState().fire({
      problemType: 'saude',
      latitude: -23.5,
      longitude: -46.6,
    });
    useSOSStore.getState().markResolved();
    expect(useSOSStore.getState().recentCancels).toHaveLength(0);
  });
});
