export type RootStackParamList = {
  MotorcycleSetup: { editMotorcycleId?: string } | undefined;
  Home: undefined;
  DestinationSearch: undefined;
  Comboio: undefined;
  CatalogFilters: undefined;
  CatalogResults: undefined;
  // Param-carrying so the detail screen can re-look-up the match from the
  // store after a remount (StackNavigator does not persist component-local
  // state across config changes / deep links).
  RouteDetail: { rotaId: string };
  // Mini-cadastro do piloto (singleton). Sem params: a tela le o perfil
  // diretamente do `useRiderStore`.
  RiderProfile: undefined;
  // Central settings hub. Sem params — a tela le os dados direto dos stores
  // (rider / motorcycle) pra montar status e dispara navegacao pra cada
  // cadastro pelos seus nomes proprios.
  Settings: undefined;
  // Modulo de SOS Comunitario (F29). Sem params: a tela le posicao do
  // navigationStore, identidade do riderStore + motorcycleStore. Em F29.2
  // ganha um param opcional pra abrir direto na tela "alerta recebido"
  // quando um SOS chega de outro piloto via PeerJS.
  SOS: undefined;
};
