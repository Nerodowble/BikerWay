import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, elevation, hitTarget, radius, spacing, typography } from '@/shared/theme';
import type {
  CatalogRouteMatch,
  Confiabilidade,
  Dificuldade,
} from '@/domains/catalog/types';

export interface RouteCardProps {
  match: CatalogRouteMatch;
  /**
   * Safe autonomy of the active motorcycle in km. Forwarded to the detail
   * screen via the `onPress` callback's consumer (the screen reads it again
   * from the catalog filters/active moto). Kept here so the card can render
   * the autonomy-warning pill with the exact km the rider has.
   */
  safeAutonomyKm: number;
  /**
   * Tap on the whole card -> open the detail screen for this rota_id.
   * Naming kept generic (`onPress` instead of `onPreview`) because the card
   * itself no longer triggers the preview — that's a button inside the
   * detail screen now.
   */
  onPress: (routeId: string) => void;
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
 * "2026-05-22" -> "22/05/2026". Returns the raw input when the string does
 * not match the ISO calendar-date shape so a typo never crashes the card —
 * the validator in `catalogClient.ts` already drops malformed dates, but the
 * helper still guards defensively in case the curated JSON ever ships a
 * value the validator missed. Re-exported because `RouteDetailScreen`
 * shares the same formatter.
 */
export function formatBrazilianDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

interface PillColors {
  bg: string;
  fg: string;
}

/**
 * Map difficulty tier to a tinted pill. Alpha 0.18 keeps the badge readable
 * on the elevated card surface without competing with the title.
 */
export function getDificuldadeColors(d: Dificuldade): PillColors {
  switch (d) {
    case 'iniciante':
      return { bg: 'rgba(63,191,111,0.18)', fg: colors.success };
    case 'intermediario':
      return { bg: 'rgba(255,204,0,0.18)', fg: colors.warning };
    case 'avancado':
      return { bg: 'rgba(211,47,47,0.18)', fg: colors.danger };
  }
}

/**
 * "Reliability" of the curated data. Low/medium/high mirror the
 * `prompts/catalog-schema.json` enum. Muted grey for "baixa" so it does not
 * compete visually with the safety warnings.
 */
export function getConfiabilidadeColors(c: Confiabilidade): PillColors {
  switch (c) {
    case 'alta':
      return { bg: 'rgba(63,191,111,0.18)', fg: colors.success };
    case 'media':
      return { bg: 'rgba(255,204,0,0.18)', fg: colors.warning };
    case 'baixa':
      return { bg: 'rgba(122,122,122,0.18)', fg: colors.textMuted };
  }
}

/**
 * Compact pill component for difficulty / status badges. Inline so the card
 * file stays self-contained.
 */
const MetaPill: React.FC<{
  label: string;
  pillColors: PillColors;
  testID?: string;
}> = ({ label, pillColors, testID }) => (
  <View
    style={[styles.pill, { backgroundColor: pillColors.bg }]}
    testID={testID}
  >
    <Text style={[styles.pillText, { color: pillColors.fg }]}>{label}</Text>
  </View>
);

/**
 * Compact result row for the catalog list (post-refactor of F21.x).
 *
 * Earlier this component carried EVERYTHING — descrição, dicas, fontes,
 * pontos de apoio — clamped with `numberOfLines` and no affordance to open.
 * It grew to 7+ visual layers per card, with critical safety info hidden.
 *
 * The new contract: the card surfaces only scannable essentials and the
 * whole row is a Pressable that navigates to `RouteDetailScreen` for the
 * full story. The detail screen renders every field with no truncation.
 *
 * Visual states preserved from the old card:
 *   - default: dark elevated card, subtle border.
 *   - autonomyWarning: 2dp warning border + AVISO pill (no inline text;
 *     the full warning copy lives in the detail screen).
 *   - overBudget: dimmed (opacity 0.5) + "Acima do orçamento" pill.
 */
export const RouteCard: React.FC<RouteCardProps> = ({
  match,
  safeAutonomyKm: _safeAutonomyKm,
  onPress,
  testID,
}) => {
  const { route } = match;

  const containerBase = [
    styles.card,
    match.autonomyWarning ? styles.cardWarning : null,
    match.overBudget ? styles.cardOverBudget : null,
  ];

  const dificuldadePill =
    route.dificuldade !== undefined
      ? {
          label: route.dificuldade.toUpperCase(),
          colors: getDificuldadeColors(route.dificuldade),
        }
      : null;

  // Prefer the OSRM-refined round-trip when available; otherwise keep the
  // haversine baseline so the card never blanks out while refinement is in
  // flight. `hasRealMetrics` is the single source of truth so the UI cannot
  // get stuck in a half-real state.
  const useReal =
    match.hasRealMetrics === true &&
    typeof match.realRoundTripDistanceKm === 'number' &&
    typeof match.realRoundTripTotalCostReais === 'number';
  const roundTripCost = useReal
    ? (match.realRoundTripTotalCostReais as number)
    : match.roundTripTotalCostReais;

  const a11ySummary = [
    route.nome_rota,
    route.estado_pais,
    `Largada a ${Math.round(match.distanceToStartKm)} quilômetros`,
    `Ida e volta ${formatReais(roundTripCost)}`,
    match.autonomyWarning ? 'Aviso de autonomia' : null,
    match.overBudget ? 'Acima do orçamento' : null,
  ]
    .filter((s) => s !== null)
    .join('. ');

  return (
    <Pressable
      testID={testID}
      onPress={() => onPress(route.rota_id)}
      android_ripple={{ color: 'rgba(255,255,255,0.06)' }}
      style={({ pressed }) => [
        ...containerBase,
        pressed ? styles.cardPressed : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={a11ySummary}
      accessibilityHint="Toque para ver detalhes desta rota"
    >
      <View style={styles.headerRow}>
        <Text style={styles.title} numberOfLines={2}>
          {route.nome_rota}
        </Text>
        {dificuldadePill !== null ? (
          <MetaPill
            label={dificuldadePill.label}
            pillColors={dificuldadePill.colors}
            testID={`${testID}-pill-dificuldade`}
          />
        ) : null}
      </View>
      <Text style={styles.metaLine} numberOfLines={1}>
        {route.estado_pais} {'·'} Largada a{' '}
        {Math.round(match.distanceToStartKm)} km
      </Text>

      <View style={styles.statsRow}>
        <View style={styles.statBlock}>
          <Text style={styles.statLabel}>EXTENSÃO</Text>
          <Text style={styles.statValue}>
            {formatKm(route.distancia_total_km)}
          </Text>
        </View>
        <View style={styles.statBlock}>
          <Text style={styles.statLabel}>PEDÁGIO</Text>
          <Text style={styles.statValue}>
            {formatReais(route.total_pedagios_moto_reais)}
          </Text>
        </View>
        <View style={styles.statBlock}>
          <Text style={styles.statLabel}>IDA + VOLTA</Text>
          <View style={styles.roundTripRow}>
            <Text
              style={styles.statValue}
              testID={`${testID}-round-trip-cost`}
              numberOfLines={1}
            >
              {formatReais(roundTripCost)}
            </Text>
            {useReal ? (
              <View
                style={styles.realMetricsDot}
                testID={`${testID}-real-metrics-dot`}
              />
            ) : null}
          </View>
        </View>
      </View>

      {match.autonomyWarning || match.overBudget ? (
        <View style={styles.pillRow}>
          {match.autonomyWarning ? (
            <View
              style={[styles.statusPill, styles.warningPill]}
              testID={`${testID}-autonomy-warning`}
            >
              <Text style={styles.warningPillText}>
                Aviso de autonomia
              </Text>
            </View>
          ) : null}
          {match.overBudget ? (
            <View
              style={[styles.statusPill, styles.overBudgetPill]}
              testID={`${testID}-over-budget`}
            >
              <Text style={styles.overBudgetPillText}>
                Acima do orçamento
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.affordanceRow}>
        <Text style={styles.affordanceText}>
          Toque para ver detalhes e iniciar rota
        </Text>
        <Text style={styles.affordanceArrow}>{'→'}</Text>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    minHeight: hitTarget.min,
    ...elevation.card,
  },
  cardWarning: {
    borderColor: colors.warning,
    borderWidth: 2,
  },
  cardOverBudget: {
    opacity: 0.5,
  },
  cardPressed: {
    // Subtle press feedback (Android also gets the ripple). Kept light so it
    // doesn't fight the warning border state.
    opacity: 0.85,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.navPrimary.fontSize,
    fontWeight: typography.navPrimary.fontWeight,
    lineHeight: typography.navPrimary.lineHeight,
    flexShrink: 1,
  },
  metaLine: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
    marginTop: spacing.xs,
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    gap: spacing.sm,
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
  roundTripRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  realMetricsDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
    marginLeft: spacing.xs,
  },
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  pillText: {
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  statusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  warningPill: {
    backgroundColor: 'rgba(255,204,0,0.12)',
    borderWidth: 1,
    borderColor: colors.warning,
  },
  warningPillText: {
    color: colors.warning,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    lineHeight: typography.caption.lineHeight,
  },
  overBudgetPill: {
    backgroundColor: colors.danger,
  },
  overBudgetPillText: {
    color: '#FFFFFF',
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    lineHeight: typography.caption.lineHeight,
  },
  affordanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  affordanceText: {
    color: colors.accent,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    lineHeight: typography.caption.lineHeight,
  },
  affordanceArrow: {
    color: colors.accent,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '800',
    lineHeight: typography.navSecondary.lineHeight,
  },
});
