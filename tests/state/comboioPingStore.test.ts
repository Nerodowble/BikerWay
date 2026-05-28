import { PING_TTL_MS, useComboioPingStore } from '@/state/comboioPingStore';
import type { ComboioPing } from '@/domains/comboio/ping';

function makePing(partial: Partial<ComboioPing> & { peerId: string }): ComboioPing {
  return {
    peerId: partial.peerId,
    initial: partial.initial ?? 'X',
    latitude: partial.latitude ?? 0,
    longitude: partial.longitude ?? 0,
    createdAt: partial.createdAt ?? Date.now(),
  };
}

describe('comboioPingStore', () => {
  beforeEach(() => {
    useComboioPingStore.getState().clear();
  });

  it('setPing adiciona ping novo', () => {
    useComboioPingStore.getState().setPing(makePing({ peerId: 'self' }));
    expect(useComboioPingStore.getState().pings).toHaveLength(1);
  });

  it('setPing do mesmo peer SUBSTITUI o antigo', () => {
    useComboioPingStore
      .getState()
      .setPing(makePing({ peerId: 'self', latitude: 1, createdAt: 1000 }));
    useComboioPingStore
      .getState()
      .setPing(makePing({ peerId: 'self', latitude: 2, createdAt: 2000 }));
    const pings = useComboioPingStore.getState().pings;
    expect(pings).toHaveLength(1);
    expect(pings[0]?.latitude).toBe(2);
    expect(pings[0]?.createdAt).toBe(2000);
  });

  it('pings de peers diferentes coexistem', () => {
    useComboioPingStore.getState().setPing(makePing({ peerId: 'a' }));
    useComboioPingStore.getState().setPing(makePing({ peerId: 'b' }));
    expect(useComboioPingStore.getState().pings).toHaveLength(2);
  });

  it('removePingFor remove apenas o do peer alvo', () => {
    useComboioPingStore.getState().setPing(makePing({ peerId: 'a' }));
    useComboioPingStore.getState().setPing(makePing({ peerId: 'b' }));
    useComboioPingStore.getState().removePingFor('a');
    const pings = useComboioPingStore.getState().pings;
    expect(pings).toHaveLength(1);
    expect(pings[0]?.peerId).toBe('b');
  });

  it('clear remove tudo', () => {
    useComboioPingStore.getState().setPing(makePing({ peerId: 'a' }));
    useComboioPingStore.getState().setPing(makePing({ peerId: 'b' }));
    useComboioPingStore.getState().clear();
    expect(useComboioPingStore.getState().pings).toEqual([]);
  });

  it('prune remove expirados', () => {
    const now = Date.now();
    useComboioPingStore
      .getState()
      .setPing(makePing({ peerId: 'fresh', createdAt: now }));
    useComboioPingStore
      .getState()
      .setPing(makePing({ peerId: 'old', createdAt: now - PING_TTL_MS - 5000 }));
    useComboioPingStore.getState().prune();
    const pings = useComboioPingStore.getState().pings;
    expect(pings.map((p) => p.peerId)).toEqual(['fresh']);
  });
});
