/**
 * Deterministic color picker for comboio participants.
 *
 * Goal: each rider gets a visually distinct tag colour next to their name so
 * the riders can tell each other apart at a glance, especially when names
 * are similar ("João" / "Joao") or empty ("Piloto").
 *
 * Determinism matters because both the local screen and the remote rider's
 * screen MUST agree on which colour belongs to which participant. We hash
 * the peer id (which is identical across all devices in the room) into a
 * fixed palette index.
 *
 * Palette is hand-picked for biker dark theme: high contrast against
 * `#121212`, no two adjacent hues, no near-orange so the rider's accent
 * (`#FF6B00`) keeps its semantic meaning ("the BikerWay app brand").
 */

// F34.1 — Paleta expandida pra 15 cores (do brainstorm) distantes em HSL.
// Hand-picked pra: alto contraste em dark theme (#121212), nao-adjacentes
// em hue, sem invadir a faixa do brand laranja (#FF6B00 ~= hue 22deg).
// Quando o comboio chega ao max de 15 peers (limite por F34), cada um
// ainda tem cor unica via mod hash.
export const PARTICIPANT_PALETTE: readonly string[] = [
  '#4FC3F7', //   1 — sky blue (200deg)
  '#81C784', //   2 — light green (120deg)
  '#BA68C8', //   3 — purple (288deg)
  '#FFD54F', //   4 — amber (47deg)
  '#F06292', //   5 — pink (340deg)
  '#4DB6AC', //   6 — teal (174deg)
  '#A1887F', //   7 — mocha (16deg, lightness baixa pra nao bater no laranja)
  '#E57373', //   8 — soft red (0deg)
  '#7986CB', //   9 — indigo (231deg)
  '#AED581', //  10 — lime (89deg)
  '#FF8A65', //  11 — coral (14deg — distinto do brand pela saturation)
  '#9575CD', //  12 — lavender (260deg)
  '#64B5F6', //  13 — light blue (210deg)
  '#DCE775', //  14 — olive (66deg)
  '#4DD0E1', //  15 — cyan (187deg)
] as const;

/**
 * djb2-style 32-bit hash, returned as a non-negative integer so we can
 * mod into the palette safely. Deterministic + dependency-free.
 */
function hashToInt(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (((hash << 5) + hash) + input.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

export function colorForParticipant(peerId: string): string {
  if (!peerId || PARTICIPANT_PALETTE.length === 0) {
    return PARTICIPANT_PALETTE[0] ?? '#888888';
  }
  const idx = hashToInt(peerId) % PARTICIPANT_PALETTE.length;
  // PARTICIPANT_PALETTE is readonly + non-empty + idx is in range, so the
  // fallback is just for noUncheckedIndexedAccess.
  return PARTICIPANT_PALETTE[idx] ?? '#888888';
}

/**
 * F34.1 — Inicial maiuscula do nome do peer pra usar no badge da label.
 * Defensiva contra `null`/`undefined`/string vazia → cai pra '?'. Suporta
 * sobrenome composto pegando so a primeira letra do primeiro nome valido.
 */
export function initialForParticipant(displayName?: string | null): string {
  if (!displayName) return '?';
  const trimmed = displayName.trim();
  if (trimmed.length === 0) return '?';
  // Pega primeiro caractere imprimivel (letra ASCII OU acento)
  const firstChar = trimmed.charAt(0).toUpperCase();
  return firstChar.length === 0 ? '?' : firstChar;
}
