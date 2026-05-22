Este documento define as ferramentas que a IA deve usar para codificar e as regras visuais (Design System) para que a interface fique utilizável em cima de uma moto.

1. Stack Tecnológica Recomendada (Custo Zero de Licenciamento)
Framework Mobile: React Native + TypeScript (Permite build para Android e iOS e possui excelente ecossistema para mapas e background geolocalização).

Gerenciamento de Estado: Zustand ou Redux Toolkit (Zustand é altamente recomendado por ser leve e performático para atualizações rápidas como coordenadas de GPS).

Banco de Dados Local: WatermelonDB ou SQLite (Expo SQLite) (Ideal para respostas rápidas de consulta offline de postos/veículos).

Engine de Mapas (Frontend): React Native Maps configurado com URLs de servidores de tiles do OpenStreetMap (ex: MapTiler gratuito ou OpenStreetMap Standard).

Serviço de Rotas (Backend/API): OSRM API pública (router.project-osrm.org/route/v1/driving/...) ou instância própria no Docker (gratuito).

Serviço de Busca Geográfica: Overpass API pública (overpass-api.de/api/interpreter).

2. Princípios de Design de Interface (UI/UX) para Motociclistas
A interface precisa ignorar os padrões de aplicativos de carros devido às condições extremas de uso (luvas, trepidação do motor, reflexo solar, foco visual do piloto na pista).

+-------------------------------------------------------+
|  [Status: 🟢 Autonomia 180km]    [Tempo: 🌤️ Seco]      | -> Top Bar Informativa
+-------------------------------------------------------+
|                                                       |
|                                                       |
|                       MAPA                            | -> Área Central (Visual Limpo)
|             (Seta indicando a moto)                   |
|                                                       |
|                                                       |
+-------------------------------------------------------+
|  +------------------+  +---------------------------+  |
|  | ⛽ POSTOS (40km)  |  | 🛠️ SOS / MECÂNICO         |  | -> Botões Touch Gigantes (Grid 2x1)
|  +------------------+  +---------------------------+  |
|  +-------------------------------------------------+  |
|  |               ✅ TANQUE CHEIO                   |  | -> Botão Principal de Ação Rápida
|  +-------------------------------------------------+  |
+-------------------------------------------------------+
Paleta de Cores de Alto Contraste (Modo Estrada)
Fundo do App (Elementos de UI): #121212 (Preto Puro - reduz fadiga visual e economiza bateria em telas OLED).

Texto e Ícones Primários: #FFFFFF (Branco).

Cor de Destaque / Identidade Biker: #FF6B00 (Laranja de Alta Visibilidade - remete a segurança e destaca elementos na estrada).

Estado de Alerta (Combustível Acabando): #FFCC00 (Amarelo Atenção) piscante ou #D32F2F (Vermelho Alerta).

Tipografia e Componentes de Tela
Tamanho Mínimo de Fonte na Tela de Navegação: 18pt para distâncias e instruções. 14pt para textos secundários. Menos que isso fica ilegível com o celular vibrando no suporte do guidão.

Área de Toque (Hit Target): Todos os botões na tela de navegação devem ter no mínimo 64dp de altura/largura. Eles precisam ser acionados facilmente mesmo se o piloto estiver usando luvas grossas de couro.

Interações Proibidas durante a rota: Rolagem de páginas extensas (scroll views longos), menus do tipo hambúrguer complexos, digitação de texto (teclado virtual deve ser totalmente bloqueado com a moto em movimento, detectado via velocidade do GPS > 5 km/h).

🚀 Como proceder agora com o Claude Code?
Crie uma pasta vazia para o seu projeto no computador.

Inicialize o projeto base (ex: npx create-expo-app BikerWay --template blank-typescript).

Abra o Claude Code no terminal dentro dessa pasta.

Forneça o DOCUMENTO 3 para ele entender a arquitetura tecnológica que você quer.

Em seguida, vá aplicando as fases do DOCUMENTO 2 uma a uma.

Exemplo: Diga ao Claude: "Baseado nas especificações que te dei, execute a Fase 1 do Documento 2: Crie as interfaces TypeScript e a modelagem de dados local para a moto e o estado de navegação."

Teste o código gerado em cada fase antes de pedir a próxima para garantir o funcionamento perfeito!