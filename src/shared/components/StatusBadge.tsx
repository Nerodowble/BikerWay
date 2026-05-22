import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radius, spacing, typography } from '../theme';

type StatusBadgeState = 'ok' | 'warning' | 'danger' | 'neutral';

type StatusBadgeProps = {
  label: string;
  value: string;
  state?: StatusBadgeState;
  icon?: React.ReactNode;
  testID?: string;
};

type StateStyle = {
  background: string;
  dot: string;
};

// Tinted backgrounds derived from semantic colors (low-alpha tint for the pill body)
const stateStyles: Record<StatusBadgeState, StateStyle> = {
  ok: {
    background: 'rgba(63,191,111,0.18)',
    dot: colors.success,
  },
  warning: {
    background: 'rgba(255,204,0,0.18)',
    dot: colors.warning,
  },
  danger: {
    background: 'rgba(211,47,47,0.20)',
    dot: colors.danger,
  },
  neutral: {
    background: colors.surfaceElevated,
    dot: colors.textMuted,
  },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  label,
  value,
  state = 'neutral',
  icon,
  testID,
}) => {
  const s = stateStyles[state];

  const containerStyle: ViewStyle = {
    backgroundColor: s.background,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  };

  // a11y: collapse label + value into a single readable phrase so screen
  // readers announce e.g. "Localização: Indisponível" instead of two separate
  // strings with the decorative dot/icon in between.
  const a11yLabel = label && value ? `${label}: ${value}` : label || value;

  return (
    <View
      style={[styles.container, containerStyle]}
      testID={testID}
      accessibilityRole="text"
      accessibilityLabel={a11yLabel}
    >
      <View style={[styles.dot, { backgroundColor: s.dot }]} />
      {icon ? <View style={styles.iconWrap}>{icon}</View> : null}
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.value} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.sm,
  },
  iconWrap: {
    marginRight: spacing.xs,
  },
  label: {
    // Bumped from textMuted (#7A7A7A) to textSecondary (#B3B3B3) for
    // a11y contrast on the tinted pill backgrounds.
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: typography.navSecondary.lineHeight,
    marginRight: spacing.xs,
  },
  value: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    // Heavier weight so the value pops against the label.
    fontWeight: '800',
    lineHeight: typography.navSecondary.lineHeight,
  },
});
