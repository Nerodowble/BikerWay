import {
  deriveRouteTheme,
  getRouteThemeMeta,
} from '@/domains/catalog/theme';
import type { CatalogRoute } from '@/domains/catalog/types';

function makeRoute(overrides: Partial<CatalogRoute> = {}): CatalogRoute {
  return {
    rota_id: 'test-route',
    nome_rota: 'Rota Teste',
    estado_pais: 'SP, Brasil',
    coordenada_inicio: { cidade: 'São Paulo', latitude: -23.5, longitude: -46.6 },
    coordenada_fim: { cidade: 'Campinas', latitude: -22.9, longitude: -47.0 },
    distancia_total_km: 100,
    total_pedagios_moto_reais: 0,
    caracteristicas: {
      tipo_pavimento: 'asfalto',
      nivel_curvas: 'medio',
      trecho_critico_sem_posto_km: 20,
    },
    interconexoes_ids: [],
    pontos_apoio_homologados: [],
    polilinha_simplificada: [],
    ...overrides,
  };
}

describe('deriveRouteTheme (F35.0.A)', () => {
  it('classifica rota >300km como TRIP independente de outros marcadores', () => {
    const r = makeRoute({
      distancia_total_km: 710,
      nome_rota: 'Estrada Real - Caminho Velho',
      caracteristicas: {
        tipo_pavimento: 'misto',
        nivel_curvas: 'alto',
        trecho_critico_sem_posto_km: 45,
      },
    });
    // Apesar de ter "Estrada Real" + curvas alto, TRIP ganha pois >300km e
    // a informacao pratica (planeje pernoite) supera o tema cultural.
    expect(deriveRouteTheme(r)).toBe('trip');
  });

  it('classifica nome com "Caminho" curto como HISTORICA', () => {
    const r = makeRoute({
      nome_rota: 'Caminho do Mar / Estrada Velha de Santos (SP-148)',
      distancia_total_km: 50,
    });
    expect(deriveRouteTheme(r)).toBe('historica');
  });

  it('classifica nome com "Romântica" como HISTORICA', () => {
    const r = makeRoute({
      nome_rota: 'Rota Romântica (RS-235)',
      distancia_total_km: 100,
    });
    expect(deriveRouteTheme(r)).toBe('historica');
  });

  it('classifica rotas costeiras (nome) como LITORAL', () => {
    const r = makeRoute({
      nome_rota: 'Rio-Santos Litoral Norte (BR-101 / SP-055)',
      distancia_total_km: 175,
    });
    expect(deriveRouteTheme(r)).toBe('litoral');
  });

  it('classifica por cidade costeira no inicio/fim como LITORAL', () => {
    const r = makeRoute({
      nome_rota: 'Rota Generica',
      coordenada_inicio: { cidade: 'Bertioga', latitude: -23.8, longitude: -46.1 },
      coordenada_fim: { cidade: 'Ubatuba', latitude: -23.4, longitude: -45.1 },
    });
    expect(deriveRouteTheme(r)).toBe('litoral');
  });

  it('cai pra SERRA quando curvas=alto e nada mais bate', () => {
    const r = makeRoute({
      nome_rota: 'Serra Generica SP-XXX',
      distancia_total_km: 80,
      caracteristicas: {
        tipo_pavimento: 'asfalto',
        nivel_curvas: 'alto',
        trecho_critico_sem_posto_km: 30,
      },
    });
    expect(deriveRouteTheme(r)).toBe('serra');
  });

  it('cai pra SERRA como fallback amplo (curvas medio sem outro marcador)', () => {
    const r = makeRoute({
      nome_rota: 'Rota Generica Interior',
      caracteristicas: {
        tipo_pavimento: 'asfalto',
        nivel_curvas: 'medio',
        trecho_critico_sem_posto_km: 20,
      },
    });
    expect(deriveRouteTheme(r)).toBe('serra');
  });
});

describe('getRouteThemeMeta (F35.0.A)', () => {
  it('expoe labels em portugues uppercase', () => {
    expect(getRouteThemeMeta('trip').label).toBe('TRIP');
    expect(getRouteThemeMeta('historica').label).toBe('HISTÓRICA');
    expect(getRouteThemeMeta('litoral').label).toBe('LITORAL');
    expect(getRouteThemeMeta('serra').label).toBe('SERRA');
  });

  it('cada tema tem bg + fg distintos pra contraste visual', () => {
    const themes: Array<'trip' | 'historica' | 'litoral' | 'serra'> = [
      'trip',
      'historica',
      'litoral',
      'serra',
    ];
    const colors = themes.map((t) => getRouteThemeMeta(t).fg);
    // Sem duplicatas — cada tema tem cor fg unica
    expect(new Set(colors).size).toBe(themes.length);
  });
});
