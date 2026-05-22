Este documento é o roteiro de execução sequencial. Passe um passo por vez para a IA para evitar estouro de contexto e códigos incompletos.

+-------------------------------------------------------+
|  FASE 1: Setup do Ambiente e Estrutura de Dados       |
+-------------------------------------------------------+
                           |
                           v
+-------------------------------------------------------+
|  FASE 2: Engine de Mapas e Renderização de Rotas      |
+-------------------------------------------------------+
                           |
                           v
+-------------------------------------------------------+
|  FASE 3: Algoritmo de Autonomia e Estado do Tanque   |
+-------------------------------------------------------+
                           |
                           v
+-------------------------------------------------------+
|  FASE 4: Integração de POIs ao Longo do Caminho       |
+-------------------------------------------------------+
                           |
                           v
+-------------------------------------------------------+
|  FASE 5: Lógica de Recálculo (Waypoints) e Testes     |
+-------------------------------------------------------+
🛠️ Configuração Inicial Recomendada para o Claude Code
Antes de iniciar, execute ou peça para a IA criar o arquivo de configuração .claudecode.json ou as diretrizes locais para garantir que ela use estritamente código modular e TypeScript/clean code.

🟢 FASE 1: Setup de Arquitetura e Modelagem de Dados
Objetivo: Criar a estrutura básica do projeto, estados globais de gerenciamento e banco de dados local.

Comando/Instrução para o Claude Code:

"Crie a estrutura de dados e interfaces TypeScript para o aplicativo. É necessário modelar a interface Motorcycle (id, brand, model, tankCapacity, averageConsump, currentAutonomy), a interface RouteSettings (type: 'express'|'scenic', allowUnpaved: boolean) e o estado global de navegação NavigationState (currentPosition, destination, distanceTraveled, isReserveMode). Configure uma estrutura de armazenamento local usando SQLite ou AsyncStorage para persistir os dados da moto."

🟢 FASE 2: Integração do Mapa e Motor de Rotas (OSM/OSRM)
Objetivo: Renderizar o mapa na tela, capturar a localização do usuário e traçar uma rota simples de A para B.

Comando/Instrução para o Claude Code:

"Implemente a tela de mapa utilizando a biblioteca Leaflet (se Web/Webview) ou React Native Maps com os tiles abertos do OpenStreetMap. Conecte com a API pública do OSRM (Open Source Routing Machine) para calcular e desenhar a rota entre a localização atual do dispositivo e um endereço digitado pelo usuário. Garanta que o mapa centralize e siga a posição do usuário de forma suave."

🟢 FASE 3: Desenvolvimento do Algoritmo de Autonomia e Hodômetro
Objetivo: Criar a lógica matemática que escuta o GPS, calcula o gasto de combustível e atualiza a interface.

Comando/Instrução para o Claude Code:

"Crie um hook ou serviço de monitoramento geográfico. Ele deve escutar as atualizações de geolocalização em segundo plano. Quando o evento 'Tanque Cheio' for disparado, comece a acumular a distância percorrida calculando a distância Haversine entre os pontos consecutivos do GPS. Subtraia essa distância da autonomia da moto cadastrada na Fase 1. Quando a autonomia restante for menor ou igual a 40km, mude o estado global isReserveMode para verdadeiro."

🟢 FASE 4: Geofencing e Consumo da Overpass API (Postos de Gasolina)
Objetivo: Buscar postos de combustível na rota dinamicamente sem usar APIs pagas.

Comando/Instrução para o Claude Code:

"Escreva uma função que receba a polilinha (array de coordenadas) da rota atual e a posição do usuário. Faça uma requisição para a Overpass API do OpenStreetMap buscando nós com a tag 'amenity=fuel' dentro de um raio de 1000 metros da linha do trajeto restante. Filtre e retorne uma lista contendo nome do posto, distância até ele e coordenadas geométricas. Normalize os dados para exibição em lista e inserção de pins customizados no mapa."

🟢 FASE 5: Sistema de Waypoints e Recálculo Dinâmico
Objetivo: Implementar o desvio de rota para o posto e o posterior retorno ao objetivo original.

Comando/Instrução para o Claude Code:

"Implemente a funcionalidade de adicionar parada. Quando o usuário selecionar um posto no mapa, a rota atual deve ser atualizada no motor de rotas OSRM injetando a coordenada do posto como um ponto intermediário (waypoint). Escreva a lógica que detecta quando o usuário está a menos de 50 metros desse posto para resetar automaticamente o estado de autonomia da moto para 'Tanque Cheio' e recalcular a rota eliminando o waypoint, seguindo direto para o destino original."