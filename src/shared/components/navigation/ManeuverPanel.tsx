import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '@/shared/theme';
import { formatDistance } from '@/shared/utils/format';
import { ManeuverIcon } from './ManeuverIcon';

export interface ManeuverPanelProps {
  instruction: string;
  distanceMeters: number;
}

/**
 * Top-of-screen card that shows the upcoming maneuver. Designed to be
 * legible while moving: the distance number is the largest element so the
 * rider can read it with a quick glance.
 */
export const ManeuverPanel: React.FC<ManeuverPanelProps> = ({
  instruction,
  distanceMeters,
}) => {
  return (
    <View style={styles.container} testID="maneuver-panel">
      <View style={styles.iconColumn}>
        <ManeuverIcon instruction={instruction} sizeDp={56} />
      </View>
      <View style={styles.textColumn}>
        <Text style={styles.distance} numberOfLines={1} testID="maneuver-distance">
          {formatDistance(distanceMeters)}
        </Text>
        <Text
          style={styles.instruction}
          numberOfLines={2}
          ellipsizeMode="tail"
          testID="maneuver-instruction"
        >
          {instruction}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconColumn: {
    marginRight: spacing.lg,
  },
  textColumn: {
    flex: 1,
  },
  distance: {
    color: colors.textPrimary,
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 36,
  },
  instruction: {
    color: colors.textSecondary,
    fontSize: 18,
    fontWeight: typography.weights.medium,
    lineHeight: 24,
    marginTop: spacing.xs,
  },
});
