import React from 'react';
import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { colors, hitTarget, radius, spacing, typography } from '../theme';

type BigButtonVariant = 'primary' | 'secondary' | 'danger' | 'warning';

type BigButtonProps = {
  label: string;
  onPress: () => void;
  variant?: BigButtonVariant;
  disabled?: boolean;
  fullWidth?: boolean;
  compact?: boolean;
  testID?: string;
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
  testID,
}) => {
  const v = variantStyles[variant];

  const containerStyle: ViewStyle = {
    backgroundColor: v.background,
    borderColor: v.borderColor,
    borderWidth: v.borderWidth,
    minHeight: hitTarget.min,
    borderRadius: radius.lg,
    paddingHorizontal: compact ? spacing.sm : spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: fullWidth ? 'stretch' : 'auto',
    opacity: disabled ? 0.4 : 1,
  };

  return (
    <Pressable
      testID={testID}
      onPress={disabled ? undefined : onPress}
      android_ripple={disabled ? undefined : { color: 'rgba(255,255,255,0.2)' }}
      pointerEvents={disabled ? 'none' : 'auto'}
      style={containerStyle}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
    >
      <Text
        style={[styles.label, { color: v.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit={compact}
        minimumFontScale={0.7}
      >
        {label}
      </Text>
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
});
