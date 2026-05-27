/**
 * F29.4 — Anti-abuso local do SOS Comunitario.
 *
 * Politica (deriva da regra de negocio do spec original):
 *  - 3+ cancelamentos em uma janela de 7 dias = trote → trava por 24h.
 *  - Janela e ROLLING — toda hora a janela "anda", cancelamentos
 *    antigos saem por idade. Quando o piloto cair pra <3 cancels em
 *    janela, o desbloqueio acontece naturalmente.
 *  - O ultimo cancel em janela de abuso prolonga a trava (lock_until =
 *    max(lock_atual, ultimo_cancel + 24h)). Evita gambiarra de cancelar
 *    24h pra ficar limpo.
 *
 * Decidido stateless: a funcao computa a trava a partir da lista dos
 * cancelamentos persistidos, sem precisar de campo `locked_until`
 * armazenado. Mais simples e nao tem "stored state drift". Em troca,
 * uma chamada lazy sempre faz a contagem — mas a lista nunca passa de
 * dezenas de itens (uso normal e ~0 cancels/dia).
 *
 * Sem backend, esta protecao e local. Reinstalar o app limpa o
 * historico — known limitation, documentada pro user no Settings.
 */

export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
export const LOCK_DURATION_MS = 24 * 60 * 60 * 1000;
export const ABUSE_THRESHOLD = 3;

export interface AbuseStatus {
  /** true se o disparo de SOS esta bloqueado neste instante. */
  locked: boolean;
  /** epoch ms quando o bloqueio expira; null quando nao ha bloqueio. */
  unlockAt: number | null;
  /** Contagem de cancels nos ultimos 7 dias. */
  cancelsLast7d: number;
}

/**
 * Avalia o estado de abuso pra um conjunto de timestamps de cancelamento
 * e o instante atual. PURE — nao toca em store, repo nem disco.
 *
 * `cancelTimestamps` pode vir em qualquer ordem; a funcao filtra os que
 * caem na janela de 7 dias e usa o mais recente como ancora pra calcular
 * o unlockAt.
 */
export function evaluateAbuseStatus(
  cancelTimestamps: readonly number[],
  now: number,
): AbuseStatus {
  const cutoff = now - SEVEN_DAYS_MS;
  const fresh = cancelTimestamps
    .filter((t) => Number.isFinite(t) && t > cutoff)
    .sort((a, b) => b - a);

  if (fresh.length < ABUSE_THRESHOLD) {
    return { locked: false, unlockAt: null, cancelsLast7d: fresh.length };
  }

  // Ancora a trava no cancelamento mais recente — assim, cada novo trote
  // dentro da janela renova a trava de 24h. Garante que o piloto nao
  // contorne ficando "limpo" so pra rentar trotinhar de novo.
  const mostRecent = fresh[0];
  if (mostRecent === undefined) {
    // Defensivo: filter+sort acima garante fresh[0], mas TS nao prova.
    return { locked: false, unlockAt: null, cancelsLast7d: fresh.length };
  }
  const unlockAt = mostRecent + LOCK_DURATION_MS;
  return {
    locked: unlockAt > now,
    unlockAt: unlockAt > now ? unlockAt : null,
    cancelsLast7d: fresh.length,
  };
}

/**
 * Formata a duracao restante de uma trava em "Xh YYmin" ou "X min" pra
 * exibir na UI. Recebe ms positivos; entrada <=0 vira "0 min".
 */
export function formatLockRemaining(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalMin = Math.ceil(safe / 60_000);
  if (totalMin < 60) return `${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (min === 0) return `${hours}h`;
  return `${hours}h ${min}min`;
}
