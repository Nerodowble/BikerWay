import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, hitTarget, radius, spacing, typography } from '../theme';

type BigButtonVariant = 'primary' | 'secondary' | 'danger' | 'warning';

type BigButtonProps = {
  label: string;
  onPress: () => void;
  variant?: BigButtonVariant;
  disabled?: boolean;
  fullWidth?: boolean;
  compact?: boolean;
  // Optional hand-drawn icon rendered alongside the label. When provided
  // we wrap the existing Text in a flex row (default) or column (stacked).
  leadingIcon?: React.ReactNode;
  // Render the icon ABOVE the label (icon + tiny eyebrow caption). Used by
  // the over-the-map bottombar where each cell is wide but short.
  stacked?: boolean;
  testID?: string;
  accessibilityLabel?: string;
};

type VariantStyle = {
  background: string;
  text: string;
  borderColor?: string;
  borderWidth?: number;
};

const variantStyles: Record<BigButtonVariant, VariantStyle> = {
  primary: {
    background: colors.accent,
    text: '#FFFFFF',
  },
  secondary: {
    background: colors.surfaceElevated,
    text: colors.textPrimary,
    borderColor: colors.border,
    borderWidth: 1,
  },
  danger: {
    background: colors.danger,
    text: '#FFFFFF',
  },
  warning: {
    background: colors.warning,
    text: '#121212',
  },
};

export const BigButton: React.FC<BigButtonProps> = ({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  fullWidth = false,
  compact = false,
  leadingIcon,
  stacked = false,
  testID,
  accessibilityLabel,
}) => {
  const v = variantStyles[variant];

  const containerStyle: ViewStyle = {
    backgroundColor: v.background,
    borderColor: v.borderColor,
    borderWidth: v.borderWidth,
    minHeight: hitTarget.min,
    borderRadius: radius.lg,
    paddingHorizontal: compact ? spacing.sm : spacing.xl,
    paddingVertical: stacked ? spacing.sm : 0,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: fullWidth ? 'stretch' : 'auto',
    opacity: disabled ? 0.4 : 1,
  };

  // Stacked layout uses the eyebrow type token (11pt 800 letterSpacing 1)
  // so the label still reads as a label, not a paragraph.
  const labelStyle = stacked
    ? [
        styles.stackedLabel,
        {
          color: v.text,
        },
      ]
    : [styles.label, { color: v.text }];

  const content = leadingIcon ? (
    <View style={stacked ? styles.stack : styles.row}>
      <View style={stacked ? styles.stackedIconWrap : styles.rowIconWrap}>
        {leadingIcon}
      </View>
      <Text
        style={labelStyle}
        numberOfLines={1}
        adjustsFontSizeToFit={compact}
        minimumFontScale={0.7}
      >
        {label}
      </Text>
    </View>
  ) : (
    <Text
      style={[styles.label, { color: v.text }]}
      numberOfLines={1}
      adjustsFontSizeToFit={compact}
      minimumFontScale={0.7}
    >
      {label}
    </Text>
  );

  return (
    <Pressable
      testID={testID}
      onPress={disabled ? undefined : onPress}
      android_ripple={disabled ? undefined : { color: 'rgba(255,255,255,0.2)' }}
      pointerEvents={disabled ? 'none' : 'auto'}
      style={containerStyle}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
    >
      {content}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  label: {
    fontSize: typography.buttonLabel.fontSize,
    fontWeight: typography.buttonLabel.fontWeight,
    lineHeight: typography.buttonLabel.lineHeight,
    textAlign: 'center',
  },
  stackedLabel: {
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stack: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconWrap: {
    marginRight: spacing.sm,
  },
  stackedIconWrap: {
    marginBottom: spacing.xs,
  },
});
