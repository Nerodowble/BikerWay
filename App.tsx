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
import { useRiderStore } from '@/state/riderStore';
import { bootstrapApp } from '@/state/bootstrap';
import { colors } from '@/shared/theme';
import { VoiceSessionMount } from '@/shared/components/voice';
import { SOSNetworkMount } from '@/shared/components/sos/SOSNetworkMount';
import { SOSPeerJSMount } from '@/shared/components/sos/SOSPeerJSMount';
import { IncomingSOSMount } from '@/shared/components/sos/IncomingSOSMount';

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
  // F33: gate de boot agora aguarda AMBOS os stores hidratarem antes de
  // montar o AppNavigator. Sem isso, o navigator decidiria entre
  // RiderProfile/MotorcycleSetup/Home baseado em `profile === null` antes
  // do loadProfile resolver, e usuarios com perfil ja salvo veriam a
  // tela de "criar perfil" piscar.
  const motorcyclesHydrated = useMotorcycleStore((s) => s.isHydrated);
  const riderHydrated = useRiderStore((s) => s.isHydrated);
  const isHydrated = motorcyclesHydrated && riderHydrated;

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
      {/* Singleton SOS Comunitario (F29.2): mantem o canal P2P/loopback
          ativo durante toda a vida do app pra que o piloto receba
          alertas mesmo fora do comboio. Sem render — apenas mantem o
          refreshRoom() rodando conforme o GPS muda e prune do TTL. */}
      <SOSNetworkMount />
      {/* F29.2b: WebView headless que conecta este device a peers do
          mesmo geohash4 via PeerJS (broker model). Substitui o transport
          Loopback assim que a pagina termina boot. Sem GPS, renderiza
          null e o Loopback continua valendo. */}
      <SOSPeerJSMount />
      {/* F29.3: modal de alerta de SOS recebido. Renderiza acima de
          QUALQUER tela quando ha um alerta no incomingSOSStore, pra que
          o piloto seja avisado em qualquer momento da viagem. */}
      <IncomingSOSMount />
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
