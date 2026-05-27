import React, { useCallback, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography } from '@/shared/theme';
import { useTripsStore } from '@/state/tripsStore';
import type { AutoTrip, SavedTrip, TripDay } from '@/domains/trips/types';
import type { RootStackParamList } from '@/navigation/types';
import type { OvernightFetchState } from '@/state/tripsStore';
import { loadCatalog } from '@/infrastructure/catalog/catalogClient';
import { formatTripForShare } from '@/domains/trips/share';
import type { CatalogRoute } from '@/domains/catalog/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Trips'>;

const THEME_LABEL: Record<AutoTrip['themeTag'], string> = {
  litoral: 'LITORAL',
  serra: 'SERRA',
  historica: 'HISTÓRICA',
  trip: 'LONGA',
  misto: 'MISTA',
};

const DIFFICULTY_LABEL: Record<NonNullable<AutoTrip['difficulty']>, string> = {
  iniciante: 'INICIANTE',
  intermediario: 'INTERMEDIÁRIO',
  avancado: 'AVANÇADO',
};

function formatKm(value: number): string {
  return `${Math.round(value)} km`;
}

function formatReais(value: number): string {
  if (value <= 0) return 'sem pedágio';
  return `R$ ${value.toFixed(2).replace('.', ',')}`;
}

export const TripsScreen: React.FC<Props> = ({ navigation }) => {
  const trips = useTripsStore((s) => s.trips);
  const savedTrips = useTripsStore((s) => s.savedTrips);
  const loading = useTripsStore((s) => s.loading);
  const loaded = useTripsStore((s) => s.loaded);
  const error = useTripsStore((s) => s.error);
  const load = useTripsStore((s) => s.load);
  const loadSavedTrips = useTripsStore((s) => s.loadSavedTrips);
  const overnightsByDay = useTripsStore((s) => s.overnightsByDay);
  const loadOvernightsFor = useTripsStore((s) => s.loadOvernightsFor);

  useEffect(() => {
    load();
  }, [load]);

  // F35.7 — Refetch saved trips toda vez que a tela ganha foco (apos
  // criar/editar uma trip o TripBuilder volta com goBack — precisamos
  // recarregar a lista).
  useFocusEffect(
    useCallback(() => {
      void loadSavedTrips();
    }, [loadSavedTrips]),
  );

  const catalogById = useMemo(() => {
    const m = new Map<string, CatalogRoute>();
    for (const r of loadCatalog()) m.set(r.rota_id, r);
    return m;
  }, []);

  const handleBack = (): void => {
    navigation.goBack();
  };

  const handleOpenRoute = (rotaId: string): void => {
    navigation.navigate('RouteDetail', { rotaId });
  };

  const handleLoadOvernights = (tripId: string, dayNumber: number): void => {
    void loadOvernightsFor(tripId, dayNumber);
  };

  const handleCreateTrip = (): void => {
    navigation.navigate('TripBuilder', undefined);
  };

  const handleEditSavedTrip = (id: number): void => {
    navigation.navigate('TripBuilder', { editTripId: id });
  };

  const handleShareSavedTrip = async (trip: SavedTrip): Promise<void> => {
    const message = formatTripForShare(trip, catalogById);
    // Tenta WhatsApp direto via deep link. Se o piloto nao tem WhatsApp
    // instalado, cai pro Share API padrao (que abre o seletor de apps).
    const whatsappUrl = `whatsapp://send?text=${encodeURIComponent(message)}`;
    try {
      const canOpen = await Linking.canOpenURL(whatsappUrl);
      if (canOpen) {
        await Linking.openURL(whatsappUrl);
        return;
      }
    } catch {
      // segue pro fallback
    }
    try {
      await Share.share({ message });
    } catch {
      Alert.alert('Erro', 'Não foi possível abrir o compartilhamento.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} testID="screen-trips">
      <View style={styles.header}>
        <Pressable
          onPress={handleBack}
          hitSlop={12}
          style={({ pressed }) => [
            styles.backButton,
            pressed ? styles.backButtonPressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          testID="btn-trips-back"
        >
          <Text style={styles.backLabel}>{'<'} Voltar</Text>
        </Pressable>
        <Text style={styles.headerTitle}>🗺️ Trips de Fim de Semana</Text>
        <Text style={styles.headerSubtitle}>
          Combinações multi-dia geradas a partir das interconexões do catálogo.
        </Text>
      </View>

      {loading && !loaded ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.helperText}>Montando trips...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator
          testID="trips-scroll"
        >
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* F35.7 — Botao "+ CRIAR TRIP" sempre visivel */}
          <Pressable
            onPress={handleCreateTrip}
            style={({ pressed }) => [
              styles.createBtn,
              pressed ? styles.createBtnPressed : null,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Criar uma nova trip manual"
            testID="btn-create-trip"
          >
            <Text style={styles.createBtnLabel}>+ CRIAR MINHA TRIP</Text>
            <Text style={styles.createBtnHint}>
              Monte um roteiro multi-dia escolhendo as rotas
            </Text>
          </Pressable>

          {/* F35.7 — Minhas Trips (salvas pelo piloto) */}
          {savedTrips.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionEyebrow}>MINHAS TRIPS</Text>
              {savedTrips.map((trip) => (
                <SavedTripCard
                  key={trip.id}
                  trip={trip}
                  catalogById={catalogById}
                  onOpenRoute={handleOpenRoute}
                  onEdit={handleEditSavedTrip}
                  onShare={(t) => {
                    void handleShareSavedTrip(t);
                  }}
                />
              ))}
            </View>
          ) : null}

          {/* F35.6 — Trips auto-geradas (existente) */}
          {trips.length > 0 || savedTrips.length === 0 ? (
            <Text style={styles.sectionEyebrow}>SUGESTÕES AUTOMÁTICAS</Text>
          ) : null}

          {trips.length === 0 && !loading ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>
                Nenhuma trip combinada encontrada.
              </Text>
              <Text style={styles.emptyText}>
                À medida que o catálogo curado tiver mais rotas
                interconectadas, trips multi-dia aparecem aqui
                automaticamente.
              </Text>
            </View>
          ) : null}

          {trips.map((trip) => (
            <TripCard
              key={trip.id}
              trip={trip}
              onOpenRoute={handleOpenRoute}
              onLoadOvernights={handleLoadOvernights}
              overnightsByDay={overnightsByDay}
            />
          ))}

          {trips.length > 0 ? (
            <Text style={styles.footnote}>
              🤖 Trips geradas automaticamente. Combinações curadas e
              compartilhamento entre amigos chegam na próxima sub-fase.
            </Text>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

interface SavedTripCardProps {
  trip: SavedTrip;
  catalogById: ReadonlyMap<string, CatalogRoute>;
  onOpenRoute: (rotaId: string) => void;
  onEdit: (id: number) => void;
  onShare: (trip: SavedTrip) => void;
}

const SavedTripCard: React.FC<SavedTripCardProps> = ({
  trip,
  catalogById,
  onOpenRoute,
  onEdit,
  onShare,
}) => {
  // Calcula agregados a partir do catalogo na hora.
  let totalKm = 0;
  let totalToll = 0;
  for (const rotaId of trip.rotaIds) {
    const r = catalogById.get(rotaId);
    if (r) {
      totalKm += r.distancia_total_km;
      totalToll += r.total_pedagios_moto_reais;
    }
  }
  return (
    <View style={styles.savedTripCard} testID={`saved-trip-card-${trip.id}`}>
      <View style={styles.savedTripHeader}>
        <Text style={styles.savedTripBadge}>👤 MINHA TRIP</Text>
        {trip.completedAt !== undefined ? (
          <Text style={styles.savedTripCompleted}>✓ CONCLUÍDA</Text>
        ) : null}
      </View>
      <Text style={styles.tripTitle} numberOfLines={2}>
        {trip.name}
      </Text>
      <View style={styles.daysList}>
        {trip.rotaIds.map((rotaId, idx) => {
          const r = catalogById.get(rotaId);
          return (
            <Pressable
              key={`${trip.id}-${idx}`}
              onPress={() => onOpenRoute(rotaId)}
              style={({ pressed }) => [
                styles.dayRow,
                pressed ? styles.dayRowPressed : null,
              ]}
              accessibilityRole="button"
            >
              <View style={styles.dayBadge}>
                <Text style={styles.dayBadgeNumber}>{idx + 1}</Text>
                <Text style={styles.dayBadgeLabel}>DIA</Text>
              </View>
              <View style={styles.dayContent}>
                <Text style={styles.dayRoute} numberOfLines={1}>
                  {r?.nome_rota ?? rotaId}
                </Text>
                {r ? (
                  <Text style={styles.dayMeta} numberOfLines={1}>
                    {r.coordenada_inicio.cidade} → {r.coordenada_fim.cidade} ·{' '}
                    {formatKm(r.distancia_total_km)}
                  </Text>
                ) : null}
                {trip.pernoiteLocations &&
                trip.pernoiteLocations[idx] !== undefined ? (
                  <Text style={styles.dayPernoite} numberOfLines={1}>
                    🛏️ Pernoite em {trip.pernoiteLocations[idx]}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.dayChevron}>›</Text>
            </Pressable>
          );
        })}
      </View>
      {trip.notes ? (
        <Text style={styles.savedTripNotes} numberOfLines={4}>
          {trip.notes}
        </Text>
      ) : null}
      <View style={styles.summaryRow}>
        <View style={styles.summaryCell}>
          <Text style={styles.summaryValue}>{formatKm(totalKm)}</Text>
          <Text style={styles.summaryLabel}>TOTAL</Text>
        </View>
        {(() => {
          const pernoiteCount = trip.pernoiteLocations?.length ?? 0;
          return (
            <View style={styles.summaryCell}>
              <Text style={styles.summaryValue}>{pernoiteCount}</Text>
              <Text style={styles.summaryLabel}>
                {pernoiteCount === 1 ? 'PERNOITE' : 'PERNOITES'}
              </Text>
            </View>
          );
        })()}
        <View style={styles.summaryCell}>
          <Text style={styles.summaryValue}>{formatReais(totalToll)}</Text>
          <Text style={styles.summaryLabel}>PEDÁGIO</Text>
        </View>
      </View>
      <View style={styles.savedTripActions}>
        <Pressable
          onPress={() => onShare(trip)}
          style={({ pressed }) => [
            styles.savedTripActionBtn,
            pressed ? styles.savedTripActionPressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Compartilhar trip via WhatsApp"
          testID={`btn-saved-trip-share-${trip.id}`}
        >
          <Text style={styles.savedTripActionLabel}>📤 COMPARTILHAR</Text>
        </Pressable>
        <Pressable
          onPress={() => onEdit(trip.id)}
          style={({ pressed }) => [
            styles.savedTripActionBtn,
            pressed ? styles.savedTripActionPressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Editar trip"
          testID={`btn-saved-trip-edit-${trip.id}`}
        >
          <Text style={styles.savedTripActionLabel}>EDITAR</Text>
        </Pressable>
      </View>
    </View>
  );
};

interface TripCardProps {
  trip: AutoTrip;
  onOpenRoute: (rotaId: string) => void;
  onLoadOvernights: (tripId: string, dayNumber: number) => void;
  overnightsByDay: Record<string, OvernightFetchState>;
}

const TripCard: React.FC<TripCardProps> = ({
  trip,
  onOpenRoute,
  onLoadOvernights,
  overnightsByDay,
}) => (
  <View style={styles.tripCard} testID={`trip-card-${trip.id}`}>
    <View style={styles.tripHeader}>
      <Text style={styles.autoBadge}>🤖 AUTO</Text>
      <Text style={styles.themeBadge}>{THEME_LABEL[trip.themeTag]}</Text>
      {trip.difficulty !== undefined ? (
        <Text style={styles.difficultyBadge}>
          {DIFFICULTY_LABEL[trip.difficulty]}
        </Text>
      ) : null}
    </View>
    <Text style={styles.tripTitle} numberOfLines={2}>
      {trip.title}
    </Text>
    <Text style={styles.tripSubtitle} numberOfLines={2}>
      {trip.subtitle}
    </Text>

    <View style={styles.daysList}>
      {trip.days.map((day) => (
        <TripDayBlock
          key={`${trip.id}-${day.dayNumber}`}
          tripId={trip.id}
          day={day}
          onOpenRoute={onOpenRoute}
          onLoadOvernights={onLoadOvernights}
          overnightState={
            overnightsByDay[`${trip.id}|${day.dayNumber}`] ?? null
          }
        />
      ))}
    </View>

    <View style={styles.summaryRow}>
      <View style={styles.summaryCell}>
        <Text style={styles.summaryValue}>{formatKm(trip.totalDistanceKm)}</Text>
        <Text style={styles.summaryLabel}>TOTAL</Text>
      </View>
      <View style={styles.summaryCell}>
        <Text style={styles.summaryValue}>{trip.pernoites}</Text>
        <Text style={styles.summaryLabel}>
          {trip.pernoites === 1 ? 'PERNOITE' : 'PERNOITES'}
        </Text>
      </View>
      <View style={styles.summaryCell}>
        <Text style={styles.summaryValue}>
          {formatReais(trip.totalTollReais)}
        </Text>
        <Text style={styles.summaryLabel}>PEDÁGIO</Text>
      </View>
      <View style={styles.summaryCell}>
        <Text style={styles.summaryValue}>
          {trip.estimatedFuelCostReais !== undefined
            ? formatReais(trip.estimatedFuelCostReais)
            : '—'}
        </Text>
        <Text style={styles.summaryLabel}>COMBUSTÍVEL</Text>
      </View>
    </View>
  </View>
);

interface TripDayBlockProps {
  tripId: string;
  day: TripDay;
  onOpenRoute: (rotaId: string) => void;
  onLoadOvernights: (tripId: string, dayNumber: number) => void;
  overnightState: OvernightFetchState | null;
}

const TripDayBlock: React.FC<TripDayBlockProps> = ({
  tripId,
  day,
  onOpenRoute,
  onLoadOvernights,
  overnightState,
}) => {
  const hasPernoite = day.pernoiteEm !== undefined;
  const fetchState = overnightState;

  return (
    <View
      style={styles.dayBlock}
      testID={`trip-day-${day.dayNumber}`}
    >
      <Pressable
        onPress={() => onOpenRoute(day.rotaId)}
        style={({ pressed }) => [
          styles.dayRow,
          pressed ? styles.dayRowPressed : null,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Dia ${day.dayNumber}, ${day.routeName}`}
      >
        <View style={styles.dayBadge}>
          <Text style={styles.dayBadgeNumber}>{day.dayNumber}</Text>
          <Text style={styles.dayBadgeLabel}>DIA</Text>
        </View>
        <View style={styles.dayContent}>
          <Text style={styles.dayRoute} numberOfLines={1}>
            {day.routeName}
          </Text>
          <Text style={styles.dayMeta} numberOfLines={1}>
            {day.startCidade} → {day.endCidade} · {formatKm(day.distanceKm)}
          </Text>
          {hasPernoite ? (
            <Text style={styles.dayPernoite} numberOfLines={1}>
              🛏️ Pernoite em {day.pernoiteEm}
            </Text>
          ) : null}
        </View>
        <Text style={styles.dayChevron}>›</Text>
      </Pressable>

      {/* F35.6 rev — Bloco de pousadas. Lazy load: aparece o botao se nao
          buscou ainda; mostra resultados quando carrega; mostra estado de
          erro se falhar. */}
      {hasPernoite ? (
        <View style={styles.overnightWrap}>
          {fetchState === null ? (
            <Pressable
              onPress={() => onLoadOvernights(tripId, day.dayNumber)}
              style={({ pressed }) => [
                styles.overnightCta,
                pressed ? styles.overnightCtaPressed : null,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Ver pousadas perto de ${day.pernoiteEm}`}
              testID={`trip-day-${day.dayNumber}-overnight-cta`}
            >
              <Text style={styles.overnightCtaLabel}>
                🛏️ VER POUSADAS PERTO DE {day.pernoiteEm?.toUpperCase()}
              </Text>
            </Pressable>
          ) : fetchState.loading ? (
            <View style={styles.overnightLoading}>
              <ActivityIndicator color={colors.accent} size="small" />
              <Text style={styles.overnightLoadingText}>
                Buscando pousadas e hoteis...
              </Text>
            </View>
          ) : fetchState.error !== null ? (
            <Text
              style={styles.overnightError}
              testID={`trip-day-${day.dayNumber}-overnight-error`}
            >
              {fetchState.error} — toque pra tentar de novo
            </Text>
          ) : fetchState.results.length === 0 ? (
            <Text style={styles.overnightEmpty}>
              Nenhuma pousada / hotel indexado no OSM perto daqui.
            </Text>
          ) : (
            <View style={styles.overnightList}>
              <Text style={styles.overnightTitle}>
                {fetchState.results.length} OPÇÕES PERTO
              </Text>
              {fetchState.results.map((opt) => (
                <View
                  key={opt.id}
                  style={styles.overnightItem}
                  testID={`overnight-${opt.id}`}
                >
                  <Text style={styles.overnightIcon}>
                    {opt.category === 'hotel' ? '🏨' : '🏡'}
                  </Text>
                  <View style={styles.overnightBody}>
                    <Text
                      style={styles.overnightName}
                      numberOfLines={1}
                    >
                      {opt.name}
                    </Text>
                    <Text style={styles.overnightMeta} numberOfLines={1}>
                      {opt.category === 'hotel' ? 'HOTEL' : 'POUSADA'} ·{' '}
                      {(opt.distanceMeters / 1000).toFixed(1).replace('.', ',')} km
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : null}
    </View>
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
  backLabel: {
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
  headerSubtitle: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: typography.navSecondary.lineHeight,
    marginTop: spacing.xs,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing['3xl'],
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
    marginTop: spacing.md,
    textAlign: 'center',
  },
  errorBox: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(220,53,69,0.12)',
    borderWidth: 1,
    borderColor: colors.danger,
    marginBottom: spacing.lg,
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
  },
  emptyState: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: 22,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  createBtn: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.accent,
    backgroundColor: 'rgba(255,107,0,0.08)',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  createBtnPressed: {
    opacity: 0.7,
  },
  createBtnLabel: {
    color: colors.accent,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  createBtnHint: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    marginTop: spacing.xs,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionEyebrow: {
    color: colors.textMuted,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  savedTripCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.accent,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  savedTripHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  savedTripBadge: {
    color: colors.accent,
    backgroundColor: 'rgba(255,107,0,0.18)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    fontSize: typography.caption.fontSize,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  savedTripCompleted: {
    color: colors.success,
    backgroundColor: 'rgba(63,191,111,0.18)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    fontSize: typography.caption.fontSize,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  savedTripNotes: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    fontStyle: 'italic',
    lineHeight: 18,
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  savedTripActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  savedTripActionBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    backgroundColor: 'rgba(255,107,0,0.06)',
  },
  savedTripActionPressed: {
    opacity: 0.6,
  },
  savedTripActionLabel: {
    color: colors.accent,
    fontSize: typography.caption.fontSize,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  tripCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  tripHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  autoBadge: {
    color: colors.accent,
    backgroundColor: 'rgba(255,107,0,0.14)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  themeBadge: {
    color: colors.textSecondary,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  difficultyBadge: {
    color: colors.textSecondary,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  tripTitle: {
    color: colors.textPrimary,
    fontSize: typography.display.fontSize,
    fontWeight: typography.display.fontWeight,
    lineHeight: typography.display.lineHeight,
  },
  tripSubtitle: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  daysList: {
    marginTop: spacing.md,
  },
  dayBlock: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  dayRowPressed: {
    opacity: 0.6,
  },
  dayBadge: {
    width: 44,
    alignItems: 'center',
  },
  dayBadgeNumber: {
    color: colors.accent,
    fontSize: typography.display.fontSize,
    fontWeight: typography.display.fontWeight,
    lineHeight: typography.display.lineHeight,
  },
  dayBadgeLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  dayContent: {
    flex: 1,
    paddingHorizontal: spacing.sm,
  },
  dayRoute: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
  },
  dayMeta: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    lineHeight: 18,
    marginTop: 2,
  },
  dayPernoite: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontStyle: 'italic',
    marginTop: 2,
  },
  dayChevron: {
    color: colors.textMuted,
    fontSize: 24,
    fontWeight: '700',
  },
  overnightWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  overnightCta: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,107,0,0.10)',
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
  },
  overnightCtaPressed: {
    opacity: 0.7,
  },
  overnightCtaLabel: {
    color: colors.accent,
    fontSize: typography.caption.fontSize,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  overnightLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  overnightLoadingText: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
  },
  overnightError: {
    color: colors.warning,
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    paddingVertical: spacing.sm,
  },
  overnightEmpty: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontStyle: 'italic',
    paddingVertical: spacing.sm,
  },
  overnightList: {
    marginTop: spacing.sm,
  },
  overnightTitle: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  overnightItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  overnightIcon: {
    fontSize: 20,
  },
  overnightBody: {
    flex: 1,
  },
  overnightName: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
  },
  overnightMeta: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    marginTop: 2,
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  summaryCell: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
  },
  summaryValue: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '800',
  },
  summaryLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  footnote: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: 18,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
