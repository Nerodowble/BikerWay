import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '@/shared/theme';

type ScreenProps = {
  children: React.ReactNode;
  padding?: boolean;
  scroll?: boolean;
  testID?: string;
};

export const Screen: React.FC<ScreenProps> = ({
  children,
  padding = true,
  scroll = false,
  testID,
}) => {
  const contentPaddingStyle = padding ? styles.padded : undefined;

  if (scroll) {
    return (
      <SafeAreaView style={styles.safeArea} testID={testID}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={contentPaddingStyle}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <View style={[styles.flex, contentPaddingStyle]}>{children}</View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  padded: {
    padding: spacing.lg,
  },
});
