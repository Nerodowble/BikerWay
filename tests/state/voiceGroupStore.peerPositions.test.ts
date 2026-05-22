import {
  useVoiceGroupStore,
  type ComboioPeerPosition,
} from '../../src/state/voiceGroupStore';

function resetStore(): void {
  // Reset to the documented initial shape. We MUST keep `audioOutput` in the
  // reset object even though the test doesn't touch it — leaveComboio
  // intentionally preserves that field across sessions, and a missing key
  // would leave the previous test's value leaking through.
  useVoiceGroupStore.setState({
    token: null,
    displayName: '',
    status: 'idle',
    isLocalMuted: false,
    audioOutput: 'speaker',
    participants: [],
    dominantSpeakerId: null,
    lastError: null,
    peerPositions: {},
  });
}

function makePos(
  id: string,
  ts: number,
  overrides: Partial<ComboioPeerPosition> = {},
): ComboioPeerPosition {
  return {
    id,
    displayName: overrides.displayName ?? `Peer ${id}`,
    latitude: overrides.latitude ?? -23.5505,
    longitude: overrides.longitude ?? -46.6333,
    heading: overrides.heading ?? null,
    speed: overrides.speed ?? null,
    timestamp: ts,
  };
}

describe('voiceGroupStore peer positions (Fase 8)', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    // Some tests stub `Date.now` to assert purge math; restore so they
    // don't leak into other suites that rely on a real clock.
    jest.restoreAllMocks();
  });

  it('upserts by id when updatePeerPosition is called', () => {
    const { updatePeerPosition } = useVoiceGroupStore.getState();
    updatePeerPosition(makePos('p1', 1_000));
    updatePeerPosition(makePos('p2', 1_100));

    const positions = useVoiceGroupStore.getState().peerPositions;
    expect(Object.keys(positions)).toEqual(['p1', 'p2']);
    expect(positions.p1?.timestamp).toBe(1_000);
    expect(positions.p2?.timestamp).toBe(1_100);
  });

  it('keeps the newer-timestamp entry on repeat updates for the same id', () => {
    const { updatePeerPosition } = useVoiceGroupStore.getState();
    updatePeerPosition(
      makePos('p1', 1_000, { latitude: -23.5, longitude: -46.6 }),
    );
    updatePeerPosition(
      makePos('p1', 2_000, { latitude: -23.4, longitude: -46.5 }),
    );

    const entry = useVoiceGroupStore.getState().peerPositions.p1;
    expect(entry?.timestamp).toBe(2_000);
    expect(entry?.latitude).toBe(-23.4);
    expect(entry?.longitude).toBe(-46.5);
  });

  it('ignores an older-timestamp delivery for an already-known peer', () => {
    const { updatePeerPosition } = useVoiceGroupStore.getState();
    updatePeerPosition(
      makePos('p1', 5_000, { latitude: -23.4, longitude: -46.5 }),
    );
    // Out-of-order delivery: this packet arrived after the newer one.
    updatePeerPosition(
      makePos('p1', 1_000, { latitude: -23.1, longitude: -46.1 }),
    );

    const entry = useVoiceGroupStore.getState().peerPositions.p1;
    expect(entry?.timestamp).toBe(5_000);
    expect(entry?.latitude).toBe(-23.4);
    expect(entry?.longitude).toBe(-46.5);
  });

  it('purgeStalePeerPositions drops entries older than maxAgeMs and keeps fresh ones', () => {
    const now = 10_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const { updatePeerPosition, purgeStalePeerPositions } =
      useVoiceGroupStore.getState();
    updatePeerPosition(makePos('fresh', now - 1_000)); // 1s old — keep
    updatePeerPosition(makePos('stale', now - 7_000)); // 7s old — drop
    updatePeerPosition(makePos('edge', now - 5_000)); // exactly 5s — keep (>=)

    purgeStalePeerPositions(5_000);

    const positions = useVoiceGroupStore.getState().peerPositions;
    expect(Object.keys(positions).sort()).toEqual(['edge', 'fresh']);
    expect(positions.stale).toBeUndefined();
  });

  it('leaveComboio clears all peer positions', () => {
    const { updatePeerPosition, createComboio, leaveComboio } =
      useVoiceGroupStore.getState();
    // createComboio puts the store into an active-room state so leaveComboio
    // has something to tear down.
    createComboio('Tester');
    updatePeerPosition(makePos('p1', 1_000));
    updatePeerPosition(makePos('p2', 2_000));
    expect(
      Object.keys(useVoiceGroupStore.getState().peerPositions).length,
    ).toBe(2);

    leaveComboio();

    expect(useVoiceGroupStore.getState().peerPositions).toEqual({});
    expect(useVoiceGroupStore.getState().token).toBeNull();
  });

  it('removeParticipant drops the matching peer position', () => {
    const { updatePeerPosition, removeParticipant } =
      useVoiceGroupStore.getState();
    updatePeerPosition(makePos('p1', 1_000));
    updatePeerPosition(makePos('p2', 1_100));

    removeParticipant('p1');

    const positions = useVoiceGroupStore.getState().peerPositions;
    expect(Object.keys(positions)).toEqual(['p2']);
    expect(positions.p1).toBeUndefined();
  });

  it('clearPeerPositions empties the map', () => {
    const { updatePeerPosition, clearPeerPositions } =
      useVoiceGroupStore.getState();
    updatePeerPosition(makePos('p1', 1_000));
    updatePeerPosition(makePos('p2', 1_100));

    clearPeerPositions();

    expect(useVoiceGroupStore.getState().peerPositions).toEqual({});
  });
});
