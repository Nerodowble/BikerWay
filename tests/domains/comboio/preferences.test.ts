import {
  COMBOIO_PREF_KEYS,
  DEFAULT_COMBOIO_PREFERENCES,
  parseBoolPref,
} from '@/domains/comboio/preferences';

describe('parseBoolPref', () => {
  it('aceita "true" e "1"', () => {
    expect(parseBoolPref('true', false)).toBe(true);
    expect(parseBoolPref('1', false)).toBe(true);
  });
  it('aceita "false" e "0"', () => {
    expect(parseBoolPref('false', true)).toBe(false);
    expect(parseBoolPref('0', true)).toBe(false);
  });
  it('aceita maiusculas com whitespace', () => {
    expect(parseBoolPref('  TRUE  ', false)).toBe(true);
    expect(parseBoolPref(' FALSE ', true)).toBe(false);
  });
  it('cai pro fallback em valores invalidos', () => {
    expect(parseBoolPref(null, true)).toBe(true);
    expect(parseBoolPref(null, false)).toBe(false);
    expect(parseBoolPref('lixo', true)).toBe(true);
    expect(parseBoolPref('', false)).toBe(false);
  });
});

describe('COMBOIO_PREF_KEYS / DEFAULTS', () => {
  it('mapeia cada chave do tipo pra uma key SQLite com prefixo comboio.', () => {
    const expectedKeys: Array<keyof typeof COMBOIO_PREF_KEYS> = [
      'recordReplay',
      'showSpeedOnPin',
      'highlightStopped',
      'alertSeparation',
      'showOfficialRoute',
      'crossPathBanner',
    ];
    for (const k of expectedKeys) {
      expect(COMBOIO_PREF_KEYS[k]).toMatch(/^comboio\./);
    }
  });

  it('defaults seguem o brainstorm (replay/km-h OFF; resto ON)', () => {
    expect(DEFAULT_COMBOIO_PREFERENCES.recordReplay).toBe(false);
    expect(DEFAULT_COMBOIO_PREFERENCES.showSpeedOnPin).toBe(false);
    expect(DEFAULT_COMBOIO_PREFERENCES.highlightStopped).toBe(true);
    expect(DEFAULT_COMBOIO_PREFERENCES.alertSeparation).toBe(true);
    expect(DEFAULT_COMBOIO_PREFERENCES.showOfficialRoute).toBe(true);
    expect(DEFAULT_COMBOIO_PREFERENCES.crossPathBanner).toBe(true);
  });
});
