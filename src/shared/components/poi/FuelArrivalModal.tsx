import React from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { BigButton } from '@/shared/components/BigButton';
import { colors, radius, spacing, typography } from '@/shared/theme';

export interface FuelArrivalModalProps {
  visible: boolean;
  /** Station name, shown as a subtitle so the rider knows which stop fired. */
  poiName: string;
  /** Rider tapped "Sim, abasteci" — parent resets the odometer / waypoint. */
  onConfirm: () => void;
  /** Rider tapped "Não" — parent drops the waypoint but keeps odometer. */
  onDismiss: () => void;
  /**
   * Optional countdown in whole seconds. When provided, renders a small
   * "auto-dismiss in {N}s" hint below the buttons. Pass `null` or omit to
   * hide the hint entirely.
   */
  remainingSeconds?: number | null;
}

/**
 * Modal shown when the rider arrives at the injected fuel waypoint. Asks
 * "Você abasteceu?" so we know whether to reset trip-distance (effectively
 * marking the tank refilled) or just drop the detour and keep the previous
 * odometer reading.
 *
 * Intentionally NOT tap-to-dismiss: the backdrop is a blocking layer so the
 * rider must make an explicit choice (or wait for the timeout). This avoids
 * accidentally swiping the modal away with a gloved hand on a bumpy road.
 */
export const FuelArrivalModal: React.FC<FuelArrivalModalProps> = ({
  visible,
  poiName,
  onConfirm,
  onDismiss,
  remainingSeconds,
}) => {
  const showCountdown =
    remainingSeconds !== null && remainingSeconds !== undefined;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // onRequestClose is required by Android for the hardware back button.
      // We route it through onDismiss so the rider always lands in the
      // "did not refuel" branch (safer default — odometer untouched).
      onRequestClose={onDismiss}
    >
      <View style={styles.root} testID="fuel-arrival-modal">
        {/*
          Plain View (not Pressable) — backdrop is intentionally tap-blocking.
          The rider must pick SIM or NÃO, no swipe-to-dismiss.
        */}
        <View style={styles.backdrop} />

        <View style={styles.card} testID="fuel-arrival-card">
          <Text style={styles.title} accessibilityRole="header">
            Chegou no posto
          </Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {poiName}
          </Text>

          <Text style={styles.question}>Você abasteceu?</Text>

          <View style={styles.buttonsRow}>
            <View style={styles.buttonCell}>
              <BigButton
                label="SIM, ABASTECI"
                variant="primary"
                fullWidth
                compact
                onPress={onConfirm}
                testID="fuel-arrival-confirm"
              />
            </View>
            <View style={styles.buttonSpacer} />
            <View style={styles.buttonCell}>
              <BigButton
                label="NÃO"
                variant="secondary"
                fullWidth
                compact
                onPress={onDismiss}
                testID="fuel-arrival-dismiss"
              />
            </View>
          </View>

          {showCountdown ? (
            <Text style={styles.countdown} testID="fuel-arrival-countdown">
              {`Removerá a parada automaticamente em ${remainingSeconds}s`}
            </Text>
          ) : null}
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
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  card: {
    width: '90%',
    maxWidth: 480,
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
    lineHeight: typography.navPrimary.lineHeight,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: typography.navSecondary.lineHeight,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  question: {
    color: colors.textPrimary,
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.bold,
    marginBottom: spacing.lg,
  },
  buttonsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  buttonCell: {
    flex: 1,
  },
  buttonSpacer: {
    width: spacing.sm,
  },
  countdown: {
    color: colors.textMuted,
    fontSize: typography.sizes.xs,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
