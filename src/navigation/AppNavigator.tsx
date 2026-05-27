import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useMotorcycleStore } from '@/state/motorcycleStore';
import { useRiderStore } from '@/state/riderStore';
import { MotorcycleSetupScreen } from '@/screens/MotorcycleSetupScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { DestinationSearchScreen } from '@/screens/DestinationSearchScreen';
import { ComboioScreen } from '@/screens/ComboioScreen';
import { CatalogFiltersScreen } from '@/screens/CatalogFiltersScreen';
import { CatalogResultsScreen } from '@/screens/CatalogResultsScreen';
import { RouteDetailScreen } from '@/screens/RouteDetailScreen';
import { RiderProfileScreen } from '@/screens/RiderProfileScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { SOSScreen } from '@/screens/SOSScreen';
import { PassportScreen } from '@/screens/PassportScreen';
import { TripsScreen } from '@/screens/TripsScreen';
import { TripBuilderScreen } from '@/screens/TripBuilderScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const AppNavigator: React.FC = () => {
  const motorcyclesCount = useMotorcycleStore((s) => s.motorcycles.length);
  const hasRiderProfile = useRiderStore((s) => s.profile !== null);
  // F33 onboarding flow:
  //  1. Sem perfil → exige RiderProfile primeiro (nome do piloto vem antes
  //     da moto pq personaliza comboio, catalogo, SOS).
  //  2. Com perfil mas zero motos → MotorcycleSetup.
  //  3. Tudo cadastrado → Home.
  // O RiderProfileScreen, no save, chama navigation.reset pra
  // MotorcycleSetup quando ainda nao tem moto — fluxo guiado.
  const initialRouteName: keyof RootStackParamList = !hasRiderProfile
    ? 'RiderProfile'
    : motorcyclesCount === 0
      ? 'MotorcycleSetup'
      : 'Home';

  return (
    <Stack.Navigator
      initialRouteName={initialRouteName}
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="MotorcycleSetup" component={MotorcycleSetupScreen} />
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen
        name="DestinationSearch"
        component={DestinationSearchScreen}
        options={{
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="Comboio"
        component={ComboioScreen}
        options={{
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="CatalogFilters"
        component={CatalogFiltersScreen}
        options={{
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="CatalogResults"
        component={CatalogResultsScreen}
        options={{
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="RouteDetail"
        component={RouteDetailScreen}
        options={{
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="RiderProfile"
        component={RiderProfileScreen}
        options={{
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="SOS"
        component={SOSScreen}
        options={{
          // Modal vindo de baixo enfatiza a urgencia do fluxo de socorro
          // e mantem o mapa visivel atras quando o piloto fechar — em F29.2
          // o mapa pode mostrar o pin do proprio SOS aberto.
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="Passport"
        component={PassportScreen}
        options={{
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="Trips"
        component={TripsScreen}
        options={{
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="TripBuilder"
        component={TripBuilderScreen}
        options={{
          animation: 'slide_from_right',
        }}
      />
    </Stack.Navigator>
  );
};

export default AppNavigator;
