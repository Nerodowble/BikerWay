import {
  _resetWhisperTransportForTests,
} from '@/infrastructure/whisper/transport';
import {
  selectReportsForRota,
  useWhisperStore,
} from '@/state/whisperStore';

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 10));
}

describe('whisperStore', () => {
  beforeEach(() => {
    _resetWhisperTransportForTests();
    useWhisperStore.setState({
      joinedRotaIds: new Set<string>(),
      reportsByRota: {},
      alias: '@piloto',
    });
  });

  it('joinRoute marca rotaId como ativa (idempotente)', async () => {
    await useWhisperStore.getState().joinRoute('rota-x');
    await useWhisperStore.getState().joinRoute('rota-x');
    expect(useWhisperStore.getState().joinedRotaIds.has('rota-x')).toBe(true);
  });

  it('publish cria report localmente + popula state', async () => {
    await useWhisperStore.getState().joinRoute('rota-x');
    const result = await useWhisperStore.getState().publish({
      rotaId: 'rota-x',
      kind: 'neblina',
      latitude: -23.5,
      longitude: -46.5,
    });
    expect(result.ok).toBe(true);
    await flush();
    const state = useWhisperStore.getState();
    const reports = selectReportsForRota(state, 'rota-x');
    expect(reports).toHaveLength(1);
    expect(reports[0]?.kind).toBe('neblina');
  });

  it('publish de OUTRO kind imediatamente apos o primeiro e permitido (sem cooldown global)', async () => {
    await useWhisperStore.getState().joinRoute('rota-x');
    const first = await useWhisperStore.getState().publish({
      rotaId: 'rota-x',
      kind: 'neblina',
      latitude: -23.5,
      longitude: -46.5,
    });
    expect(first.ok).toBe(true);
    const second = await useWhisperStore.getState().publish({
      rotaId: 'rota-x',
      kind: 'chuva', // DIFERENTE kind, mesmo lugar — permitido
      latitude: -23.5,
      longitude: -46.5,
    });
    expect(second.ok).toBe(true);
  });

  it('publish de MESMO kind em local diferente (>1km) e permitido', async () => {
    await useWhisperStore.getState().joinRoute('rota-x');
    const first = await useWhisperStore.getState().publish({
      rotaId: 'rota-x',
      kind: 'buraco_brita',
      latitude: -23.5,
      longitude: -46.5,
    });
    expect(first.ok).toBe(true);
    const second = await useWhisperStore.getState().publish({
      rotaId: 'rota-x',
      kind: 'buraco_brita',
      latitude: -23.515, // ~1.6km de distancia
      longitude: -46.5,
    });
    expect(second.ok).toBe(true);
  });

  it('dedup: mesmo kind + mesmo lugar (<1km) + ate 30min e bloqueado', async () => {
    await useWhisperStore.getState().joinRoute('rota-x');
    await useWhisperStore.getState().publish({
      rotaId: 'rota-x',
      kind: 'neblina',
      latitude: -23.5,
      longitude: -46.5,
    });
    const dup = await useWhisperStore.getState().publish({
      rotaId: 'rota-x',
      kind: 'neblina',
      latitude: -23.5001, // ~10m, dentro do raio
      longitude: -46.5,
    });
    expect(dup.ok).toBe(false);
    expect((dup as { reason: string }).reason).toBe('duplicate');
  });

  it('leaveRoute remove a rota do state', async () => {
    await useWhisperStore.getState().joinRoute('rota-x');
    await useWhisperStore.getState().publish({
      rotaId: 'rota-x',
      kind: 'neblina',
      latitude: -23.5,
      longitude: -46.5,
    });
    await useWhisperStore.getState().leaveRoute('rota-x');
    const state = useWhisperStore.getState();
    expect(state.joinedRotaIds.has('rota-x')).toBe(false);
    expect(state.reportsByRota['rota-x']).toBeUndefined();
  });

  it('setAlias trunca e respeita default em vazio', () => {
    useWhisperStore.getState().setAlias('   ');
    expect(useWhisperStore.getState().alias).toBe('@piloto');
    useWhisperStore.getState().setAlias('a'.repeat(50));
    expect(useWhisperStore.getState().alias.length).toBe(20);
  });

  it('selectReportsForRota retorna referencia ESTAVEL pra rota sem entry', () => {
    // Sem isso, `... ?? []` literal causaria loop infinito no React.
    const a = selectReportsForRota(useWhisperStore.getState(), 'inexistente');
    const b = selectReportsForRota(useWhisperStore.getState(), 'inexistente');
    expect(a).toBe(b);
  });
});
