import {
  PING_TTL_MS,
  isPingExpired,
  pruneExpiredPings,
  type ComboioPing,
} from '@/domains/comboio/ping';

function makePing(partial: Partial<ComboioPing> & { peerId: string; createdAt: number }): ComboioPing {
  return {
    peerId: partial.peerId,
    initial: partial.initial ?? 'X',
    latitude: partial.latitude ?? 0,
    longitude: partial.longitude ?? 0,
    createdAt: partial.createdAt,
  };
}

describe('isPingExpired', () => {
  it('false antes do TTL', () => {
    expect(isPingExpired({ createdAt: 1000 }, 1000 + 1000)).toBe(false);
    expect(isPingExpired({ createdAt: 1000 }, 1000 + PING_TTL_MS - 1)).toBe(false);
  });
  it('true depois do TTL', () => {
    expect(isPingExpired({ createdAt: 1000 }, 1000 + PING_TTL_MS + 1)).toBe(true);
  });
});

describe('pruneExpiredPings', () => {
  it('mantem so os nao expirados', () => {
    const now = 100_000;
    const fresh = makePing({ peerId: 'a', createdAt: now - 10_000 });
    const old = makePing({ peerId: 'b', createdAt: now - PING_TTL_MS - 5_000 });
    const result = pruneExpiredPings([fresh, old], now);
    expect(result.map((p) => p.peerId)).toEqual(['a']);
  });
  it('lista vazia retorna []', () => {
    expect(pruneExpiredPings([], 1000)).toEqual([]);
  });
});
