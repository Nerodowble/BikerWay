import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { JitsiWebView, type JitsiWebViewHandle } from './JitsiWebView';
import { useVoiceGroupStore } from '@/state/voiceGroupStore';
import { useNavigationStore } from '@/state/navigationStore';

// Module-level handle so any screen can drive mute/hangup without holding a
// React ref. The handle is updated whenever the WebView mounts/unmounts.
let globalVoiceHandle: JitsiWebViewHandle | null = null;

export interface VoiceController {
  toggleAudio: () => void;
  setAudioMuted: (muted: boolean) => void;
  hangup: () => void;
}

/**
 * Returns the live voice controller while a comboio is active. Returns null
 * when no comboio is running. Designed so screens (ComboioScreen, future
 * voice-status overlays on HomeScreen, etc) can issue voice commands without
 * each owning a JitsiWebView ref.
 */
export function getVoiceController(): VoiceController | null {
  const handle = globalVoiceHandle;
  if (!handle) return null;
  return {
    toggleAudio: () => handle.toggleAudio(),
    setAudioMuted: (muted: boolean) => handle.setAudioMuted(muted),
    hangup: () => handle.hangup(),
  };
}

const BROADCAST_INTERVAL_MS = 3000;
// Purge stale peer pins from the map at this cadence so a peer that went
// dark stops haunting the UI. Same cadence as the broadcast loop is fine.
const PURGE_INTERVAL_MS = 3000;
// Drop a peer pin from the map after this many ms without a fresh GPS packet
// when the mesh is healthy.
const PEER_STALE_MS_CONNECTED = 15_000;
// During a silent reconnect we KEEP showing the last-known peer pins for
// much longer — riding through a 30s dead-zone shouldn't wipe the comboio
// off the map. Bumped well past the 30s backoff cap so even a worst-case
// reconnect window still leaves the pins on screen.
const PEER_STALE_MS_RECONNECTING = 60_000;

/**
 * Headless overlay that owns the comboio voice session for the WHOLE app
 * lifetime. Mounts the PeerJS WebView (1x1, invisible) whenever the voice
 * store has an active `token`, and tears it down when the rider leaves.
 *
 * Why this is at the App level rather than inside ComboioScreen:
 *   - The WebView contains the live WebRTC peer connections. Unmounting it
 *     drops the audio session and all DataChannels (so map pins also stop
 *     updating). The rider needs to be able to close the ComboioScreen
 *     modal and look at the map without losing the call.
 *   - The 3-second GPS broadcast loop also lives here so peers keep seeing
 *     each other on the map regardless of which screen is in front.
 */
export const VoiceSessionMount: React.FC = () => {
  const token = useVoiceGroupStore((s) => s.token);
  const displayName = useVoiceGroupStore((s) => s.displayName);
  // Reading status here drives the periodic purge threshold so peer pins
  // outlive a transient reconnect instead of disappearing after 15s.
  const status = useVoiceGroupStore((s) => s.status);

  const localRef = useRef<JitsiWebViewHandle | null>(null);

  // Mirror the latest ref into the module-level handle so getVoiceController()
  // can read it from anywhere. Use a layout-effect-like callback ref via
  // useEffect: we re-run on every render but the inner check makes it cheap.
  useEffect(() => {
    globalVoiceHandle = localRef.current;
    return () => {
      globalVoiceHandle = null;
    };
  }, [token]);

  // Stable callbacks bound to store actions.
  const handleJoined = useCallback(() => {
    useVoiceGroupStore.getState().setStatus('connected');
  }, []);
  const handleLeft = useCallback(() => {
    useVoiceGroupStore.getState().leaveComboio();
  }, []);
  const handleAudioMuted = useCallback((muted: boolean) => {
    useVoiceGroupStore.getState().setLocalMuted(muted);
  }, []);
  const handleParticipantJoined = useCallback(
    (p: { id: string; displayName: string }) => {
      useVoiceGroupStore.getState().upsertParticipant({
        id: p.id,
        displayName: p.displayName,
        isAudioMuted: false,
      });
    },
    [],
  );
  const handleParticipantLeft = useCallback((p: { id: string }) => {
    useVoiceGroupStore.getState().removeParticipant(p.id);
  }, []);
  const handleDominantSpeakerChanged = useCallback((id: string | null) => {
    useVoiceGroupStore.getState().setDominantSpeaker(id);
  }, []);
  const handleConnectionState = useCallback(
    (state: 'restored' | 'interrupted') => {
      const store = useVoiceGroupStore.getState();
      if (state === 'restored') {
        store.markConnected();
      } else {
        store.markReconnecting();
      }
    },
    [],
  );
  // Wired to the PeerJS in-page silent-reconnect loop. The page emits
  // 'reconnecting' on socket drop and 'connected' once .reconnect() succeeds.
  // We deliberately route through markReconnecting/markConnected (not
  // setStatus) so participants + peerPositions survive the transition.
  const handleVoiceStatus = useCallback(
    (vs: 'connecting' | 'connected' | 'reconnecting') => {
      const store = useVoiceGroupStore.getState();
      if (vs === 'connected') {
        store.markConnected();
      } else if (vs === 'reconnecting') {
        store.markReconnecting();
      } else {
        // 'connecting' arrives once at session boot (rare in PeerJS path);
        // keep the existing setStatus contract intact for that case.
        store.setStatus('connecting');
      }
    },
    [],
  );
  const handleReadyToClose = useCallback(() => {
    useVoiceGroupStore.getState().leaveComboio();
  }, []);
  const handleError = useCallback((message: string) => {
    useVoiceGroupStore.getState().setError(message);
  }, []);
  const handlePeerPosition = useCallback(
    (p: {
      id: string;
      displayName?: string;
      latitude: number;
      longitude: number;
      heading?: number | null;
      speed?: number | null;
      timestamp: number;
    }) => {
      useVoiceGroupStore.getState().updatePeerPosition(p);
    },
    [],
  );

  // 3-second GPS broadcast loop. Runs as long as a comboio is active AND
  // there is a valid current position. Survives navigation between
  // ComboioScreen and HomeScreen because this component lives at the App
  // root, not inside any screen.
  useEffect(() => {
    if (!token) return undefined;
    const interval = setInterval(() => {
      const pos = useNavigationStore.getState().currentPosition;
      if (!pos) return;
      localRef.current?.sendPeerPosition({
        latitude: pos.latitude,
        longitude: pos.longitude,
        heading: pos.heading ?? null,
        speed: pos.speed ?? null,
      });
    }, BROADCAST_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [token]);

  // Periodic peer-pin purge. The threshold is RAISED during silent reconnect
  // so a 5-30s dead-zone doesn't wipe everyone from the map. Status is read
  // via subscription (above) so this effect tears down + rebuilds the
  // interval whenever the threshold flips between healthy and reconnecting.
  useEffect(() => {
    if (!token) return undefined;
    const maxAge =
      status === 'reconnecting'
        ? PEER_STALE_MS_RECONNECTING
        : PEER_STALE_MS_CONNECTED;
    const interval = setInterval(() => {
      useVoiceGroupStore.getState().purgeStalePeerPositions(maxAge);
    }, PURGE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [token, status]);

  if (!token) return null;

  return (
    <View style={styles.hidden} pointerEvents="none">
      <JitsiWebView
        ref={(handle) => {
          localRef.current = handle;
          globalVoiceHandle = handle;
        }}
        roomName={token.roomName}
        displayName={displayName}
        visible={false}
        onJoined={handleJoined}
        onLeft={handleLeft}
        onAudioMuted={handleAudioMuted}
        onParticipantJoined={handleParticipantJoined}
        onParticipantLeft={handleParticipantLeft}
        onDominantSpeakerChanged={handleDominantSpeakerChanged}
        onConnectionState={handleConnectionState}
        onVoiceStatus={handleVoiceStatus}
        onReadyToClose={handleReadyToClose}
        onError={handleError}
        onPeerPosition={handlePeerPosition}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    left: -100,
    top: -100,
  },
});
