import {
  __resetCatalogCacheForTests,
  loadCatalog,
} from '../../../src/infrastructure/catalog/catalogClient';

describe('loadCatalog', () => {
  beforeEach(() => {
    __resetCatalogCacheForTests();
  });

  it('returns a non-empty array of validated routes from the bundled JSON', () => {
    const routes = loadCatalog();
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      expect(typeof r.rota_id).toBe('string');
      expect(typeof r.nome_rota).toBe('string');
      expect(Number.isFinite(r.coordenada_inicio.latitude)).toBe(true);
      expect(Number.isFinite(r.coordenada_inicio.longitude)).toBe(true);
      expect(['asfalto', 'misto', 'terra']).toContain(
        r.caracteristicas.tipo_pavimento,
      );
      expect(['baixo', 'medio', 'alto']).toContain(
        r.caracteristicas.nivel_curvas,
      );
      expect(Array.isArray(r.polilinha_simplificada)).toBe(true);
    }
  });

  it('caches the result across calls (same array reference)', () => {
    const a = loadCatalog();
    const b = loadCatalog();
    expect(a).toBe(b);
  });

  it('exposes curated optional metadata when the route ships it', () => {
    // The bundled JSON enriches at least one route with the F21.1 optional
    // fields (ultima_revisao + confiabilidade + dificuldade + descricao). If
    // this assertion fails, either the JSON was reset to bare-bones or the
    // client started dropping valid optionals — both are regressions.
    const routes = loadCatalog();
    const enriched = routes.find(
      (r) =>
        r.ultima_revisao !== undefined &&
        r.confiabilidade !== undefined &&
        r.dificuldade !== undefined,
    );
    expect(enriched).toBeDefined();
    if (!enriched) return;
    expect(['alta', 'media', 'baixa']).toContain(enriched.confiabilidade);
    expect(['iniciante', 'intermediario', 'avancado']).toContain(
      enriched.dificuldade,
    );
    expect(enriched.ultima_revisao).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('leaves routes without curated optionals untouched (graceful)', () => {
    // The bundled JSON also has older routes that pre-date the framework.
    // They must keep loading with the optionals undefined.
    const routes = loadCatalog();
    const bare = routes.find(
      (r) =>
        r.ultima_revisao === undefined &&
        r.confiabilidade === undefined &&
        r.dificuldade === undefined,
    );
    expect(bare).toBeDefined();
    if (!bare) return;
    // Required fields still populated — graceful degradation only affects
    // the optional curated metadata.
    expect(typeof bare.rota_id).toBe('string');
    expect(typeof bare.distancia_total_km).toBe('number');
  });
});

// Separate suite for the "ignore-malformed-optionals" behavior. We mock the
// bundled JSON via `jest.doMock` because the validation paths under test only
// fire on a freshly-required module — hence the dynamic `require` after the
// mock is registered.
describe('loadCatalog - graceful optional-field validation', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  function buildRoute(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      rota_id: 'test-route-sp',
      nome_rota: 'Test Route',
      estado_pais: 'SP, Brasil',
      coordenada_inicio: { cidade: 'A', latitude: -23.5, longitude: -46.6 },
      coordenada_fim: { cidade: 'B', latitude: -23.6, longitude: -46.7 },
      distancia_total_km: 50,
      total_pedagios_moto_reais: 0,
      caracteristicas: {
        tipo_pavimento: 'asfalto',
        nivel_curvas: 'medio',
        trecho_critico_sem_posto_km: 10,
      },
      interconexoes_ids: [],
      pontos_apoio_homologados: [],
      polilinha_simplificada: [],
      ...overrides,
    };
  }

  it('accepts a route with all valid optional fields', () => {
    jest.doMock('../../../src/infrastructure/catalog/routes.json', () => [
      buildRoute({
        ultima_revisao: '2026-05-22',
        confiabilidade: 'alta',
        dificuldade: 'intermediario',
        melhor_epoca: 'Marco a outubro',
        descricao_biker: 'Texto narrativo da rota',
        fontes_dados: ['https://example.com'],
        dicas_seguranca: ['Cuidado com neblina'],
      }),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../../../src/infrastructure/catalog/catalogClient');
    const routes = mod.loadCatalog();
    expect(routes).toHaveLength(1);
    expect(routes[0].ultima_revisao).toBe('2026-05-22');
    expect(routes[0].confiabilidade).toBe('alta');
    expect(routes[0].dificuldade).toBe('intermediario');
    expect(routes[0].melhor_epoca).toBe('Marco a outubro');
    expect(routes[0].descricao_biker).toBe('Texto narrativo da rota');
    expect(routes[0].fontes_dados).toEqual(['https://example.com']);
    expect(routes[0].dicas_seguranca).toEqual(['Cuidado com neblina']);
  });

  it('drops a route with an unknown confiabilidade value but keeps the rest', () => {
    // Silence the dev warning the client emits for the bad field — we only
    // care that loading does not throw and the bad field is stripped.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.doMock('../../../src/infrastructure/catalog/routes.json', () => [
      buildRoute({
        confiabilidade: 'muito alta',
        dificuldade: 'intermediario',
      }),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../../../src/infrastructure/catalog/catalogClient');
    const routes = mod.loadCatalog();
    expect(routes).toHaveLength(1);
    expect(routes[0].confiabilidade).toBeUndefined();
    // dificuldade was valid so it survives independently — partial validation
    // never punishes a sibling field.
    expect(routes[0].dificuldade).toBe('intermediario');
    warnSpy.mockRestore();
  });

  it('drops malformed ultima_revisao (non-ISO date) without crashing', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.doMock('../../../src/infrastructure/catalog/routes.json', () => [
      buildRoute({ ultima_revisao: '22/05/2026' }),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../../../src/infrastructure/catalog/catalogClient');
    const routes = mod.loadCatalog();
    expect(routes).toHaveLength(1);
    expect(routes[0].ultima_revisao).toBeUndefined();
    warnSpy.mockRestore();
  });
});
