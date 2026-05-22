import {
  useVoiceGroupStore,
  type ComboioPeerPosition,
} from '../../src/state/voiceGroupStore';
import type { VoiceParticipant } from '../../src/domains/voice/types';

/**
 * Tests for the silent-reconnect store contract:
 *   1. `markReconnecting()` flips status without wiping the mesh.
 *   2. `markConnected()` returns the status to 'connected' and clears any
 *      previous lastError (we never own a transient-network error string).
 *   3. The purge math still respects the same threshold semantics even after
 *      a reconnect cycle — the actual threshold flip lives in the mount
 *      component, but we verify the store math is honest at the boundary.
 */

function resetStore(): void {
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

function makeParticipant(id: string, name: string): VoiceParticipant {
  return { id, displayName: name, isAudioMuted: false };
}

function makePos(id: string, ts: number): ComboioPeerPosition {
  return {
    id,
    displayName: `Peer ${id}`,
    latitude: -23.5,
    longitude: -46.6,
    heading: null,
    speed: null,
    timestamp: ts,
  };
}

describe('voiceGroupStore silent reconnect', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('markReconnecting flips status to "reconnecting" without dropping participants or peerPositions', () => {
    const store = useVoiceGroupStore.getState();
    store.createComboio('Tester');
    store.upsertParticipant(makeParticipant('p1', 'Alice'));
    store.upsertParticipant(makeParticipant('p2', 'Bob'));
    store.updatePeerPosition(makePos('p1', 1_000));
    store.updatePeerPosition(makePos('p2', 1_100));

    useVoiceGroupStore.getState().markReconnecting();

    const after = useVoiceGroupStore.getState();
    expect(after.status).toBe('reconnecting');
    // The whole point of silent reconnect: roster and pins stay visible.
    expect(after.participants.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    expect(Object.keys(after.peerPositions).sort()).toEqual(['p1', 'p2']);
  });

  it('markReconnecting is idempotent (no extra write when already reconnecting)', () => {
    const store = useVoiceGroupStore.getState();
    store.createComboio('Tester');
    store.markReconnecting();
    const snapshot1 = useVoiceGroupStore.getState();
    expect(snapshot1.status).toBe('reconnecting');

    // Second call must not break invariants.
    useVoiceGroupStore.getState().markReconnecting();
    const snapshot2 = useVoiceGroupStore.getState();
    expect(snapshot2.status).toBe('reconnecting');
    // Participants / positions stay the same shape.
    expect(snapshot2.participants).toBe(snapshot1.participants);
    expect(snapshot2.peerPositions).toBe(snapshot1.peerPositions);
  });

  it('markReconnecting never writes lastError', () => {
    const store = useVoiceGroupStore.getState();
    store.createComboio('Tester');
    expect(useVoiceGroupStore.getState().lastError).toBeNull();
    store.markReconnecting();
    expect(useVoiceGroupStore.getState().lastError).toBeNull();
  });

  it('markConnected returns status to "connected"', () => {
    const store = useVoiceGroupStore.getState();
    store.createComboio('Tester');
    store.markReconnecting();
    expect(useVoiceGroupStore.getState().status).toBe('reconnecting');

    useVoiceGroupStore.getState().markConnected();
    expect(useVoiceGroupStore.getState().status).toBe('connected');
  });

  it('markConnected clears a stale lastError so a fresh banner can show next time', () => {
    const store = useVoiceGroupStore.getState();
    store.createComboio('Tester');
    // Simulate a UX-level error that was surfaced earlier (e.g. invalid code
    // attempt) but which should not survive a successful reconnect cycle.
    store.setError('Erro UX qualquer');
    store.markReconnecting();
    expect(useVoiceGroupStore.getState().lastError).toBe('Erro UX qualquer');

    useVoiceGroupStore.getState().markConnected();
    expect(useVoiceGroupStore.getState().lastError).toBeNull();
  });

  it('full transition cycle: connecting -> reconnecting -> connected preserves the mesh', () => {
    const store = useVoiceGroupStore.getState();
    store.createComboio('Tester');
    // After createComboio the store is in 'connecting' until the WebView
    // posts back a status update.
    expect(useVoiceGroupStore.getState().status).toBe('connecting');

    store.upsertParticipant(makeParticipant('p1', 'Alice'));
    store.updatePeerPosition(makePos('p1', 1_000));

    useVoiceGroupStore.getState().markConnected();
    expect(useVoiceGroupStore.getState().status).toBe('connected');

    useVoiceGroupStore.getState().markReconnecting();
    expect(useVoiceGroupStore.getState().status).toBe('reconnecting');
    // Roster survives.
    expect(useVoiceGroupStore.getState().participants).toHaveLength(1);
    expect(useVoiceGroupStore.getState().peerPositions.p1).toBeDefined();

    useVoiceGroupStore.getState().markConnected();
    expect(useVoiceGroupStore.getState().status).toBe('connected');
    // Roster STILL survives after recovering.
    expect(useVoiceGroupStore.getState().participants).toHaveLength(1);
    expect(useVoiceGroupStore.getState().peerPositions.p1).toBeDefined();
  });

  it('purgeStalePeerPositions honours an expanded threshold during reconnect', () => {
    // The component-level interval picks the threshold; the store just does
    // the math. Verify the math is honest: a 45s-old pin should survive a
    // 60s purge (reconnect mode) and be dropped by a 15s purge (healthy).
    const now = 100_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const store = useVoiceGroupStore.getState();
    store.updatePeerPosition(makePos('p1', now - 45_000)); // 45s old
    store.updatePeerPosition(makePos('p2', now - 5_000)); // 5s old

    // Healthy purge (15s) would drop p1.
    store.purgeStalePeerPositions(15_000);
    expect(useVoiceGroupStore.getState().peerPositions.p1).toBeUndefined();
    expect(useVoiceGroupStore.getState().peerPositions.p2).toBeDefined();

    // Repopulate and run the reconnect-window threshold (60s).
    useVoiceGroupStore.getState().updatePeerPosition(makePos('p1', now - 45_000));
    useVoiceGroupStore.getState().purgeStalePeerPositions(60_000);
    expect(useVoiceGroupStore.getState().peerPositions.p1).toBeDefined();
    expect(useVoiceGroupStore.getState().peerPositions.p2).toBeDefined();
  });
});
