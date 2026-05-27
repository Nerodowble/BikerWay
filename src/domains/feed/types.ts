import type { CatalogRoute, Dificuldade, NivelCurvas } from '../catalog/types';
import type { RouteTheme } from '../catalog/theme';

/**
 * F35.5 — Fim de Semana Perfeito. Modelos do feed contextual.
 *
 * `FeedCard` carrega TUDO que a UI do card precisa pra renderizar sem
 * voltar ao catalogo. Decisao do layout hero (V2): cada card mostra
 * stats grid + chips + motivo + CTA grande, entao precisa de
 * `distanceKmFromUser`, `durationMinutes`, `tollRoundTrip`,
 * `themeRoute`, `dificuldade`, `nivelCurvas`, e o `reason` textual.
 */

export type FeedCardKind = 'opportunity' | 'caution' | 'discovery' | 'seasonal';

export interface FeedCard {
  id: string;
  kind: FeedCardKind;
  icon: string;
  eyebrow: string;
  headline: string;
  rotaId: string;
  routeName: string;
  estadoPais: string;
  distanceKmFromUser: number;
  /** Distancia total da rota (km). Vem direto do `distancia_total_km`
   *  curado, usado pra mostrar "rota = X km" no card e calcular duracao. */
  routeDistanceKm: number;
  /** Estimativa de duracao da rota em minutos. Heuristica: distancia / 60 km/h
   *  + 10% folga. Suficiente pra dar contexto sem fingir precisao. */
  estimatedDurationMinutes: number;
  /** Pedagio total round-trip em reais (one-way * 2). 0 quando nao ha. */
  tollRoundTripReais: number;
  /** Tema derivado (LITORAL/SERRA/HISTORICA/TRIP) pro chip. */
  themeRoute: RouteTheme;
  dificuldade?: Dificuldade;
  nivelCurvas: NivelCurvas;
  /** Frase curta sobre POR QUE essa rota ta aqui no card.
   *  Ex: "Em época (abr-set)", "Você nunca explorou", "Atenção: fora de época". */
  reason: string;
  /** Score 0..1 que ranqueou esse card no seu kind (pra debug + testes). */
  score: number;
  /** Quando o ranker rodou. Util pra cache invalidation. */
  generatedAt: number;
}

export interface FeedInput {
  catalog: ReadonlyArray<CatalogRoute>;
  userPosition: { latitude: number; longitude: number };
  /** Map rotaId -> contagem de aberturas no `route_history`. Falta da entry
   *  = 0 aberturas (nunca abriu). */
  routeOpenCounts: ReadonlyMap<string, number>;
  /** Set de rotaIds com completed_at no `trip_history`. */
  completedRotaIds: ReadonlySet<string>;
  /** Perfil opcional pra ajustar `suitability`. Ausencia = perfil neutro. */
  profile?: {
    estiloPilotagem?: 'urbano' | 'estrada' | 'trail' | 'misto';
    preferenciaTempo?: 'sol' | 'qualquer' | 'evito-chuva';
    anosPilotando?: number;
  };
  /** Epoch ms — usado pra "melhor_epoca" check (mes corrente). */
  now: number;
  /** Quantidade maxima de cards a retornar. Default 5. */
  maxCards?: number;
}

export interface RouteScores {
  rotaId: string;
  opportunity: number;
  novelty: number;
  suitability: number;
  combined: number;
  distanceKm: number;
  inSeason: boolean;
  reasons: string[];
}
