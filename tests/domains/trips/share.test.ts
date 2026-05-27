import { formatTripForShare } from '@/domains/trips/share';
import type { CatalogRoute } from '@/domains/catalog/types';
import type { SavedTrip } from '@/domains/trips/types';

function makeRoute(
  partial: Partial<CatalogRoute> & {
    rota_id: string;
    nome_rota?: string;
    startCidade?: string;
    endCidade?: string;
    km?: number;
    toll?: number;
  },
): CatalogRoute {
  return {
    rota_id: partial.rota_id,
    nome_rota: partial.nome_rota ?? partial.rota_id,
    estado_pais: 'SP',
    coordenada_inicio: {
      cidade: partial.startCidade ?? 'Inicio',
      latitude: 0,
      longitude: 0,
    },
    coordenada_fim: {
      cidade: partial.endCidade ?? 'Fim',
      latitude: 0,
      longitude: 0,
    },
    distancia_total_km: partial.km ?? 100,
    total_pedagios_moto_reais: partial.toll ?? 0,
    caracteristicas: {
      tipo_pavimento: 'asfalto',
      nivel_curvas: 'medio',
      trecho_critico_sem_posto_km: 50,
    },
    interconexoes_ids: [],
    pontos_apoio_homologados: [],
    polilinha_simplificada: [],
  };
}

describe('formatTripForShare', () => {
  const trip: SavedTrip = {
    id: 1,
    name: 'Litoral SP + Serra do Mar',
    rotaIds: ['tamoios', 'rio-santos'],
    pernoiteLocations: ['Caraguatatuba'],
    createdAt: 1000,
  };
  const catalogById = new Map<string, CatalogRoute>([
    [
      'tamoios',
      makeRoute({
        rota_id: 'tamoios',
        nome_rota: 'Tamoios',
        startCidade: 'Diadema',
        endCidade: 'Caraguatatuba',
        km: 82,
        toll: 11.8,
      }),
    ],
    [
      'rio-santos',
      makeRoute({
        rota_id: 'rio-santos',
        nome_rota: 'Rio-Santos',
        startCidade: 'Caraguatatuba',
        endCidade: 'Ubatuba',
        km: 175,
      }),
    ],
  ]);

  it('inclui titulo, nome da trip e cabecalho BikerWay', () => {
    const text = formatTripForShare(trip, catalogById);
    expect(text).toContain('🏍️ Plano de Trip BikerWay');
    expect(text).toContain('📍 Litoral SP + Serra do Mar');
    expect(text).toContain('— enviado pelo BikerWay');
  });

  it('lista cada dia com nome da rota, cidades e km', () => {
    const text = formatTripForShare(trip, catalogById);
    expect(text).toContain('Dia 1: Tamoios (Diadema → Caraguatatuba) — 82 km');
    expect(text).toContain('Dia 2: Rio-Santos (Caraguatatuba → Ubatuba) — 175 km');
  });

  it('soma km + pedagio total', () => {
    const text = formatTripForShare(trip, catalogById);
    expect(text).toContain('Total: 257 km');
    expect(text).toContain('R$ 11,80');
  });

  it('lista pernoites quando presentes', () => {
    const text = formatTripForShare(trip, catalogById);
    expect(text).toContain('Pernoites: Caraguatatuba');
  });

  it('inclui scheduledFor formatado quando setado', () => {
    const tripWithDate: SavedTrip = {
      ...trip,
      scheduledFor: new Date(2026, 5, 25).getTime(),
    };
    const text = formatTripForShare(tripWithDate, catalogById);
    expect(text).toContain('Saída prevista: 25/06/2026');
  });

  it('inclui notas quando presentes', () => {
    const tripWithNotes: SavedTrip = {
      ...trip,
      notes: 'Levar capa de chuva',
    };
    const text = formatTripForShare(tripWithNotes, catalogById);
    expect(text).toContain('Levar capa de chuva');
  });

  it('formata trip de 1 dia com pernoite no destino', () => {
    const tripWithSingleDay: SavedTrip = {
      id: 1,
      name: 'Fim de semana em Caraguá',
      rotaIds: ['tamoios'],
      pernoiteLocations: ['Caraguatatuba'],
      createdAt: 1000,
    };
    const text = formatTripForShare(tripWithSingleDay, catalogById);
    expect(text).toContain('Dia 1: Tamoios');
    expect(text).toContain('Total: 82 km');
    expect(text).toContain('Pernoites: Caraguatatuba');
  });

  it('lida com rota nao encontrada no catalogo', () => {
    const badTrip: SavedTrip = {
      id: 1,
      name: 'Trip orfa',
      rotaIds: ['rota-removida'],
      createdAt: 1000,
    };
    const text = formatTripForShare(badTrip, catalogById);
    expect(text).toContain('Dia 1: rota-removida');
    expect(text).toContain('Total: 0 km');
  });
});
