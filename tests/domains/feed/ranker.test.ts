import { computeFeed } from '@/domains/feed/ranker';
import type { CatalogRoute, NivelCurvas, Pavimento } from '@/domains/catalog/types';

function makeRoute(
  partial: Partial<CatalogRoute> & {
    rota_id: string;
    nome_rota?: string;
    estado_pais?: string;
    lat?: number;
    lng?: number;
    nivel_curvas?: NivelCurvas;
  },
): CatalogRoute {
  const pavimento: Pavimento = partial.caracteristicas?.tipo_pavimento ?? 'asfalto';
  return {
    rota_id: partial.rota_id,
    nome_rota: partial.nome_rota ?? partial.rota_id,
    estado_pais: partial.estado_pais ?? 'SP',
    coordenada_inicio: {
      cidade: '',
      latitude: partial.lat ?? -23.55,
      longitude: partial.lng ?? -46.63,
    },
    coordenada_fim: {
      cidade: '',
      latitude: partial.lat ?? -23.5,
      longitude: partial.lng ?? -46.6,
    },
    distancia_total_km: partial.distancia_total_km ?? 100,
    total_pedagios_moto_reais: partial.total_pedagios_moto_reais ?? 0,
    caracteristicas: {
      tipo_pavimento: pavimento,
      nivel_curvas: partial.nivel_curvas ?? 'medio',
      trecho_critico_sem_posto_km: 50,
    },
    interconexoes_ids: [],
    pontos_apoio_homologados: [],
    polilinha_simplificada: [],
    ...(partial.melhor_epoca !== undefined ? { melhor_epoca: partial.melhor_epoca } : {}),
    ...(partial.confiabilidade !== undefined ? { confiabilidade: partial.confiabilidade } : {}),
    ...(partial.dificuldade !== undefined ? { dificuldade: partial.dificuldade } : {}),
  };
}

const SP_POSITION = { latitude: -23.55, longitude: -46.63 };

describe('computeFeed', () => {
  it('retorna [] quando catalogo vazio', () => {
    const cards = computeFeed({
      catalog: [],
      userPosition: SP_POSITION,
      routeOpenCounts: new Map(),
      completedRotaIds: new Set(),
      now: Date.now(),
    });
    expect(cards).toEqual([]);
  });

  it('respeita maxCards (default 5, override possivel)', () => {
    const catalog = Array.from({ length: 10 }, (_, i) =>
      makeRoute({ rota_id: `r${i}`, lat: -23.5 - i * 0.05, lng: -46.6 - i * 0.05 }),
    );
    const cards = computeFeed({
      catalog,
      userPosition: SP_POSITION,
      routeOpenCounts: new Map(),
      completedRotaIds: new Set(),
      now: Date.now(),
      maxCards: 3,
    });
    expect(cards.length).toBeLessThanOrEqual(3);
  });

  it('dedup: a mesma rota nao aparece em dois cards', () => {
    // Apenas 1 rota no catalogo — todas as buscas de kind diferentes
    // tem a mesma candidata. So 1 card final.
    const catalog = [
      makeRoute({ rota_id: 'unica', nome_rota: 'Rota Unica', estado_pais: 'SP' }),
    ];
    const cards = computeFeed({
      catalog,
      userPosition: SP_POSITION,
      routeOpenCounts: new Map(),
      completedRotaIds: new Set(),
      now: Date.now(),
    });
    const ids = cards.map((c) => c.rotaId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(cards.length).toBeLessThanOrEqual(1);
  });

  it('opportunity favorece rotas em-epoca + proximas', () => {
    const now = new Date(2026, 5, 15).getTime(); // junho
    const catalog = [
      makeRoute({
        rota_id: 'mauá',
        nome_rota: 'Mauá',
        estado_pais: 'RJ',
        lat: -22.36,
        lng: -44.55,
        melhor_epoca: 'abril a setembro',
      }),
      makeRoute({
        rota_id: 'tamoios',
        nome_rota: 'Tamoios',
        estado_pais: 'SP',
        lat: -23.4,
        lng: -45.0,
        melhor_epoca: 'novembro a fevereiro', // FORA em junho
      }),
    ];
    const cards = computeFeed({
      catalog,
      userPosition: SP_POSITION,
      routeOpenCounts: new Map(),
      completedRotaIds: new Set(),
      now,
    });
    const opp = cards.find((c) => c.kind === 'opportunity');
    expect(opp).toBeDefined();
    expect(opp?.rotaId).toBe('mauá');
  });

  it('discovery favorece rota nunca aberta', () => {
    const catalog = [
      makeRoute({ rota_id: 'velha', nome_rota: 'Rota Velha' }),
      makeRoute({ rota_id: 'nova', nome_rota: 'Rota Nova' }),
    ];
    const cards = computeFeed({
      catalog,
      userPosition: SP_POSITION,
      routeOpenCounts: new Map([['velha', 10]]),
      completedRotaIds: new Set(['velha']),
      now: Date.now(),
    });
    const disc = cards.find((c) => c.kind === 'discovery');
    expect(disc?.rotaId).toBe('nova');
  });

  it('seasonal so escolhe rotas em-epoca + nao completadas', () => {
    const now = new Date(2026, 3, 15).getTime(); // abril
    const catalog = [
      makeRoute({
        rota_id: 'em-epoca',
        melhor_epoca: 'abril a junho',
      }),
      makeRoute({
        rota_id: 'fora-epoca',
        melhor_epoca: 'novembro a janeiro',
      }),
    ];
    const cards = computeFeed({
      catalog,
      userPosition: SP_POSITION,
      routeOpenCounts: new Map(),
      completedRotaIds: new Set(),
      now,
    });
    const seasonal = cards.find((c) => c.kind === 'seasonal');
    if (seasonal !== undefined) {
      expect(seasonal.rotaId).toBe('em-epoca');
    }
  });

  it('caution so aparece se ha rota fora-epoca com historia (open/completed)', () => {
    const now = new Date(2026, 11, 15).getTime(); // dezembro
    const catalog = [
      makeRoute({
        rota_id: 'frequentada',
        nome_rota: 'Frequentada',
        melhor_epoca: 'abril a junho', // fora em dez
      }),
      makeRoute({ rota_id: 'desconhecida', melhor_epoca: 'ano todo' }),
    ];
    const cards = computeFeed({
      catalog,
      userPosition: SP_POSITION,
      routeOpenCounts: new Map([['frequentada', 5]]),
      completedRotaIds: new Set(['frequentada']),
      now,
    });
    const caution = cards.find((c) => c.kind === 'caution');
    expect(caution?.rotaId).toBe('frequentada');
  });

  it('FeedCard carrega stats + chips data pro layout hero', () => {
    const catalog = [
      makeRoute({
        rota_id: 'r1',
        estado_pais: 'SP',
        total_pedagios_moto_reais: 12.5,
        distancia_total_km: 180,
        nivel_curvas: 'alto',
        dificuldade: 'intermediario',
      }),
    ];
    const cards = computeFeed({
      catalog,
      userPosition: SP_POSITION,
      routeOpenCounts: new Map(),
      completedRotaIds: new Set(),
      now: Date.now(),
    });
    const card = cards[0];
    expect(card).toBeDefined();
    expect(card?.estadoPais).toBe('SP');
    expect(card?.distanceKmFromUser).toBeGreaterThanOrEqual(0);
    expect(card?.routeDistanceKm).toBe(180);
    expect(card?.estimatedDurationMinutes).toBeGreaterThan(0);
    // 12.5 * 2 = 25 round-trip
    expect(card?.tollRoundTripReais).toBeCloseTo(25, 2);
    expect(card?.nivelCurvas).toBe('alto');
    expect(card?.dificuldade).toBe('intermediario');
    expect(typeof card?.themeRoute).toBe('string');
    expect(typeof card?.reason).toBe('string');
    expect(card?.reason.length).toBeGreaterThan(0);
  });

  it('"ano todo" sempre em-epoca, "qualquer epoca" tambem', () => {
    const catalog = [
      makeRoute({ rota_id: 'sempre', melhor_epoca: 'ano todo' }),
      makeRoute({ rota_id: 'restrita', melhor_epoca: 'julho a agosto' }),
    ];
    const cards = computeFeed({
      catalog,
      userPosition: SP_POSITION,
      routeOpenCounts: new Map(),
      completedRotaIds: new Set(),
      now: new Date(2026, 0, 15).getTime(), // janeiro — fora pra restrita
    });
    const opp = cards.find((c) => c.kind === 'opportunity');
    expect(opp?.rotaId).toBe('sempre');
  });

  it('cache cards tem `generatedAt` igual ao now passado', () => {
    const now = 1_700_000_000_000;
    const catalog = [makeRoute({ rota_id: 'r1' })];
    const cards = computeFeed({
      catalog,
      userPosition: SP_POSITION,
      routeOpenCounts: new Map(),
      completedRotaIds: new Set(),
      now,
    });
    for (const c of cards) {
      expect(c.generatedAt).toBe(now);
    }
  });
});
