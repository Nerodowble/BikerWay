import React, { useCallback, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography } from '@/shared/theme';
import {
  WHISPER_PRESETS,
  type WhisperKind,
} from '@/domains/whisper/types';
import { useWhisperStore } from '@/state/whisperStore';

/**
 * F35.9 — Modal de "Reportar nessa rota". Lista os 5 presets em botoes
 * grandes (1-toque, friendly pra luva). Mostra cooldown remaining se
 * houver. Fecha sozinho ao publicar com sucesso.
 */

export interface ReportWhisperModalProps {
  visible: boolean;
  rotaId: string;
  userPosition: { latitude: number; longitude: number } | null;
  routeKm?: number;
  onClose: () => void;
}

export const ReportWhisperModal: React.FC<ReportWhisperModalProps> = ({
  visible,
  rotaId,
  userPosition,
  routeKm,
  onClose,
}) => {
  const publish = useWhisperStore((s) => s.publish);
  const [submittingKind, setSubmittingKind] = useState<WhisperKind | null>(
    null,
  );

  const handlePick = useCallback(
    async (kind: WhisperKind) => {
      if (!userPosition) {
        Alert.alert(
          'Sem GPS',
          'Precisa de um sinal de GPS pra reportar nessa rota.',
        );
        return;
      }
      setSubmittingKind(kind);
      try {
        const result = await publish({
          rotaId,
          kind,
          latitude: userPosition.latitude,
          longitude: userPosition.longitude,
          ...(routeKm !== undefined ? { routeKm } : {}),
        });
        if (result.ok) {
          onClose();
        } else if (result.reason === 'duplicate') {
          Alert.alert(
            'Já reportado',
            'Outro piloto já reportou algo parecido aqui há pouco. Dirija mais 1 km pra reportar de novo do mesmo tipo.',
          );
        } else {
          Alert.alert('Erro', 'Falha ao enviar o reporte.');
        }
      } finally {
        setSubmittingKind(null);
      }
    },
    [publish, rotaId, userPosition, routeKm, onClose],
  );

  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      transparent
      animationType="slide"
    >
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Reportar nesta rota</Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Fechar"
              testID="btn-whisper-cancel"
            >
              <Text style={styles.cancelLabel}>CANCELAR</Text>
            </Pressable>
          </View>

          <View style={styles.presetsList}>
            {WHISPER_PRESETS.map((preset) => {
              const isSubmitting = submittingKind === preset.kind;
              return (
                <Pressable
                  key={preset.kind}
                  onPress={() => {
                    void handlePick(preset.kind);
                  }}
                  disabled={submittingKind !== null}
                  style={({ pressed }) => [
                    styles.presetBtn,
                    pressed ? styles.presetBtnPressed : null,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Reportar ${preset.label}`}
                  testID={`btn-whisper-preset-${preset.kind}`}
                >
                  <Text style={styles.presetEmoji}>{preset.emoji}</Text>
                  <Text style={styles.presetLabel}>{preset.label}</Text>
                  {isSubmitting ? (
                    <Text style={styles.presetSubmitting}>...</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.footnote}>
            Reportes são anônimos, expiram em 6h, e só aparecem pra outros
            pilotos rodando esta mesma rota. Pode reportar à vontade — só
            evite repetir o mesmo tipo no mesmo lugar em poucos minutos.
          </Text>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  title: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '800',
  },
  cancelLabel: {
    color: colors.danger,
    fontSize: typography.caption.fontSize,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  presetsList: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  presetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  presetBtnPressed: {
    opacity: 0.7,
    backgroundColor: colors.surfaceMuted,
  },
  presetEmoji: {
    fontSize: 28,
  },
  presetLabel: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  presetSubmitting: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '800',
  },
  footnote: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontStyle: 'italic',
    paddingHorizontal: spacing.lg,
    lineHeight: 18,
  },
});
