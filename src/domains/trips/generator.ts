import type { CatalogRoute, Dificuldade } from '../catalog/types';
import { deriveRouteTheme, type RouteTheme } from '../catalog/theme';
import type {
  AdjacencyMap,
  AutoTrip,
  GenerateTripsInput,
  TripDay,
  TripDifficulty,
} from './types';

/**
 * F35.6 — Gerador puro de trips multi-dia.
 *
 * Estrategia:
 *   1. Constroi grafo dirigido onde A→B se (a) A.interconexoes_ids inclui
 *      B OU (b) coordenada_fim de A esta a <=proximityKm de
 *      coordenada_inicio de B.
 *   2. DFS limitado a `maxDays` profundidade a partir de cada rota.
 *   3. Pra cada cadeia (A,B,...) valida regras: total >= minTotalKm,
 *      cada dia <= maxDailyKm, sem rota repetida, pelo menos uma rota
 *      com curvas medio/alto.
 *   4. Ranqueia: bonus pra tema consistente, distancia razoavel
 *      (200-700km no total), e pernoites equilibrados.
 *
 * Pure: nao toca em store, fetch, db. Recebe catalog, devolve AutoTrip[].
 */

const EARTH_RADIUS_KM = 6371;
const DEFAULT_PROXIMITY_KM = 30;
const DEFAULT_MAX_DAILY_KM = 500;
const DEFAULT_MIN_TOTAL_KM = 100;
const DEFAULT_MAX_DAYS = 3;
const DEFAULT_MAX_RESULTS = 10;

function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (x: number): number => (x * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function buildAdjacency(
  catalog: ReadonlyArray<CatalogRoute>,
  proximityKm: number,
): AdjacencyMap {
  const edges = new Map<string, Set<string>>();
  const routesById = new Map<string, CatalogRoute>();
  for (const r of catalog) routesById.set(r.rota_id, r);

  for (const a of catalog) {
    const out = new Set<string>();
    // Conexao declarada pelo curador
    for (const interId of a.interconexoes_ids) {
      if (interId === a.rota_id) continue;
      if (routesById.has(interId)) out.add(interId);
    }
    // Conexao por proximidade geografica de fim->inicio
    for (const b of catalog) {
      if (b.rota_id === a.rota_id) continue;
      if (out.has(b.rota_id)) continue;
      const d = haversineKm(
        {
          latitude: a.coordenada_fim.latitude,
          longitude: a.coordenada_fim.longitude,
        },
        {
          latitude: b.coordenada_inicio.latitude,
          longitude: b.coordenada_inicio.longitude,
        },
      );
      if (d <= proximityKm) out.add(b.rota_id);
    }
    edges.set(a.rota_id, out);
  }
  return { edges, routesById };
}

const DIFFICULTY_RANK: Record<Dificuldade, number> = {
  iniciante: 1,
  intermediario: 2,
  avancado: 3,
};

function dominantTheme(routes: ReadonlyArray<CatalogRoute>): AutoTrip['themeTag'] {
  const counts = new Map<RouteTheme, number>();
  for (const r of routes) {
    const t = deriveRouteTheme(r);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let best: RouteTheme = 'trip';
  let bestCount = 0;
  for (const [t, c] of counts) {
    if (c > bestCount) {
      best = t;
      bestCount = c;
    }
  }
  if (bestCount / routes.length >= 0.5) return best;
  return 'misto';
}

function dominantDifficulty(
  routes: ReadonlyArray<CatalogRoute>,
): TripDifficulty | undefined {
  let max: Dificuldade | undefined;
  for (const r of routes) {
    if (r.dificuldade === undefined) continue;
    if (max === undefined || DIFFICULTY_RANK[r.dificuldade] > DIFFICULTY_RANK[max]) {
      max = r.dificuldade;
    }
  }
  return max;
}

function buildTitle(routes: ReadonlyArray<CatalogRoute>): {
  title: string;
  subtitle: string;
} {
  const themeTag = dominantTheme(routes);
  const subtitle = routes.map((r) => r.nome_rota).join(' → ');
  let title: string;
  if (themeTag === 'litoral') title = 'Trip Litoral';
  else if (themeTag === 'serra') title = 'Trip Serrana';
  else if (themeTag === 'historica') title = 'Trip Histórica';
  else if (themeTag === 'trip') title = 'Trip Longa';
  else title = 'Trip Combinada';
  // Acrescenta primeiro estado pra dar contexto regional
  const firstEstado = routes[0]?.estado_pais?.match(/[A-Z]{2}/)?.[0];
  if (firstEstado) title = `${title} · ${firstEstado}`;
  return { title, subtitle };
}

function scoreChain(routes: ReadonlyArray<CatalogRoute>): number {
  if (routes.length === 0) return 0;
  const totalKm = routes.reduce((s, r) => s + r.distancia_total_km, 0);
  let score = 0;
  // Distancia razoavel: 200-700km e ideal pra fim-de-semana
  if (totalKm >= 200 && totalKm <= 700) score += 0.4;
  else if (totalKm > 700 && totalKm <= 1200) score += 0.15;
  // Pelo menos 1 com curvas medio/alto (justifica trip de moto)
  const hasCurves = routes.some(
    (r) =>
      r.caracteristicas.nivel_curvas === 'medio' ||
      r.caracteristicas.nivel_curvas === 'alto',
  );
  if (hasCurves) score += 0.25;
  // Tema consistente (50%+ rotas mesmo tema)
  if (dominantTheme(routes) !== 'misto') score += 0.15;
  // Confiabilidade alta media
  const confiavel = routes.filter((r) => r.confiabilidade === 'alta').length;
  if (confiavel === routes.length) score += 0.1;
  // Penaliza dias muito desiguais (max/min > 4x)
  if (routes.length >= 2) {
    const kms = routes.map((r) => r.distancia_total_km);
    const max = Math.max(...kms);
    const min = Math.min(...kms);
    if (min > 0 && max / min > 4) score -= 0.1;
  }
  return Math.max(0, Math.min(1, score));
}

function chainToTrip(
  routes: ReadonlyArray<CatalogRoute>,
  score: number,
  fuelEstimate?: { consumoKmL: number; pricePerLiter: number },
): AutoTrip {
  const days: TripDay[] = routes.map((r, i) => {
    const day: TripDay = {
      dayNumber: i + 1,
      rotaId: r.rota_id,
      routeName: r.nome_rota,
      startCidade: r.coordenada_inicio.cidade,
      endCidade: r.coordenada_fim.cidade,
      distanceKm: r.distancia_total_km,
      tollReais: r.total_pedagios_moto_reais,
    };
    if (i < routes.length - 1) {
      day.pernoiteEm = r.coordenada_fim.cidade;
      day.pernoiteLat = r.coordenada_fim.latitude;
      day.pernoiteLng = r.coordenada_fim.longitude;
    }
    return day;
  });
  const totalDistanceKm = routes.reduce(
    (s, r) => s + r.distancia_total_km,
    0,
  );
  const totalTollReais = routes.reduce(
    (s, r) => s + r.total_pedagios_moto_reais,
    0,
  );
  const hasCurvyRoute = routes.some(
    (r) =>
      r.caracteristicas.nivel_curvas === 'medio' ||
      r.caracteristicas.nivel_curvas === 'alto',
  );
  const { title, subtitle } = buildTitle(routes);
  const themeTag = dominantTheme(routes);
  const difficulty = dominantDifficulty(routes);
  const trip: AutoTrip = {
    id: `auto-${routes.map((r) => r.rota_id).join('+')}`,
    title,
    subtitle,
    days,
    totalDistanceKm,
    totalTollReais,
    pernoites: Math.max(0, routes.length - 1),
    themeTag,
    hasCurvyRoute,
  };
  if (difficulty !== undefined) {
    trip.difficulty = difficulty;
  }
  // F35.6 rev — combustivel total a partir da soma das distancias.
  // Heuristica simples: km / consumo = litros; litros * preco = reais.
  // Nao inclui a aproximacao do GPS do piloto ate o inicio do dia 1 —
  // essa parte e dependente da posicao atual (variavel) e seria mostrada
  // por trip-card uma vez que o piloto abrir o roteiro.
  if (
    fuelEstimate &&
    fuelEstimate.consumoKmL > 0 &&
    fuelEstimate.pricePerLiter > 0
  ) {
    const liters = totalDistanceKm / fuelEstimate.consumoKmL;
    const cost = liters * fuelEstimate.pricePerLiter;
    trip.estimatedFuelLiters = Math.round(liters * 10) / 10;
    trip.estimatedFuelCostReais = Math.round(cost * 100) / 100;
  }
  // O score nao e exposto no tipo final, mas usado pra ordenar antes.
  // Anexamos via cast leve pra evitar campo "score" no AutoTrip publico.
  (trip as AutoTrip & { _score: number })._score = score;
  return trip;
}

export function generateAutoTrips(input: GenerateTripsInput): AutoTrip[] {
  const proximityKm = input.proximityKm ?? DEFAULT_PROXIMITY_KM;
  const maxDailyKm = input.maxDailyKm ?? DEFAULT_MAX_DAILY_KM;
  const minTotalKm = input.minTotalKm ?? DEFAULT_MIN_TOTAL_KM;
  const maxDays = input.maxDays ?? DEFAULT_MAX_DAYS;
  const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS;

  if (input.catalog.length === 0) return [];

  const { edges, routesById } = buildAdjacency(input.catalog, proximityKm);
  const seenChainIds = new Set<string>();
  const trips: AutoTrip[] = [];

  function dfs(
    chain: CatalogRoute[],
    currentId: string,
    depth: number,
  ): void {
    // Avalia cadeia atual (so a partir de 2 rotas — trip de 1 dia e so
    // a rota em si, nao um "trip multi-dia").
    if (chain.length >= 2) {
      const totalKm = chain.reduce((s, r) => s + r.distancia_total_km, 0);
      const everyDayUnderCap = chain.every(
        (r) => r.distancia_total_km <= maxDailyKm,
      );
      const hasCurves = chain.some(
        (r) =>
          r.caracteristicas.nivel_curvas === 'medio' ||
          r.caracteristicas.nivel_curvas === 'alto',
      );
      if (totalKm >= minTotalKm && everyDayUnderCap && hasCurves) {
        const key = chain.map((r) => r.rota_id).sort().join('+');
        if (!seenChainIds.has(key)) {
          seenChainIds.add(key);
          const score = scoreChain(chain);
          trips.push(chainToTrip(chain, score, input.fuelEstimate));
        }
      }
    }
    if (depth >= maxDays) return;
    const out = edges.get(currentId);
    if (!out) return;
    for (const nextId of out) {
      const next = routesById.get(nextId);
      if (!next) continue;
      if (chain.some((r) => r.rota_id === next.rota_id)) continue; // sem ciclos
      chain.push(next);
      dfs(chain, nextId, depth + 1);
      chain.pop();
    }
  }

  for (const root of input.catalog) {
    dfs([root], root.rota_id, 1);
  }

  // Ordena por score desc, depois corta no max.
  trips.sort((a, b) => {
    const sa = (a as AutoTrip & { _score?: number })._score ?? 0;
    const sb = (b as AutoTrip & { _score?: number })._score ?? 0;
    return sb - sa;
  });
  // Remove o `_score` interno antes de devolver pro consumer.
  return trips.slice(0, maxResults).map((t) => {
    const clone: AutoTrip = {
      id: t.id,
      title: t.title,
      subtitle: t.subtitle,
      days: t.days,
      totalDistanceKm: t.totalDistanceKm,
      totalTollReais: t.totalTollReais,
      pernoites: t.pernoites,
      themeTag: t.themeTag,
      hasCurvyRoute: t.hasCurvyRoute,
    };
    if (t.difficulty !== undefined) clone.difficulty = t.difficulty;
    if (t.estimatedFuelLiters !== undefined) {
      clone.estimatedFuelLiters = t.estimatedFuelLiters;
    }
    if (t.estimatedFuelCostReais !== undefined) {
      clone.estimatedFuelCostReais = t.estimatedFuelCostReais;
    }
    return clone;
  });
}
