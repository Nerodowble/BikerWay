import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '@/shared/theme';
import { formatDistance, formatDuration } from '@/shared/utils/format';

export interface EtaBannerProps {
  etaSeconds: number;
  remainingMeters: number;
  arrivalDate?: Date | null;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function computeArrivalDate(
  arrivalDate: Date | null | undefined,
  etaSeconds: number,
): Date {
  if (arrivalDate instanceof Date && !Number.isNaN(arrivalDate.getTime())) {
    return arrivalDate;
  }
  const safeEta = Number.isFinite(etaSeconds) && etaSeconds > 0 ? etaSeconds : 0;
  return new Date(Date.now() + safeEta * 1000);
}

function formatClockTime(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * Compact pill summarizing remaining time, remaining distance, and arrival
 * clock time. Three Text segments separated by dot characters keep the row
 * scannable at a glance without forcing a multi-line layout.
 */
export const EtaBanner: React.FC<EtaBannerProps> = ({
  etaSeconds,
  remainingMeters,
  arrivalDate,
}) => {
  const arrival = computeArrivalDate(arrivalDate, etaSeconds);
  const arrivalLabel = `chega ${formatClockTime(arrival)}`;

  return (
    <View style={styles.container} testID="eta-banner">
      <Text style={styles.primary} testID="eta-duration" numberOfLines={1}>
        {formatDuration(etaSeconds)}
      </Text>
      <Text style={styles.separator} numberOfLines={1}>
        {'·'}
      </Text>
      <Text style={styles.secondary} testID="eta-remaining" numberOfLines={1}>
        {formatDistance(remainingMeters)}
      </Text>
      <Text style={styles.separator} numberOfLines={1}>
        {'·'}
      </Text>
      <Text style={styles.secondary} testID="eta-arrival" numberOfLines={1}>
        {arrivalLabel}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.pill,
  },
  primary: {
    color: colors.textPrimary,
    fontSize: typography.navPrimary.fontSize,
    fontWeight: typography.navPrimary.fontWeight,
    lineHeight: typography.navPrimary.lineHeight,
  },
  secondary: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: typography.navSecondary.lineHeight,
  },
  separator: {
    color: colors.textMuted,
    fontSize: typography.navSecondary.fontSize,
    lineHeight: typography.navSecondary.lineHeight,
    marginHorizontal: spacing.sm,
  },
});
