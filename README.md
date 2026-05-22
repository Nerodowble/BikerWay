# BikerWay

App de navegação para motociclistas com lógica preditiva de combustível, rotas customizadas (expressa/sinuosa) e busca de postos sobre OpenStreetMap.

## Stack
- Expo SDK 52, React Native 0.76, TypeScript strict
- Zustand v5 (estado), expo-sqlite (persistência), React Navigation v7
- Mapas/rotas/POIs serão integrados nas Fases 2–5 (OSM + OSRM + Overpass)

## Status (Fase 1 completa)
- Modelagem de dados (Motorcycle, NavigationState, FuelSnapshot, POI types)
- Persistência SQLite com migrations transacionais
- Cálculos de autonomia (A_max, A_seg margem 15%, A_rest, reserve em 40km)
- Stores Zustand: motorcycleStore + navigationStore + bootstrap
- Design system biker-glove-safe (dark #121212, accent #FF6B00, hit target ≥64dp, fonte ≥18pt nav)
- Telas: MotorcycleSetup (cadastro+edição) e Home (placeholder do mapa + Tanque Cheio + grid de botões)

## Como rodar (Expo Go)

```bash
npm install        # primeira vez
npm start          # ou: npx expo start
```

1. Instale o app **Expo Go** no seu Android via Play Store.
2. Escaneie o QR code que aparece no terminal.
3. O app abre direto no celular.

## Scripts
- `npm start` — Metro bundler + QR code do Expo Go
- `npm run android` — abre direto em emulador Android (se houver)
- `npm run typecheck` — `tsc --noEmit` para validar tipos

## Estrutura

```
src/
  domains/        # bounded contexts (motorcycle, navigation, fuel, poi)
  infrastructure/ # SQLite + migrations + repositories
  state/          # Zustand stores + bootstrap
  navigation/     # React Navigation (stack)
  screens/        # telas
  shared/         # theme tokens + componentes base + utils
docs/             # especificações (SRS, arquitetura, roadmap)
```

## Próximas fases
- **Fase 2**: react-native-maps + OSM tiles + roteamento OSRM
- **Fase 3**: rastreamento GPS contínuo + hodômetro virtual
- **Fase 4**: busca Overpass de postos no buffer da rota (1km)
- **Fase 5**: waypoint injection + auto-cleanup ao chegar no posto
