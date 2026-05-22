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
});
