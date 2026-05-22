import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, radius, spacing, typography } from '@/shared/theme';

export interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}

/**
 * Pill-shaped multi-state selector used by the catalog filters screen for
 * pavimento / nivelCurvas choices. Selected state fills the chip with the
 * brand accent — matching the chips on DestinationSearch's route-mode row.
 */
export const Chip: React.FC<ChipProps> = ({
  label,
  selected,
  onPress,
  testID,
}) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ selected }}
    style={({ pressed }) => [
      styles.chip,
      selected ? styles.chipSelected : null,
      pressed ? styles.chipPressed : null,
    ]}
    testID={testID}
  >
    <Text
      style={[styles.label, selected ? styles.labelSelected : null]}
    >
      {label}
    </Text>
  </Pressable>
);

const styles = StyleSheet.create({
  chip: {
    margin: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipPressed: {
    opacity: 0.75,
  },
  label: {
    color: colors.textPrimary,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    lineHeight: typography.caption.lineHeight,
    letterSpacing: 0.5,
  },
  labelSelected: {
    color: '#FFFFFF',
  },
});
