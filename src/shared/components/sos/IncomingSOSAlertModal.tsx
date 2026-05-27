import React, { useCallback } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BigButton } from '@/shared/components/BigButton';
import { colors, radius, spacing, typography } from '@/shared/theme';
import { SOS_PROBLEMS } from '@/domains/sos/types';
import type { IncomingSOSAlert } from '@/state/incomingSOSStore';

/**
 * F29.3 — Modal de alerta de SOS recebido de outro motociclista.
 *
 * Aparece OVER qualquer tela (montado no App root via IncomingSOSMount).
 * Mostra identidade do piloto em apuros, problema, distancia e mensagem
 * livre. Dois CTAs:
 *
 *   - SIM, ESTOU A CAMINHO! → seta as coordenadas do SOS como destino
 *     no navigationStore. O piloto receptor pode entao tocar "INICIAR
 *     ROTA" no HomeScreen pra calcular o trajeto OSRM ate la.
 *   - AGORA NAO POSSO → so dismissa. O alerta sai do incomingSOSStore
 *     e nao volta a aparecer (a nao ser que o emissor reenvie).
 */
interface IncomingSOSAlertModalProps {
  alert: IncomingSOSAlert | null;
  onAccept: (alert: IncomingSOSAlert) => void;
  onDecline: (alert: IncomingSOSAlert) => void;
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1).replace('.', ',')} km`;
}

export const IncomingSOSAlertModal: React.FC<IncomingSOSAlertModalProps> = ({
  alert,
  onAccept,
  onDecline,
}) => {
  const handleAccept = useCallback(() => {
    if (alert !== null) onAccept(alert);
  }, [alert, onAccept]);

  const handleDecline = useCallback(() => {
    if (alert !== null) onDecline(alert);
  }, [alert, onDecline]);

  if (alert === null) return null;

  const problemMeta = SOS_PROBLEMS[alert.problem_type];
  const riderLine =
    alert.rider_moto !== undefined
      ? `${alert.rider_name} (${alert.rider_moto})`
      : alert.rider_name;

  return (
    <Modal
      visible
      animationType="slide"
      transparent
      onRequestClose={handleDecline}
      testID="modal-incoming-sos"
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>🚨  ALERTA DE SOS PRÓXIMO!</Text>
          <Text style={styles.headline}>
            Há um motociclista precisando de apoio a{' '}
            <Text style={styles.distance}>{formatDistance(alert.distance_km)}</Text>{' '}
            de você.
          </Text>

          <View style={styles.detailBlock}>
            <Text style={styles.detailLabel}>MOTOCICLISTA</Text>
            <Text style={styles.detailValue} testID="sos-incoming-rider">
              {riderLine}
            </Text>
          </View>

          <View style={styles.detailBlock}>
            <Text style={styles.detailLabel}>PROBLEMA</Text>
            <Text style={styles.detailValue} testID="sos-incoming-problem">
              {problemMeta.emoji}  {problemMeta.label}
            </Text>
          </View>

          {alert.message !== undefined ? (
            <View style={styles.detailBlock}>
              <Text style={styles.detailLabel}>MENSAGEM</Text>
              <Text
                style={[styles.detailValue, styles.detailMessage]}
                testID="sos-incoming-message"
              >
                &ldquo;{alert.message}&rdquo;
              </Text>
            </View>
          ) : null}

          <Text style={styles.question}>
            Você pode parar para dar esse apoio?
          </Text>

          <View style={styles.actionRow}>
            <BigButton
              label="🏍️  SIM, ESTOU A CAMINHO!"
              variant="primary"
              fullWidth
              onPress={handleAccept}
              testID="btn-sos-incoming-accept"
              accessibilityLabel={`Aceitar SOS de ${alert.rider_name} a ${formatDistance(alert.distance_km)}`}
            />
          </View>
          <View style={styles.actionRow}>
            <Pressable
              onPress={handleDecline}
              accessibilityRole="button"
              accessibilityLabel="Recusar este SOS"
              style={({ pressed }) => [
                styles.declineBtn,
                pressed ? styles.declineBtnPressed : null,
              ]}
              testID="btn-sos-incoming-decline"
            >
              <Text style={styles.declineBtnText}>
                ❌  Agora não posso / Recusar
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.danger,
    padding: spacing.lg,
  },
  eyebrow: {
    color: colors.danger,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
    marginBottom: spacing.sm,
  },
  headline: {
    color: colors.textPrimary,
    fontSize: typography.navPrimary.fontSize,
    fontWeight: '700',
    lineHeight: 26,
    marginBottom: spacing.md,
  },
  distance: {
    color: colors.danger,
    fontWeight: '800',
  },
  detailBlock: {
    marginTop: spacing.sm,
  },
  detailLabel: {
    color: colors.textMuted,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
  },
  detailValue: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '600',
    lineHeight: 22,
    marginTop: 2,
  },
  detailMessage: {
    fontStyle: 'italic',
    color: colors.textSecondary,
  },
  question: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: 22,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  actionRow: {
    marginTop: spacing.sm,
  },
  declineBtn: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
  },
  declineBtnPressed: {
    opacity: 0.6,
  },
  declineBtnText: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navSecondary.lineHeight,
  },
});
