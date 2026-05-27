import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, elevation, radius, spacing, typography } from '@/shared/theme';

export interface TripTimerBadgeProps {
  /** Unix epoch ms when the current trip started. `null` hides the badge. */
  tripStartedAt: number | null;
  /** ETA from `useNavigationEngine().derived?.etaSeconds`. Optional — when
   *  absent, only the elapsed timer line renders. */
  etaSeconds?: number | null;
  testID?: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatElapsed(ms: number): string {
  // 0:42 (under an hour) → 0h42min so the rider sees the unit without
  // mental math. Hours format remains HHh MMmin for the long trips.
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalMin = Math.floor(safe / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}min`;
  return `${h}h${pad2(m)}min`;
}

function formatClockTime(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * Top-left floating badge shown DURING active navigation. Two compact lines:
 *   PILOTANDO  · 0h42min
 *   CHEGADA    · 14:32
 *
 * Re-renders every 60s via a local tick. We deliberately avoid 1s ticks
 * because (a) the badge has minute-resolution copy, (b) anything tighter
 * keeps the JS thread busy unnecessarily on a battery-conscious app.
 */
export const TripTimerBadge: React.FC<TripTimerBadgeProps> = ({
  tripStartedAt,
  etaSeconds,
  testID,
}) => {
  // `nowMs` exists only to force a re-render every minute. Reading it is
  // intentional so React doesn't strip the state read in dev builds.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (tripStartedAt === null) return undefined;
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [tripStartedAt]);

  if (tripStartedAt === null) return null;

  const elapsedMs = nowMs - tripStartedAt;
  const elapsedLabel = formatElapsed(elapsedMs);
  const hasEta =
    typeof etaSeconds === 'number' && Number.isFinite(etaSeconds) && etaSeconds > 0;
  const arrivalLabel = hasEta
    ? formatClockTime(new Date(nowMs + (etaSeconds ?? 0) * 1000))
    : null;

  return (
    <View style={styles.container} testID={testID ?? 'trip-timer-badge'}>
      <View style={styles.row}>
        <Text style={styles.eyebrow}>PILOTANDO</Text>
        <Text style={styles.value} testID="trip-timer-elapsed">
          {elapsedLabel}
        </Text>
      </View>
      {arrivalLabel !== null ? (
        <View style={styles.row}>
          <Text style={styles.eyebrow}>CHEGADA</Text>
          <Text style={styles.value} testID="trip-timer-arrival">
            {arrivalLabel}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 132,
    ...elevation.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  eyebrow: {
    color: colors.textSecondary,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
  },
  value: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '800',
    lineHeight: typography.navSecondary.lineHeight,
  },
});
