import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/shared/theme';

export interface RadioRowProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}

/**
 * Single radio entry rendered as a full-width pressable row. Used inside the
 * catalog filters screen for origin mode and motorcycle selection. Visual
 * design intentionally mirrors the dark mode form pattern used elsewhere in
 * the app (orange accent ring around an active dot).
 */
export const RadioRow: React.FC<RadioRowProps> = ({
  label,
  selected,
  onPress,
  testID,
}) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="radio"
    accessibilityState={{ selected }}
    style={({ pressed }) => [
      styles.row,
      pressed ? styles.rowPressed : null,
    ]}
    testID={testID}
  >
    <View
      style={[styles.circle, selected ? styles.circleSelected : null]}
    >
      {selected ? <View style={styles.dot} /> : null}
    </View>
    <Text style={styles.label}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  rowPressed: {
    opacity: 0.7,
  },
  circle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  circleSelected: {
    borderColor: colors.accent,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  label: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: typography.navSecondary.lineHeight,
  },
});
