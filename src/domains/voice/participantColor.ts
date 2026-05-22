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

export const PARTICIPANT_PALETTE: readonly string[] = [
  '#4FC3F7', // sky blue
  '#81C784', // light green
  '#BA68C8', // purple
  '#FFD54F', // amber
  '#F06292', // pink
  '#4DB6AC', // teal
  '#A1887F', // mocha
  '#E57373', // soft red
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
