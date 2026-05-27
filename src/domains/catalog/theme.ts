import type { CatalogRoute } from './types';

/**
 * F35.0.A — Tema visual derivado de campos existentes da rota.
 *
 * Heuristica leve: olha nome, cidades, distancia e nivel_curvas pra
 * categorizar cada rota em um dos 4 temas. NAO altera o schema de
 * curadoria — e puro derived state. Se uma rota tem o tema errado, ajusta
 * a heuristica aqui sem mexer no JSON.
 *
 * Ordem de prioridade (a primeira que matchar ganha):
 *  1. TRIP — distancia_total_km > 300, sinaliza viagem longa que exige
 *     planejamento (pernoite, combo de dias). E informacao pratica
 *     critica e vence outros temas.
 *  2. HISTORICA — nome contem marcadores culturais ("Estrada Real",
 *     "Caminho", "Romantica", "Historica"). Atalho pra "passeio cultural".
 *  3. LITORAL — nome ou cidades de inicio/fim contem marcadores costeiros
 *     (lista hardcoded de cidades praianas SP/RJ).
 *  4. SERRA — nivel_curvas === 'alto' como fallback, sem outro marcador.
 *  5. null — nada bateu (rota plana pouco curvada nao costeira nao
 *     historica de curta distancia; raro mas possivel).
 */

export type RouteTheme = 'trip' | 'historica' | 'litoral' | 'serra';

const HISTORIC_MARKERS: readonly string[] = [
  'estrada real',
  'caminho',
  'romantica',
  'romântica',
  'historica',
  'histórica',
];

// Cidades costeiras BR que o catalogo cobre / cobrira. Adicionar mais conforme
// o catalogo crescer. Comparacao case-insensitive sem acentos.
const COASTAL_CITIES: readonly string[] = [
  'caraguatatuba',
  'ubatuba',
  'mongagua',
  'mongaguá',
  'bertioga',
  'sao sebastiao',
  'são sebastião',
  'maresias',
  'paraty',
  'angra',
  'guaruja',
  'guarujá',
  'santos',
  'sao vicente',
  'são vicente',
  'praia grande',
  'ilhabela',
  'florianopolis',
  'florianópolis',
];

const COASTAL_NAME_MARKERS: readonly string[] = ['litoral', 'rio-santos', 'praia'];

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

function matchesAny(haystack: string, needles: readonly string[]): boolean {
  const h = normalize(haystack);
  return needles.some((n) => h.includes(normalize(n)));
}

export function deriveRouteTheme(route: CatalogRoute): RouteTheme {
  if (route.distancia_total_km > 300) return 'trip';
  if (matchesAny(route.nome_rota, HISTORIC_MARKERS)) return 'historica';
  if (matchesAny(route.nome_rota, COASTAL_NAME_MARKERS)) return 'litoral';
  const startCity = route.coordenada_inicio?.cidade ?? '';
  const endCity = route.coordenada_fim?.cidade ?? '';
  if (
    matchesAny(startCity, COASTAL_CITIES) ||
    matchesAny(endCity, COASTAL_CITIES)
  ) {
    return 'litoral';
  }
  if (route.caracteristicas.nivel_curvas === 'alto') return 'serra';
  // Sem marcador forte — escolhe SERRA como fallback amplo
  // (a maioria do catalogo atual tem curvas medio/alto). E melhor
  // mostrar um chip generico do que nenhum.
  return 'serra';
}

export interface RouteThemeMeta {
  label: string;
  /** Cor de fundo do pill (transparencia ja aplicada). */
  bg: string;
  /** Cor do texto do pill. */
  fg: string;
}

/**
 * Aparencia visual de cada tema. Cores escolhidas pra distinguir bem em
 * scroll rapido — TRIP em laranja chamativo (planeje!), HISTORICA em
 * ambar/dourado (cultura), LITORAL em cyan/azul (mar), SERRA em verde
 * (natureza/montanha).
 */
export function getRouteThemeMeta(theme: RouteTheme): RouteThemeMeta {
  switch (theme) {
    case 'trip':
      return { label: 'TRIP', bg: 'rgba(255,107,0,0.22)', fg: '#FF6B00' };
    case 'historica':
      return { label: 'HISTÓRICA', bg: 'rgba(255,204,0,0.20)', fg: '#FFCC00' };
    case 'litoral':
      return { label: 'LITORAL', bg: 'rgba(91,213,255,0.18)', fg: '#5BD5FF' };
    case 'serra':
      return { label: 'SERRA', bg: 'rgba(63,191,111,0.20)', fg: '#3FBF6F' };
  }
}
