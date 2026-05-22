import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from 'react-native';
import type { FilteredFuelPoi } from '@/domains/poi/geometry';
import type { PoiCategory } from '@/domains/poi/types';
import { BigButton } from '@/shared/components/BigButton';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { colors, radius, spacing, typography } from '@/shared/theme';
import type { PoiSearchMode } from '@/state/poiStore';

export interface PoiListSheetProps {
  visible: boolean;
  pois: FilteredFuelPoi[];
  isFetching: boolean;
  lastError: string | null;
  searchMode: PoiSearchMode;
  onSearchModeChange: (mode: PoiSearchMode) => void;
  onClose: () => void;
  onSelect: (poi: FilteredFuelPoi) => void;
  onRefresh: () => void;
  /**
   * Currently selected POI id (driven by the parent store). When provided,
   * the matching row reveals an inline "Desviar para este posto" action so
   * the rider can convert a selection into a real detour.
   */
  selectedPoiId?: string | null;
  /**
   * Fired when the rider taps the inline detour button on the currently
   * selected row. The parent is responsible for closing the sheet and
   * triggering the OSRM refetch via `injectFuelWaypoint`.
   */
  onDetour?: (poi: FilteredFuelPoi) => void;
  /**
   * Currently selected POI category. Optional + defaulted so existing
   * call-sites that only render fuel keep working without changes.
   */
  searchCategory?: PoiCategory;
  /**
   * Fired when the rider taps a category chip (POSTOS / BORRACHEIROS /
   * OFICINAS). Optional so the sheet can still be embedded by a parent
   * that wants the legacy fuel-only behaviour.
   */
  onSearchCategoryChange?: (category: PoiCategory) => void;
}

interface CategoryCopy {
  title: string;
  subtitleAlong: string;
  subtitleNearby: string;
  emptyAlong: string;
  emptyNearby: string;
  loading: string;
  rowAccessibilityPrefix: string;
}

const CATEGORY_COPY: Record<PoiCategory, CategoryCopy> = {
  fuel: {
    title: 'Postos próximos',
    subtitleAlong: 'Buffer de 1 km na rota restante',
    subtitleNearby: 'Postos num raio de 5 km da sua posição',
    emptyAlong: 'Nenhum posto encontrado no buffer da rota — tente "Próximos"',
    emptyNearby: 'Nenhum posto encontrado no raio de 5 km',
    loading: 'Buscando postos...',
    rowAccessibilityPrefix: 'Posto',
  },
  tyres: {
    title: 'Borracheiros próximos',
    subtitleAlong: 'Buffer de 1 km na rota restante',
    subtitleNearby: 'Borracheiros num raio de 5 km da sua posição',
    emptyAlong:
      'Nenhum borracheiro no buffer da rota — tente "Próximos a mim"',
    emptyNearby: 'Nenhum borracheiro encontrado no raio de 5 km',
    loading: 'Buscando borracheiros...',
    rowAccessibilityPrefix: 'Borracheiro',
  },
  mechanic: {
    title: 'Oficinas próximas',
    subtitleAlong: 'Buffer de 1 km na rota restante',
    subtitleNearby: 'Oficinas num raio de 5 km da sua posição',
    emptyAlong: 'Nenhuma oficina no buffer da rota — tente "Próximos a mim"',
    emptyNearby: 'Nenhuma oficina encontrada no raio de 5 km',
    loading: 'Buscando oficinas...',
    rowAccessibilityPrefix: 'Oficina',
  },
};

const CATEGORY_CHIPS: ReadonlyArray<{
  category: PoiCategory;
  label: string;
  testID: string;
}> = [
  { category: 'fuel', label: 'POSTOS', testID: 'poi-sheet-category-fuel' },
  {
    category: 'tyres',
    label: 'BORRACHEIROS',
    testID: 'poi-sheet-category-tyres',
  },
  {
    category: 'mechanic',
    label: 'OFICINAS',
    testID: 'poi-sheet-category-mechanic',
  },
];

/**
 * Bottom-sheet modal that lists POIs (fuel stations, tyre shops, or
 * mechanic workshops depending on the active chip) along the active route
 * or within a fixed radius of the rider, ordered by linear distance from
 * the rider. Built on react-native `Modal` with a transparent backdrop so
 * we can tap outside to dismiss without losing the underlying map state.
 *
 * Body states (mutually exclusive, evaluated in order):
 *   1. `isFetching` → spinner + helper text
 *   2. `lastError`  → error badge + retry button
 *   3. Empty list   → muted helper text
 *   4. Non-empty    → FlatList of pressable rows
 */
export const PoiListSheet: React.FC<PoiListSheetProps> = ({
  visible,
  pois,
  isFetching,
  lastError,
  searchMode,
  onSearchModeChange,
  onClose,
  onSelect,
  onRefresh,
  selectedPoiId,
  onDetour,
  searchCategory = 'fuel',
  onSearchCategoryChange,
}) => {
  const copy = CATEGORY_COPY[searchCategory];

  const subtitleText =
    searchMode === 'along-route' ? copy.subtitleAlong : copy.subtitleNearby;

  const emptyText =
    searchMode === 'along-route' ? copy.emptyAlong : copy.emptyNearby;

  const renderItem: ListRenderItem<FilteredFuelPoi> = ({ item }) => {
    const isSelected = selectedPoiId != null && item.id === selectedPoiId;
    return (
      <Pressable
        style={({ pressed }) => [
          styles.row,
          isSelected ? styles.rowSelected : null,
          pressed ? styles.rowPressed : null,
        ]}
        onPress={() => onSelect(item)}
        android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
        accessibilityRole="button"
        accessibilityLabel={`${copy.rowAccessibilityPrefix} ${item.name}`}
        accessibilityState={{ selected: isSelected }}
        testID={`poi-row-${item.id}`}
      >
        <Text style={styles.rowName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.rowDistanceUser} numberOfLines={1}>
          {`${Math.round(item.distanceFromUserMeters)} m da sua posição`}
        </Text>
        <Text style={styles.rowDistanceRoute} numberOfLines={1}>
          {`${Math.round(item.distanceToRouteMeters)} m da rota`}
        </Text>
        {isSelected && onDetour ? (
          <View style={styles.rowDetourWrap}>
            <BigButton
              label="Desviar para este local"
              variant="primary"
              fullWidth
              compact
              onPress={() => onDetour(item)}
              testID={`poi-row-detour-${item.id}`}
            />
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Fechar lista de postos"
          testID="poi-sheet-backdrop"
        />

        <View style={styles.sheet} testID="poi-sheet">
          <View style={styles.titleRow}>
            <Text style={styles.title}>{copy.title}</Text>
            <Pressable
              style={({ pressed }) => [
                styles.closeButton,
                pressed ? styles.closeButtonPressed : null,
              ]}
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Fechar"
              testID="poi-sheet-close"
            >
              <Text style={styles.closeButtonText}>×</Text>
            </Pressable>
          </View>

          <Text style={styles.subtitle}>{subtitleText}</Text>

          {/* Category chips sit ABOVE the along-route/nearby toggle so the
              "what am I searching for" choice is visually primary, and the
              "where" toggle is read as a refinement. Rendered only when a
              category-change handler is wired; legacy parents still get the
              fuel-only sheet without extra chrome. */}
          {onSearchCategoryChange ? (
            <View style={styles.categoryRow} testID="poi-sheet-category-row">
              {CATEGORY_CHIPS.map((chip) => {
                const isActive = searchCategory === chip.category;
                return (
                  <Pressable
                    key={chip.category}
                    style={[
                      styles.categoryChip,
                      isActive ? styles.categoryChipActive : null,
                    ]}
                    onPress={() => onSearchCategoryChange(chip.category)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    testID={chip.testID}
                  >
                    <Text
                      style={[
                        styles.categoryChipText,
                        isActive ? styles.categoryChipTextActive : null,
                      ]}
                      numberOfLines={1}
                    >
                      {chip.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <View style={styles.toggleRow}>
            <Pressable
              style={[
                styles.toggleChip,
                searchMode === 'along-route' ? styles.toggleChipActive : null,
              ]}
              onPress={() => onSearchModeChange('along-route')}
              accessibilityRole="button"
              accessibilityState={{ selected: searchMode === 'along-route' }}
              testID="poi-sheet-toggle-along-route"
            >
              <Text
                style={[
                  styles.toggleChipText,
                  searchMode === 'along-route'
                    ? styles.toggleChipTextActive
                    : null,
                ]}
              >
                Na rota
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.toggleChip,
                searchMode === 'nearby' ? styles.toggleChipActive : null,
              ]}
              onPress={() => onSearchModeChange('nearby')}
              accessibilityRole="button"
              accessibilityState={{ selected: searchMode === 'nearby' }}
              testID="poi-sheet-toggle-nearby"
            >
              <Text
                style={[
                  styles.toggleChipText,
                  searchMode === 'nearby' ? styles.toggleChipTextActive : null,
                ]}
              >
                Próximos a mim
              </Text>
            </Pressable>
          </View>

          {isFetching ? (
            <View style={styles.stateBox} testID="poi-sheet-loading">
              <ActivityIndicator color={colors.accent} size="large" />
              <Text style={styles.stateText}>{copy.loading}</Text>
            </View>
          ) : lastError ? (
            <View style={styles.stateBox} testID="poi-sheet-error">
              <StatusBadge
                label="Erro"
                value={lastError}
                state="danger"
                testID="poi-sheet-error-badge"
              />
              <View style={styles.retryRow}>
                <BigButton
                  label="Tentar de novo"
                  variant="secondary"
                  fullWidth
                  compact
                  onPress={onRefresh}
                  testID="poi-sheet-retry"
                />
              </View>
            </View>
          ) : pois.length === 0 ? (
            <View style={styles.stateBox} testID="poi-sheet-empty">
              <Text style={styles.emptyText}>{emptyText}</Text>
            </View>
          ) : (
            <FlatList
              data={pois}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              testID="poi-sheet-list"
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: '75%',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: colors.accent,
    fontSize: typography.navPrimary.fontSize,
    fontWeight: typography.navPrimary.fontWeight,
    lineHeight: typography.navPrimary.lineHeight,
  },
  // Close-X kept in lockstep with RouteAlternativesSheet so the rider sees
  // the same affordance across every sheet. Any change here must be mirrored
  // there.
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
    marginBottom: spacing.sm,
  },
  // Category chips row (POSTOS / BORRACHEIROS / OFICINAS). Sits above the
  // along-route/nearby toggle so the category choice is read as primary.
  categoryRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  categoryChip: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  categoryChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  categoryChipText: {
    color: colors.textSecondary,
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  categoryChipTextActive: {
    color: '#FFFFFF',
  },
  toggleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  toggleChip: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  toggleChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  toggleChipText: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '600',
  },
  toggleChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
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
  },
  listContent: {
    paddingBottom: spacing.sm,
  },
  row: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowPressed: {
    backgroundColor: colors.surfaceElevated,
  },
  rowSelected: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.accent,
  },
  rowDetourWrap: {
    marginTop: spacing.sm,
    alignSelf: 'stretch',
  },
  rowName: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navSecondary.lineHeight,
  },
  rowDistanceUser: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    marginTop: 2,
  },
  rowDistanceRoute: {
    color: colors.textMuted,
    fontSize: typography.sizes.xs,
    marginTop: 2,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
});
