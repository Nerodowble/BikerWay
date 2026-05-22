Este documento especifica a engenharia, as regras de negócio e o layout para a funcionalidade de chamada de voz comunitária entre motociclistas em movimento.

1. Arquitetura Técnica (Custo Zero)
Tecnologia de Voz: Jitsi Meet React Native SDK (baseado em WebRTC).

Mecanismo: O aplicativo atuará como um cliente invisível do Jitsi. Em vez de abrir a interface de videoconferência padrão do Jitsi, o app consumirá apenas o fluxo de áudio em segundo plano, mantendo o usuário na tela do mapa do BikerWay.

Segurança/Isolamento: As salas serão geradas dinamicamente usando hashes baseados no ID do criador do comboio (ex: bikerway_room_[hash_unico]) para evitar que estranhos entrem na mesma frequência.

2. Regras de Negócio e Lógica do Fluxo
RN01: Criação e Ingresso no Comboio
O "Líder" clica em Criar Comboio. O sistema gera um Token de Sessão de 4 dígitos alfanuméricos e inicia a sala de voz no servidor público e gratuito do Jitsi (meet.jit.si).

Os "Membros" digitam o código na tela inicial do módulo. O sistema valida o código no banco de dados, recupera as coordenadas da sala e conecta o usuário automaticamente com o microfone ativado e o alto-falante em modo Viva-Voz/Bluetooth.

RN02: Gerenciamento de Conectividade Extrema (Algoritmo Anti-Queda)
Nas estradas, o sinal de internet oscila frequentemente. O Claude Code deve implementar a seguinte lógica no SDK do Jitsi:

Detecção de Desconexão: Se o status da conexão do usuário mudar para DISCONNECTED ou FAILED, a interface deve mudar o indicador de sinal do amigo para "Tentando Reconectar".

Silenciamento de Erros: Bloquear qualquer pop-up nativo do Jitsi de "Conexão perdida". O piloto não pode interagir com avisos de erro.

Loop de Reconexão Passiva: O app deve tentar reconectar à sala a cada 5 segundos automaticamente, usando uma estratégia de backoff exponencial, até que o sinal 4G/5G seja restabelecido.

3. Especificação de UI/UX (Design de Tela)
Como o piloto precisa operar o sistema com luvas e olhar rápido, a interface de voz é integrada diretamente na barra lateral ou inferior da tela do mapa de navegação principal.

Layout Base (Visualização no Mapa durante a Rota)
+-------------------------------------------------------+
|  [Status: 🟢 Conectado ]     [🔊 Comboio: #5821 ]     | -> Top Bar do Comboio
+-------------------------------------------------------+
|                                                       |
|   (📍 Mapa com Pins em tempo real dos amigos)         |
|   [🏍️ Você] ---- 500m ---- [🏍️ João] ---- 1km ---- [🏍️ Pedro] |
|                                                       |
+-------------------------------------------------------+
|  PAINEL DE CONTROLE DA CALL (Acessível com 1 Toque)   |
|                                                       |
|  +---------------+  +---------------+  +-----------+  |
|  |   🎤 MUTAR    |  |  🔊 VIVA-VOZ   |  | ❌ SAIR   |  | -> Botões gigantes (Min. 70dp)
|  |  (Ativo/Micro)|  |   / CAPACETE  |  |  DA CALL  |  |
|  +---------------+  +---------------+  +-----------+  |
|                                                       |
|  STATUS DOS INTEGRANTES:                              |
|  🟢 Você (Falando...)                                 |
|  🔴 João (Mutado)                                     |
|  ⚪ Pedro (Sem Sinal - Reconectando automaticamente)   |
+-------------------------------------------------------+
Elementos Visuais Críticos para o Claude Code Implementar:
Botão Mutar/Desmutar: Deve ocupar pelo menos 35% da largura inferior da tela. A cor do botão deve mudar drasticamente: Verde quando o microfone estiver aberto, Vermelho Sólido quando estiver mutado. Isso permite que o piloto saiba o status com um relance periférico.

Indicador de Voz Ativa: Próximo ao nome dos amigos na barra lateral, deve haver uma animação simples de ondas sonoras se o amigo estiver falando. Isso ajuda o piloto a identificar quem está falando sem precisar reconhecer apenas pela voz (útil quando há muito barulho de vento no microfone).

4. Instrução Prática para o Claude Code (Quando for implementar)
Quando você decidir ativar essa funcionalidade no futuro, cole o seguinte comando no prompt do Claude Code:

"Instale o SDK do Jitsi Meet para React Native (react-native-jitsi-meet ou utilize a biblioteca padrão WebRTC para se conectar ao servidor público do Jitsi). Implemente um serviço chamado VoiceGroupService.ts. Este serviço deve gerenciar a conexão de áudio em segundo plano usando apenas o fluxo de áudio, desativando completamente a captura de vídeo para economizar banda de internet e bateria. Crie as funções joinComboio(codigo), muteLocalMic(), switchAudioOutput() e leaveComboio(). Garanta que, se a conexão cair, o app tente reconectar silenciosamente em background sem travar a interface do mapa."