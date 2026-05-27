Módulo de SOS Comunitário (Anjo da Guarda)
Guarde este documento com os outros para entregar ao Claude Code no momento da expansão do app.

1. Regras de Negócio e Segurança
Gatilho de Cancelamento: O usuário que pediu ajuda pode cancelar o SOS a qualquer momento. Isso remove o pin do mapa de todos os outros usuários instantaneamente.

Histórico de Abuso: Se um usuário disparar o SOS mais de 3 vezes na semana e cancelar em seguida (trote), o sistema suspende temporariamente a conta dele para proteger a confiabilidade da comunidade.

Módulo de Saúde (Prioridade Máxima): Se o botão escolhido for Emergência de Saúde, além de notificar a comunidade, o app deve exibir na tela um botão de discagem direta para o Samu/Bombeiros (192/193) da região e compartilhar um texto pronto com as coordenadas para o piloto copiar e enviar via WhatsApp para familiares.

2. Especificação de UI/UX (Layout das Telas)
Tela de Disparo do SOS (Quem precisa de ajuda)
+-------------------------------------------------------+
| ⚠️  [ MÓDULO DE SOCORRO IMEDIATO ]                     |
+-------------------------------------------------------+
|                                                       |
|   Selecione o seu problema atual na estrada:          |
|                                                       |
|   +---------------------+   +---------------------+   |
|   | 🛞 PNEU FURADO      |   | 🛠️ PANE MECÂNICA     |   |
|   +---------------------+   +---------------------+   |
|   | ⚡ PANE ELÉTRICA     |   | ⛽ PANE SECA         |   |
|   +---------------------+   +---------------------+   |
|                                                       |
|   +-------------------------------------------------+ |
|   | 🏥 EMERGÊNCIA DE SAÚDE (Urgente)                | | -> Botão Vermelho em Destaque
|   +-------------------------------------------------+ |
|                                                       |
|   [ Deslize para Ativar o SOS >>>>>>>>>>>>>>>>>>>> ]  | -> Slider para evitar cliques acidentais
+-------------------------------------------------------+
Tela de Alerta Recebido (Quem está passando perto e vai ajudar)
+-------------------------------------------------------+
| 🚨 ALERTA DE SOS PRÓXIMO!                             |
+-------------------------------------------------------+
|                                                       |
|   Há um motociclista precisando de apoio a 4.2 km     |
|   da sua posição atual.                               |
|                                                       |
|   • Motociclista: Carlos (Honda Hornet)               |
|   • Problema: 🛞 Pneu Furado                           |
|   • Mensagem: "Estou sem câmara de ar reserva"        |
|                                                       |
|   Você pode parar para dar esse apoio?                |
|                                                       |
|   +-------------------------------------------------+ |
|   | 🏍️ SIM, ESTOU A CAMINHO!                         | | -> Ao clicar, abre o GPS até o Carlos
|   +-------------------------------------------------+ |
|   | ❌ Agora não posso / Recusar                     | |
|   +-------------------------------------------------+ |
+-------------------------------------------------------+
🏁 Instrução Prática para o Claude Code
Quando você for implementar essa maravilha, passe o seguinte comando para a IA:

"Implemente o sistema de SOS Comunitário por geolocalização.

Crie uma tabela no banco de dados chamada sos_alerts (id, user_id, latitude, longitude, problem_type, status: 'open'|'resolved'|'cancelled').

Integre o Firebase Cloud Messaging (FCM). Escreva uma função no backend que, ao receber um novo registro em sos_alerts, calcule via query geográfica (usando PostGIS ou Geohash local) quais usuários ativos estão num raio de 10km e dispare uma notificação push para eles.

Na interface do usuário, crie o componente de ativação em formato de Slider ('Deslize para ativar') para segurança do piloto.

Se o usuário aceitar o socorro, adicione a coordenada do SOS como destino temporário no mapa de navegação."