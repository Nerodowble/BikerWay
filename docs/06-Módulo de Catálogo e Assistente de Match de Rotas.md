Este documento especifica a engenharia de busca, as regras de filtragem inteligente por variáveis do usuário e a arquitetura de interface para a descoberta de rotas.1. Arquitetura da Lógica do Produto (Backend / Regras de Negócio)O sistema deve processar a lista de rotas salvas localmente (ou no servidor) através de um pipeline de filtragem e enriquecimento de dados em quatro etapas, acionado assim que o usuário abre a tela "Explorar Viagens".Passo 1: Cálculo de Proximidade (Ordenação Geográfica)Objetivo: Descobrir quais rotas estão mais perto do piloto.Mecanismo: O app captura a coordenada atual do GPS do usuário ($Lat_{user}, Lng_{user}$). Para cada rota do banco de dados, o sistema deve calcular a distância linear até a coordenada_inicio ($Lat_{inicio}, Lng_{inicio}$) utilizando a Fórmula de Haversine:$$d = 2R \arcsin\left(\sqrt{\sin^2\left(\frac{\Delta lat}{2}\right) + \cos(lat_1)\cos(lat_2)\sin^2\left(\frac{\Delta lng}{2}\right)}\right)$$Ação: A lista é ordenada de forma crescente (da rota com a largada mais próxima para a mais distante).Passo 2: Validação Algorítmica de Autonomia (Segurança)O sistema deve cruzar os dados do veículo atual do usuário com a rota para evitar que ele fique sem combustível em trechos isolados.Regra: Se caracteristicas.trecho_critico_sem_posto_km da rota for maior do que a Autonomia Segura da moto cadastrada pelo usuário, a rota deve receber uma flag de aviso: alerta_autonomia = true.Passo 3: Cálculo Preditivo de Orçamento (Custo da Viagem)O sistema deve estimar o custo financeiro total para o usuário realizar aquela rota específica.Fórmula do Consumo da Rota:$$\text{Litros Necessários} = \frac{\text{distancia\_total\_km}}{\text{Consumo Médio da Moto}}$$Fórmula do Custo de Combustível:$$\text{Custo Combustível} = \text{Litros Necessários} \times \text{Preço Médio da Gasolina (Variável Global, ex: R\$ 6.00)}$$Custo Total:$$\text{Custo Total} = \text{Custo Combustível} + \text{total\_pedagios\_moto\_reais}$$Ação: Se o Custo Total for maior do que o valor que o usuário digitou no filtro "Valor Disponível", a rota é ocultada da listagem ou enviada para o fim da paginação com opacidade reduzida.2. Especificação de UI/UX (Layout e Telas)Abaixo está a estrutura visual das duas telas que compõem este módulo.Tela A: Filtros do Assistente (Input do Usuário)Uma tela simples, com inputs grandes e seletores rápidos.+-------------------------------------------------------+
| < Voltar            [ PLANEJAR VIAGEM ]               |
+-------------------------------------------------------+
| Onde você está?                                       |
| (•) Usar minha localização atual (GPS)                |
| ( ) Digitar outra cidade de partida                   |
|                                                       |
| Quanto quer gastar no máximo neste passeio?           |
| [ R$ 150,00       ] -> Campo de texto numérico grande |
|                                                       |
| Moto selecionada para a viagem:                       |
| +---------------------------------------------------+ |
| | 🏍️ Honda PCX 2020 (Autonomia: 240km)          [v] | | -> Dropdown
| +---------------------------------------------------+ |
|                                                       |
| Estilo de Estrada Preferido:                          |
| [ Asfalto (Solo) ]   [ Misto (Terra/Asfalto) ]        | -> Botões de Seleção
|                                                       |
| Nível de Curvas Desejado:                             |
| ( ) Baixo (Retas)  ( ) Médio  (•) Alto (Serra!)       | -> Radio Buttons
|                                                       |
| +---------------------------------------------------+ |
| |               🔍 BUSCAR ROTAS BIKERS              | | -> Botão de Ação Gigante
| +---------------------------------------------------+ |
+-------------------------------------------------------+
Tela B: Resultado da Busca (Lista Paginada com Cards)Exibe os cards das rotas que deram "match" com o perfil do usuário, limitados a 10 resultados por página (Infinite Scroll / Paginação).+-------------------------------------------------------+
| < Filtrar novamente     [ 12 Rotas Encontradas ]      |
+-------------------------------------------------------+
| +---------------------------------------------------+ |
| | CARD DE ROTA #1                                   | |
| | 🗺️ SERRA DO RIO DO RASTRO (SC)                     | |
| | 📍 Largada a 15 km de você                         | |
| |                                                   | |
| | 📏 25 km de extensão   | 🪙 Pedágio: R$ 0,00      | |
| | 🛣️ Asfalto            | ↩️ Curvas: ALTO          | |
| | 💰 Custo Estm. Combustível: R$ 5,20               | |
| |                                                   | |
| | 🔗 Se conecta com: Serra do Corvo Branco          | |
| |                                                   | |
| | +-----------------------------------------------+ | |
| | |               🏍️ VER ROTA NO MAPA             | | | -> Botão de clique rápido
| | +-----------------------------------------------+ | |
| +---------------------------------------------------+ |
|                                                       |
| +---------------------------------------------------+ |
| | CARD DE ROTA #2 - ⚠️ ALERTA DE AUTONOMIA          | | -> Card muda de cor (Borda amarela)
| | 🗺️ ESTRADA X ISOLADA (MG)                          | |
| | 📍 Largada a 45 km de você                         | |
| | ⚠️ Seu tanque (240km) é menor que o trecho sem     | |
| |    posto desta rota (260km)!                      | |
| |                                                   | |
| | +-----------------------------------------------+ | |
| | |               🏍️ VER ROTA NO MAPA             | | |
| | +-----------------------------------------------+ | |
| +---------------------------------------------------+ |
+-------------------------------------------------------+
3. Instrução Prática para o Claude CodeQuando você abrir o ambiente de desenvolvimento e for mandar o Claude Code criar este módulo, use exatamente o prompt de comando abaixo:"Baseado na nossa estrutura de dados de rotas em JSON, crie o módulo de Catálogo de Viagens.Implemente uma função utilitária chamada calculateHaversineDistance para ordenar as rotas a partir do GPS atual do usuário.Crie uma função chamada calculateRouteCost(routeDistance, motoConsump, fuelPrice, tollCost) que retorne o custo estimado da viagem.Crie a tela de filtros e a tela de listagem em formato de Cards usando componentes nativos do React Native (FlatList para renderização performática e paginada).Se a rota possuir trecho_critico_sem_posto_km maior que a autonomia segura da moto do estado global, estilize o card com uma borda amarela de alerta e renderize o aviso de segurança na tela.Ao clicar em 'Ver Rota no Mapa', o app deve injetar a polilinha_simplificada da rota selecionada diretamente no nosso componente de mapa criado anteriormente."