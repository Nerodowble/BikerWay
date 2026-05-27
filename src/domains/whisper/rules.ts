import {
  WHISPER_DEDUP_RADIUS_M,
  WHISPER_DEDUP_WINDOW_MS,
  WHISPER_TTL_MS,
  type WhisperReport,
} from './types';

/**
 * F35.9 — Regras puras anti-abuso e de dedup do Whisper.
 *
 * Mantidas isoladas do store pra testar determinacionalmente. O store
 * chama estas funcoes ao publicar e ao receber.
 *
 * F35.9.1 — Cooldown global por tempo foi REMOVIDO. O anti-spam fica so
 * no `findDuplicate` (mesmo kind + raio + janela). Razao: piloto pode
 * encontrar problema agora E outro a 1km depois — bloquear por 1h era
 * restritivo demais.
 */

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineMeters(
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
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * 1000;
}

/** True quando o report passou do TTL e deve ser descartado. */
export function isExpired(
  report: Pick<WhisperReport, 'createdAt'>,
  now: number = Date.now(),
): boolean {
  return now - report.createdAt > WHISPER_TTL_MS;
}

/**
 * Encontra um report existente que duplica `candidate` (mesmo `kind`,
 * coords dentro do raio de dedup, dentro da janela temporal). Retorna o
 * report duplicado ou `null`.
 */
export function findDuplicate(
  existing: ReadonlyArray<WhisperReport>,
  candidate: Pick<
    WhisperReport,
    'kind' | 'latitude' | 'longitude' | 'createdAt'
  >,
): WhisperReport | null {
  for (const r of existing) {
    if (r.kind !== candidate.kind) continue;
    if (Math.abs(r.createdAt - candidate.createdAt) > WHISPER_DEDUP_WINDOW_MS) {
      continue;
    }
    const d = haversineMeters(
      { latitude: r.latitude, longitude: r.longitude },
      { latitude: candidate.latitude, longitude: candidate.longitude },
    );
    if (d <= WHISPER_DEDUP_RADIUS_M) return r;
  }
  return null;
}

/**
 * Mescla um novo report numa lista existente:
 *   - filtra expirados ja na entrada (cleanup oportunistico)
 *   - se for duplicata (findDuplicate retorna existente), substitui pelo
 *     mais recente (mantem aviso "atualizado")
 *   - senao prepende
 * Ordenado descendente por `createdAt`.
 */
export function mergeReport(
  existing: ReadonlyArray<WhisperReport>,
  incoming: WhisperReport,
  now: number = Date.now(),
): WhisperReport[] {
  // Limpa expirados primeiro
  const fresh = existing.filter((r) => !isExpired(r, now));
  if (isExpired(incoming, now)) return fresh.slice();
  // Dedup: ja vimos esse id?
  if (fresh.some((r) => r.id === incoming.id)) return fresh.slice();
  const dup = findDuplicate(fresh, incoming);
  let next: WhisperReport[];
  if (dup) {
    // Pega o mais recente; se incoming for newer, substitui
    if (incoming.createdAt > dup.createdAt) {
      next = fresh.map((r) => (r.id === dup.id ? incoming : r));
    } else {
      next = fresh.slice();
    }
  } else {
    next = [incoming, ...fresh];
  }
  next.sort((a, b) => b.createdAt - a.createdAt);
  return next;
}

/**
 * Verifica geocerca: o usuario esteve dentro do raio de algum ponto da
 * polyline da rota nos ultimos 30 min? Recebe um historico de posicoes
 * (apenas pra esta sessao) e a polyline da rota.
 */
export function isWithinGeofence(
  positionHistory: ReadonlyArray<{
    latitude: number;
    longitude: number;
    timestamp: number;
  }>,
  polyline: ReadonlyArray<{ latitude: number; longitude: number }>,
  options?: { radiusMeters?: number; windowMs?: number; now?: number },
): boolean {
  const radius = options?.radiusMeters ?? 500;
  const windowMs =
    options?.windowMs ?? 30 * 60 * 1000;
  const now = options?.now ?? Date.now();
  if (polyline.length === 0) return false;
  const since = now - windowMs;
  for (const pos of positionHistory) {
    if (pos.timestamp < since) continue;
    for (const p of polyline) {
      if (haversineMeters(pos, p) <= radius) return true;
    }
  }
  return false;
}

/** Limpa reports expirados (uso publico — store pode chamar periodicamente). */
export function pruneExpired(
  reports: ReadonlyArray<WhisperReport>,
  now: number = Date.now(),
): WhisperReport[] {
  return reports.filter((r) => !isExpired(r, now));
}
