/**
 * F34.5 — Ping de localização no mapa. Long-press num ponto do mapa
 * dispara "ping aqui" pros outros peers do comboio verem (pin pulsante).
 *
 * V1: visual local-only. O pin renderiza no MEU mapa por 45s. Outros
 * peers nao recebem ainda — propagacao P2P (wire `comboio.ping {...}`)
 * fica como F34.5.1.
 *
 * Cada peer pode ter no maximo 1 ping ativo. Novo ping substitui o antigo
 * (do mesmo peer). TTL: 45 segundos.
 */

export const PING_TTL_MS = 45_000;

export interface ComboioPing {
  /** Peer id do autor do ping. Local user usa 'self'. */
  peerId: string;
  /** Cidade ou letra inicial do autor (mostrada no pin). */
  initial: string;
  latitude: number;
  longitude: number;
  /** Epoch ms — quando o ping foi criado. */
  createdAt: number;
}

/** True quando o ping passou do TTL. */
export function isPingExpired(
  ping: Pick<ComboioPing, 'createdAt'>,
  now: number = Date.now(),
): boolean {
  return now - ping.createdAt > PING_TTL_MS;
}

/** Filtra pings ainda válidos. Pure pra testes. */
export function pruneExpiredPings(
  pings: ReadonlyArray<ComboioPing>,
  now: number = Date.now(),
): ComboioPing[] {
  return pings.filter((p) => !isPingExpired(p, now));
}
