import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '@/shared/theme';

export interface GpsLostBadgeProps {
  staleSeconds: number;
  isGpsStale: boolean;
}

/**
 * Compact warning pill shown when the last GPS fix is older than the
 * freshness threshold (or when no fix has arrived yet). Renders nothing
 * when the signal is healthy so the caller can place it unconditionally.
 */
export const GpsLostBadge: React.FC<GpsLostBadgeProps> = ({
  staleSeconds,
  isGpsStale,
}) => {
  if (!isGpsStale) {
    return null;
  }

  const label =
    staleSeconds === 0
      ? 'Aguardando sinal de GPS'
      : `Sinal de GPS perdido — ${staleSeconds}s`;

  return (
    <View style={styles.container} testID="gps-lost-badge">
      <Text style={styles.label} numberOfLines={1} testID="gps-lost-badge-label">
        {label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    minHeight: 36,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.warning,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  label: {
    color: '#121212',
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navSecondary.lineHeight,
  },
});
