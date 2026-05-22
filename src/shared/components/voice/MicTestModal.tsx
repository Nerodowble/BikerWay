import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { BigButton } from '@/shared/components/BigButton';
import { colors, radius, spacing, typography } from '@/shared/theme';

export interface MicTestModalProps {
  visible: boolean;
  onClose: () => void;
}

type Phase = 'idle' | 'recording' | 'processing' | 'playback' | 'error';

const RECORD_DURATION_MS = 3000;

/**
 * Self-contained microphone + speaker diagnostic.
 *
 * Records 3 seconds of audio while showing a live volume bar (metering API
 * from expo-audio), then plays it straight back. If the rider hears their
 * voice, microphone capture AND speaker output are both functional —
 * independent of whether Jitsi is healthy or not. Used to disambiguate
 * "Jitsi seems silent" from "the device hardware is broken".
 */
export const MicTestModal: React.FC<MicTestModalProps> = ({
  visible,
  onClose,
}) => {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const player = useAudioPlayer(recordingUri ? { uri: recordingUri } : null);

  useEffect(() => {
    return () => {
      if (stopTimerRef.current) {
        clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
      }
    };
  }, []);

  // Reset state every time the modal opens.
  useEffect(() => {
    if (visible) {
      setPhase('idle');
      setErrorMessage(null);
      setRecordingUri(null);
    }
  }, [visible]);

  const startRecording = async (): Promise<void> => {
    try {
      setErrorMessage(null);
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setPhase('error');
        setErrorMessage(
          'Permissão de microfone negada. Habilite nas Configurações do sistema.',
        );
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase('recording');

      stopTimerRef.current = setTimeout(() => {
        void stopRecording();
      }, RECORD_DURATION_MS);
    } catch (err) {
      setPhase('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const stopRecording = async (): Promise<void> => {
    try {
      setPhase('processing');
      if (stopTimerRef.current) {
        clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
      }
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) {
        setPhase('error');
        setErrorMessage('A gravação não produziu um arquivo.');
        return;
      }
      setRecordingUri(uri);
      // Switch audio mode to playback (allowsRecording=false routes to
      // earpiece on some devices; staying true keeps the loudspeaker which
      // is what the rider wants for the test).
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
      setPhase('playback');
    } catch (err) {
      setPhase('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const playRecording = (): void => {
    try {
      player.seekTo(0);
      player.play();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleClose = (): void => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    try {
      if (recorderState.isRecording) {
        void recorder.stop();
      }
      player.pause();
    } catch {
      /* swallow */
    }
    onClose();
  };

  // Live metering: expo-audio's recorder state exposes `metering` in dB
  // (typically -160 to 0). Map to a 0..1 ratio for the visual bar.
  const meteringDb = recorderState.metering ?? -160;
  const meteringNormalized = Math.max(0, Math.min(1, (meteringDb + 60) / 60));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={handleClose} />
        <View style={styles.card}>
          <Text style={styles.title}>Teste de microfone</Text>
          <Text style={styles.subtitle}>
            Grava 3 segundos do seu microfone e reproduz de volta no
            alto-falante. Útil para validar que o áudio está funcionando antes
            de entrar no comboio.
          </Text>

          {phase === 'idle' ? (
            <View style={styles.actionBlock}>
              <BigButton
                label="GRAVAR 3 SEGUNDOS"
                variant="primary"
                fullWidth
                onPress={() => {
                  void startRecording();
                }}
                testID="mic-test-start"
              />
            </View>
          ) : null}

          {phase === 'recording' ? (
            <View style={styles.actionBlock}>
              <Text style={styles.recordingText}>Gravando... fale algo!</Text>
              <View style={styles.meterTrack}>
                <View
                  style={[
                    styles.meterFill,
                    { width: `${meteringNormalized * 100}%` },
                  ]}
                />
              </View>
              <Text style={styles.meterHint}>
                A barra acima deve se mexer enquanto você fala.
              </Text>
            </View>
          ) : null}

          {phase === 'processing' ? (
            <View style={styles.actionBlock}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.processingText}>Processando...</Text>
            </View>
          ) : null}

          {phase === 'playback' ? (
            <View style={styles.actionBlock}>
              <Text style={styles.successText}>
                Gravação concluída. Toque PLAY pra ouvir.
              </Text>
              <BigButton
                label="OUVIR GRAVAÇÃO"
                variant="primary"
                fullWidth
                onPress={playRecording}
                testID="mic-test-play"
              />
              <View style={styles.spacer} />
              <BigButton
                label="GRAVAR DE NOVO"
                variant="secondary"
                fullWidth
                onPress={() => {
                  setPhase('idle');
                  setRecordingUri(null);
                }}
                testID="mic-test-retry"
              />
            </View>
          ) : null}

          {phase === 'error' ? (
            <View style={styles.actionBlock}>
              <Text style={styles.errorText}>
                {errorMessage ?? 'Erro desconhecido.'}
              </Text>
              <BigButton
                label="TENTAR DE NOVO"
                variant="secondary"
                fullWidth
                onPress={() => {
                  setPhase('idle');
                  setErrorMessage(null);
                }}
                testID="mic-test-error-retry"
              />
            </View>
          ) : null}

          <View style={styles.spacer} />
          <BigButton
            label="FECHAR"
            variant="secondary"
            fullWidth
            onPress={handleClose}
            testID="mic-test-close"
          />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: {
    color: colors.accent,
    fontSize: typography.navPrimary.fontSize,
    fontWeight: typography.navPrimary.fontWeight,
    marginBottom: spacing.sm,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    marginBottom: spacing.lg,
  },
  actionBlock: {
    marginBottom: spacing.md,
  },
  recordingText: {
    color: colors.warning,
    fontSize: typography.navPrimary.fontSize,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  meterTrack: {
    height: 24,
    width: '100%',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.pill,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  meterFill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  meterHint: {
    color: colors.textMuted,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  processingText: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  successText: {
    color: colors.success,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.navSecondary.fontSize,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  spacer: {
    height: spacing.sm,
  },
});
