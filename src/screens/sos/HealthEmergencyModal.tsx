import React, { useCallback } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BigButton } from '@/shared/components/BigButton';
import { colors, radius, spacing, typography } from '@/shared/theme';

/**
 * Modal de Saude — Prioridade Maxima (F29.1).
 *
 * Quando o piloto seleciona "Emergencia de Saude" e desliza, alem do
 * broadcast pra rede (F29.2), abrimos este modal com:
 *  - Dial direto SAMU 192 (servico publico, gratis em qualquer estado)
 *  - Dial direto Bombeiros 193
 *  - Share da localizacao via share sheet nativo (usuario escolhe WhatsApp)
 *
 * O texto compartilhado vem pre-formatado com link do Google Maps pra que
 * quem receber consiga abrir o ponto no celular sem digitar coordenada.
 */
interface HealthEmergencyModalProps {
  visible: boolean;
  latitude: number | null;
  longitude: number | null;
  riderName?: string;
  onClose: () => void;
}

function formatLocationText(
  lat: number,
  lng: number,
  riderName?: string,
): string {
  const who = riderName !== undefined && riderName.length > 0 ? riderName : 'Estou';
  // Coordenadas com 6 casas (~11cm de precisao) — preciso o suficiente
  // pro SAMU/familiar encontrar, e ainda copiavel sem ficar gigante.
  const latStr = lat.toFixed(6);
  const lngStr = lng.toFixed(6);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${latStr},${lngStr}`;
  return [
    `🆘 ${who} em emergência e preciso de ajuda.`,
    '',
    `📍 Minha localização agora:`,
    `Lat: ${latStr}`,
    `Lng: ${lngStr}`,
    '',
    `Abra no mapa: ${mapsUrl}`,
  ].join('\n');
}

export const HealthEmergencyModal: React.FC<HealthEmergencyModalProps> = ({
  visible,
  latitude,
  longitude,
  riderName,
  onClose,
}) => {
  const handleCallSamu = useCallback(() => {
    void Linking.openURL('tel:192').catch(() => {
      Alert.alert(
        'Erro',
        'Nao foi possivel abrir o discador. Disque 192 manualmente.',
      );
    });
  }, []);

  const handleCallBombeiros = useCallback(() => {
    void Linking.openURL('tel:193').catch(() => {
      Alert.alert(
        'Erro',
        'Nao foi possivel abrir o discador. Disque 193 manualmente.',
      );
    });
  }, []);

  const handleShareLocation = useCallback(() => {
    if (latitude === null || longitude === null) {
      Alert.alert(
        'Sem localizacao',
        'Aguardando GPS. Tente novamente em alguns segundos.',
      );
      return;
    }
    const message = formatLocationText(latitude, longitude, riderName);
    void Share.share(
      { message, title: 'Emergencia BikerWay' },
      { dialogTitle: 'Compartilhar localizacao de emergencia' },
    ).catch(() => {
      Alert.alert(
        'Erro',
        'Nao foi possivel abrir o compartilhamento. Tente novamente.',
      );
    });
  }, [latitude, longitude, riderName]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      testID="health-emergency-modal"
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.eyebrow}>EMERGÊNCIA DE SAÚDE</Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Fechar"
              style={({ pressed }) => [
                styles.closeBtn,
                pressed ? styles.closeBtnPressed : null,
              ]}
              testID="btn-close-health-modal"
            >
              <Text style={styles.closeBtnText}>×</Text>
            </Pressable>
          </View>
          <Text style={styles.title}>Acione ajuda imediatamente</Text>
          <Text style={styles.subtitle}>
            O SOS ja foi enviado pros motociclistas proximos. Use os botoes
            abaixo pra falar com o servico publico ou avisar a familia.
          </Text>

          <View style={styles.actionRow}>
            <BigButton
              label="LIGAR 192 (SAMU)"
              variant="danger"
              fullWidth
              onPress={handleCallSamu}
              testID="btn-health-call-samu"
              accessibilityLabel="Ligar para o SAMU no numero 192"
            />
          </View>
          <View style={styles.actionRow}>
            <BigButton
              label="LIGAR 193 (BOMBEIROS)"
              variant="danger"
              fullWidth
              onPress={handleCallBombeiros}
              testID="btn-health-call-bombeiros"
              accessibilityLabel="Ligar para o Corpo de Bombeiros no numero 193"
            />
          </View>
          <View style={styles.actionRow}>
            <BigButton
              label="COMPARTILHAR LOCALIZAÇÃO"
              variant="warning"
              fullWidth
              onPress={handleShareLocation}
              testID="btn-health-share-location"
              accessibilityLabel="Compartilhar localizacao atual com familiares via WhatsApp ou outro app"
            />
          </View>

          <Text style={styles.disclaimer}>
            192 (SAMU) e 193 (Bombeiros) sao gratuitos em todo o territorio
            nacional, inclusive sem credito no celular.
          </Text>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  eyebrow: {
    color: colors.danger,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: colors.surfaceElevated,
  },
  closeBtnPressed: {
    opacity: 0.7,
  },
  closeBtnText: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 22,
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.navPrimary.fontSize,
    fontWeight: typography.navPrimary.fontWeight,
    lineHeight: typography.navPrimary.lineHeight,
    marginBottom: spacing.xs,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  actionRow: {
    marginTop: spacing.sm,
  },
  disclaimer: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
    fontStyle: 'italic',
    marginTop: spacing.md,
    textAlign: 'center',
  },
});
