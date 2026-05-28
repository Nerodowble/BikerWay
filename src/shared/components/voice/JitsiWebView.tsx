import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { buildJitsiHtml, buildJitsiInjectedJs } from '@/infrastructure/voice/jitsiHtml';
import { buildJitsiInjectionScript } from '@/infrastructure/voice/jitsiCommands';
import type { ComboioPeerPosition } from '@/state/voiceGroupStore';

export interface JitsiWebViewProps {
  roomName: string;
  displayName: string;
  startMuted?: boolean;
  /** When false, the WebView is rendered offscreen at 1x1 so audio stays alive. */
  visible?: boolean;
  onJoined?: () => void;
  onLeft?: () => void;
  onAudioMuted?: (muted: boolean) => void;
  onParticipantJoined?: (p: { id: string; displayName: string }) => void;
  onParticipantLeft?: (p: { id: string; displayName: string }) => void;
  onDominantSpeakerChanged?: (id: string | null) => void;
  onConnectionState?: (state: 'restored' | 'interrupted') => void;
  /**
   * Fired when the in-page PeerJS layer transitions between silent-reconnect
   * states. The WebView never surfaces transient network drops as errors —
   * the page posts a 'reconnecting' / 'connected' status here and the host
   * is expected to flip a badge / preserve roster state accordingly.
   */
  onVoiceStatus?: (status: 'connecting' | 'connected' | 'reconnecting') => void;
  onReadyToClose?: () => void;
  /**
   * Fired when the bridge surfaces a hard error (script load failure, Jitsi
   * API construction failure, message parse failure). Pass-through string so
   * the host can route it to a banner / store / log.
   */
  onError?: (message: string) => void;
  /**
   * Periodic diagnostic dump from the in-page script. Lets the host show a
   * "what is happening inside Jitsi right now?" panel for debugging.
   */
  onDiagnostic?: (state: JitsiDiagnosticState) => void;
  /**
   * Fired whenever a comboio peer broadcasts its GPS position over the
   * PeerJS DataChannel. The screen forwards this into the voice store so
   * the BikerWay map can render a coloured pin per peer.
   */
  onPeerPosition?: (p: ComboioPeerPosition) => void;
  /**
   * F34.5.1 — Ping de localizacao recebido de outro peer. RN encaminha
   * pro comboioPingStore que renderiza marker pulsante 45s.
   */
  onPeerPing?: (p: {
    peerId: string;
    initial: string;
    latitude: number;
    longitude: number;
    createdAt: number;
  }) => void;
  /**
   * F34.2.1 — Admin remoto designou um sucessor. RN atualiza store local
   * pra mostrar a ⭐ no peer indicado.
   */
  onAdminDesignate?: (p: {
    from: string;
    successorPeerId: string;
    timestamp: number;
  }) => void;
  /**
   * F34.2.1 — Admin transferiu admin pra outro peer (ou avisou que vai
   * sair). RN decide se o LOCAL vira admin (quando to=my id).
   */
  onAdminHandoff?: (p: {
    from: string;
    to: string;
    timestamp: number;
  }) => void;
}

export interface JitsiDiagnosticState {
  hasAPP: boolean;
  hasConference: boolean;
  isJoined: boolean;
  isLocalAudioMuted: boolean;
  readyState?: string;
  url?: string;
  title?: string;
  memberCount?: number;
}

export interface JitsiWebViewHandle {
  toggleAudio: () => void;
  setAudioMuted: (muted: boolean) => void;
  /**
   * F30: muta o audio RECEBIDO localmente — outros peers continuam ouvindo
   * uns aos outros normalmente, so este device deixa de reproduzir audio
   * dos demais. Diferente de `setAudioMuted` (que silencia o MEU mic).
   */
  setIncomingAudioMuted: (muted: boolean) => void;
  hangup: () => void;
  /**
   * Broadcast the local GPS position to every connected comboio peer over
   * the PeerJS DataChannel. No-op if the WebView hasn't joined yet — the
   * page-level helper short-circuits when no DataConnections are open.
   */
  sendPeerPosition: (input: {
    latitude: number;
    longitude: number;
    heading?: number | null;
    speed?: number | null;
  }) => void;
  /** F34.5.1 — Envia ping de localizacao pros peers no comboio. */
  sendPing: (input: {
    latitude: number;
    longitude: number;
    initial: string;
  }) => void;
  /** F34.2.1 — Propaga sucessor escolhido. */
  sendAdminDesignate: (successorId: string) => void;
  /** F34.2.1 — Transfere admin pra outro peer. */
  sendAdminHandoff: (toId: string) => void;
}

type BridgeMessage =
  | { type: 'bridgeReady'; payload: { roomName: string } | null }
  | { type: 'bridgeError'; payload: { reason: string; message?: string } | null }
  | { type: 'videoConferenceJoined'; payload: { id?: string; displayName?: string; roomName?: string } | null }
  | { type: 'videoConferenceLeft'; payload: { roomName?: string } | null }
  | { type: 'participantJoined'; payload: { id?: string; displayName?: string } | null }
  | { type: 'participantLeft'; payload: { id?: string; displayName?: string } | null }
  | { type: 'participantRoleChanged'; payload: { id?: string; role?: string } | null }
  | { type: 'audioMuteStatusChanged'; payload: { muted: boolean } | null }
  | { type: 'dominantSpeakerChanged'; payload: { id: string | null } | null }
  | { type: 'readyToClose'; payload: null }
  | { type: 'connectionRestored'; payload: null }
  | { type: 'connectionInterrupted'; payload: null }
  | { type: 'bridgeDiagnostic'; payload: JitsiDiagnosticState | null }
  | {
      type: 'voice-status';
      payload: { status?: string } | null;
    }
  | {
      type: 'peerPositionUpdate';
      payload: {
        id?: string;
        displayName?: string;
        latitude?: number;
        longitude?: number;
        heading?: number | null;
        speed?: number | null;
        timestamp?: number;
      } | null;
    }
  | {
      type: 'peerPing';
      payload: {
        peerId?: string;
        initial?: string;
        latitude?: number;
        longitude?: number;
        createdAt?: number;
      } | null;
    }
  | {
      type: 'adminDesignate';
      payload: {
        from?: string;
        successorPeerId?: string;
        timestamp?: number;
      } | null;
    }
  | {
      type: 'adminHandoff';
      payload: {
        from?: string;
        to?: string;
        timestamp?: number;
      } | null;
    };

function parseMessage(raw: string): BridgeMessage | null {
  try {
    const parsed = JSON.parse(raw) as BridgeMessage;
    if (!parsed || typeof parsed.type !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export const JitsiWebView = forwardRef<JitsiWebViewHandle, JitsiWebViewProps>(function JitsiWebView(
  props,
  ref,
) {
  const {
    roomName,
    displayName,
    startMuted = false,
    visible = true,
    onJoined,
    onLeft,
    onAudioMuted,
    onParticipantJoined,
    onParticipantLeft,
    onDominantSpeakerChanged,
    onConnectionState,
    onVoiceStatus,
    onReadyToClose,
    onError,
    onDiagnostic,
    onPeerPosition,
    onPeerPing,
    onAdminDesignate,
    onAdminHandoff,
  } = props;

  const webRef = useRef<WebView | null>(null);

  const html = useMemo(
    () => buildJitsiHtml({ roomName, displayName, startMuted }),
    [roomName, displayName, startMuted],
  );
  const injectedJs = useMemo(() => buildJitsiInjectedJs(), []);

  const inject = useCallback((script: string) => {
    webRef.current?.injectJavaScript(script);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      toggleAudio: () => inject(buildJitsiInjectionScript({ kind: 'toggleAudio' })),
      setAudioMuted: (muted: boolean) =>
        inject(buildJitsiInjectionScript({ kind: 'setAudioMuted', muted })),
      setIncomingAudioMuted: (muted: boolean) =>
        inject(buildJitsiInjectionScript({ kind: 'setIncomingMuted', muted })),
      hangup: () => inject(buildJitsiInjectionScript({ kind: 'hangup' })),
      sendPeerPosition: (input) =>
        inject(
          buildJitsiInjectionScript({
            kind: 'sendPosition',
            latitude: input.latitude,
            longitude: input.longitude,
            heading: input.heading ?? null,
            speed: input.speed ?? null,
          }),
        ),
      sendPing: (input) =>
        inject(
          buildJitsiInjectionScript({
            kind: 'sendPing',
            latitude: input.latitude,
            longitude: input.longitude,
            initial: input.initial,
          }),
        ),
      sendAdminDesignate: (successorId) =>
        inject(
          buildJitsiInjectionScript({
            kind: 'sendAdminDesignate',
            successorId,
          }),
        ),
      sendAdminHandoff: (toId) =>
        inject(
          buildJitsiInjectionScript({
            kind: 'sendAdminHandoff',
            toId,
          }),
        ),
    }),
    [inject],
  );

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const msg = parseMessage(event.nativeEvent.data);
      if (!msg) {
        return;
      }
      switch (msg.type) {
        case 'videoConferenceJoined':
          onJoined?.();
          return;
        case 'videoConferenceLeft':
          onLeft?.();
          return;
        case 'audioMuteStatusChanged':
          if (msg.payload) {
            onAudioMuted?.(Boolean(msg.payload.muted));
          }
          return;
        case 'participantJoined':
          if (msg.payload && typeof msg.payload.id === 'string') {
            onParticipantJoined?.({
              id: msg.payload.id,
              displayName: msg.payload.displayName ?? '',
            });
          }
          return;
        case 'participantLeft':
          if (msg.payload && typeof msg.payload.id === 'string') {
            onParticipantLeft?.({
              id: msg.payload.id,
              displayName: msg.payload.displayName ?? '',
            });
          }
          return;
        case 'dominantSpeakerChanged':
          onDominantSpeakerChanged?.((msg.payload && msg.payload.id) || null);
          return;
        case 'connectionRestored':
          onConnectionState?.('restored');
          return;
        case 'connectionInterrupted':
          onConnectionState?.('interrupted');
          return;
        case 'readyToClose':
          onReadyToClose?.();
          return;
        case 'bridgeError':
          if (msg.payload) {
            onError?.(
              msg.payload.message ?? msg.payload.reason ?? 'Erro na ponte Jitsi',
            );
          }
          return;
        case 'bridgeDiagnostic':
          if (msg.payload) {
            onDiagnostic?.(msg.payload);
          }
          return;
        case 'voice-status':
          if (msg.payload && typeof msg.payload.status === 'string') {
            const s = msg.payload.status;
            // Narrow to the documented values; the WebView is also a future
            // surface for 'connecting', so we accept it but anything outside
            // the union is dropped to keep the store contract honest.
            if (s === 'connecting' || s === 'connected' || s === 'reconnecting') {
              onVoiceStatus?.(s);
            }
          }
          return;
        case 'peerPositionUpdate':
          if (
            msg.payload &&
            typeof msg.payload.id === 'string' &&
            msg.payload.id.length > 0 &&
            typeof msg.payload.latitude === 'number' &&
            typeof msg.payload.longitude === 'number' &&
            Number.isFinite(msg.payload.latitude) &&
            Number.isFinite(msg.payload.longitude)
          ) {
            const ts =
              typeof msg.payload.timestamp === 'number'
                ? msg.payload.timestamp
                : Date.now();
            onPeerPosition?.({
              id: msg.payload.id,
              displayName: msg.payload.displayName ?? '',
              latitude: msg.payload.latitude,
              longitude: msg.payload.longitude,
              heading: msg.payload.heading ?? null,
              speed: msg.payload.speed ?? null,
              timestamp: ts,
            });
          }
          return;
        case 'peerPing':
          if (
            msg.payload &&
            typeof msg.payload.peerId === 'string' &&
            msg.payload.peerId.length > 0 &&
            typeof msg.payload.latitude === 'number' &&
            typeof msg.payload.longitude === 'number' &&
            Number.isFinite(msg.payload.latitude) &&
            Number.isFinite(msg.payload.longitude)
          ) {
            onPeerPing?.({
              peerId: msg.payload.peerId,
              initial:
                typeof msg.payload.initial === 'string' &&
                msg.payload.initial.length > 0
                  ? msg.payload.initial.charAt(0).toUpperCase()
                  : '?',
              latitude: msg.payload.latitude,
              longitude: msg.payload.longitude,
              createdAt:
                typeof msg.payload.createdAt === 'number'
                  ? msg.payload.createdAt
                  : Date.now(),
            });
          }
          return;
        case 'adminDesignate':
          if (
            msg.payload &&
            typeof msg.payload.from === 'string' &&
            msg.payload.from.length > 0 &&
            typeof msg.payload.successorPeerId === 'string'
          ) {
            onAdminDesignate?.({
              from: msg.payload.from,
              successorPeerId: msg.payload.successorPeerId,
              timestamp:
                typeof msg.payload.timestamp === 'number'
                  ? msg.payload.timestamp
                  : Date.now(),
            });
          }
          return;
        case 'adminHandoff':
          if (
            msg.payload &&
            typeof msg.payload.from === 'string' &&
            msg.payload.from.length > 0 &&
            typeof msg.payload.to === 'string'
          ) {
            onAdminHandoff?.({
              from: msg.payload.from,
              to: msg.payload.to,
              timestamp:
                typeof msg.payload.timestamp === 'number'
                  ? msg.payload.timestamp
                  : Date.now(),
            });
          }
          return;
        default:
          return;
      }
    },
    [
      onJoined,
      onLeft,
      onAudioMuted,
      onParticipantJoined,
      onParticipantLeft,
      onDominantSpeakerChanged,
      onConnectionState,
      onVoiceStatus,
      onReadyToClose,
      onError,
      onDiagnostic,
      onPeerPosition,
      onPeerPing,
      onAdminDesignate,
      onAdminHandoff,
    ],
  );

  // Android-only auto-grant for getUserMedia. The prop is not part of the
  // public react-native-webview typings on every version, so we attach it
  // through a typed-as-unknown object. If the underlying native module does
  // not expose the callback, WebView will simply prompt once and Android's
  // system mic dialog will appear — which is the documented fallback.
  const androidPermissionProps =
    Platform.OS === 'android'
      ? ({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onPermissionRequest: (event: any) => {
            try {
              if (event && typeof event.grant === 'function') {
                event.grant();
              }
            } catch {
              // best-effort
            }
          },
          androidLayerType: 'hardware' as const,
        } as unknown as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  const containerStyle = visible ? styles.visibleContainer : styles.hiddenContainer;

  return (
    <View style={containerStyle} pointerEvents="none">
      <WebView
        ref={webRef}
        // PeerJS strategy: we host our own tiny HTML that boots PeerJS from a
        // CDN and runs the host/guest mesh. We MUST pass `baseUrl:
        // 'https://localhost'` so the page evaluates under a secure-context
        // origin — Chromium-based WebViews only expose `getUserMedia` and
        // the WebRTC stack on secure contexts. Without baseUrl the document
        // is treated as `about:blank` and mic access silently fails.
        source={{ html, baseUrl: 'https://localhost' }}
        injectedJavaScript={injectedJs}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        allowsProtectedMedia
        // iOS 15+: grant mic if origin matches our baseUrl. Otherwise prompt.
        mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
        // Keep the audio session alive even when offscreen.
        pullToRefreshEnabled={false}
        bounces={false}
        scrollEnabled={false}
        onMessage={handleMessage}
        style={styles.webview}
        {...androidPermissionProps}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  visibleContainer: {
    // 1px-tall mount: enough to keep the WebView attached to the view tree
    // (so Android does not tear down the audio session) without revealing
    // Jitsi's chrome to the user — we render our own controls on top.
    height: 1,
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  hiddenContainer: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000',
  },
});
