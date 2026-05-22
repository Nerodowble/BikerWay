import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useMotorcycleStore } from '@/state/motorcycleStore';
import { MotorcycleSetupScreen } from '@/screens/MotorcycleSetupScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { DestinationSearchScreen } from '@/screens/DestinationSearchScreen';
import { ComboioScreen } from '@/screens/ComboioScreen';
import { CatalogFiltersScreen } from '@/screens/CatalogFiltersScreen';
import { CatalogResultsScreen } from '@/screens/CatalogResultsScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const AppNavigator: React.FC = () => {
  const motorcyclesCount = useMotorcycleStore((s) => s.motorcycles.length);
  const initialRouteName: keyof RootStackParamList =
    motorcyclesCount === 0 ? 'MotorcycleSetup' : 'Home';

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
    </Stack.Navigator>
  );
};

export default AppNavigator;
