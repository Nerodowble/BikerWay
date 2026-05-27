import React, { useCallback, useEffect, useMemo } from 'react';
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
import { FeedCardList } from '@/shared/components/feed/FeedCardItem';
import { colors, radius, spacing, typography } from '@/shared/theme';
import { useCatalogStore } from '@/state/catalogStore';
import { useFeedStore } from '@/state/feedStore';
import {
  selectActiveMotorcycle,
  useMotorcycleStore,
} from '@/state/motorcycleStore';
import { useNavigationStore } from '@/state/navigationStore';
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
  const runDefaultSearch = useCatalogStore((s) => s.runDefaultSearch);

  const activeMoto = useMotorcycleStore(selectActiveMotorcycle);
  const currentPosition = useNavigationStore((s) => s.currentPosition);
  const feedCards = useFeedStore((s) => s.cards);
  const refreshFeed = useFeedStore((s) => s.refresh);

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

  // F35.0.C — quando o piloto entra direto via Home (sem passar pelos
  // filtros), `filters` ainda e null e `results` esta vazio. Aplicamos
  // defaults inteligentes usando GPS + moto ativa e disparamos a busca uma
  // unica vez. Se faltar GPS ou moto, o usuario ve o estado vazio + pode
  // abrir filtros manualmente.
  useEffect(() => {
    if (filters !== null) return;
    if (results.length > 0 || isSearching) return;
    if (!currentPosition || !activeMoto) return;
    const motoSafeAutonomy = calculateSafeAutonomy(
      calculateMaxAutonomy(activeMoto.tankCapacity, activeMoto.averageConsump),
    );
    runDefaultSearch({
      origin: {
        latitude: currentPosition.latitude,
        longitude: currentPosition.longitude,
      },
      motoConsumoKmL: activeMoto.averageConsump,
      motoSafeAutonomyKm: motoSafeAutonomy,
    });
  }, [filters, results.length, isSearching, currentPosition, activeMoto, runDefaultSearch]);

  // F35.5 — Refresh do feed "Fim de Semana Perfeito" quando ha GPS. Cache
  // TTL de 30min mora dentro do store, entao chamadas repetidas viram no-op.
  useEffect(() => {
    if (!currentPosition) return;
    void refreshFeed({
      userPosition: {
        latitude: currentPosition.latitude,
        longitude: currentPosition.longitude,
      },
    });
  }, [currentPosition, refreshFeed]);

  // F35.0.C — "Customizado" = piloto passou pela tela de filtros e ajustou
  // ao menos um campo alem dos defaults. Usado para destacar o botao
  // FILTRAR ATIVOS no header.
  const filtersCustomized = useMemo(() => {
    if (!filters) return false;
    return (
      filters.budgetReais > 0 ||
      filters.pavimento !== null ||
      filters.nivelCurvas !== null
    );
  }, [filters]);

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleOpenFilters = useCallback(() => {
    navigation.navigate('CatalogFilters');
  }, [navigation]);

  const handleOpenTrips = useCallback(() => {
    navigation.navigate('Trips');
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
        <View style={styles.headerTopRow}>
          <Pressable
            onPress={handleBack}
            hitSlop={12}
            style={({ pressed }) => [
              styles.backButton,
              pressed ? styles.backButtonPressed : null,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Voltar"
            testID="btn-catalog-results-back"
          >
            <Text style={styles.backButtonLabel}>{'<'} Voltar</Text>
          </Pressable>
          <Pressable
            onPress={handleOpenFilters}
            hitSlop={12}
            style={({ pressed }) => [
              styles.filterButton,
              filtersCustomized ? styles.filterButtonActive : null,
              pressed ? styles.filterButtonPressed : null,
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              filtersCustomized ? 'Filtros ativos — toque para editar' : 'Abrir filtros'
            }
            testID="btn-catalog-results-filter"
          >
            <Text
              style={[
                styles.filterButtonLabel,
                filtersCustomized ? styles.filterButtonLabelActive : null,
              ]}
            >
              {filtersCustomized ? '⚙ FILTROS ATIVOS' : 'FILTRAR'}
            </Text>
          </Pressable>
        </View>
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
          ListHeaderComponent={
            <View>
              {/* F35.6 — Entry pra trips multi-dia auto-geradas. Sempre
                  visivel; a propria tela mostra estado vazio quando
                  nao ha trips possiveis. */}
              <Pressable
                onPress={handleOpenTrips}
                style={({ pressed }) => [
                  styles.tripsBanner,
                  pressed ? styles.tripsBannerPressed : null,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Abrir trips de fim de semana"
                testID="btn-catalog-open-trips"
              >
                <Text style={styles.tripsBannerIcon}>🗺️</Text>
                <View style={styles.tripsBannerBody}>
                  <Text style={styles.tripsBannerTitle}>
                    TRIPS DE FIM DE SEMANA
                  </Text>
                  <Text style={styles.tripsBannerSub}>
                    Combos multi-dia gerados a partir do catálogo
                  </Text>
                </View>
                <Text style={styles.tripsBannerChevron}>›</Text>
              </Pressable>
              {feedCards.length > 0 ? (
                <View style={styles.feedHeaderBleed}>
                  <FeedCardList
                    cards={feedCards}
                    onCardPress={handleOpenDetail}
                  />
                </View>
              ) : null}
            </View>
          }
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
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
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
  filterButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: 'transparent',
  },
  filterButtonActive: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(255,107,0,0.14)',
  },
  filterButtonPressed: {
    opacity: 0.6,
  },
  filterButtonLabel: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navSecondary.lineHeight,
    letterSpacing: 0.5,
  },
  filterButtonLabelActive: {
    color: colors.accent,
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
  feedHeaderBleed: {
    // Anula o padding lateral do listContent pra que o carrossel possa
    // alinhar com a borda da tela. Mantem o paddingTop herdado.
    marginHorizontal: -spacing.lg,
    marginBottom: spacing.md,
  },
  tripsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
    marginBottom: spacing.lg,
  },
  tripsBannerPressed: {
    opacity: 0.7,
  },
  tripsBannerIcon: {
    fontSize: 28,
  },
  tripsBannerBody: {
    flex: 1,
  },
  tripsBannerTitle: {
    color: colors.accent,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  tripsBannerSub: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
    marginTop: 2,
  },
  tripsBannerChevron: {
    color: colors.accent,
    fontSize: 28,
    fontWeight: '800',
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
