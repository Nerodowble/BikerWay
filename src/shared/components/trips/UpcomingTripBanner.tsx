import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, radius, spacing, typography } from '@/shared/theme';
import { loadCatalog } from '@/infrastructure/catalog/catalogClient';
import { getSavedTripsRepo } from '@/infrastructure/db/savedTripsRepository';
import {
  selectUpcomingTrip,
  type UpcomingTripPick,
} from '@/domains/trips/schedule';
import type { SavedTrip } from '@/domains/trips/types';
import type { RootStackParamList } from '@/navigation/types';

/**
 * F35.8 — Banner in-app de lembrete pre-trip. Aparece quando ha uma
 * SavedTrip com `scheduledFor` dentro das proximas 48h. Carrega trips
 * da SQLite ao mount e re-checka a cada minuto enquanto a tela esta
 * montada (cobre o caso "Home aberta atravessando meia-noite").
 *
 * Persistencia do dismiss: por enquanto so em-memoria (re-aparece na
 * proxima abertura do app). Suficiente — o banner e leve e o piloto
 * provavelmente quer o lembrete recorrente.
 */

const RECHECK_INTERVAL_MS = 60_000; // 1 min

export const UpcomingTripBanner: React.FC = () => {
  const [trips, setTrips] = useState<SavedTrip[]>([]);
  const [nowTick, setNowTick] = useState<number>(Date.now());
  const [dismissedId, setDismissedId] = useState<number | null>(null);
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // Carrega trips uma vez ao montar. Re-load implicitamente acontece se a
  // user volta pra Home depois de criar/editar — HomeScreen monta a tela
  // de novo. Ja e o suficiente sem subscribe global.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const repo = await getSavedTripsRepo();
        const list = await repo.list();
        if (!cancelled) setTrips(list);
      } catch {
        // best-effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Tick a cada minuto pra que o status (D-1 → D → passou) atualize
  // automaticamente.
  useEffect(() => {
    const handle = setInterval(() => setNowTick(Date.now()), RECHECK_INTERVAL_MS);
    return () => {
      clearInterval(handle);
    };
  }, []);

  const pick: UpcomingTripPick | null = useMemo(() => {
    return selectUpcomingTrip(trips, nowTick);
  }, [trips, nowTick]);

  const tripFirstRouteName = useMemo<string | null>(() => {
    if (!pick) return null;
    const firstId = pick.trip.rotaIds[0];
    if (!firstId) return null;
    const route = loadCatalog().find((r) => r.rota_id === firstId);
    return route?.nome_rota ?? null;
  }, [pick]);

  if (!pick) return null;
  if (dismissedId === pick.trip.id) return null;

  const handleOpen = (): void => {
    navigation.navigate('TripBuilder', { editTripId: pick.trip.id });
  };

  const handleDismiss = (): void => {
    setDismissedId(pick.trip.id);
  };

  const headlineCopy = pick.isToday
    ? `🏍️ Hoje: ${pick.trip.name}`
    : `🏍️ Amanhã: ${pick.trip.name}`;
  const subCopy = pick.isToday
    ? tripFirstRouteName
      ? `Começa em ${tripFirstRouteName}. Bom roteiro!`
      : 'Bom roteiro!'
    : 'Tanque cheio? Bagagem pronta? Pousada confirmada?';

  return (
    <View style={styles.wrap} testID="upcoming-trip-banner">
      <Pressable
        onPress={handleOpen}
        accessibilityRole="button"
        accessibilityLabel={`Abrir detalhes da trip ${pick.trip.name}`}
        style={({ pressed }) => [
          styles.card,
          pressed ? styles.cardPressed : null,
        ]}
      >
        <View style={styles.body}>
          <Text style={styles.headline} numberOfLines={2}>
            {headlineCopy}
          </Text>
          <Text style={styles.sub} numberOfLines={2}>
            {subCopy}
          </Text>
          <Text style={styles.cta}>VER ROTEIRO ›</Text>
        </View>
        <Pressable
          onPress={handleDismiss}
          hitSlop={12}
          style={({ pressed }) => [
            styles.dismissBtn,
            pressed ? styles.dismissBtnPressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Dispensar lembrete"
          testID="btn-upcoming-trip-dismiss"
        >
          <Text style={styles.dismissLabel}>×</Text>
        </Pressable>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: spacing['3xl'],
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 999,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderWidth: 1,
    borderColor: colors.accent,
  },
  cardPressed: {
    opacity: 0.85,
  },
  body: {
    flex: 1,
  },
  headline: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '800',
    lineHeight: typography.navSecondary.lineHeight,
  },
  sub: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
    lineHeight: 18,
    marginTop: 2,
  },
  cta: {
    color: colors.accent,
    fontSize: typography.caption.fontSize,
    fontWeight: '800',
    marginTop: spacing.xs,
    letterSpacing: 0.3,
  },
  dismissBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  dismissBtnPressed: {
    opacity: 0.6,
  },
  dismissLabel: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 22,
  },
});
