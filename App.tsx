import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  NavigationContainer,
  DefaultTheme,
  type Theme,
} from '@react-navigation/native';
// Side-effect import: registers the expo-task-manager background location task
// at module scope so it is known to the native runtime by the time
// startLocationUpdatesAsync fires (including on cold-start wake-ups when the
// OS resumes the app solely to deliver a queued location batch).
import '@/infrastructure/location/backgroundLocationTask';
import AppNavigator from '@/navigation/AppNavigator';
import { useMotorcycleStore } from '@/state/motorcycleStore';
import { bootstrapApp } from '@/state/bootstrap';
import { colors } from '@/shared/theme';
import { VoiceSessionMount } from '@/shared/components/voice';

const bikerWayDarkTheme: Theme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.background,
    text: colors.textPrimary,
    primary: colors.accent,
    border: colors.border,
    notification: colors.danger,
  },
};

export default function App() {
  const isHydrated = useMotorcycleStore((s) => s.isHydrated);

  useEffect(() => {
    void bootstrapApp();
  }, []);

  if (!isHydrated) {
    return (
      <SafeAreaProvider>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.loadingText}>Carregando BikerWay...</Text>
        </View>
        <StatusBar
          style="light"
          backgroundColor={colors.background}
          translucent={false}
        />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={bikerWayDarkTheme}>
        <AppNavigator />
      </NavigationContainer>
      {/* Singleton voice session - owns the PeerJS WebView so the call and
          GPS broadcasts survive navigation between ComboioScreen and Home. */}
      <VoiceSessionMount />
      <StatusBar
        style="light"
        backgroundColor={colors.background}
        translucent={false}
      />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: 12,
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '500',
  },
});
