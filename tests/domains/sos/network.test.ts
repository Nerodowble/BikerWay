import {
  parseWireMessage,
  SOS_PROTOCOL_VERSION,
} from '@/domains/sos/network';

describe('parseWireMessage', () => {
  it('aceita sos.alert valido com campos minimos', () => {
    const parsed = parseWireMessage({
      type: 'sos.alert',
      protocol_version: SOS_PROTOCOL_VERSION,
      alert_id: 'a-1',
      rider_name: 'Carlos',
      problem_type: 'pneu_furado',
      latitude: -23.5,
      longitude: -46.6,
      created_at: 1700000000000,
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe('sos.alert');
    if (parsed?.type === 'sos.alert') {
      expect(parsed.alert_id).toBe('a-1');
      expect(parsed.rider_moto).toBeUndefined();
    }
  });

  it('propaga rider_moto e message quando presentes', () => {
    const parsed = parseWireMessage({
      type: 'sos.alert',
      protocol_version: SOS_PROTOCOL_VERSION,
      alert_id: 'a-2',
      rider_name: 'Carlos',
      rider_moto: 'Honda Hornet',
      message: 'Sem camara de ar',
      problem_type: 'pneu_furado',
      latitude: -23.5,
      longitude: -46.6,
      created_at: 1700000000000,
    });
    if (parsed?.type === 'sos.alert') {
      expect(parsed.rider_moto).toBe('Honda Hornet');
      expect(parsed.message).toBe('Sem camara de ar');
    }
  });

  it('aceita sos.cancel valido', () => {
    const parsed = parseWireMessage({
      type: 'sos.cancel',
      protocol_version: SOS_PROTOCOL_VERSION,
      alert_id: 'a-3',
    });
    expect(parsed?.type).toBe('sos.cancel');
    if (parsed?.type === 'sos.cancel') {
      expect(parsed.alert_id).toBe('a-3');
    }
  });

  it('descarta payload com protocol_version errado (forward-compat)', () => {
    expect(
      parseWireMessage({
        type: 'sos.alert',
        protocol_version: 999,
        alert_id: 'a',
        rider_name: 'X',
        problem_type: 'pneu_furado',
        latitude: 0,
        longitude: 0,
        created_at: 0,
      }),
    ).toBeNull();
  });

  it('descarta sos.alert sem campos obrigatorios', () => {
    // Sem rider_name
    expect(
      parseWireMessage({
        type: 'sos.alert',
        protocol_version: SOS_PROTOCOL_VERSION,
        alert_id: 'a',
        problem_type: 'pneu_furado',
        latitude: 0,
        longitude: 0,
        created_at: 0,
      }),
    ).toBeNull();
    // latitude como string
    expect(
      parseWireMessage({
        type: 'sos.alert',
        protocol_version: SOS_PROTOCOL_VERSION,
        alert_id: 'a',
        rider_name: 'X',
        problem_type: 'pneu_furado',
        latitude: '0',
        longitude: 0,
        created_at: 0,
      }),
    ).toBeNull();
  });

  it('descarta payload nao-objeto', () => {
    expect(parseWireMessage(null)).toBeNull();
    expect(parseWireMessage(42)).toBeNull();
    expect(parseWireMessage('foo')).toBeNull();
    expect(parseWireMessage(undefined)).toBeNull();
  });

  it('descarta tipo desconhecido', () => {
    expect(
      parseWireMessage({
        type: 'sos.foo',
        protocol_version: SOS_PROTOCOL_VERSION,
        alert_id: 'a',
      }),
    ).toBeNull();
  });
});
