import type {
  CatalogRoute,
  Confiabilidade,
  Dificuldade,
  PedagioPraca,
  SistemaCobranca,
} from '@/domains/catalog/types';
import rawCatalog from './routes.json';

let cached: CatalogRoute[] | null = null;

// ISO date used by `ultima_revisao`. Anchored on both ends so trailing junk
// like "2026-05-22T10:00" is rejected — the validator wants a calendar date,
// not a timestamp.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isPavimento(value: unknown): value is 'asfalto' | 'misto' | 'terra' {
  return value === 'asfalto' || value === 'misto' || value === 'terra';
}

function isNivelCurvas(value: unknown): value is 'baixo' | 'medio' | 'alto' {
  return value === 'baixo' || value === 'medio' || value === 'alto';
}

function isConfiabilidade(value: unknown): value is Confiabilidade {
  return value === 'alta' || value === 'media' || value === 'baixa';
}

function isDificuldade(value: unknown): value is Dificuldade {
  return (
    value === 'iniciante' ||
    value === 'intermediario' ||
    value === 'avancado'
  );
}

function isSistemaCobranca(value: unknown): value is SistemaCobranca {
  return value === 'fisica' || value === 'free_flow';
}

/**
 * Coerce a raw object into PedagioPraca only if the required fields shape up.
 * Returns null for malformed entries so the caller can drop them while still
 * keeping the surrounding route alive. Optional fields (km, concessionaria,
 * fonte_url) are forwarded only when they pass their own shape check.
 */
function pickPedagioPraca(value: unknown): PedagioPraca | null {
  if (!isObject(value)) return null;
  if (typeof value.nome !== 'string' || value.nome.trim().length === 0) {
    return null;
  }
  if (!isFiniteNumber(value.valor_moto_reais) || value.valor_moto_reais < 0) {
    return null;
  }
  if (!isSistemaCobranca(value.sistema)) return null;

  const out: PedagioPraca = {
    nome: value.nome,
    valor_moto_reais: value.valor_moto_reais,
    sistema: value.sistema,
  };
  if (isFiniteNumber(value.km) && value.km >= 0) {
    out.km = value.km;
  }
  if (
    typeof value.concessionaria === 'string' &&
    value.concessionaria.trim().length > 0
  ) {
    out.concessionaria = value.concessionaria;
  }
  if (
    typeof value.fonte_url === 'string' &&
    value.fonte_url.trim().length > 0
  ) {
    out.fonte_url = value.fonte_url;
  }
  return out;
}

/**
 * Dev-only console warning. The catalog client must never crash the app over
 * a mis-curated optional field, but in dev we want the noise so the curator
 * sees the typo and fixes the JSON. Guarded by `__DEV__` so production
 * bundles stay quiet.
 */
function warnDev(routeId: string, field: string, received: unknown): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.warn(
      `[catalog] route "${routeId}": optional field "${field}" has invalid value, ignoring. Received: ${JSON.stringify(received)}`,
    );
  }
}

/**
 * Strip optional metadata fields that fail shape validation. We never throw
 * here — the curated JSON is allowed to be partial, and a single bad value
 * (e.g. `confiabilidade: "muito alta"`) must degrade gracefully to "field
 * absent" rather than blocking the entire route. Validators in
 * `scripts/validate-catalog.ts` are the gatekeepers for hard errors.
 */
type CatalogRouteOptional = Pick<
  CatalogRoute,
  | 'ultima_revisao'
  | 'confiabilidade'
  | 'dificuldade'
  | 'melhor_epoca'
  | 'descricao_biker'
  | 'fontes_dados'
  | 'dicas_seguranca'
  | 'pedagios_detalhados'
>;

function pickValidatedOptional(
  value: Record<string, unknown>,
  routeId: string,
): CatalogRouteOptional {
  const out: CatalogRouteOptional = {};

  if (value.ultima_revisao !== undefined) {
    if (
      typeof value.ultima_revisao === 'string' &&
      ISO_DATE_RE.test(value.ultima_revisao)
    ) {
      out.ultima_revisao = value.ultima_revisao;
    } else {
      warnDev(routeId, 'ultima_revisao', value.ultima_revisao);
    }
  }
  if (value.confiabilidade !== undefined) {
    if (isConfiabilidade(value.confiabilidade)) {
      out.confiabilidade = value.confiabilidade;
    } else {
      warnDev(routeId, 'confiabilidade', value.confiabilidade);
    }
  }
  if (value.dificuldade !== undefined) {
    if (isDificuldade(value.dificuldade)) {
      out.dificuldade = value.dificuldade;
    } else {
      warnDev(routeId, 'dificuldade', value.dificuldade);
    }
  }
  if (value.melhor_epoca !== undefined) {
    if (
      typeof value.melhor_epoca === 'string' &&
      value.melhor_epoca.trim().length > 0
    ) {
      out.melhor_epoca = value.melhor_epoca;
    } else {
      warnDev(routeId, 'melhor_epoca', value.melhor_epoca);
    }
  }
  if (value.descricao_biker !== undefined) {
    if (
      typeof value.descricao_biker === 'string' &&
      value.descricao_biker.trim().length > 0
    ) {
      out.descricao_biker = value.descricao_biker;
    } else {
      warnDev(routeId, 'descricao_biker', value.descricao_biker);
    }
  }
  if (value.fontes_dados !== undefined) {
    if (isStringArray(value.fontes_dados)) {
      out.fontes_dados = value.fontes_dados;
    } else {
      warnDev(routeId, 'fontes_dados', value.fontes_dados);
    }
  }
  if (value.dicas_seguranca !== undefined) {
    if (isStringArray(value.dicas_seguranca)) {
      out.dicas_seguranca = value.dicas_seguranca;
    } else {
      warnDev(routeId, 'dicas_seguranca', value.dicas_seguranca);
    }
  }
  if (value.pedagios_detalhados !== undefined) {
    if (Array.isArray(value.pedagios_detalhados)) {
      const pracas = value.pedagios_detalhados
        .map(pickPedagioPraca)
        .filter((p): p is PedagioPraca => p !== null);
      // Mantemos array vazio explícito (sinaliza "auditado, sem pedágio")
      // mesmo que todos os itens caiam na validação — a curadoria humana
      // pode ter marcado de propósito como [] em routes.json.
      out.pedagios_detalhados = pracas;
      if (pracas.length !== value.pedagios_detalhados.length) {
        warnDev(routeId, 'pedagios_detalhados', value.pedagios_detalhados);
      }
    } else {
      warnDev(routeId, 'pedagios_detalhados', value.pedagios_detalhados);
    }
  }

  return out;
}

function validateCoord(value: unknown): asserts value is {
  cidade: string;
  latitude: number;
  longitude: number;
} {
  if (
    !isObject(value) ||
    typeof value.cidade !== 'string' ||
    !isFiniteNumber(value.latitude) ||
    !isFiniteNumber(value.longitude)
  ) {
    throw new Error('Invalid catalog coordinate shape');
  }
}

function validateRoute(value: unknown): CatalogRoute {
  if (!isObject(value)) {
    throw new Error('Catalog entry is not an object');
  }
  const id = value.rota_id;
  const name = value.nome_rota;
  const estado = value.estado_pais;
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof estado !== 'string'
  ) {
    throw new Error('Catalog entry missing id/name/estado_pais');
  }
  validateCoord(value.coordenada_inicio);
  validateCoord(value.coordenada_fim);
  if (
    !isFiniteNumber(value.distancia_total_km) ||
    !isFiniteNumber(value.total_pedagios_moto_reais)
  ) {
    throw new Error(`Route ${id}: distance/toll must be finite numbers`);
  }
  if (!isObject(value.caracteristicas)) {
    throw new Error(`Route ${id}: missing caracteristicas`);
  }
  const c = value.caracteristicas;
  if (
    !isPavimento(c.tipo_pavimento) ||
    !isNivelCurvas(c.nivel_curvas) ||
    !isFiniteNumber(c.trecho_critico_sem_posto_km)
  ) {
    throw new Error(`Route ${id}: invalid caracteristicas content`);
  }
  if (!isStringArray(value.interconexoes_ids)) {
    throw new Error(`Route ${id}: interconexoes_ids must be string[]`);
  }
  if (
    !Array.isArray(value.pontos_apoio_homologados) ||
    !Array.isArray(value.polilinha_simplificada)
  ) {
    throw new Error(`Route ${id}: support points / polyline must be arrays`);
  }

  // Strip the raw object down to the required fields and append the curated
  // optionals that survive shape validation. Spreading `value` would let
  // malformed extras leak through; the explicit projection keeps the shape
  // honest and the TypeScript inference accurate.
  const optional = pickValidatedOptional(value, id);
  const base = value as unknown as CatalogRoute;
  return {
    rota_id: base.rota_id,
    nome_rota: base.nome_rota,
    estado_pais: base.estado_pais,
    coordenada_inicio: base.coordenada_inicio,
    coordenada_fim: base.coordenada_fim,
    distancia_total_km: base.distancia_total_km,
    total_pedagios_moto_reais: base.total_pedagios_moto_reais,
    caracteristicas: base.caracteristicas,
    interconexoes_ids: base.interconexoes_ids,
    pontos_apoio_homologados: base.pontos_apoio_homologados,
    polilinha_simplificada: base.polilinha_simplificada,
    ...optional,
  };
}

/**
 * Load the bundled catalog JSON, validating each entry's shape so a typo in
 * `routes.json` surfaces as a clear error rather than a runtime NaN deep
 * inside the matcher. Cached in-process — the dataset is fixed at build time.
 */
export function loadCatalog(): CatalogRoute[] {
  if (cached !== null) return cached;
  if (!Array.isArray(rawCatalog)) {
    throw new Error('Catalog JSON root must be an array');
  }
  const validated = rawCatalog.map(validateRoute);
  cached = validated;
  return cached;
}

/**
 * Force a re-read of the bundled JSON. Only used by tests that need to
 * exercise the validation path with a fresh module-level cache.
 */
export function __resetCatalogCacheForTests(): void {
  cached = null;
}
