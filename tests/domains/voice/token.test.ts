import {
  buildComboioToken,
  buildRoomNameFromCode,
  generateComboioCode,
  isValidComboioCode,
} from '../../../src/domains/voice/token';

const SAFE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

describe('generateComboioCode', () => {
  it('returns a 4-char string composed solely of safe-alphabet chars', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateComboioCode();
      expect(code).toHaveLength(4);
      for (const ch of code) {
        expect(SAFE_ALPHABET.includes(ch)).toBe(true);
      }
    }
  });

  it('1000 calls yield at least 800 unique codes (statistical sanity check)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      seen.add(generateComboioCode());
    }
    expect(seen.size).toBeGreaterThanOrEqual(800);
  });
});

describe('isValidComboioCode', () => {
  it('accepts a well-formed uppercase code', () => {
    expect(isValidComboioCode('A3K9')).toBe(true);
  });

  it('accepts lowercase input by normalising to uppercase first', () => {
    expect(isValidComboioCode('a3k9')).toBe(true);
  });

  it('rejects codes shorter or longer than 4 chars', () => {
    expect(isValidComboioCode('ABC')).toBe(false);
    expect(isValidComboioCode('ABCDE')).toBe(false);
    expect(isValidComboioCode('')).toBe(false);
  });

  it('rejects codes containing banned (confusable) characters', () => {
    // O, 1, I, L are all banned to keep the code glove-friendly.
    expect(isValidComboioCode('O1IL')).toBe(false);
    expect(isValidComboioCode('A0K9')).toBe(false);
    expect(isValidComboioCode('A1K9')).toBe(false);
    expect(isValidComboioCode('AIK9')).toBe(false);
    expect(isValidComboioCode('ALK9')).toBe(false);
  });

  it('rejects mixed-case content that contains non-alphanumeric chars', () => {
    expect(isValidComboioCode('abc1')).toBe(false); // contains banned "1"
    expect(isValidComboioCode('A-K9')).toBe(false);
    expect(isValidComboioCode('A K9')).toBe(false);
  });
});

describe('buildRoomNameFromCode', () => {
  it('starts with the lowercased code prefix and ends with 8 hex chars', () => {
    const room = buildRoomNameFromCode('A3K9');
    expect(room.startsWith('bikerway_room_a3k9_')).toBe(true);
    const tail = room.slice('bikerway_room_a3k9_'.length);
    expect(tail).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic for the same code', () => {
    expect(buildRoomNameFromCode('A3K9')).toBe(buildRoomNameFromCode('A3K9'));
  });

  it('produces different room names for different codes (smoke test)', () => {
    const a = buildRoomNameFromCode('A3K9');
    const b = buildRoomNameFromCode('B4M2');
    expect(a).not.toBe(b);
  });

  it('treats lowercase and uppercase code as the same logical code', () => {
    expect(buildRoomNameFromCode('a3k9')).toBe(buildRoomNameFromCode('A3K9'));
  });
});

describe('buildComboioToken', () => {
  it('uses the supplied code (uppercased) when provided', () => {
    const token = buildComboioToken('a3k9');
    expect(token.code).toBe('A3K9');
    expect(token.roomName).toBe(buildRoomNameFromCode('A3K9'));
  });

  it('generates a fresh, valid code when none is provided', () => {
    const token = buildComboioToken();
    expect(token.code).toHaveLength(4);
    expect(isValidComboioCode(token.code)).toBe(true);
    expect(token.roomName.startsWith(`bikerway_room_${token.code.toLowerCase()}_`)).toBe(true);
  });
});
