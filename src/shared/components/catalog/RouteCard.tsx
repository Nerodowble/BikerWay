import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '@/shared/components/BigButton';
import { colors, elevation, radius, spacing, typography } from '@/shared/theme';
import type { CatalogRouteMatch } from '@/domains/catalog/types';

export interface RouteCardProps {
  match: CatalogRouteMatch;
  /**
   * Safe autonomy of the active motorcycle in km. Used to render the
   * warning line ("Seu tanque (Xkm) é menor que..."). Falls back to 0 when
   * the rider has no active bike — the warning copy then shows "0 km" but
   * the card is still rendered with the warning border so the visual cue is
   * preserved.
   */
  safeAutonomyKm: number;
  onPreview: (routeId: string) => void;
  testID?: string;
}

function formatReais(value: number): string {
  const safe = Number.isFinite(value) && value > 0 ? value : 0;
  return `R$ ${safe.toFixed(2).replace('.', ',')}`;
}

function formatKm(value: number): string {
  const safe = Number.isFinite(value) && value > 0 ? value : 0;
  return `${Math.round(safe)} km`;
}

/**
 * Single result row for the catalog list. Visual states:
 *   - default: dark elevated card, no border.
 *   - autonomyWarning: 2dp warning border + inline alert line.
 *   - overBudget: dimmed (opacity 0.5) + "Acima do orçamento" badge.
 *
 * No emojis in copy (project rule). Iconography is reserved for actual
 * vector icons added later; for now we use ALL-CAPS eyebrow labels.
 */
export const RouteCard: React.FC<RouteCardProps> = ({
  match,
  safeAutonomyKm,
  onPreview,
  testID,
}) => {
  const { route } = match;
  const pavimentoLabel = route.caracteristicas.tipo_pavimento.toUpperCase();
  const curvasLabel = route.caracteristicas.nivel_curvas.toUpperCase();
  const interconexao = route.interconexoes_ids[0];

  const containerStyle = [
    styles.card,
    match.autonomyWarning ? styles.cardWarning : null,
    match.overBudget ? styles.cardOverBudget : null,
  ];

  return (
    <View style={containerStyle} testID={testID}>
      <Text style={styles.title} numberOfLines={2}>
        {route.nome_rota}
      </Text>
      <Text style={styles.estado}>{route.estado_pais}</Text>
      <Text style={styles.distanceToStart} testID={`${testID}-distance-start`}>
        Largada a {Math.round(match.distanceToStartKm)} km de você
      </Text>

      <View style={styles.statsRow}>
        <View style={styles.statBlock}>
          <Text style={styles.statLabel}>EXTENSÃO</Text>
          <Text style={styles.statValue}>{formatKm(route.distancia_total_km)}</Text>
        </View>
        <View style={styles.statBlock}>
          <Text style={styles.statLabel}>PEDÁGIO</Text>
          <Text style={styles.statValue}>
            {formatReais(route.total_pedagios_moto_reais)}
          </Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statBlock}>
          <Text style={styles.statLabel}>PAVIMENTO</Text>
          <Text style={styles.statValue}>{pavimentoLabel}</Text>
        </View>
        <View style={styles.statBlock}>
          <Text style={styles.statLabel}>CURVAS</Text>
          <Text style={styles.statValue}>{curvasLabel}</Text>
        </View>
      </View>

      <Text style={styles.fuelLine} testID={`${testID}-fuel-cost`}>
        Combustível só da rota: {formatReais(match.estimatedFuelCostReais)}
      </Text>
      <Text
        style={styles.roundTripLine}
        testID={`${testID}-round-trip-cost`}
      >
        Ida + rota + volta (~{formatKm(match.roundTripDistanceKm)}):{' '}
        {formatReais(match.roundTripTotalCostReais)}
      </Text>

      {interconexao ? (
        <Text style={styles.interconexao}>Se conecta com: {interconexao}</Text>
      ) : null}

      {match.autonomyWarning ? (
        <View style={styles.warningBox} testID={`${testID}-autonomy-warning`}>
          <Text style={styles.warningLabel}>AVISO</Text>
          <Text style={styles.warningText}>
            Seu tanque ({Math.round(safeAutonomyKm)} km) é menor que o trecho
            sem posto desta rota (
            {route.caracteristicas.trecho_critico_sem_posto_km} km).
          </Text>
        </View>
      ) : null}

      {match.overBudget ? (
        <View style={styles.overBudgetPill} testID={`${testID}-over-budget`}>
          <Text style={styles.overBudgetText}>Acima do orçamento</Text>
        </View>
      ) : null}

      <View style={styles.buttonRow}>
        <BigButton
          label="VER ROTA NO MAPA"
          variant="primary"
          fullWidth
          compact
          onPress={() => onPreview(route.rota_id)}
          testID={`${testID}-preview-btn`}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...elevation.card,
  },
  cardWarning: {
    borderColor: colors.warning,
    borderWidth: 2,
  },
  cardOverBudget: {
    opacity: 0.5,
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.navPrimary.fontSize,
    fontWeight: typography.navPrimary.fontWeight,
    lineHeight: typography.navPrimary.lineHeight,
  },
  estado: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
    marginTop: spacing.xs,
  },
  distanceToStart: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: typography.navSecondary.lineHeight,
    marginTop: spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
  },
  statBlock: {
    flex: 1,
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navSecondary.lineHeight,
    marginTop: 2,
  },
  fuelLine: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
    marginTop: spacing.md,
  },
  roundTripLine: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '800',
    lineHeight: typography.navSecondary.lineHeight,
    marginTop: spacing.xs,
  },
  interconexao: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
    marginTop: spacing.sm,
  },
  warningBox: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,204,0,0.12)',
    borderWidth: 1,
    borderColor: colors.warning,
  },
  warningLabel: {
    color: colors.warning,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
  },
  warningText: {
    color: colors.warning,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    lineHeight: typography.caption.lineHeight,
    marginTop: spacing.xs,
  },
  overBudgetPill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.danger,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    marginTop: spacing.md,
  },
  overBudgetText: {
    color: '#FFFFFF',
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    lineHeight: typography.caption.lineHeight,
  },
  buttonRow: {
    marginTop: spacing.md,
  },
});
