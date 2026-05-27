import React, { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography } from '@/shared/theme';
import { useNavigationStore } from '@/state/navigationStore';
import { useTripCompletionStore } from '@/state/tripCompletionStore';
import { ReportWhisperModal } from './ReportWhisperModal';

/**
 * F35.9 — Botao flutuante "⚠️ REPORTAR" que aparece na HomeScreen quando
 * o piloto esta NAVEGANDO ATIVAMENTE uma rota do catalogo. Lemos o
 * `rotaId` do `tripCompletionStore` (que e setado em
 * `handleStartNavigation` do RouteDetail). Sem rota ativa do catalogo
 * (ex: navegacao destino livre via DestinationSearch), o botao some.
 */
export const WhisperReportButton: React.FC = () => {
  const trackerActive = useTripCompletionStore((s) => s.active);
  const rotaId = useTripCompletionStore((s) => s.rotaId);
  const currentPosition = useNavigationStore((s) => s.currentPosition);
  const insets = useSafeAreaInsets();
  const [modalOpen, setModalOpen] = useState(false);

  if (!trackerActive || rotaId === null) return null;

  // Posicao: LATERAL ESQUERDA, centro-superior (~38% da altura). Esta
  // area e SEMPRE so mapa em vertical e em horizontal:
  //   - Em portrait, o nav-card (ManeuverPanel + ETA + GPS warnings) mora
  //     no topo ate ~30%, e os action buttons (CANCELAR/LUGARES/TANQUE)
  //     ficam no rodape. Lateral esquerda meio = espaco livre.
  //   - Em landscape, o comboio button + outros FABs ficam no rodape
  //     direito. Mesmo principio.
  // Usar percentual (em vez de offset fixo) garante que cards de
  // navegacao mais altos (com reroute banner, GPS lost, etc.) nao colidam.
  const leftOffset = Math.max(spacing.lg, insets.left + spacing.sm);

  return (
    <>
      <Pressable
        onPress={() => setModalOpen(true)}
        style={({ pressed }) => [
          styles.fab,
          { left: leftOffset },
          pressed ? styles.fabPressed : null,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Reportar condição na rota"
        testID="btn-whisper-report"
      >
        <Text style={styles.fabIcon}>⚠️</Text>
        <Text style={styles.fabLabel}>REPORTAR</Text>
      </Pressable>
      <ReportWhisperModal
        visible={modalOpen}
        rotaId={rotaId}
        userPosition={
          currentPosition
            ? {
                latitude: currentPosition.latitude,
                longitude: currentPosition.longitude,
              }
            : null
        }
        onClose={() => setModalOpen(false)}
      />
    </>
  );
};

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    // Percentual robusto: 38% do topo cai abaixo do nav-card mais alto
    // mesmo em telas curtas. Em telas longas, fica ainda mais centralizado
    // verticalmente — sempre na regiao "so mapa" da lateral esquerda.
    top: '38%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.warning,
    borderWidth: 1,
    borderColor: '#000',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 6,
    zIndex: 50,
  },
  fabPressed: {
    opacity: 0.85,
  },
  fabIcon: {
    fontSize: 20,
  },
  fabLabel: {
    color: '#000',
    fontSize: typography.caption.fontSize,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
