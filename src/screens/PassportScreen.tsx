import React, { useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography } from '@/shared/theme';
import { usePassportStore } from '@/state/passportStore';
import type { Badge, RouteTripCard } from '@/domains/passport/types';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Passport'>;

function formatBrazilianDate(epoch: number): string {
  const d = new Date(epoch);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function formatKm(value: number): string {
  const safe = Number.isFinite(value) && value > 0 ? value : 0;
  return `${Math.round(safe)} km`;
}

export const PassportScreen: React.FC<Props> = ({ navigation }) => {
  const data = usePassportStore((s) => s.data);
  const loading = usePassportStore((s) => s.loading);
  const error = usePassportStore((s) => s.error);
  const load = usePassportStore((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  const handleBack = (): void => {
    navigation.goBack();
  };

  // Badges desbloqueadas vem primeiro; trancadas com progresso vao em
  // seguida. Mesma ordem-dentro-do-grupo preserva o array original.
  const sortedBadges = useMemo<Badge[]>(() => {
    if (!data) return [];
    const unlocked = data.badges.filter((b) => b.unlockedAt !== undefined);
    const locked = data.badges.filter((b) => b.unlockedAt === undefined);
    return [...unlocked, ...locked];
  }, [data]);

  return (
    <SafeAreaView style={styles.safe} testID="screen-passport">
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
          testID="btn-passport-back"
        >
          <Text style={styles.backButtonLabel}>{'<'} Voltar</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Meu Passaporte</Text>
      </View>

      {loading && !data ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.helperText}>Carregando passaporte...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator
          testID="passport-scroll"
        >
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Stats agregados */}
          {data ? (
            <View style={styles.statsCard} testID="passport-stats">
              <View style={styles.statsRow}>
                <View style={styles.statCell}>
                  <Text style={styles.statValue} testID="passport-stat-trips">
                    {data.stats.trips}
                  </Text>
                  <Text style={styles.statLabel}>ROTAS CONCLUÍDAS</Text>
                </View>
                <View style={styles.statCell}>
                  <Text style={styles.statValue} testID="passport-stat-km">
                    {data.stats.km}
                  </Text>
                  <Text style={styles.statLabel}>KM RODADOS</Text>
                </View>
                <View style={styles.statCell}>
                  <Text
                    style={styles.statValue}
                    testID="passport-stat-states"
                  >
                    {data.stats.uniqueStates}
                  </Text>
                  <Text style={styles.statLabel}>ESTADOS</Text>
                </View>
              </View>
              <Text style={styles.statsFooter} testID="passport-stat-year">
                {data.stats.tripsInCurrentYear} em {data.stats.currentYear}
              </Text>
            </View>
          ) : null}

          {/* Progresso por estado */}
          {data && data.perState.length > 0 ? (
            <View style={styles.section} testID="passport-section-states">
              <Text style={styles.sectionEyebrow}>POR ESTADO</Text>
              {data.perState.map((entry) => (
                <View key={entry.uf} style={styles.stateRow}>
                  <Text style={styles.stateUf}>{entry.uf}</Text>
                  <View style={styles.stateBarTrack}>
                    <View
                      style={[
                        styles.stateBarFill,
                        {
                          width: `${Math.min(
                            100,
                            (entry.completed / entry.total) * 100,
                          )}%`,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.stateCount}>
                    {entry.completed}/{entry.total}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Conquistas */}
          {sortedBadges.length > 0 ? (
            <View style={styles.section} testID="passport-section-badges">
              <Text style={styles.sectionEyebrow}>CONQUISTAS</Text>
              <View style={styles.badgeGrid}>
                {sortedBadges.map((badge) => (
                  <BadgeCard key={badge.id} badge={badge} />
                ))}
              </View>
            </View>
          ) : null}

          {/* Histórico */}
          {data && data.history.length > 0 ? (
            <View style={styles.section} testID="passport-section-history">
              <Text style={styles.sectionEyebrow}>HISTÓRICO</Text>
              {data.history.map((card) => (
                <TripRow key={card.trip.id} card={card} />
              ))}
            </View>
          ) : null}

          {data && data.history.length === 0 && !loading ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Nenhuma rota concluída ainda.</Text>
              <Text style={styles.emptyText}>
                Quando você completar uma rota do catálogo, ela aparece aqui
                com a data, distância e tempo. Conquistas vêm junto.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const BadgeCard: React.FC<{ badge: Badge }> = ({ badge }) => {
  const isUnlocked = badge.unlockedAt !== undefined;
  const progressPct = Math.round(badge.progress * 100);
  return (
    <View
      style={[
        styles.badgeCard,
        isUnlocked ? styles.badgeCardUnlocked : styles.badgeCardLocked,
      ]}
      testID={`passport-badge-${badge.id}`}
    >
      <Text
        style={[
          styles.badgeIcon,
          isUnlocked ? null : styles.badgeIconLocked,
        ]}
      >
        {badge.icon}
      </Text>
      <Text
        style={[
          styles.badgeTitle,
          isUnlocked ? null : styles.badgeTitleLocked,
        ]}
        numberOfLines={2}
      >
        {badge.title}
      </Text>
      <Text style={styles.badgeDescription} numberOfLines={3}>
        {badge.description}
      </Text>
      {isUnlocked ? (
        <Text style={styles.badgeUnlockedAt}>
          {badge.unlockedAt !== undefined
            ? formatBrazilianDate(badge.unlockedAt)
            : ''}
        </Text>
      ) : (
        <View style={styles.badgeProgressTrack}>
          <View
            style={[styles.badgeProgressFill, { width: `${progressPct}%` }]}
          />
        </View>
      )}
    </View>
  );
};

const TripRow: React.FC<{ card: RouteTripCard }> = ({ card }) => {
  const { trip, route } = card;
  const completed = trip.completedAt ?? 0;
  const title = route?.nome_rota ?? trip.rotaId;
  return (
    <View style={styles.tripRow} testID={`passport-trip-${trip.id}`}>
      <View style={styles.tripRowMain}>
        <Text style={styles.tripTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.tripMeta}>
          {formatBrazilianDate(completed)}
          {trip.distanceKm !== undefined
            ? ` · ${formatKm(trip.distanceKm)}`
            : ''}
          {trip.durationMinutes !== undefined
            ? ` · ${Math.floor(trip.durationMinutes / 60)}h${String(trip.durationMinutes % 60).padStart(2, '0')}`
            : ''}
        </Text>
      </View>
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
    lineHeight: typography.navSecondary.lineHeight,
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
    lineHeight: typography.caption.lineHeight,
  },
  statsCard: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: typography.display.fontSize,
    fontWeight: typography.display.fontWeight,
    lineHeight: typography.display.lineHeight,
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  statsFooter: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  section: {
    marginTop: spacing.xl,
  },
  sectionEyebrow: {
    color: colors.textMuted,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
    marginBottom: spacing.md,
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.xs,
  },
  stateUf: {
    width: 32,
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
  },
  stateBarTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceElevated,
    marginHorizontal: spacing.sm,
    overflow: 'hidden',
  },
  stateBarFill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  stateCount: {
    width: 56,
    textAlign: 'right',
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
  },
  badgeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  badgeCard: {
    width: '47%',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  badgeCardUnlocked: {
    backgroundColor: 'rgba(255,107,0,0.08)',
    borderColor: colors.accent,
  },
  badgeCardLocked: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.borderSubtle,
  },
  badgeIcon: {
    fontSize: 28,
    marginBottom: spacing.sm,
  },
  badgeIconLocked: {
    opacity: 0.4,
  },
  badgeTitle: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navSecondary.lineHeight,
    marginBottom: spacing.xs,
  },
  badgeTitleLocked: {
    color: colors.textSecondary,
  },
  badgeDescription: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
  },
  badgeUnlockedAt: {
    color: colors.accent,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  badgeProgressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceElevated,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  badgeProgressFill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  tripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  tripRowMain: {
    flex: 1,
  },
  tripTitle: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '600',
    lineHeight: typography.navSecondary.lineHeight,
  },
  tripMeta: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
    marginTop: 2,
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
});
