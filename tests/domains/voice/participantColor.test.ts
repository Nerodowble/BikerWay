import {
  PARTICIPANT_PALETTE,
  colorForParticipant,
  initialForParticipant,
} from '@/domains/voice/participantColor';

describe('PARTICIPANT_PALETTE', () => {
  it('tem 15 cores (F34.1 — max de peers do comboio)', () => {
    expect(PARTICIPANT_PALETTE).toHaveLength(15);
  });

  it('todas as cores sao hex validos #RRGGBB', () => {
    for (const c of PARTICIPANT_PALETTE) {
      expect(c).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('nao tem duplicatas', () => {
    expect(new Set(PARTICIPANT_PALETTE).size).toBe(PARTICIPANT_PALETTE.length);
  });
});

describe('colorForParticipant', () => {
  it('e deterministico (mesmo id sempre devolve mesma cor)', () => {
    expect(colorForParticipant('peer-1')).toBe(colorForParticipant('peer-1'));
    expect(colorForParticipant('long-peer-id-abc')).toBe(
      colorForParticipant('long-peer-id-abc'),
    );
  });

  it('distribui ids diferentes razoavelmente bem em 15 buckets', () => {
    const buckets = new Set<string>();
    for (let i = 0; i < 30; i += 1) {
      buckets.add(colorForParticipant(`peer-${i}`));
    }
    // 30 peers em 15 buckets deveria pelo menos popular metade
    expect(buckets.size).toBeGreaterThanOrEqual(8);
  });

  it('retorna cor valida pra ids invalidos', () => {
    expect(colorForParticipant('')).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe('initialForParticipant', () => {
  it('extrai primeira letra maiuscula', () => {
    expect(initialForParticipant('Willian')).toBe('W');
    expect(initialForParticipant('pedro')).toBe('P');
  });
  it('aceita acentos', () => {
    expect(initialForParticipant('Êdson')).toBe('Ê');
  });
  it('fallback "?" pra entradas vazias', () => {
    expect(initialForParticipant('')).toBe('?');
    expect(initialForParticipant('   ')).toBe('?');
    expect(initialForParticipant(null)).toBe('?');
    expect(initialForParticipant(undefined)).toBe('?');
  });
  it('trim antes de extrair', () => {
    expect(initialForParticipant('   Maria')).toBe('M');
  });
});
