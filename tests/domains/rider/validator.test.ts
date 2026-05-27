import { validateRiderProfileInput } from '../../../src/domains/rider/validator';
import type { RiderProfileInput } from '../../../src/domains/rider/types';

function base(over: Partial<RiderProfileInput> = {}): Partial<RiderProfileInput> {
  return {
    displayName: 'Willian',
    cidade: 'Diadema',
    estado: 'SP',
    ...over,
  };
}

describe('validateRiderProfileInput', () => {
  it('accepts a minimal valid input (only required fields)', () => {
    const result = validateRiderProfileInput(base());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects displayName shorter than the minimum length', () => {
    const result = validateRiderProfileInput(base({ displayName: 'A' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'displayName')).toBe(true);
  });

  it('rejects displayName longer than 40 chars', () => {
    const long = 'a'.repeat(41);
    const result = validateRiderProfileInput(base({ displayName: long }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'displayName')).toBe(true);
  });

  it('rejects estado that is not exactly 2 uppercase letters', () => {
    const tooShort = validateRiderProfileInput(base({ estado: 'S' }));
    const lower = validateRiderProfileInput(base({ estado: 'sp' }));
    const tooLong = validateRiderProfileInput(base({ estado: 'SPS' }));
    const digits = validateRiderProfileInput(base({ estado: '12' }));

    expect(tooShort.valid).toBe(false);
    expect(lower.valid).toBe(false);
    expect(tooLong.valid).toBe(false);
    expect(digits.valid).toBe(false);
    // All should specifically fail on the estado field.
    for (const r of [tooShort, lower, tooLong, digits]) {
      expect(r.errors.some((e) => e.field === 'estado')).toBe(true);
    }
  });

  it('rejects cidade that is too short or too long', () => {
    expect(validateRiderProfileInput(base({ cidade: '' })).valid).toBe(false);
    expect(validateRiderProfileInput(base({ cidade: 'A' })).valid).toBe(false);
    expect(
      validateRiderProfileInput(base({ cidade: 'a'.repeat(61) })).valid,
    ).toBe(false);
  });

  it('accepts anosPilotando inside 0-80 (inclusive) and rejects outside', () => {
    expect(validateRiderProfileInput(base({ anosPilotando: 0 })).valid).toBe(
      true,
    );
    expect(validateRiderProfileInput(base({ anosPilotando: 80 })).valid).toBe(
      true,
    );
    expect(validateRiderProfileInput(base({ anosPilotando: -1 })).valid).toBe(
      false,
    );
    expect(validateRiderProfileInput(base({ anosPilotando: 81 })).valid).toBe(
      false,
    );
    // Non-integer should be rejected — the UI expects whole years only.
    expect(validateRiderProfileInput(base({ anosPilotando: 3.5 })).valid).toBe(
      false,
    );
  });

  it('rejects bio longer than 200 chars but accepts exactly 200', () => {
    const okBio = 'b'.repeat(200);
    const tooLong = 'b'.repeat(201);
    expect(validateRiderProfileInput(base({ bio: okBio })).valid).toBe(true);
    const bad = validateRiderProfileInput(base({ bio: tooLong }));
    expect(bad.valid).toBe(false);
    expect(bad.errors.some((e) => e.field === 'bio')).toBe(true);
  });

  it('rejects enum values not in the allowed sets', () => {
    const badGenero = validateRiderProfileInput(
      // Forcing a bogus value through `as` mirrors what would arrive from a
      // corrupt SQLite row or a buggy form — the validator must catch it.
      base({ genero: 'alien' as unknown as RiderProfileInput['genero'] }),
    );
    const badEstilo = validateRiderProfileInput(
      base({
        estiloPilotagem:
          'orbital' as unknown as RiderProfileInput['estiloPilotagem'],
      }),
    );
    const badPref = validateRiderProfileInput(
      base({
        preferenciaTempo:
          'tempestade' as unknown as RiderProfileInput['preferenciaTempo'],
      }),
    );
    expect(badGenero.valid).toBe(false);
    expect(badEstilo.valid).toBe(false);
    expect(badPref.valid).toBe(false);
  });
});
