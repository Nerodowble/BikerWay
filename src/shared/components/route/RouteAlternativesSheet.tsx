import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Route } from '@/domains/routing/types';
import { BigButton } from '@/shared/components/BigButton';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { colors, hitTarget, radius, spacing, typography } from '@/shared/theme';
import { formatDistance, formatDuration } from '@/shared/utils/format';

// Cap so the picker never eats more than this fraction of the viewport even
// on small phones. Above this the rider scrolls the card list.
const SHEET_MAX_HEIGHT_FRACTION = 0.75;

export interface RouteAlternativesSheetProps {
  visible: boolean;
  /**
   * OSRM alternatives to display, in the order returned by the client
   * (index 0 = fastest). The colours array must be parallel — same index
   * means same colour on both the card stripe and the map polyline.
   */
  alternatives: Route[];
  colors: string[];
  onClose: () => void;
  /**
   * Fired when the rider taps a card. The parent is responsible for
   * promoting the chosen alternative to the active route and dismissing
   * the picker.
   */
  onPick: (index: number) => void;
  isFetching: boolean;
  lastError: string | null;
  /**
   * Free-form label displayed in the sheet subtitle ("Para: {label}").
   * Use the destination's display name when available, otherwise a
   * generic placeholder like "destino selecionado".
   */
  destinationLabel: string;
}

const STRAIGHT_SINUOSITY_MAX = 30;
const MODERATE_SINUOSITY_MAX = 60;

const CARD_MIN_HEIGHT = 88;
const STRIPE_WIDTH = 6;

function describeSinuosity(score: number | undefined): string {
  if (typeof score !== 'number' || !Number.isFinite(score) || score <= 0) {
    return 'Reta — poucas curvas';
  }
  if (score < STRAIGHT_SINUOSITY_MAX) return 'Reta — poucas curvas';
  if (score < MODERATE_SINUOSITY_MAX) return 'Curvas moderadas';
  return 'Muitas curvas';
}

function findMostSinuousIndex(routes: Route[]): number {
  let bestIdx = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < routes.length; i += 1) {
    const r = routes[i];
    if (!r) continue;
    const score = r.sinuosityScore;
    if (typeof score !== 'number' || !Number.isFinite(score)) continue;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

interface AlternativeRowProps {
  index: number;
  route: Route;
  stripeColor: string;
  isFastest: boolean;
  isMostSinuous: boolean;
  onPress: (index: number) => void;
}

const AlternativeRow: React.FC<AlternativeRowProps> = ({
  index,
  route,
  stripeColor,
  isFastest,
  isMostSinuous,
  onPress,
}) => {
  const sinuosityLabel = describeSinuosity(route.sinuosityScore);
  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        pressed ? styles.cardPressed : null,
      ]}
      onPress={() => onPress(index)}
      android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
      accessibilityRole="button"
      accessibilityLabel={`Rota ${index + 1}: ${formatDuration(route.durationSeconds)}, ${formatDistance(route.distanceMeters)}`}
      testID={`route-alt-row-${index}`}
    >
      <View
        style={[styles.cardStripe, { backgroundColor: stripeColor }]}
        accessibilityElementsHidden
      />
      <View style={styles.cardBody}>
        <View style={styles.cardTopRow}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {`${formatDuration(route.durationSeconds)} · ${formatDistance(route.distanceMeters)}`}
          </Text>
          <View style={styles.tagsRow}>
            {isFastest ? (
              <View
                style={styles.tagFastest}
                testID={`route-alt-tag-fastest-${index}`}
              >
                <Text style={styles.tagFastestText}>MAIS RÁPIDA</Text>
              </View>
            ) : null}
            {isMostSinuous ? (
              <View
                style={styles.tagSinuous}
                testID={`route-alt-tag-sinuous-${index}`}
              >
                <Text style={styles.tagSinuousText}>MAIS SINUOSA</Text>
              </View>
            ) : null}
          </View>
        </View>
        <Text style={styles.cardSubtitle} numberOfLines={1}>
          {sinuosityLabel}
        </Text>
      </View>
    </Pressable>
  );
};

/**
 * Bottom-sheet picker for OSRM alternatives.
 *
 * Now rendered as an INLINE overlay (not a Modal) so the rider can still
 * pan/zoom the map underneath and inspect each alternative drawn there.
 * The sheet has two states:
 *   - EXPANDED  (default): full card list + title bar visible.
 *   - COLLAPSED (peek):    only a thin handle bar at the bottom + the close X.
 * A drag handle at the top toggles between the two; the rider can also tap
 * the handle (single tap) to expand/collapse. No `Modal`, no backdrop —
 * the map remains fully interactive in both states.
 */
export const RouteAlternativesSheet: React.FC<RouteAlternativesSheetProps> = ({
  visible,
  alternatives,
  colors: stripeColors,
  onClose,
  onPick,
  isFetching,
  lastError,
  destinationLabel,
}) => {
  const [expanded, setExpanded] = useState(true);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // Pad above the Android gesture bar so the last card isn't clipped by it.
  const safeBottomPad = Math.max(spacing.xl, insets.bottom + spacing.md);
  // Pixel cap — RN percentage heights only resolve when the parent has a
  // measured height, and our `expandedRoot` is an absolute-positioned wrapper
  // anchored to the bottom (no explicit height). Computing the cap from the
  // window dimensions guarantees the sheet always reserves enough room for
  // its content even on small phones.
  const sheetMaxHeight = Math.round(windowHeight * SHEET_MAX_HEIGHT_FRACTION);

  const mostSinuousIdx = useMemo(
    () => findMostSinuousIndex(alternatives),
    [alternatives],
  );

  if (!visible) return null;

  // COLLAPSED state — only the handle + close button, nothing blocking the map.
  if (!expanded) {
    return (
      <View
        style={styles.collapsedRoot}
        pointerEvents="box-none"
        testID="route-alts-sheet-collapsed"
      >
        <Pressable
          style={styles.collapsedBar}
          onPress={() => setExpanded(true)}
          accessibilityRole="button"
          accessibilityLabel="Abrir lista de rotas"
          testID="route-alts-sheet-expand-tap"
        >
          <View style={styles.handle} />
          <Text style={styles.collapsedLabel}>
            {`${alternatives.length} ${
              alternatives.length === 1 ? 'rota' : 'rotas'
            } — toque para escolher`}
          </Text>
          <Pressable
            style={styles.collapsedClose}
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Cancelar seleção de rota"
            testID="route-alts-sheet-collapsed-close"
          >
            <Text style={styles.collapsedCloseText}>×</Text>
          </Pressable>
        </Pressable>
      </View>
    );
  }

  // EXPANDED state — full card list.
  return (
    <View
      style={styles.expandedRoot}
      pointerEvents="box-none"
      testID="route-alts-sheet"
    >
      <View style={[styles.sheet, { maxHeight: sheetMaxHeight }]}>
        <Pressable
          style={styles.handleHitArea}
          onPress={() => setExpanded(false)}
          accessibilityRole="button"
          accessibilityLabel="Recolher lista de rotas"
          testID="route-alts-sheet-collapse"
        >
          <View style={styles.handle} />
        </Pressable>

        <View style={styles.titleRow}>
          <Text style={styles.title}>Escolha sua rota</Text>
          <Pressable
            style={({ pressed }) => [
              styles.closeButton,
              pressed ? styles.closeButtonPressed : null,
            ]}
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Fechar"
            testID="route-alts-sheet-close"
          >
            <Text style={styles.closeButtonText}>×</Text>
          </Pressable>
        </View>

        <Text style={styles.subtitle} numberOfLines={2}>
          {`Para: ${destinationLabel}`}
        </Text>
        <Text style={styles.hint}>
          Arraste o mapa pra ver cada rota. Toque na alça acima para recolher.
        </Text>

        {isFetching ? (
          <View style={styles.stateBox} testID="route-alts-sheet-loading">
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={styles.stateText}>Calculando alternativas...</Text>
          </View>
        ) : lastError ? (
          <View style={styles.stateBox} testID="route-alts-sheet-error">
            <StatusBadge
              label="Erro"
              value={lastError}
              state="danger"
              testID="route-alts-sheet-error-badge"
            />
            <View style={styles.retryRow}>
              <BigButton
                label="Fechar"
                variant="secondary"
                fullWidth
                compact
                onPress={onClose}
                testID="route-alts-sheet-error-close"
              />
            </View>
          </View>
        ) : alternatives.length === 0 ? (
          <View style={styles.stateBox} testID="route-alts-sheet-empty">
            <Text style={styles.emptyText}>
              Nenhuma alternativa encontrada para este destino.
            </Text>
          </View>
        ) : (
          // ScrollView (not FlatList) so we do not nest a VirtualizedList
          // inside another scrollable. With at most 3 cards perf is a non-
          // issue, and ScrollView guarantees the last card is fully visible
          // on small viewports (landscape, compact phones) by enabling
          // scrolling only if the cap is reached.
          <ScrollView
            style={styles.list}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: safeBottomPad },
            ]}
            showsVerticalScrollIndicator={false}
            testID="route-alts-sheet-list"
          >
            {alternatives.map((item, index) => {
              const stripe = stripeColors[index] ?? colors.accent;
              const isFastest = index === 0;
              const isMostSinuous =
                mostSinuousIdx === index &&
                alternatives.length > 1 &&
                mostSinuousIdx !== 0;
              return (
                <View key={`route-alt-${index}`}>
                  {index > 0 ? <View style={styles.separator} /> : null}
                  <AlternativeRow
                    index={index}
                    route={item}
                    stripeColor={stripe}
                    isFastest={isFastest}
                    isMostSinuous={isMostSinuous}
                    onPress={onPick}
                  />
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  expandedRoot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // No backdrop — the map underneath stays fully interactive.
  },
  collapsedRoot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  collapsedBar: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    borderTopWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  collapsedLabel: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    marginTop: 6,
    textAlign: 'center',
  },
  collapsedClose: {
    position: 'absolute',
    right: spacing.lg,
    top: spacing.sm,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
  },
  collapsedCloseText: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  handleHitArea: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  handle: {
    width: 48,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.textMuted,
    opacity: 0.7,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  title: {
    color: colors.accent,
    fontSize: typography.navPrimary.fontSize,
    fontWeight: typography.navPrimary.fontWeight,
    lineHeight: typography.navPrimary.lineHeight,
  },
  // Close-X kept in lockstep with PoiListSheet so the rider sees the same
  // affordance across every sheet. Any change here must be mirrored there.
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  closeButtonPressed: {
    opacity: 0.7,
  },
  closeButtonText: {
    color: '#FFFFFF',
    fontSize: 24,
    lineHeight: 26,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    marginTop: spacing.xs,
  },
  hint: {
    color: colors.textMuted,
    fontSize: typography.sizes.xs,
    marginTop: 2,
    marginBottom: spacing.md,
    fontStyle: 'italic',
  },
  stateBox: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateText: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    marginTop: spacing.md,
  },
  retryRow: {
    marginTop: spacing.md,
    alignSelf: 'stretch',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: typography.navSecondary.fontSize,
    textAlign: 'center',
  },
  list: {
    alignSelf: 'stretch',
    flexGrow: 0,
    flexShrink: 1,
  },
  listContent: {
    paddingTop: spacing.xs,
  },
  card: {
    flexDirection: 'row',
    minHeight: Math.max(CARD_MIN_HEIGHT, hitTarget.min),
    borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardPressed: {
    opacity: 0.85,
    borderColor: colors.accent,
  },
  cardStripe: {
    width: STRIPE_WIDTH,
    alignSelf: 'stretch',
  },
  cardBody: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navSecondary.lineHeight,
  },
  cardSubtitle: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    marginTop: spacing.xs,
  },
  tagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 0,
  },
  tagFastest: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  tagFastestText: {
    color: '#FFFFFF',
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  tagSinuous: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tagSinuousText: {
    color: colors.textPrimary,
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  separator: {
    height: spacing.sm,
  },
});
