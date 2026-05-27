import { eligibleRoutesForNextDay } from '@/domains/trips/eligibility';
import type { CatalogRoute, NivelCurvas } from '@/domains/catalog/types';

function makeRoute(
  partial: Partial<CatalogRoute> & {
    rota_id: string;
    startLat?: number;
    startLng?: number;
    endLat?: number;
    endLng?: number;
    interconexoes_ids?: string[];
    nivel_curvas?: NivelCurvas;
  },
): CatalogRoute {
  return {
    rota_id: partial.rota_id,
    nome_rota: partial.nome_rota ?? partial.rota_id,
    estado_pais: partial.estado_pais ?? 'SP',
    coordenada_inicio: {
      cidade: 'Inicio',
      latitude: partial.startLat ?? -23.5,
      longitude: partial.startLng ?? -46.6,
    },
    coordenada_fim: {
      cidade: 'Fim',
      latitude: partial.endLat ?? -23.4,
      longitude: partial.endLng ?? -46.5,
    },
    distancia_total_km: partial.distancia_total_km ?? 100,
    total_pedagios_moto_reais: 0,
    caracteristicas: {
      tipo_pavimento: 'asfalto',
      nivel_curvas: partial.nivel_curvas ?? 'medio',
      trecho_critico_sem_posto_km: 50,
    },
    interconexoes_ids: partial.interconexoes_ids ?? [],
    pontos_apoio_homologados: [],
    polilinha_simplificada: [],
  };
}

describe('eligibleRoutesForNextDay', () => {
  it('Dia 1 (sem rotas selecionadas) retorna o catalogo inteiro', () => {
    const catalog = [
      makeRoute({ rota_id: 'a' }),
      makeRoute({ rota_id: 'b' }),
      makeRoute({ rota_id: 'c' }),
    ];
    const result = eligibleRoutesForNextDay({
      catalog,
      selectedRotaIds: [],
    });
    expect(result).toHaveLength(3);
  });

  it('Dia 2 filtra por proximidade fim→inicio', () => {
    const catalog = [
      makeRoute({
        rota_id: 'tamoios',
        endLat: -23.5,
        endLng: -45.4,
      }),
      makeRoute({
        rota_id: 'rio-santos',
        startLat: -23.5,
        startLng: -45.4,
        endLat: -23.5,
        endLng: -44.8,
      }),
      makeRoute({
        rota_id: 'longe',
        startLat: -10.0,
        startLng: -40.0,
      }),
    ];
    const result = eligibleRoutesForNextDay({
      catalog,
      selectedRotaIds: ['tamoios'],
    });
    expect(result.map((r) => r.rota_id)).toEqual(['rio-santos']);
  });

  it('nunca repete uma rota ja escolhida no trip', () => {
    const catalog = [
      makeRoute({
        rota_id: 'a',
        endLat: -23.5,
        endLng: -46.5,
        interconexoes_ids: ['b'],
      }),
      makeRoute({
        rota_id: 'b',
        startLat: -23.5,
        startLng: -46.5,
        interconexoes_ids: ['a'],
      }),
    ];
    // Apos A → B, pra dia 3 nenhuma pode aparecer (A ja foi, B ja foi)
    const result = eligibleRoutesForNextDay({
      catalog,
      selectedRotaIds: ['a', 'b'],
    });
    expect(result).toEqual([]);
  });

  it('interconexoes_ids declaradas sao sempre aceitas', () => {
    const catalog = [
      makeRoute({
        rota_id: 'a',
        endLat: -23.5,
        endLng: -46.5,
        interconexoes_ids: ['far'],
      }),
      makeRoute({
        rota_id: 'far',
        // Muito longe — sem interconexao seria reprovada
        startLat: -10.0,
        startLng: -40.0,
      }),
    ];
    const result = eligibleRoutesForNextDay({
      catalog,
      selectedRotaIds: ['a'],
    });
    expect(result.map((r) => r.rota_id)).toContain('far');
  });
});
