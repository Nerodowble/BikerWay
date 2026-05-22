import type { ComboioToken } from './types';

/**
 * Safe alphabet — excludes characters that are easily confused on small
 * displays / under glove operation: 0/O, 1/I/L. Source for the choice:
 * Crockford's Base32 minus a few extra ambiguous chars.
 */
const SAFE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const SAFE_CODE_REGEX = /^[A-Z0-9]{4}$/;

/**
 * Pick a uniformly-random char from SAFE_ALPHABET.
 * Math.random is acceptable here — the code is a session token, not a
 * cryptographic secret; collision resistance comes from the djb2 hash
 * suffix on the room name plus the 4-char namespace (≈ 31^4 ≈ 923K).
 */
function pickSafeChar(): string {
  const idx = Math.floor(Math.random() * SAFE_ALPHABET.length);
  // SAFE_ALPHABET length is a positive integer, idx is in range — non-null.
  return SAFE_ALPHABET.charAt(idx);
}

export function generateComboioCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += pickSafeChar();
  }
  return code;
}

/**
 * djb2 string hash, returned as a zero-padded 8-char lowercase hex string.
 * Deterministic, dependency-free, and good enough to disambiguate
 * room names — we are NOT using it as a security primitive.
 */
function djb2Hash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    // hash * 33 + c, kept in 32-bit unsigned space via the `| 0` trick + `>>> 0`
    hash = (((hash << 5) + hash) + input.charCodeAt(i)) | 0;
  }
  const unsigned = hash >>> 0;
  return unsigned.toString(16).padStart(8, '0');
}

export function buildRoomNameFromCode(code: string): string {
  const normalized = code.toUpperCase();
  return `bikerway_room_${normalized.toLowerCase()}_${djb2Hash(normalized)}`;
}

export function buildComboioToken(code?: string): ComboioToken {
  const resolvedCode = (code ?? generateComboioCode()).toUpperCase();
  return {
    code: resolvedCode,
    roomName: buildRoomNameFromCode(resolvedCode),
  };
}

export function isValidComboioCode(s: string): boolean {
  if (typeof s !== 'string') {
    return false;
  }
  const normalized = s.toUpperCase();
  if (!SAFE_CODE_REGEX.test(normalized)) {
    return false;
  }
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized.charAt(i);
    if (SAFE_ALPHABET.indexOf(ch) === -1) {
      return false;
    }
  }
  return true;
}
