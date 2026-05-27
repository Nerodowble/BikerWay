import type { CatalogRoute } from '../catalog/types';

/**
 * F35.6 — Plano de Trip. Trip = sequencia de 2 a 4 rotas conectadas que
 * forma uma viagem multi-dia (cada rota = 1 dia).
 *
 * `TripDay` representa um dia do roteiro com a rota daquele dia, pernoite
 * proposto e flag "ultimo dia" pra UI saber se nao precisa de pernoite.
 *
 * `AutoTrip` e o objeto que a UI consome — carrega rotulos prontos pra
 * mostrar, agregados (km, pedagio total) ja calculados, e a lista de
 * dias na ordem certa.
 */

export interface TripDay {
  dayNumber: number;
  rotaId: string;
  routeName: string;
  startCidade: string;
  endCidade: string;
  distanceKm: number;
  /** Pedagio one-way da rota (NAO multiplicado por ida+volta — o trip
   *  acumula no `totalTollReais` considerando que cada perna e single-pass
   *  no caminho do roteiro). */
  tollReais: number;
  /** Cidade sugerida pra pernoite. Indefinido no ultimo dia. */
  pernoiteEm?: string;
  /** F35.6 rev — Coordenadas do `coordenada_fim` da rota daquele dia.
   *  Usadas pelo overnightFinder pra buscar hoteis/pousadas perto.
   *  Sempre preenchido pra dias com `pernoiteEm`. */
  pernoiteLat?: number;
  pernoiteLng?: number;
}

export type TripDifficulty = 'iniciante' | 'intermediario' | 'avancado';

export interface AutoTrip {
  id: string;
  /** Titulo gerado pelo template (ex: "Litoral SP + Serra do Mar"). */
  title: string;
  /** Subtitulo descritivo curto (ex: "Tamoios → Rio-Santos"). */
  subtitle: string;
  /** Ordem 1, 2, 3 (max 4) — cada dia uma rota do catalogo. */
  days: TripDay[];
  /** Soma das distancias de todas as rotas no trip (sem incluir ida ao
   *  ponto de partida nem volta pra casa do piloto). */
  totalDistanceKm: number;
  /** Soma dos pedagios one-way de todas as rotas no caminho do roteiro. */
  totalTollReais: number;
  /** Numero de noites de pernoite (= days.length - 1). */
  pernoites: number;
  /** Tema dominante: se 50%+ das rotas tem mesmo tema, exposto aqui pro
   *  card filtrar visualmente. Senao 'misto'. */
  themeTag: 'litoral' | 'serra' | 'historica' | 'trip' | 'misto';
  /** Dificuldade dominante (mais alta entre as rotas do trip). */
  difficulty?: TripDifficulty;
  /** True quando ao menos uma rota tem nivel_curvas medio ou alto
   *  (justifica como "trip de moto" e nao so deslocamento). */
  hasCurvyRoute: boolean;
  /** F35.6 rev — Combustivel estimado em litros pra todo o trip. Soma
   *  `totalDistanceKm / consumoKmL`. Apenas preenchido quando o caller
   *  fornece `fuelEstimate` no input. */
  estimatedFuelLiters?: number;
  /** Combustivel total em reais (litros * preco). */
  estimatedFuelCostReais?: number;
}

/**
 * Adjacencia entre rotas: A → B se `A.coordenada_fim` esta a ate
 * `proximityKm` km de `B.coordenada_inicio` OU se A.interconexoes_ids
 * inclui B.rota_id (declarado pelo curador).
 */
export interface AdjacencyMap {
  edges: Map<string, Set<string>>;
  routesById: Map<string, CatalogRoute>;
}

/**
 * F35.7 — Trip salva pelo piloto via builder manual. Persiste no SQLite e
 * sobrevive entre sessoes. `rotaIds` ordenado define os dias.
 */
export interface SavedTrip {
  id: number;
  name: string;
  /** Ordem importa: indice 0 = dia 1, indice 1 = dia 2, etc. */
  rotaIds: string[];
  /** Cidades de pernoite por dia (paralelo a rotaIds[0..n-1], sem ultimo). */
  pernoiteLocations?: string[];
  /** Epoch ms da data planejada da viagem. Usado pelo lembrete. */
  scheduledFor?: number;
  notes?: string;
  createdAt: number;
  completedAt?: number;
}

export interface SavedTripInput {
  name: string;
  rotaIds: string[];
  pernoiteLocations?: string[];
  scheduledFor?: number;
  notes?: string;
}

export interface GenerateTripsInput {
  catalog: ReadonlyArray<CatalogRoute>;
  /** Raio em km pra considerar dois pontos "proximos" pro encadeamento.
   *  Default 30km (do brainstorm). */
  proximityKm?: number;
  /** Cap de km por dia. Trip onde algum dia ultrapassa e descartado.
   *  Default 500km. */
  maxDailyKm?: number;
  /** Minimo total de km pra justificar trip (descarta combinacoes
   *  triviais). Default 100km. */
  minTotalKm?: number;
  /** Profundidade maxima da busca de cadeia. Default 3 dias. */
  maxDays?: number;
  /** Maximo de trips no resultado, ordenados por score. Default 10. */
  maxResults?: number;
  /** F35.6 rev — Dados pra calcular custo de combustivel por trip. Quando
   *  presente, o gerador preenche `estimatedFuelLiters` e
   *  `estimatedFuelCostReais` em cada AutoTrip. Omitido = sem estimativa. */
  fuelEstimate?: {
    consumoKmL: number;
    pricePerLiter: number;
  };
}
