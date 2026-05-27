import type { CatalogRoute } from '../catalog/types';
import { deriveRouteTheme } from '../catalog/theme';
import type { FeedCard, FeedInput, RouteScores } from './types';

/**
 * F35.5 — Ranker puro do feed "Fim de Semana Perfeito".
 *
 * Estrategia: pra cada rota do catalogo, calcula 3 scores (opportunity,
 * novelty, suitability) normalizados em 0..1. Depois seleciona:
 *   - Top 1 de `opportunity` (kind=opportunity)
 *   - Top 1 de `novelty` excluindo o ja escolhido (kind=discovery)
 *   - Top 1 de cuidado: rotas com `melhor_epoca` que NAO esta no mes
 *     corrente E que o piloto ja completou ou abriu varias vezes (sugere
 *     alternativa contextual) — kind=caution
 *   - Top 1 sazonal: rota onde melhor_epoca comeca proximo do mes corrente
 *     e o piloto nunca a fez (kind=seasonal)
 *
 * Sem dados de clima ao vivo no v1 — `opportunity` usa proxies do JSON
 * (melhor_epoca contendo o mes corrente, distancia razoavel da posicao,
 * curvas casando com preferencia do piloto).
 */

const MONTH_NAMES_PT = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}

/**
 * Detecta se o mes corrente cai dentro do range textual da `melhor_epoca`.
 * Aceita formatos comuns do JSON curado: "abril a setembro", "ano todo",
 * "março/abril e outubro/novembro", etc. Heuristica conservadora: se nao
 * consegue parse, retorna `null` (= neutro, nao penaliza).
 */
function isInSeason(melhorEpoca: string | undefined, now: Date): boolean | null {
  if (!melhorEpoca || melhorEpoca.trim().length === 0) return null;
  const lower = melhorEpoca.toLowerCase();
  // "ano todo" / "todo o ano" — sempre na temporada
  if (/ano\s*todo|todo\s*o\s*ano|qualquer\s*epoca/i.test(lower)) return true;
  const month = now.getMonth();
  // IMPORTANTE: ordenar por POSICAO no texto, nao pelo numero do mes.
  // Pra "novembro a fevereiro", queremos m1=novembro (10), m2=fevereiro (1)
  // pra detectar o wrap-around. Pegar por ordem alfabetica do nome
  // perderia essa informacao.
  const monthsMentioned = MONTH_NAMES_PT
    .map((name, i) => ({ name, i, pos: lower.indexOf(name) }))
    .filter((m) => m.pos >= 0)
    .sort((a, b) => a.pos - b.pos);
  if (monthsMentioned.length === 0) return null;
  if (monthsMentioned.length === 2 && /\sa\s|\sate\s|\sa\s/i.test(lower)) {
    const m1 = monthsMentioned[0]!.i;
    const m2 = monthsMentioned[1]!.i;
    if (m1 <= m2) return month >= m1 && month <= m2;
    // Wrap-around: "novembro a fevereiro" -> m1=10, m2=1 -> mes em
    // [novembro..dezembro] OU [janeiro..fevereiro]
    return month >= m1 || month <= m2;
  }
  return monthsMentioned.some((m) => m.i === month);
}

function computeOpportunity(
  route: CatalogRoute,
  distanceKm: number,
  inSeason: boolean | null,
  profile: FeedInput['profile'],
): number {
  let score = 0.5;
  // Distancia razoavel: ideal entre 30 e 250km. Acima de 400km penaliza
  // (fica em outro dia).
  if (distanceKm <= 30) score += 0.05;
  else if (distanceKm <= 150) score += 0.25;
  else if (distanceKm <= 250) score += 0.15;
  else if (distanceKm <= 400) score += 0.05;
  else score -= 0.15;

  // Curadoria humana > heuristica. Se esta na epoca, bonus solido.
  if (inSeason === true) score += 0.25;
  else if (inSeason === false) score -= 0.2;

  // Preferencia do piloto bate com nivel de curvas
  const curvas = route.caracteristicas.nivel_curvas;
  if (profile?.estiloPilotagem === 'estrada' && curvas === 'baixo') score += 0.05;
  if (profile?.estiloPilotagem === 'estrada' && curvas === 'alto') score += 0.1;
  if (profile?.estiloPilotagem === 'urbano' && curvas === 'alto') score -= 0.05;

  // Confiabilidade da curadoria boost score
  if (route.confiabilidade === 'alta') score += 0.05;
  else if (route.confiabilidade === 'baixa') score -= 0.05;

  return Math.max(0, Math.min(1, score));
}

function computeNovelty(
  route: CatalogRoute,
  openCount: number,
  alreadyCompleted: boolean,
): number {
  if (alreadyCompleted) return 0.1;
  if (openCount === 0) return 1;
  if (openCount === 1) return 0.7;
  if (openCount <= 3) return 0.5;
  if (openCount <= 7) return 0.3;
  return 0.15;
}

function computeSuitability(
  route: CatalogRoute,
  profile: FeedInput['profile'],
): number {
  let score = 0.5;
  if (!profile) return score;
  // Anos pilotando vs dificuldade
  const dif = route.dificuldade;
  if (dif !== undefined && typeof profile.anosPilotando === 'number') {
    const exp = profile.anosPilotando;
    if (dif === 'iniciante') score += exp >= 1 ? 0.1 : 0.05;
    if (dif === 'intermediario') score += exp >= 3 ? 0.15 : -0.05;
    if (dif === 'avancado') score += exp >= 5 ? 0.2 : -0.15;
  }
  // Pavimento off-road exige perfil 'trail'
  if (route.caracteristicas.tipo_pavimento === 'terra') {
    if (profile.estiloPilotagem === 'trail') score += 0.2;
    else score -= 0.2;
  }
  return Math.max(0, Math.min(1, score));
}

function combinedScore(s: { opportunity: number; novelty: number; suitability: number }): number {
  // Pesos: oportunidade pesa mais (recomenda baseado em "hoje vale"), depois
  // novidade, depois adequacao.
  return s.opportunity * 0.5 + s.novelty * 0.3 + s.suitability * 0.2;
}

function formatHeadline(route: CatalogRoute, kind: FeedCard['kind']): string {
  switch (kind) {
    case 'opportunity':
      return `${route.nome_rota} tá perfeita`;
    case 'discovery':
      return `Você nunca foi pra ${route.nome_rota}`;
    case 'seasonal':
      return `Janela aberta: ${route.nome_rota}`;
    case 'caution':
      return `Atenção: ${route.nome_rota}`;
  }
}

function formatEyebrow(kind: FeedCard['kind']): string {
  switch (kind) {
    case 'opportunity':
      return 'HOJE VALE A PENA';
    case 'discovery':
      return 'NUNCA EXPLORADA';
    case 'seasonal':
      return 'MELHOR ÉPOCA SE APROXIMANDO';
    case 'caution':
      return 'CUIDADO';
  }
}

function formatIcon(kind: FeedCard['kind']): string {
  switch (kind) {
    case 'opportunity':
      return '🌤️';
    case 'discovery':
      return '🌅';
    case 'seasonal':
      return '🗓️';
    case 'caution':
      return '⚠️';
  }
}

function buildReason(
  route: CatalogRoute,
  kind: FeedCard['kind'],
  scores: RouteScores,
): string {
  switch (kind) {
    case 'opportunity':
      if (scores.inSeason && route.melhor_epoca) {
        return `Em época · ${route.melhor_epoca}`;
      }
      return 'Boa janela hoje';
    case 'discovery':
      return 'Você nunca explorou';
    case 'seasonal':
      return route.melhor_epoca
        ? `Janela aberta · ${route.melhor_epoca}`
        : 'Janela aberta agora';
    case 'caution':
      return route.melhor_epoca
        ? `Fora de época · ideal ${route.melhor_epoca}`
        : 'Fora da melhor época';
  }
}

function buildCard(
  route: CatalogRoute,
  kind: FeedCard['kind'],
  scores: RouteScores,
  now: number,
): FeedCard {
  // Duracao estimada: rota_km / 60 km/h + 10% folga (curvas, paradas).
  // Heuristica grosseira — o objetivo e dar contexto, nao prometer ETA.
  const estimatedDurationMinutes = Math.max(
    15,
    Math.round((route.distancia_total_km / 60) * 60 * 1.1),
  );
  const card: FeedCard = {
    id: `${kind}-${route.rota_id}`,
    kind,
    icon: formatIcon(kind),
    eyebrow: formatEyebrow(kind),
    headline: formatHeadline(route, kind),
    rotaId: route.rota_id,
    routeName: route.nome_rota,
    estadoPais: route.estado_pais,
    distanceKmFromUser: scores.distanceKm,
    routeDistanceKm: route.distancia_total_km,
    estimatedDurationMinutes,
    tollRoundTripReais: route.total_pedagios_moto_reais * 2,
    themeRoute: deriveRouteTheme(route),
    nivelCurvas: route.caracteristicas.nivel_curvas,
    reason: buildReason(route, kind, scores),
    score: scores.combined,
    generatedAt: now,
  };
  if (route.dificuldade !== undefined) {
    card.dificuldade = route.dificuldade;
  }
  return card;
}

/**
 * Computa o feed inteiro. Retorna ate `maxCards` cards (default 5), em
 * ordem de exibicao (opportunity → discovery → seasonal → caution).
 * Cards repetidos pra mesma rota sao deduplicados (uma rota so aparece
 * uma vez no feed, no card "mais forte" dela).
 */
export function computeFeed(input: FeedInput): FeedCard[] {
  const max = input.maxCards ?? 5;
  if (input.catalog.length === 0) return [];
  const nowDate = new Date(input.now);
  const profile = input.profile;

  // Computa scores pra cada rota
  const scored: RouteScores[] = input.catalog.map((route) => {
    const distanceKm = haversineKm(input.userPosition, {
      latitude: route.coordenada_inicio.latitude,
      longitude: route.coordenada_inicio.longitude,
    });
    const inSeason = isInSeason(route.melhor_epoca, nowDate);
    const opportunity = computeOpportunity(
      route,
      distanceKm,
      inSeason,
      profile,
    );
    const openCount = input.routeOpenCounts.get(route.rota_id) ?? 0;
    const alreadyCompleted = input.completedRotaIds.has(route.rota_id);
    const novelty = computeNovelty(route, openCount, alreadyCompleted);
    const suitability = computeSuitability(route, profile);
    const combined = combinedScore({ opportunity, novelty, suitability });
    const reasons: string[] = [];
    if (inSeason === true) reasons.push('em-epoca');
    if (inSeason === false) reasons.push('fora-epoca');
    if (openCount === 0) reasons.push('novidade');
    if (alreadyCompleted) reasons.push('ja-completou');
    return {
      rotaId: route.rota_id,
      opportunity,
      novelty,
      suitability,
      combined,
      distanceKm,
      inSeason: inSeason === true,
      reasons,
    };
  });

  const byId = new Map(input.catalog.map((r) => [r.rota_id, r]));
  const used = new Set<string>();
  const cards: FeedCard[] = [];

  function pick(
    kind: FeedCard['kind'],
    rank: (s: RouteScores) => number,
    filter?: (s: RouteScores) => boolean,
  ): void {
    if (cards.length >= max) return;
    const candidates = scored
      .filter((s) => !used.has(s.rotaId))
      .filter((s) => (filter ? filter(s) : true))
      .sort((a, b) => rank(b) - rank(a));
    const top = candidates[0];
    if (!top) return;
    const route = byId.get(top.rotaId);
    if (!route) return;
    used.add(top.rotaId);
    cards.push(buildCard(route, kind, top, input.now));
  }

  // Ordem do brainstorm: oportunidade → cuidado → novidade → sazonal →
  // slot extra. Cuidado vem cedo pra capturar rotas frequentadas
  // fora-epoca antes que discovery as consuma.

  // 1. Top oportunidade — melhor casamento "hoje vale" + adequado
  pick('opportunity', (s) => s.opportunity);

  // 2. Cuidado — rota frequentada/completada do piloto que esta fora-epoca.
  pick(
    'caution',
    (s) =>
      s.reasons.includes('fora-epoca')
        ? (input.routeOpenCounts.get(s.rotaId) ?? 0) +
          (input.completedRotaIds.has(s.rotaId) ? 5 : 0)
        : 0,
    (s) =>
      s.reasons.includes('fora-epoca') &&
      ((input.routeOpenCounts.get(s.rotaId) ?? 0) > 0 ||
        input.completedRotaIds.has(s.rotaId)),
  );

  // 3. Discovery — alta novidade. Pode coexistir com baixa oportunidade.
  pick('discovery', (s) => s.novelty);

  // 4. Sazonal — rota em-epoca ainda nao escolhida e nao completada.
  pick(
    'seasonal',
    (s) => (s.inSeason ? s.opportunity : 0),
    (s) => s.inSeason && !s.reasons.includes('ja-completou'),
  );

  // 5. Slot final — combined geral pra preencher o feed ate maxCards.
  pick('opportunity', (s) => s.combined);

  return cards;
}
