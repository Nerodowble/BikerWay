import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Screen } from '@/shared/components/Screen';
import { BigButton } from '@/shared/components/BigButton';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { LabeledInput } from '@/shared/components/LabeledInput';
import { colors, radius, spacing, typography } from '@/shared/theme';
import { getVoiceController } from '@/shared/components/voice';
import { useNavigationStore } from '@/state/navigationStore';
import { MicTestModal } from '@/shared/components/voice/MicTestModal';
import { colorForParticipant } from '@/domains/voice/participantColor';
import { useVoiceGroupStore } from '@/state/voiceGroupStore';
import {
  selectActiveMotorcycle,
  useMotorcycleStore,
} from '@/state/motorcycleStore';
import { useRiderStore } from '@/state/riderStore';
import { useMovementLock } from '@/shared/hooks/useMovementLock';
import type {
  VoiceConnectionStatus,
  VoiceParticipant,
} from '@/domains/voice/types';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Comboio'>;
type BadgeState = 'ok' | 'warning' | 'danger' | 'neutral';

const CODE_LENGTH = 4;

function statusToBadge(s: VoiceConnectionStatus): {
  state: BadgeState;
  label: string;
} {
  switch (s) {
    case 'connected':
      return { state: 'ok', label: 'Conectado' };
    case 'connecting':
      return { state: 'warning', label: 'Conectando...' };
    case 'reconnecting':
      return { state: 'warning', label: 'Reconectando...' };
    case 'disconnected':
      return { state: 'danger', label: 'Desconectado' };
    case 'failed':
      return { state: 'danger', label: 'Falha' };
    case 'idle':
    default:
      return { state: 'neutral', label: 'Ocioso' };
  }
}

function localStatusDotColor(s: VoiceConnectionStatus): string {
  // Green = healthy connection, yellow = transient (connecting/reconnecting),
  // red = something is broken (disconnected/failed).
  switch (s) {
    case 'connected':
      return colors.success;
    case 'connecting':
    case 'reconnecting':
      return colors.warning;
    case 'disconnected':
    case 'failed':
      return colors.danger;
    case 'idle':
    default:
      return colors.textMuted;
  }
}

function resolveDisplayName(): string {
  // Priority order:
  //   1. Rider profile displayName (the canonical nick — set in
  //      RiderProfileScreen and used across every social surface).
  //   2. Active motorcycle's `ownerName` (legacy field on Motorcycle, kept
  //      for back-compat with bikes created before the rider profile).
  //   3. Just the bike string ("Honda PCX") when no human name is known.
  //   4. "Piloto" as a final fallback.
  const riderName = useRiderStore.getState().profile?.displayName?.trim();
  const active = selectActiveMotorcycle(useMotorcycleStore.getState());
  const bike = active ? `${active.brand} ${active.model}`.trim() : '';

  if (riderName && riderName.length > 0) {
    return bike.length > 0 ? `${riderName} - ${bike}` : riderName;
  }
  if (active?.ownerName && active.ownerName.length > 0) {
    return bike.length > 0 ? `${active.ownerName} - ${bike}` : active.ownerName;
  }
  return bike.length > 0 ? bike : 'Piloto';
}

export const ComboioScreen: React.FC<Props> = ({ navigation }) => {
  // Landscape adaptive layout: in paisagem the active-room screen would be
  // ~360-450dp tall, so stacking header → list → 3 stacked controls vertically
  // gets cropped on the bottom. We detect landscape here and switch the
  // active-room body to a two-column flow (list on the left, controls on the
  // right). Portrait keeps the original single-column layout intact.
  const { width: viewportWidth, height: viewportHeight } =
    useWindowDimensions();
  const isLandscape = viewportWidth > viewportHeight;

  const token = useVoiceGroupStore((s) => s.token);
  const status = useVoiceGroupStore((s) => s.status);
  const isLocalMuted = useVoiceGroupStore((s) => s.isLocalMuted);
  const audioOutput = useVoiceGroupStore((s) => s.audioOutput);
  const participants = useVoiceGroupStore((s) => s.participants);
  const dominantSpeakerId = useVoiceGroupStore((s) => s.dominantSpeakerId);
  const lastError = useVoiceGroupStore((s) => s.lastError);
  const displayName = useVoiceGroupStore((s) => s.displayName);
  // F30: toggles locais — ocultar pins dos peers e mutar audio recebido.
  const peerPinsHidden = useVoiceGroupStore((s) => s.peerPinsHidden);
  const incomingAudioMuted = useVoiceGroupStore((s) => s.incomingAudioMuted);

  const createComboio = useVoiceGroupStore((s) => s.createComboio);
  const joinComboio = useVoiceGroupStore((s) => s.joinComboio);
  const leaveComboio = useVoiceGroupStore((s) => s.leaveComboio);
  const setStatus = useVoiceGroupStore((s) => s.setStatus);
  const setLocalMuted = useVoiceGroupStore((s) => s.setLocalMuted);
  const setAudioOutput = useVoiceGroupStore((s) => s.setAudioOutput);
  const setPeerPinsHidden = useVoiceGroupStore((s) => s.setPeerPinsHidden);
  const setIncomingAudioMuted = useVoiceGroupStore(
    (s) => s.setIncomingAudioMuted,
  );
  const upsertParticipant = useVoiceGroupStore((s) => s.upsertParticipant);
  const removeParticipant = useVoiceGroupStore((s) => s.removeParticipant);
  const setDominantSpeaker = useVoiceGroupStore((s) => s.setDominantSpeaker);
  const setError = useVoiceGroupStore((s) => s.setError);

  const { isMoving } = useMovementLock();
  const [joinCode, setJoinCode] = useState<string>('');
  // Surfaced after the rider toggles VIVA-VOZ/CAPACETE: we persist the
  // preference but cannot yet flip native audio routing.
  const [showRoutingNotice, setShowRoutingNotice] = useState(false);
  const [micTestOpen, setMicTestOpen] = useState(false);

  const handleClose = useCallback(() => navigation.goBack(), [navigation]);
  const handleCreate = useCallback(() => {
    createComboio(resolveDisplayName());
  }, [createComboio]);

  const handleJoin = useCallback(() => {
    if (isMoving) {
      Keyboard.dismiss();
      return;
    }
    const normalized = joinCode.trim().toUpperCase();
    if (normalized.length !== CODE_LENGTH) {
      setError(`Digite um código de ${CODE_LENGTH} caracteres.`);
      return;
    }
    const result = joinComboio(normalized, resolveDisplayName());
    if (result === null) return; // joinComboio already populated lastError
    setJoinCode('');
    Keyboard.dismiss();
  }, [isMoving, joinCode, joinComboio, setError]);

  // Voice commands now route through getVoiceController(), which talks to
  // the SINGLETON JitsiWebView mounted at App.tsx root via VoiceSessionMount.
  // That keeps the call + 3s GPS broadcast alive even when the rider closes
  // this modal to look at the map.
  const handleToggleMute = useCallback(() => {
    getVoiceController()?.toggleAudio();
  }, []);

  // TODO: Native audio routing (speaker / Bluetooth helmet / earpiece)
  // requires platform modules we don't ship yet (e.g.
  // react-native-incall-manager). For now we only persist the UI
  // preference and surface a banner explaining the limitation.
  const handleToggleAudioOutput = useCallback(() => {
    setAudioOutput(audioOutput === 'speaker' ? 'phone' : 'speaker');
    setShowRoutingNotice(true);
  }, [audioOutput, setAudioOutput]);

  // F30: toggles puramente locais — apenas mudam state no store + (no caso
  // do mute incoming) propagam pra WebView via VoiceSessionMount effect.
  const handleTogglePeerPins = useCallback(() => {
    setPeerPinsHidden(!peerPinsHidden);
  }, [peerPinsHidden, setPeerPinsHidden]);

  const handleToggleIncomingMute = useCallback(() => {
    setIncomingAudioMuted(!incomingAudioMuted);
  }, [incomingAudioMuted, setIncomingAudioMuted]);

  const handleHangup = useCallback(() => {
    getVoiceController()?.hangup();
    leaveComboio();
    navigation.goBack();
  }, [leaveComboio, navigation]);

  // Lobby
  if (token === null) {
    return (
      <Screen padding scroll testID="screen-comboio-lobby">
        <View style={styles.header}>
          <Text style={styles.title}>Comboio</Text>
          <View style={styles.closeButton}>
            <BigButton
              label="Fechar"
              variant="secondary"
              onPress={handleClose}
              testID="btn-comboio-close"
            />
          </View>
        </View>

        <Text style={styles.subtitle}>
          Crie um comboio e compartilhe o código com os pilotos, ou entre em um
          comboio existente.
        </Text>

        {lastError ? (
          <View style={styles.bannerRow}>
            <StatusBadge
              label="Erro"
              value={lastError}
              state="danger"
              testID="banner-comboio-error"
            />
          </View>
        ) : null}

        <View style={styles.lobbyAction}>
          <BigButton
            label="CRIAR COMBOIO"
            variant="primary"
            fullWidth
            onPress={handleCreate}
            testID="btn-comboio-create"
          />
        </View>

        {isMoving ? (
          <Text style={styles.movementWarning} testID="warning-movement-lock">
            Pare a moto para digitar o código. Movimento detectado (&gt; 5
            km/h).
          </Text>
        ) : null}

        <View
          pointerEvents={isMoving ? 'none' : 'auto'}
          style={isMoving ? styles.inputLocked : null}
        >
          <LabeledInput
            label={`Código do comboio (${CODE_LENGTH} caracteres)`}
            value={joinCode}
            onChangeText={(t) =>
              setJoinCode(t.toUpperCase().slice(0, CODE_LENGTH))
            }
            placeholder="Ex.: A3K9"
            keyboardType="default"
            autoCapitalize="characters"
            testID="input-comboio-code"
          />
        </View>

        <View style={styles.lobbyAction}>
          <BigButton
            label="ENTRAR NO COMBOIO"
            variant="secondary"
            fullWidth
            onPress={handleJoin}
            disabled={joinCode.trim().length !== CODE_LENGTH}
            testID="btn-comboio-join"
          />
        </View>

        <View style={styles.lobbyAction}>
          <BigButton
            label="TESTAR MICROFONE"
            variant="secondary"
            fullWidth
            onPress={() => setMicTestOpen(true)}
            testID="btn-comboio-mic-test"
          />
        </View>

        <Text style={styles.infoText}>
          O áudio fica em segundo plano enquanto você navega. Use o botão MUTAR
          no painel para falar com o grupo. Use TESTAR MICROFONE para validar
          o áudio sem precisar de um segundo dispositivo.
        </Text>

        <MicTestModal
          visible={micTestOpen}
          onClose={() => setMicTestOpen(false)}
        />
      </Screen>
    );
  }

  // Active room
  const ui = statusToBadge(status);
  // Debug mode: when true, the hidden WebView takes over the full screen so
  // the rider sees the native Jitsi UI (lobby / auth / errors). Diagnostic
  // panel below renders the last in-page state polled from the bridge.
  // Visual logic: when muted the button is RED + label says DESMUTAR (the
  // action that will happen on tap). When live the button is the primary
  // accent + label says MUTAR. This mirrors the spec's "drastic colour
  // change" so the rider sees state at a glance.
  const muteLabel = isLocalMuted ? 'DESMUTAR' : 'MUTAR';
  const muteVariant: 'primary' | 'danger' = isLocalMuted ? 'danger' : 'primary';
  const audioOutputLabel =
    audioOutput === 'speaker' ? 'ALTO-FALANTE' : 'FONE/CAPACETE';
  // F30: labels com estado VISIVEL (palavra forte) e variant warning
  // quando ativo pra deixar claro que a UX padrao da audicao/visualizacao
  // esta alterada — espelha a regra do MUTAR/DESMUTAR.
  const peerPinsLabel = peerPinsHidden
    ? 'MOSTRAR PINS NO MAPA'
    : 'OCULTAR PINS NO MAPA';
  const peerPinsVariant: 'secondary' | 'warning' = peerPinsHidden
    ? 'warning'
    : 'secondary';
  const incomingMuteLabel = incomingAudioMuted
    ? 'OUVIR COMBOIO'
    : 'MUTAR TODO COMBOIO';
  const incomingMuteVariant: 'secondary' | 'warning' = incomingAudioMuted
    ? 'warning'
    : 'secondary';

  // The active-room body is built from four reusable blocks (header,
  // banners, controls, participants). We compose them in two different
  // orders depending on orientation so each layout reads naturally:
  //   - Portrait: header → banners → controls (row) → participants (list).
  //   - Landscape: header (full width) → banners (full width) → row of
  //     [participants (left, wider) | controls stacked (right)].
  const headerBlock = (
    <View style={styles.activeTopBar}>
      <View style={styles.activeTopLeft}>
        <StatusBadge
          label="Comboio"
          value={`#${token.code}`}
          state={ui.state}
          testID="badge-comboio-room"
        />
        <View style={styles.activeTopSpacer} />
        <StatusBadge
          label="Status"
          value={ui.label}
          state={ui.state}
          testID="badge-comboio-status"
        />
      </View>
    </View>
  );

  const bannersBlock = (
    <>
      {showRoutingNotice ? (
        <View style={styles.bannerRow}>
          <StatusBadge
            label="Aviso"
            value="Preferência salva. Roteamento físico exige módulo nativo."
            state="warning"
            testID="banner-audio-routing-notice"
          />
        </View>
      ) : null}
      {lastError ? (
        <View style={styles.bannerRow}>
          <StatusBadge
            label="Erro"
            value={lastError}
            state="danger"
            testID="banner-comboio-error"
          />
        </View>
      ) : null}
    </>
  );

  // F30 — bloco de preferencias locais (toggles que so afetam ESTE device).
  // Mantido separado do `controlsBlock` (MUTE/AUDIO/SAIR) pra nao crowdar
  // 5 botoes na linha portrait. Sempre stack vertical pra etiquetas longas.
  const localPrefsBlock = (
    <View style={styles.localPrefsBlock} testID="comboio-local-prefs">
      <Text style={styles.localPrefsEyebrow}>PREFERÊNCIAS LOCAIS</Text>
      <Text style={styles.localPrefsHint}>
        Só afetam o que VOCÊ vê e ouve — os outros não percebem.
      </Text>
      <View style={styles.bigButtonWrap}>
        <BigButton
          label={peerPinsLabel}
          variant={peerPinsVariant}
          fullWidth
          onPress={handleTogglePeerPins}
          testID="btn-comboio-toggle-pins"
        />
      </View>
      <View style={styles.controlStackSpacer} />
      <View style={styles.bigButtonWrap}>
        <BigButton
          label={incomingMuteLabel}
          variant={incomingMuteVariant}
          fullWidth
          onPress={handleToggleIncomingMute}
          testID="btn-comboio-toggle-incoming-mute"
        />
      </View>
    </View>
  );

  // In landscape we drop `compact` from the BigButtons so the tap targets
  // stay generous (the column is narrower than a portrait row, but each
  // button uses the full column width and gets some vertical breathing
  // room between them via `controlStackSpacer`).
  const controlsBlock = isLandscape ? (
    <View style={styles.controlsColumn} testID="comboio-controls-column">
      <View style={styles.bigButtonWrap}>
        <BigButton
          label={muteLabel}
          variant={muteVariant}
          fullWidth
          onPress={handleToggleMute}
          testID="btn-comboio-mute"
        />
      </View>
      <View style={styles.controlStackSpacer} />
      <View style={styles.bigButtonWrap}>
        <BigButton
          label={audioOutputLabel}
          variant="secondary"
          fullWidth
          onPress={handleToggleAudioOutput}
          testID="btn-comboio-audio-output"
        />
      </View>
      <View style={styles.controlStackSpacer} />
      <View style={styles.bigButtonWrap}>
        <BigButton
          label="SAIR"
          variant="danger"
          fullWidth
          onPress={handleHangup}
          testID="btn-comboio-hangup"
        />
      </View>
    </View>
  ) : (
    <View style={styles.controlsRow}>
      <View style={styles.controlCell}>
        <View style={styles.bigButtonWrap}>
          <BigButton
            label={muteLabel}
            variant={muteVariant}
            fullWidth
            compact
            onPress={handleToggleMute}
            testID="btn-comboio-mute"
          />
        </View>
      </View>
      <View style={styles.controlSpacer} />
      <View style={styles.controlCell}>
        <View style={styles.bigButtonWrap}>
          <BigButton
            label={audioOutputLabel}
            variant="secondary"
            fullWidth
            compact
            onPress={handleToggleAudioOutput}
            testID="btn-comboio-audio-output"
          />
        </View>
      </View>
      <View style={styles.controlSpacer} />
      <View style={styles.controlCell}>
        <View style={styles.bigButtonWrap}>
          <BigButton
            label="SAIR"
            variant="danger"
            fullWidth
            compact
            onPress={handleHangup}
            testID="btn-comboio-hangup"
          />
        </View>
      </View>
    </View>
  );

  const participantsBlock = (
    <>
      <Text style={styles.sectionTitle}>STATUS DOS INTEGRANTES</Text>

      {/* Local user row — always rendered at the top so the rider sees how
          THEIR own connection looks before scanning peers. */}
      <View style={styles.participantRow}>
        <View
          style={[
            styles.participantDot,
            { backgroundColor: localStatusDotColor(status) },
          ]}
        />
        <View
          style={[
            styles.participantColorTag,
            { backgroundColor: colorForParticipant(displayName || 'self') },
          ]}
        />
        <Text style={styles.participantName} numberOfLines={1}>
          {displayName || 'Piloto'}
          <Text style={styles.localUserSuffix}> (você)</Text>
        </Text>
        {isLocalMuted ? (
          <Text style={styles.participantMuted}>MUTADO</Text>
        ) : null}
      </View>

      <ParticipantsList
        participants={participants}
        dominantSpeakerId={dominantSpeakerId}
        status={status}
      />
    </>
  );

  return (
    <Screen padding testID="screen-comboio-active">
      {headerBlock}

      {/*
        The voice WebView used to live here. It now lives at the App root
        (see VoiceSessionMount in App.tsx) so the call survives when the
        rider closes this modal to look at the map.
      */}

      {bannersBlock}

      {isLandscape ? (
        // Landscape viewport (~360-450dp altura) facilmente estoura quando o
        // rider tem >3 peers OU quando aparece um banner. Envolver em
        // ScrollView garante que tudo permanece acessível mesmo com pouco
        // espaço vertical.
        <ScrollView
          style={styles.landscapeScroll}
          contentContainerStyle={styles.landscapeScrollContent}
          testID="comboio-landscape-scroll"
        >
          <View style={styles.landscapeSplit} testID="comboio-landscape-split">
            <View style={styles.landscapeLeftColumn}>{participantsBlock}</View>
            <View style={styles.landscapeColumnSpacer} />
            <View style={styles.landscapeRightColumn}>
              {controlsBlock}
              {localPrefsBlock}
            </View>
          </View>
        </ScrollView>
      ) : (
        <>
          {controlsBlock}
          {localPrefsBlock}
          {participantsBlock}
        </>
      )}
    </Screen>
  );
};

interface ParticipantsListProps {
  participants: VoiceParticipant[];
  dominantSpeakerId: string | null;
  status: VoiceConnectionStatus;
}

const ParticipantsList: React.FC<ParticipantsListProps> = ({
  participants,
  dominantSpeakerId,
  status,
}) => {
  const isReconnecting = status === 'reconnecting';

  const renderRow = useCallback(
    (item: VoiceParticipant) => {
      // green = ok, red = muted, gray = reconnecting/unknown.
      let dotColor: string = colors.success;
      if (isReconnecting) dotColor = colors.textMuted;
      else if (item.isAudioMuted) dotColor = colors.danger;
      const isTalking = item.id === dominantSpeakerId && !item.isAudioMuted;
      const tagColor = colorForParticipant(item.id);
      return (
        <View key={item.id} style={styles.participantRow}>
          <View style={[styles.participantDot, { backgroundColor: dotColor }]} />
          <View
            style={[styles.participantColorTag, { backgroundColor: tagColor }]}
          />
          <Text style={styles.participantName} numberOfLines={1}>
            {item.displayName || 'Piloto'}
          </Text>
          {item.isAudioMuted ? (
            <Text style={styles.participantMuted}>MUTADO</Text>
          ) : null}
          {isTalking ? (
            <Text style={styles.participantTalking}>Falando...</Text>
          ) : null}
        </View>
      );
    },
    [dominantSpeakerId, isReconnecting],
  );

  if (participants.length === 0) {
    return (
      <Text style={styles.emptyHint} testID="hint-comboio-empty-list">
        Aguardando outros pilotos entrarem...
      </Text>
    );
  }

  // View+map instead of FlatList: a comboio rarely exceeds ~6 peers and the
  // list is now rendered inside a parent ScrollView in landscape mode — a
  // nested VirtualizedList would warn and lose its own scrolling anyway.
  return (
    <View style={styles.participantList} testID="list-comboio-participants">
      {participants.map(renderRow)}
    </View>
  );
};

// Doc 04 requires minimum 70dp tap target for comboio controls;
// BigButton's default floor is 64dp (hitTarget.min) so we wrap it via
// `bigButtonWrap` below.
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  title: { flex: 1, color: colors.textPrimary, fontSize: typography.navPrimary.fontSize, fontWeight: typography.navPrimary.fontWeight, lineHeight: typography.navPrimary.lineHeight, marginRight: spacing.md },
  closeButton: { minWidth: 120 },
  subtitle: { color: colors.textSecondary, fontSize: typography.navSecondary.fontSize, fontWeight: typography.navSecondary.fontWeight, lineHeight: typography.navSecondary.lineHeight, marginBottom: spacing.lg },
  bannerRow: { marginBottom: spacing.md },
  lobbyAction: { marginVertical: spacing.md },
  infoText: { color: colors.textMuted, fontSize: typography.sizes.sm, lineHeight: 20, marginTop: spacing.lg },
  movementWarning: { color: colors.warning, fontSize: typography.navSecondary.fontSize, fontWeight: '700', lineHeight: typography.navSecondary.lineHeight, marginBottom: spacing.sm, marginTop: spacing.sm },
  inputLocked: { opacity: 0.5 },
  activeTopBar: { marginBottom: spacing.md },
  activeTopLeft: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  activeTopSpacer: { width: spacing.sm, height: spacing.sm },
  hiddenWebView: { position: 'absolute', top: 0, left: 0, width: 1, height: 1, opacity: 0 },
  debugWebView: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', zIndex: 10 },
  debugCloseRow: { position: 'absolute', top: 40, right: 16, zIndex: 20 },
  diagnosticPanel: { backgroundColor: colors.surfaceElevated, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  diagnosticTitle: { color: colors.accent, fontSize: typography.sizes.sm, fontWeight: '700', marginBottom: spacing.xs, letterSpacing: 0.4 },
  diagnosticLine: { color: colors.textSecondary, fontSize: typography.sizes.sm, lineHeight: 18 },
  debugRow: { marginTop: spacing.md },
  localUserSuffix: { color: colors.textMuted, fontSize: typography.sizes.sm, fontWeight: '500' },
  participantMuted: { color: colors.danger, fontSize: typography.sizes.sm, fontWeight: '700', marginLeft: spacing.sm },
  participantColorTag: { width: 10, height: 18, borderRadius: 3, marginRight: spacing.sm, borderWidth: 1, borderColor: 'rgba(0,0,0,0.4)' },
  controlsRow: { flexDirection: 'row', alignItems: 'stretch', marginVertical: spacing.md },
  controlCell: { flex: 1 },
  controlSpacer: { width: spacing.sm },
  bigButtonWrap: { minHeight: 70 },
  // Landscape: 3 buttons stacked vertically inside the narrower right
  // column. `flex: 1` here lets the column fill the available height of
  // the split row so the SAIR button sits flush with the bottom of the
  // participants list on the left.
  controlsColumn: { flex: 1, justifyContent: 'flex-start' },
  controlStackSpacer: { height: spacing.md },
  localPrefsBlock: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  localPrefsEyebrow: {
    color: colors.textMuted,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
    marginBottom: 2,
  },
  localPrefsHint: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
    fontStyle: 'italic',
    marginBottom: spacing.md,
  },
  // Landscape two-column body. Weights 1.4 / 1 give the participant list
  // visually more space (it can grow to many rows) without starving the
  // controls column of width — at 720x360 that's ~410dp / ~290dp, well
  // above the 64dp tap-target floor for the controls.
  landscapeScroll: { flex: 1 },
  landscapeScrollContent: { paddingBottom: spacing.lg, flexGrow: 1 },
  landscapeSplit: { flex: 1, flexDirection: 'row', alignItems: 'stretch' },
  landscapeLeftColumn: { flex: 1.4 },
  landscapeRightColumn: { flex: 1 },
  landscapeColumnSpacer: { width: spacing.lg },
  sectionTitle: { color: colors.textSecondary, fontSize: typography.navSecondary.fontSize, fontWeight: '700', lineHeight: typography.navSecondary.lineHeight, marginTop: spacing.lg, marginBottom: spacing.sm, letterSpacing: 0.5 },
  participantList: { flex: 1 },
  participantRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, borderRadius: radius.sm },
  participantDot: { width: 12, height: 12, borderRadius: 6, marginRight: spacing.md },
  participantName: { flex: 1, color: colors.textPrimary, fontSize: typography.navSecondary.fontSize, fontWeight: typography.navSecondary.fontWeight, lineHeight: typography.navSecondary.lineHeight },
  participantTalking: { color: colors.accent, fontSize: typography.sizes.sm, fontWeight: '700', marginLeft: spacing.sm },
  emptyHint: { color: colors.textMuted, fontSize: typography.navSecondary.fontSize, lineHeight: typography.navSecondary.lineHeight, marginTop: spacing.md },
});
