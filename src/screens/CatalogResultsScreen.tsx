import React, { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteCard } from '@/shared/components/catalog/RouteCard';
import { colors, spacing, typography } from '@/shared/theme';
import { useCatalogStore } from '@/state/catalogStore';
import {
  selectActiveMotorcycle,
  useMotorcycleStore,
} from '@/state/motorcycleStore';
import {
  calculateMaxAutonomy,
  calculateSafeAutonomy,
} from '@/domains/fuel/autonomy';
import type { CatalogRouteMatch } from '@/domains/catalog/types';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'CatalogResults'>;

// TODO: real pagination once the catalog grows past ~50 entries.
// FlatList virtualization plus initialNumToRender:10 is sufficient until then.
const INITIAL_RENDER = 10;
const WINDOW_SIZE = 5;

export const CatalogResultsScreen: React.FC<Props> = ({ navigation }) => {
  const results = useCatalogStore((s) => s.results);
  const isSearching = useCatalogStore((s) => s.isSearching);
  const lastError = useCatalogStore((s) => s.lastError);
  const filters = useCatalogStore((s) => s.filters);

  const activeMoto = useMotorcycleStore(selectActiveMotorcycle);
  // The cards need the rider's safe autonomy to render the warning copy. We
  // prefer the value baked into `filters` (set by the previous screen using
  // the user-selected moto) and fall back to the active moto so the screen
  // still renders sensibly on a deep link.
  const safeAutonomyKm = useMemo(() => {
    if (filters && filters.motoSafeAutonomyKm > 0) {
      return filters.motoSafeAutonomyKm;
    }
    if (!activeMoto) return 0;
    return calculateSafeAutonomy(
      calculateMaxAutonomy(activeMoto.tankCapacity, activeMoto.averageConsump),
    );
  }, [activeMoto, filters]);

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleOpenDetail = useCallback(
    (routeId: string) => {
      // The card is now scannable-only; the detail screen owns the preview
      // and "go to map" actions. We `push` (not `replace`) so the rider can
      // come back to the results list with the same scroll position.
      navigation.navigate('RouteDetail', { rotaId: routeId });
    },
    [navigation],
  );

  const renderItem = useCallback<ListRenderItem<CatalogRouteMatch>>(
    ({ item }) => (
      <View style={styles.cardWrap}>
        <RouteCard
          match={item}
          safeAutonomyKm={safeAutonomyKm}
          onPress={handleOpenDetail}
          testID={`route-card-${item.route.rota_id}`}
        />
      </View>
    ),
    [handleOpenDetail, safeAutonomyKm],
  );

  const keyExtractor = useCallback(
    (item: CatalogRouteMatch) => item.route.rota_id,
    [],
  );

  const headerCount = `${results.length} ${results.length === 1 ? 'Rota Encontrada' : 'Rotas Encontradas'}`;

  return (
    <SafeAreaView style={styles.safe} testID="screen-catalog-results">
      <View style={styles.header}>
        <Pressable
          onPress={handleBack}
          hitSlop={12}
          style={({ pressed }) => [
            styles.backButton,
            pressed ? styles.backButtonPressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Voltar para filtros"
          testID="btn-catalog-results-back"
        >
          <Text style={styles.backButtonLabel}>{'<'} Filtrar novamente</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{headerCount}</Text>
      </View>

      {isSearching ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.helperText}>Buscando rotas...</Text>
        </View>
      ) : lastError ? (
        <View style={styles.centerState}>
          <Text style={styles.errorText} testID="catalog-results-error">
            {lastError}
          </Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          initialNumToRender={INITIAL_RENDER}
          windowSize={WINDOW_SIZE}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.centerState}>
              <Text style={styles.helperText} testID="catalog-results-empty">
                Nenhuma rota encontrada com esses filtros — tente ampliar a
                busca.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  backButtonPressed: {
    opacity: 0.6,
  },
  backButtonLabel: {
    color: colors.accent,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navSecondary.lineHeight,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: typography.display.fontSize,
    fontWeight: typography.display.fontWeight,
    lineHeight: typography.display.lineHeight,
    marginTop: spacing.sm,
  },
  listContent: {
    padding: spacing.lg,
    paddingBottom: spacing['3xl'],
  },
  cardWrap: {
    marginBottom: spacing.md,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  helperText: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: typography.navSecondary.lineHeight,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: typography.navSecondary.lineHeight,
    textAlign: 'center',
  },
});
