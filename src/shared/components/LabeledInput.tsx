import React from 'react';
import { StyleSheet, Text, TextInput, View, ViewStyle } from 'react-native';
import { colors, hitTarget, radius, spacing, typography } from '../theme';

type LabeledInputProps = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  error?: string;
  testID?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
};

export const LabeledInput: React.FC<LabeledInputProps> = ({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  error,
  testID,
  autoCapitalize = 'sentences',
}) => {
  const hasError = Boolean(error);

  const inputContainer: ViewStyle = {
    minHeight: hitTarget.min,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: hasError ? colors.danger : colors.border,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  };

  return (
    <View style={styles.wrapper} testID={testID}>
      <Text style={styles.label}>{label}</Text>
      <View style={inputContainer}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          style={styles.input}
          testID={testID ? `${testID}-input` : undefined}
        />
      </View>
      {hasError ? (
        <Text style={styles.errorText} testID={testID ? `${testID}-error` : undefined}>
          {error}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  label: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: typography.navSecondary.lineHeight,
    marginBottom: spacing.sm,
  },
  input: {
    color: colors.textPrimary,
    fontSize: typography.sizes.lg,
    paddingVertical: spacing.sm,
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.sizes.sm,
    marginTop: spacing.xs,
  },
});
