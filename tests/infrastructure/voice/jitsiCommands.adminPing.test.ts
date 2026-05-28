import { buildJitsiInjectionScript } from '@/infrastructure/voice/jitsiCommands';

describe('jitsiCommands — F34.2.1 / F34.5.1', () => {
  it('sendPing: serializa lat/lng + inicial dentro do snippet', () => {
    const js = buildJitsiInjectionScript({
      kind: 'sendPing',
      latitude: -23.5,
      longitude: -46.5,
      initial: 'W',
    });
    expect(js).toContain('window.bwSendPing');
    expect(js).toContain('-23.5');
    expect(js).toContain('-46.5');
    expect(js).toContain('"W"');
  });

  it('sendPing: rejeita inicial maior que 4 chars (truncate)', () => {
    const js = buildJitsiInjectionScript({
      kind: 'sendPing',
      latitude: 0,
      longitude: 0,
      initial: 'WillianX',
    });
    expect(js).toContain('"Will"');
    expect(js).not.toContain('WillianX');
  });

  it('sendAdminDesignate: serializa successor id como string JSON', () => {
    const js = buildJitsiInjectionScript({
      kind: 'sendAdminDesignate',
      successorId: 'peer-abc-123',
    });
    expect(js).toContain('window.bwSendAdminDesignate');
    expect(js).toContain('"peer-abc-123"');
  });

  it('sendAdminDesignate: aceita string vazia (= cancelar designacao)', () => {
    const js = buildJitsiInjectionScript({
      kind: 'sendAdminDesignate',
      successorId: '',
    });
    expect(js).toContain('window.bwSendAdminDesignate');
    expect(js).toContain('""');
  });

  it('sendAdminHandoff: serializa toId', () => {
    const js = buildJitsiInjectionScript({
      kind: 'sendAdminHandoff',
      toId: 'peer-target',
    });
    expect(js).toContain('window.bwSendAdminHandoff');
    expect(js).toContain('"peer-target"');
  });

  it('sendPing: lat/lng nao-finito vira 0 defensivo', () => {
    const js = buildJitsiInjectionScript({
      kind: 'sendPing',
      latitude: NaN,
      longitude: Infinity,
      initial: 'X',
    });
    // No NaN, no Infinity (would be ReferenceError no eval do snippet)
    expect(js).not.toContain('NaN');
    expect(js).not.toContain('Infinity');
  });
});
