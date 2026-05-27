/* eslint-disable no-console */
/**
 * scripts/validate-catalog.ts
 *
 * Validador standalone do catálogo BikerWay. Roda via:
 *   npx tsx scripts/validate-catalog.ts                  # valida o arquivo de produção
 *   npx tsx scripts/validate-catalog.ts caminho/foo.json # valida arquivo arbitrário
 *
 * POR QUÊ standalone (sem importar de src/domains/catalog/types.ts):
 * o domínio do catálogo está em iteração ativa e o validador precisa
 * permanecer estável mesmo quando o tipo do app evolui. Manter os tipos
 * espelhados aqui evita acoplamento e permite validar arquivos-candidatos
 * antes de fazer o merge no domínio.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Tipos espelhados — sincronizar manualmente com prompts/catalog-schema.json.
type Pavimento = 'asfalto' | 'misto' | 'terra';
type NivelCurvas = 'baixo' | 'medio' | 'alto';
type TipoPonto =
  | 'posto_gasolina'
  | 'mirante'
  | 'restaurante'
  | 'oficina_moto'
  | 'hotel'
  | 'ponto_historico';
type Confiabilidade = 'alta' | 'media' | 'baixa';
type Dificuldade = 'iniciante' | 'intermediario' | 'avancado';
type SistemaCobranca = 'fisica' | 'free_flow';

interface CoordCidade {
  cidade: string;
  latitude: number;
  longitude: number;
}

// Bounding box continental do Brasil. Folga para fronteiras (Oiapoque ~4.8°N,
// Chuí ~-33.7°S, AC ~-73.9°W). Trindade e demais ilhas oceânicas distantes
// ficam de fora propositalmente — não fazem sentido para um app de moto.
const BR_LAT_MIN = -34.0;
const BR_LAT_MAX = 5.5;
const BR_LNG_MIN = -74.0;
const BR_LNG_MAX = -34.0;

const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ESTADO_PAIS_RE = /^[A-Z]{2}(\/[A-Z]{2})*, Brasil$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const PAVIMENTOS: readonly Pavimento[] = ['asfalto', 'misto', 'terra'];
const NIVEIS: readonly NivelCurvas[] = ['baixo', 'medio', 'alto'];
const TIPOS_PONTO: readonly TipoPonto[] = [
  'posto_gasolina',
  'mirante',
  'restaurante',
  'oficina_moto',
  'hotel',
  'ponto_historico',
];
const CONFIABILIDADES: readonly Confiabilidade[] = ['alta', 'media', 'baixa'];
const DIFICULDADES: readonly Dificuldade[] = ['iniciante', 'intermediario', 'avancado'];
const SISTEMAS_COBRANCA: readonly SistemaCobranca[] = ['fisica', 'free_flow'];

// Folga de R$ 0,50 entre soma das praças e total_pedagios_moto_reais — cobre
// arredondamento de centavo entre 3-4 praças sem deixar passar erro grosseiro.
const PEDAGIO_SUM_TOLERANCE_REAIS = 0.5;

// 0.01° ≈ 1.1 km — folga para arredondamento de polyline sem deixar passar
// inversão de início/fim ou pontos descolados do trajeto real.
const POLY_ENDPOINT_TOL_DEG = 0.01;

// Cores ANSI sem dependência externa. NO_COLOR ou não-TTY desabilita.
const noColor = process.env.NO_COLOR !== undefined || !process.stdout.isTTY;
const c = {
  red: (s: string): string => (noColor ? s : `\x1b[31m${s}\x1b[0m`),
  green: (s: string): string => (noColor ? s : `\x1b[32m${s}\x1b[0m`),
  yellow: (s: string): string => (noColor ? s : `\x1b[33m${s}\x1b[0m`),
  cyan: (s: string): string => (noColor ? s : `\x1b[36m${s}\x1b[0m`),
  dim: (s: string): string => (noColor ? s : `\x1b[2m${s}\x1b[0m`),
  bold: (s: string): string => (noColor ? s : `\x1b[1m${s}\x1b[0m`),
};

interface ValidationError {
  routeIndex: number;
  routeId: string;
  path: string;
  message: string;
}

class ErrorCollector {
  private readonly errors: ValidationError[] = [];

  push(routeIndex: number, routeId: string, path: string, message: string): void {
    this.errors.push({ routeIndex, routeId, path, message });
  }

  get all(): readonly ValidationError[] {
    return this.errors;
  }

  get hasErrors(): boolean {
    return this.errors.length > 0;
  }
}

// Helpers genéricos — cada um responde UMA pergunta booleana clara.
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function inLatBR(v: number): boolean {
  return v >= BR_LAT_MIN && v <= BR_LAT_MAX;
}

function inLngBR(v: number): boolean {
  return v >= BR_LNG_MIN && v <= BR_LNG_MAX;
}

function within<T>(needle: T, haystack: readonly T[]): boolean {
  return haystack.includes(needle);
}

function validateCoord(
  value: unknown,
  ctx: { idx: number; id: string; path: string; collector: ErrorCollector },
): value is CoordCidade {
  const { idx, id, path, collector } = ctx;
  if (!isObject(value)) {
    collector.push(idx, id, path, `esperava objeto {cidade, latitude, longitude}, recebeu ${typeof value}`);
    return false;
  }
  let ok = true;
  if (!isNonEmptyString(value.cidade)) {
    collector.push(idx, id, `${path}.cidade`, 'string não-vazia esperada');
    ok = false;
  }
  if (!isFiniteNumber(value.latitude) || !inLatBR(value.latitude)) {
    collector.push(idx, id, `${path}.latitude`, `latitude fora do BR continental (${BR_LAT_MIN}..${BR_LAT_MAX}) — recebeu ${String(value.latitude)}`);
    ok = false;
  }
  if (!isFiniteNumber(value.longitude) || !inLngBR(value.longitude)) {
    collector.push(idx, id, `${path}.longitude`, `longitude fora do BR continental (${BR_LNG_MIN}..${BR_LNG_MAX}) — recebeu ${String(value.longitude)}`);
    ok = false;
  }
  return ok;
}

function validatePontoApoio(
  value: unknown,
  ctx: { idx: number; id: string; path: string; collector: ErrorCollector },
): void {
  const { idx, id, path, collector } = ctx;
  if (!isObject(value)) {
    collector.push(idx, id, path, 'ponto de apoio deve ser objeto');
    return;
  }
  if (!isNonEmptyString(value.tipo) || !within(value.tipo as TipoPonto, TIPOS_PONTO)) {
    collector.push(idx, id, `${path}.tipo`, `tipo inválido — esperado um de [${TIPOS_PONTO.join(', ')}], recebeu ${String(value.tipo)}`);
  }
  if (!isNonEmptyString(value.nome)) {
    collector.push(idx, id, `${path}.nome`, 'string não-vazia esperada');
  }
  if (!isFiniteNumber(value.latitude) || !inLatBR(value.latitude)) {
    collector.push(idx, id, `${path}.latitude`, `latitude fora do BR — recebeu ${String(value.latitude)}`);
  }
  if (!isFiniteNumber(value.longitude) || !inLngBR(value.longitude)) {
    collector.push(idx, id, `${path}.longitude`, `longitude fora do BR — recebeu ${String(value.longitude)}`);
  }
  if (!isNonEmptyString(value.descricao_biker) || value.descricao_biker.length < 20) {
    collector.push(idx, id, `${path}.descricao_biker`, 'descrição deve ter ao menos 20 caracteres explicando por que importa para o motociclista');
  }
}

function validatePolyline(
  poly: unknown,
  start: CoordCidade | undefined,
  end: CoordCidade | undefined,
  ctx: { idx: number; id: string; collector: ErrorCollector },
): void {
  const { idx, id, collector } = ctx;
  const path = 'polilinha_simplificada';
  if (!Array.isArray(poly)) {
    collector.push(idx, id, path, 'esperava array de pontos {lat,lng}');
    return;
  }
  if (poly.length < 5 || poly.length > 10) {
    collector.push(idx, id, path, `polilinha deve ter entre 5 e 10 pontos, recebeu ${poly.length}`);
  }
  poly.forEach((pt, i) => {
    if (!isObject(pt)) {
      collector.push(idx, id, `${path}[${i}]`, 'ponto deve ser objeto {lat,lng}');
      return;
    }
    if (!isFiniteNumber(pt.lat) || !inLatBR(pt.lat)) {
      collector.push(idx, id, `${path}[${i}].lat`, `lat fora do BR — recebeu ${String(pt.lat)}`);
    }
    if (!isFiniteNumber(pt.lng) || !inLngBR(pt.lng)) {
      collector.push(idx, id, `${path}[${i}].lng`, `lng fora do BR — recebeu ${String(pt.lng)}`);
    }
  });

  // Só cobra endpoints se já temos coords e extremos válidos — prioriza
  // erros estruturais antes de consistência geográfica.
  if (poly.length >= 2 && start && end) {
    const first = poly[0];
    const last = poly[poly.length - 1];
    if (isObject(first) && isFiniteNumber(first.lat) && isFiniteNumber(first.lng)) {
      if (
        Math.abs(first.lat - start.latitude) > POLY_ENDPOINT_TOL_DEG ||
        Math.abs(first.lng - start.longitude) > POLY_ENDPOINT_TOL_DEG
      ) {
        collector.push(
          idx,
          id,
          `${path}[0]`,
          `primeiro ponto da polyline (${first.lat}, ${first.lng}) não coincide com coordenada_inicio (${start.latitude}, ${start.longitude}) — tolerância ${POLY_ENDPOINT_TOL_DEG}°`,
        );
      }
    }
    if (isObject(last) && isFiniteNumber(last.lat) && isFiniteNumber(last.lng)) {
      if (
        Math.abs(last.lat - end.latitude) > POLY_ENDPOINT_TOL_DEG ||
        Math.abs(last.lng - end.longitude) > POLY_ENDPOINT_TOL_DEG
      ) {
        collector.push(
          idx,
          id,
          `${path}[${poly.length - 1}]`,
          `último ponto da polyline (${last.lat}, ${last.lng}) não coincide com coordenada_fim (${end.latitude}, ${end.longitude}) — tolerância ${POLY_ENDPOINT_TOL_DEG}°`,
        );
      }
    }
  }
}

function validateOptional(
  route: Record<string, unknown>,
  ctx: { idx: number; id: string; collector: ErrorCollector },
): void {
  const { idx, id, collector } = ctx;

  if (route.ultima_revisao !== undefined) {
    if (typeof route.ultima_revisao !== 'string' || !ISO_DATE_RE.test(route.ultima_revisao)) {
      collector.push(idx, id, 'ultima_revisao', 'deve ser string ISO YYYY-MM-DD');
    }
  }
  if (route.confiabilidade !== undefined) {
    if (!within(route.confiabilidade as Confiabilidade, CONFIABILIDADES)) {
      collector.push(idx, id, 'confiabilidade', `valor inválido — esperado um de [${CONFIABILIDADES.join(', ')}]`);
    }
  }
  if (route.dificuldade !== undefined) {
    if (!within(route.dificuldade as Dificuldade, DIFICULDADES)) {
      collector.push(idx, id, 'dificuldade', `valor inválido — esperado um de [${DIFICULDADES.join(', ')}]`);
    }
  }
  if (route.melhor_epoca !== undefined && !isNonEmptyString(route.melhor_epoca)) {
    collector.push(idx, id, 'melhor_epoca', 'se presente, deve ser string não vazia');
  }
  if (route.descricao_biker !== undefined) {
    if (!isNonEmptyString(route.descricao_biker) || route.descricao_biker.length < 60) {
      collector.push(idx, id, 'descricao_biker', 'se presente, deve ter ao menos 60 caracteres');
    }
  }
  if (route.fontes_dados !== undefined) {
    if (!Array.isArray(route.fontes_dados) || route.fontes_dados.some((u) => typeof u !== 'string' || u.length < 8)) {
      collector.push(idx, id, 'fontes_dados', 'se presente, deve ser array de URLs (strings com >=8 chars)');
    }
  }
  if (route.dicas_seguranca !== undefined) {
    if (!Array.isArray(route.dicas_seguranca) || route.dicas_seguranca.some((d) => typeof d !== 'string' || d.length < 10)) {
      collector.push(idx, id, 'dicas_seguranca', 'se presente, deve ser array de strings com >=10 chars');
    }
  }
  if (route.pedagios_detalhados !== undefined) {
    validatePedagiosDetalhados(
      route.pedagios_detalhados,
      isFiniteNumber(route.total_pedagios_moto_reais) ? route.total_pedagios_moto_reais : null,
      { idx, id, collector },
    );
  }
}

function validatePedagiosDetalhados(
  value: unknown,
  declaredTotal: number | null,
  ctx: { idx: number; id: string; collector: ErrorCollector },
): void {
  const { idx, id, collector } = ctx;
  const path = 'pedagios_detalhados';
  if (!Array.isArray(value)) {
    collector.push(idx, id, path, 'se presente, deve ser array de praças (use [] para rotas sem pedágio)');
    return;
  }
  // Empty array is valid — explicit "we checked and there are no tolls".
  let sum = 0;
  let allValid = true;
  value.forEach((praca, i) => {
    const itemPath = `${path}[${i}]`;
    if (!isObject(praca)) {
      collector.push(idx, id, itemPath, 'praça deve ser objeto');
      allValid = false;
      return;
    }
    if (!isNonEmptyString(praca.nome)) {
      collector.push(idx, id, `${itemPath}.nome`, 'string não-vazia esperada');
      allValid = false;
    }
    if (!isFiniteNumber(praca.valor_moto_reais) || praca.valor_moto_reais < 0) {
      collector.push(idx, id, `${itemPath}.valor_moto_reais`, `deve ser número >= 0 — recebeu ${String(praca.valor_moto_reais)}`);
      allValid = false;
    } else {
      sum += praca.valor_moto_reais;
    }
    if (!within(praca.sistema as SistemaCobranca, SISTEMAS_COBRANCA)) {
      collector.push(idx, id, `${itemPath}.sistema`, `esperado um de [${SISTEMAS_COBRANCA.join(', ')}], recebeu ${String(praca.sistema)}`);
      allValid = false;
    }
    if (praca.km !== undefined && (!isFiniteNumber(praca.km) || praca.km < 0)) {
      collector.push(idx, id, `${itemPath}.km`, `se presente, deve ser número >= 0 — recebeu ${String(praca.km)}`);
    }
    if (praca.concessionaria !== undefined && !isNonEmptyString(praca.concessionaria)) {
      collector.push(idx, id, `${itemPath}.concessionaria`, 'se presente, deve ser string não-vazia');
    }
    if (praca.fonte_url !== undefined && (typeof praca.fonte_url !== 'string' || praca.fonte_url.length < 8)) {
      collector.push(idx, id, `${itemPath}.fonte_url`, 'se presente, deve ser URL com >=8 caracteres');
    }
  });
  // Coerência: a soma das praças tem que bater com total_pedagios_moto_reais
  // dentro da folga de centavos. Pega curador que esqueceu de atualizar o
  // total ao alterar uma praça.
  if (allValid && declaredTotal !== null) {
    const delta = Math.abs(sum - declaredTotal);
    if (delta > PEDAGIO_SUM_TOLERANCE_REAIS) {
      collector.push(
        idx,
        id,
        path,
        `soma de valor_moto_reais (R$ ${sum.toFixed(2)}) não bate com total_pedagios_moto_reais (R$ ${declaredTotal.toFixed(2)}) — diferença R$ ${delta.toFixed(2)} excede tolerância de R$ ${PEDAGIO_SUM_TOLERANCE_REAIS.toFixed(2)}`,
      );
    }
  }
}

function validateRoute(
  raw: unknown,
  idx: number,
  collector: ErrorCollector,
): { id: string | null } {
  if (!isObject(raw)) {
    collector.push(idx, '<sem id>', '', `rota deve ser objeto, recebeu ${Array.isArray(raw) ? 'array' : typeof raw}`);
    return { id: null };
  }
  const route = raw;
  const id = typeof route.rota_id === 'string' ? route.rota_id : '<sem id>';

  // rota_id
  if (!isNonEmptyString(route.rota_id) || !KEBAB_RE.test(route.rota_id)) {
    collector.push(idx, id, 'rota_id', 'deve ser kebab-case (regex ^[a-z0-9]+(-[a-z0-9]+)*$)');
  }

  // nome_rota
  if (!isNonEmptyString(route.nome_rota)) {
    collector.push(idx, id, 'nome_rota', 'string não-vazia esperada');
  }

  // estado_pais
  if (!isNonEmptyString(route.estado_pais) || !ESTADO_PAIS_RE.test(route.estado_pais)) {
    collector.push(idx, id, 'estado_pais', 'deve seguir padrão "UF[/UF...], Brasil" (ex: "SC, Brasil" ou "MG/SP/RJ, Brasil")');
  }

  // coordenadas
  const inicioOk = validateCoord(route.coordenada_inicio, { idx, id, path: 'coordenada_inicio', collector });
  const fimOk = validateCoord(route.coordenada_fim, { idx, id, path: 'coordenada_fim', collector });
  const start = inicioOk ? (route.coordenada_inicio as CoordCidade) : undefined;
  const end = fimOk ? (route.coordenada_fim as CoordCidade) : undefined;

  // distancia
  if (!isFiniteNumber(route.distancia_total_km) || route.distancia_total_km <= 0) {
    collector.push(idx, id, 'distancia_total_km', `deve ser número > 0 — recebeu ${String(route.distancia_total_km)}`);
  } else if (route.distancia_total_km < 20) {
    collector.push(idx, id, 'distancia_total_km', `rota com menos de 20km não atende ao critério de aceite do BikerWay — recebeu ${route.distancia_total_km}`);
  } else if (route.distancia_total_km > 3000) {
    collector.push(idx, id, 'distancia_total_km', `mais de 3000km é improvável (provável erro de unidade) — recebeu ${route.distancia_total_km}`);
  }

  // pedagio
  if (!isFiniteNumber(route.total_pedagios_moto_reais) || route.total_pedagios_moto_reais < 0) {
    collector.push(idx, id, 'total_pedagios_moto_reais', `deve ser número >= 0 — recebeu ${String(route.total_pedagios_moto_reais)}`);
  }

  // caracteristicas
  if (!isObject(route.caracteristicas)) {
    collector.push(idx, id, 'caracteristicas', 'objeto esperado');
  } else {
    const car = route.caracteristicas;
    if (!within(car.tipo_pavimento as Pavimento, PAVIMENTOS)) {
      collector.push(idx, id, 'caracteristicas.tipo_pavimento', `esperado um de [${PAVIMENTOS.join(', ')}], recebeu ${String(car.tipo_pavimento)}`);
    }
    if (!within(car.nivel_curvas as NivelCurvas, NIVEIS)) {
      collector.push(idx, id, 'caracteristicas.nivel_curvas', `esperado um de [${NIVEIS.join(', ')}], recebeu ${String(car.nivel_curvas)}`);
    }
    if (!isFiniteNumber(car.trecho_critico_sem_posto_km) || car.trecho_critico_sem_posto_km < 0) {
      collector.push(idx, id, 'caracteristicas.trecho_critico_sem_posto_km', `deve ser número >= 0 — recebeu ${String(car.trecho_critico_sem_posto_km)}`);
    }
  }

  // interconexoes
  if (!Array.isArray(route.interconexoes_ids)) {
    collector.push(idx, id, 'interconexoes_ids', 'array esperado (use [] se nenhuma)');
  } else {
    route.interconexoes_ids.forEach((conn, i) => {
      if (typeof conn !== 'string' || !KEBAB_RE.test(conn)) {
        collector.push(idx, id, `interconexoes_ids[${i}]`, `id de conexão deve ser kebab-case — recebeu ${String(conn)}`);
      }
    });
    const dedup = new Set(route.interconexoes_ids);
    if (dedup.size !== route.interconexoes_ids.length) {
      collector.push(idx, id, 'interconexoes_ids', 'há ids duplicados');
    }
  }

  // pontos_apoio
  if (!Array.isArray(route.pontos_apoio_homologados) || route.pontos_apoio_homologados.length < 1) {
    collector.push(idx, id, 'pontos_apoio_homologados', 'array com ao menos 1 ponto esperado');
  } else {
    if (route.pontos_apoio_homologados.length > 12) {
      collector.push(idx, id, 'pontos_apoio_homologados', `máximo de 12 pontos por rota — recebeu ${route.pontos_apoio_homologados.length}`);
    }
    route.pontos_apoio_homologados.forEach((p, i) => {
      validatePontoApoio(p, { idx, id, path: `pontos_apoio_homologados[${i}]`, collector });
    });
    const temPosto = route.pontos_apoio_homologados.some(
      (p): boolean => isObject(p) && p.tipo === 'posto_gasolina',
    );
    if (!temPosto) {
      collector.push(idx, id, 'pontos_apoio_homologados', 'cada rota deve ter ao menos 1 ponto do tipo posto_gasolina');
    }
  }

  // polilinha
  validatePolyline(route.polilinha_simplificada, start, end, { idx, id, collector });

  // opcionais
  validateOptional(route, { idx, id, collector });

  return { id: typeof route.rota_id === 'string' ? route.rota_id : null };
}

interface RunSummary {
  filePath: string;
  total: number;
  errors: readonly ValidationError[];
}

function loadAndParse(filePath: string): unknown {
  if (!existsSync(filePath)) {
    throw new Error(`arquivo não encontrado: ${filePath}`);
  }
  const raw = readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`JSON inválido em ${filePath}: ${msg}`);
  }
}

function validateCatalog(parsed: unknown, collector: ErrorCollector): number {
  if (!Array.isArray(parsed)) {
    collector.push(-1, '<root>', '', 'arquivo raiz deve ser um array JSON de rotas');
    return 0;
  }

  const seenIds = new Map<string, number>();
  parsed.forEach((route, idx) => {
    const { id } = validateRoute(route, idx, collector);
    if (id !== null) {
      const prev = seenIds.get(id);
      if (prev !== undefined) {
        collector.push(
          idx,
          id,
          'rota_id',
          `rota_id duplicado — também aparece no índice ${prev}`,
        );
      } else {
        seenIds.set(id, idx);
      }
    }
  });

  return parsed.length;
}

function printReport(summary: RunSummary): void {
  console.log('');
  console.log(c.bold(c.cyan('BikerWay — Validador de Catálogo')));
  console.log(c.dim(`arquivo: ${summary.filePath}`));
  console.log(c.dim(`rotas processadas: ${summary.total}`));
  console.log('');

  if (summary.errors.length === 0) {
    console.log(c.green(`OK — ${summary.total} rota(s) válida(s).`));
    return;
  }

  console.log(c.red(`${summary.errors.length} erro(s) encontrado(s):`));
  console.log('');

  // Agrupa por índice de rota para facilitar leitura.
  const byRoute = new Map<number, ValidationError[]>();
  for (const e of summary.errors) {
    const arr = byRoute.get(e.routeIndex) ?? [];
    arr.push(e);
    byRoute.set(e.routeIndex, arr);
  }

  const sortedIdx = [...byRoute.keys()].sort((a, b) => a - b);
  for (const idx of sortedIdx) {
    const errs = byRoute.get(idx) ?? [];
    const head = idx < 0
      ? c.yellow('  [ESTRUTURA RAIZ]')
      : c.yellow(`  [rota #${idx} — ${errs[0]?.routeId ?? '<sem id>'}]`);
    console.log(head);
    for (const e of errs) {
      const where = e.path === '' ? '(raiz)' : e.path;
      console.log(`    ${c.red('x')} ${c.bold(where)}: ${e.message}`);
    }
    console.log('');
  }

  console.log(c.dim('Dica: corrija e re-rode `npx tsx scripts/validate-catalog.ts <arquivo>`.'));
}

function main(): void {
  const argPath = process.argv[2];
  // Default: validar o catálogo de produção atual.
  const target = argPath
    ? resolve(process.cwd(), argPath)
    : resolve(process.cwd(), 'src/infrastructure/catalog/routes.json');

  const collector = new ErrorCollector();

  let total = 0;
  try {
    const parsed = loadAndParse(target);
    total = validateCatalog(parsed, collector);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(c.red(`Falha ao carregar/parsear: ${msg}`));
    process.exit(1);
  }

  printReport({ filePath: target, total, errors: collector.all });
  process.exit(collector.hasErrors ? 1 : 0);
}

main();
