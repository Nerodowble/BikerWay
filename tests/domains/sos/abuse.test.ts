import {
  ABUSE_THRESHOLD,
  LOCK_DURATION_MS,
  SEVEN_DAYS_MS,
  evaluateAbuseStatus,
  formatLockRemaining,
} from '@/domains/sos/abuse';

describe('evaluateAbuseStatus', () => {
  const now = 1_700_000_000_000;

  it('devolve locked=false quando nenhum cancel ocorreu', () => {
    const s = evaluateAbuseStatus([], now);
    expect(s.locked).toBe(false);
    expect(s.unlockAt).toBeNull();
    expect(s.cancelsLast7d).toBe(0);
  });

  it('nao bloqueia com 2 cancels recentes (abaixo do threshold de 3)', () => {
    const s = evaluateAbuseStatus([now - 1000, now - 2000], now);
    expect(s.locked).toBe(false);
    expect(s.cancelsLast7d).toBe(2);
  });

  it('bloqueia com 3 cancels recentes e ancora unlock em mais_recente + 24h', () => {
    const cancels = [now - 60_000, now - 120_000, now - 180_000];
    const s = evaluateAbuseStatus(cancels, now);
    expect(s.locked).toBe(true);
    expect(s.unlockAt).toBe(now - 60_000 + LOCK_DURATION_MS);
    expect(s.cancelsLast7d).toBe(3);
  });

  it('ignora cancels com mais de 7 dias', () => {
    const old = now - SEVEN_DAYS_MS - 1000;
    const cancels = [old, old - 1, old - 2];
    const s = evaluateAbuseStatus(cancels, now);
    expect(s.locked).toBe(false);
    expect(s.cancelsLast7d).toBe(0);
  });

  it('expira o bloqueio 24h depois do cancel mais recente', () => {
    const cancelTs = now - LOCK_DURATION_MS - 1; // 24h + 1ms atras
    const s = evaluateAbuseStatus([cancelTs, cancelTs - 1, cancelTs - 2], now);
    // Mesmo com 3 cancels em 7d, o cancel mais recente foi ha >24h →
    // unlockAt esta no passado → locked false.
    expect(s.locked).toBe(false);
    expect(s.unlockAt).toBeNull();
    // Mas a contagem ainda aparece (transparencia pro usuario).
    expect(s.cancelsLast7d).toBe(3);
  });

  it('renova a trava quando um novo cancel cai dentro da janela ativa', () => {
    // Tres cancels antigos (locked esta prestes a expirar), e um novo
    // cancel acaba de ocorrer → a trava renova a partir do mais recente.
    const old = now - LOCK_DURATION_MS + 60_000; // expira em 1 min
    const fresh = now - 5000;
    const s = evaluateAbuseStatus([fresh, old, old - 1, old - 2], now);
    expect(s.locked).toBe(true);
    expect(s.unlockAt).toBe(fresh + LOCK_DURATION_MS);
  });

  it('filtra NaN/Infinity defensivamente sem crashar', () => {
    const s = evaluateAbuseStatus(
      [now - 1, NaN, Infinity, -Infinity, now - 2],
      now,
    );
    expect(s.cancelsLast7d).toBe(2);
  });

  it('exporta as constantes esperadas pra outros modulos', () => {
    expect(SEVEN_DAYS_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(LOCK_DURATION_MS).toBe(24 * 60 * 60 * 1000);
    expect(ABUSE_THRESHOLD).toBe(3);
  });
});

describe('formatLockRemaining', () => {
  it('formata < 60min como "X min"', () => {
    expect(formatLockRemaining(30 * 60_000)).toBe('30 min');
    expect(formatLockRemaining(60_001)).toBe('2 min'); // ceiling
  });

  it('formata exatamente N horas sem fracao', () => {
    expect(formatLockRemaining(3 * 60 * 60_000)).toBe('3h');
  });

  it('formata horas + minutos quando ha fracao', () => {
    expect(formatLockRemaining(3 * 60 * 60_000 + 15 * 60_000)).toBe('3h 15min');
  });

  it('trata entrada invalida (NaN, negativa) como 0', () => {
    expect(formatLockRemaining(NaN)).toBe('0 min');
    expect(formatLockRemaining(-1)).toBe('0 min');
    expect(formatLockRemaining(0)).toBe('0 min');
  });
});
