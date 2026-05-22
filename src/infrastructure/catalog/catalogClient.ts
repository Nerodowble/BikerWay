import type { CatalogRoute } from '@/domains/catalog/types';
import rawCatalog from './routes.json';

let cached: CatalogRoute[] | null = null;

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

  return value as unknown as CatalogRoute;
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
