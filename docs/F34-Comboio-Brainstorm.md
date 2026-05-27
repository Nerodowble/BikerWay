# F34 — Brainstorm do Módulo de Comboio

> Documento de pré-implementação capturado em 2026-05-26 antes de tocar em código. Lê em ~10 min, decisões fundamentadas, perguntas residuais marcadas.
> Toda a discussão foi conduzida em torno do princípio: **"100% P2P sem backend, deixar o usuário decidir o máximo possível via toggles em Settings."**

---

## 1. Contexto

O módulo de Comboio do BikerWay hoje (F0-F30) entrega:
- Sala de voz P2P via PeerJS WebView (broker model), com signaling pelo broker público da peerjs.com
- Broadcast de GPS a cada 3s entre peers via DataChannel
- Reconexão silenciosa com backoff (2/4/8/16/30s) quando o sinal cai
- Pin colorido por peer no mapa (cor via hash do id — colide ocasionalmente)
- F30 entregue: toggles locais "ocultar pins" + "mutar áudio do comboio" dentro da ComboioScreen
- Mute mic + audio output speaker/phone (TODO nativo) também na ComboioScreen
- Indicador de dominant speaker + status badges (Conectado/Reconectando/Falha)

**Limitação central:** PeerJS WebView morre quando o app é killed pelo Android. Background OK (continua rodando se app minimizado); killed = morre e ao reabrir precisa recovery via SQLite.

**Limitação de escala:** PeerJS full-mesh degrada após ~8 peers (N² conexões). Definido cap de **15 peers** por comboio. Acima disso vira projeto novo com SFU/relay.

---

## 2. Quadro decisório (consolidado da brainstorm)

### Limites e governança
| | Decidido |
|--|----------|
| Max peers por comboio | 15 (acima exige reestruturação) |
| Admin | Coroa dourada visível pra todos; sucessor pré-escolhido pelo admin na criação; cascata FIFO se sucessor offline |
| Identidade visual do peer | Inicial colorida com paleta única de 15 cores distantes em HSL; broker atribui índice ao entrar |
| Lobby pre-ride | Read-only — lista de peers com status (bateria, etc); SEM botão "PARTIMOS" |

### Features novas a entregar
| | Decidido |
|--|----------|
| Ping de localização | Long-press no mapa → pin "olha aqui" visual, 45s TTL, 1 ativo por peer; **sem som** |
| Detecção de separação | Pares > 3 km por > 3 min consecutivos → banner; ignora velocidades < 5 km/h (parados) |
| Mapa coletivo | Botão "🔍 PELOTÃO" auto-zoom enquadrando TODOS os peers + admin |
| Velocidade no pin | Render abaixo de cada peer quando toggle ligado; "⏸️ parado" como indicador separado quando < 5 km/h |
| Histórico de comboios passados | Settings → "Meus comboios": código, data, duração, lista de peers — SEM replay detalhado |
| Replay (gravar trajeto) | **Modelo A** — só o seu próprio trajeto, opt-in global, 50 max LOCAL no SQLite, auto-cleanup 90 dias, decimação se > 4h |
| Admin compartilha rota oficial | Modelo 2 camadas: oficial visível (azul tracejada) + navegável escolhida; banner "cruzou trajeto" pra unir-se ao grupo |

### Robustez
| | Decidido |
|--|----------|
| App em background | Continua funcionando (WebView viva, broadcast GPS rodando) |
| App killed | Morre normalmente; ao reabrir, recovery via SQLite |
| State recovery | Janela 30 min; banner BLOQUEANTE com 2 botões grandes [CONTINUAR VIAGEM] / [DESCARTAR] |
| Cleanup gracioso ao descartar | Se havia SOS aberto → broadcast `sos.cancel`; se havia comboio aberto → broadcast `peer.leave`; ZERO lixo na rede |
| Estados recuperados | Rota+destino, comboio (código), SOS aberto, TripTimer, última posição GPS |
| Estados descartados | Filtros catálogo, busca POI ativa, scrolls de tela |

### Princípio "ON/OFF wherever possible"
Toggles ficam organizados em 2 lugares por finalidade:

**ComboioScreen (in-context, acesso rápido durante uso):**
- Mutar mic local (já existe)
- Mutar áudio do comboio inteiro (F30 entregue)
- Ocultar pins no mapa (F30 entregue)
- Audio output speaker/phone (já existe)
- Sair do comboio (já existe)

**Settings → Preferências do Comboio (set-and-forget):**
- 🎥 Gravar replay de viagens (default OFF)
- ⚡ Mostrar km/h nos pins (default OFF)
- ⏸️ Destacar peers parados (default ON)
- ⚠️ Alertas de separação (default ON)
- 🛣️ Mostrar rota oficial do admin (default ON)
- 🔀 Banner "cruzou trajeto" (default ON)

### Cortado da brainstorm
| | Por quê |
|--|---------|
| Chat texto fallback | Tira atenção do rider; voz + ping cobrem |
| PTT por botão de volume | Conflita com música via Bluetooth do capacete |
| FCM + backend pra app fechado | Custo de infra muito alto pro valor; "killed = morre" é aceitável |
| Velocidade compartilhada visual sem opt-in | Vai pra toggle em Settings (default OFF) |

---

## 3. Plano F34 — sub-fases

**Total: 11 sub-fases.** Ordem proposta otimizada pra valor visível rápido + desbloqueio de dependências.

### F34.0 — Settings → Preferências do Comboio + 6 toggles
**Esforço: Low.** Sem essa base, outras fases não têm onde plugar os opt-ins.
- Nova seção em SettingsScreen
- 6 toggles persistidos em SQLite (`app_settings` table que já existe) ou novo store
- Boot: hidratar toggles antes de mostrar UI

### F34.1 — Pin do peer com inicial colorida + paleta única
**Esforço: Low.** Depende: nada.
- Substitui `PeerMemberMarker` atual por componente novo: círculo + letra branca centralizada (estética igual ao avatar fallback da F32)
- Paleta determinística de 15 cores HSL bem separadas
- Broker atribui índice 0-14 pra cada peer que entra (round-robin reaproveita índices liberados)
- Wire message: incluir `color_index` no pacote de posição

### F34.2 — Coroa dourada + admin sucessor
**Esforço: Low-med.** Depende: F34.1.
- UI na ComboioScreen pra admin escolher sucessor (estrela cinza ao lado do nome)
- Wire message `admin.designate { successor_id }` propaga escolha
- Wire message `admin.handoff { from, to }` quando admin sai
- Cascata FIFO se sucessor offline → próximo peer da ordem de entrada
- Coroa dourada renderiza ao lado do nome do admin (lista + pin no mapa)

### F34.3 — Velocidade nos pins + "parado" indicator
**Esforço: Low.** Depende: F34.0 (toggle) + F34.1 (pin).
- Lê toggle `showSpeedOnPin` do Settings
- Quando ON: renderiza "85 km/h" abaixo do pin (fonte pequena, branca com sombra)
- Sempre (independente do toggle, default ON do `highlightStopped`): "⏸️" no pin quando velocidade < 5 km/h por > 30s
- Velocidade vem do broadcast existente (`speed` campo)

### F34.4 — State recovery (snapshot SQLite + banner bloqueante)
**Esforço: Med.** Depende: nada.
- Nova tabela `session_snapshot` com colunas: destination_lat/lng/name, route_polyline, comboio_code, sos_alert_id, trip_started_at, last_active_at
- Hook em pontos-chave (setDestination, joinComboio, fireSOS, etc) → salva snapshot
- Boot: lê snapshot. Se `last_active_at` < 30 min → renderiza banner bloqueante
- Banner toma a tela, 2 botões grandes: [CONTINUAR VIAGEM] / [DESCARTAR]
- Cleanup gracioso ao descartar: dispara `sos.cancel` se SOS aberto; dispara saída do comboio se aberto

### F34.5 — Ping de localização
**Esforço: Low.** Depende: nada (reutiliza DataChannel do PeerJS).
- Long-press no mapa (>500ms) abre menu rápido com "Ping aqui"
- Wire message `comboio.ping { peer_id, lat, lng, expires_at }`
- Cada peer pode ter no máximo 1 ping ativo; novo ping substitui o antigo
- Render: círculo pulsante laranja no mapa por 45s, com inicial do peer dentro
- Auto-cleanup quando passa o TTL

### F34.6 — Detecção de separação
**Esforço: Low.** Depende: F34.0 (toggle).
- Loop a cada 30s computa pares de distâncias entre peers
- Se par > 3 km por > 3 min consecutivos → banner discreto no mapa
- Ignora pares onde ao menos um tem velocidade < 5 km/h (parados intencionais)
- Toggle `alertSeparation` em Settings (default ON) controla se banner aparece

### F34.7 — Lobby pre-ride
**Esforço: Low.** Depende: F34.1.
- Quando admin cria comboio mas ANTES de qualquer peer iniciar navegação, abre uma tela "Sala de Espera"
- Lista peers com status: bateria estimada, posição (cidade), ping (latência ao broker)
- Read-only — sem botão "GO". Quando alguém começa a se mover, sala vira automaticamente "passeio em andamento" (transição visual)

### F34.8 — Mapa coletivo (botão pelotão)
**Esforço: Low.** Depende: nada.
- Novo botão "🔍 PELOTÃO" perto do recenter
- Ao tocar: calcula bounding box que contém TODOS os peers + admin + meu próprio pin
- Anima zoom + centro do mapa pra essa BBox com padding generoso
- Sem follow ativo após zoom — fica "congelado" até user interagir

### F34.9 — Histórico de comboios passados
**Esforço: Low.** Depende: F34.4 (parte do snapshot).
- Nova tabela `comboio_history`: código, criado_em, encerrado_em, peer_names (json)
- Settings → "Meus comboios": lista cards com dados
- Tap em um card: opção "Reentrar (se ainda ativo)" e ver peers que participaram
- Sem trajeto detalhado (isso é F34.10)

### F34.10 — Replay (gravar trajeto opt-in)
**Esforço: Med.** Depende: F34.0 (toggle) + F34.9 (histórico).
- Nova tabela `trip_replay`: trip_id, points (json com timestamps + lat/lng)
- Quando toggle `recordReplay` ON: a cada broadcast GPS, append no array em memória
- Quando comboio acaba (último peer sai OU admin lock-room): salva no SQLite
- Cap: 50 mais recentes; auto-cleanup > 90 dias; decimação se > 4h (1 ponto a cada 10s)
- Settings → "Meus comboios" → tap → tela "Minhas Viagens" com player de replay (animação no mapa)

### F34.11 — Admin compartilha rota oficial (2 camadas)
**Esforço: High.** Depende: F34.2 (admin).
- Admin define destino e calcula rota OSRM
- Botão "📍 COMPARTILHAR ROTA OFICIAL" → decima polyline pra 200-500 pontos + broadcast
- Wire message `route.share { polyline, dest_lat, dest_lng, dest_name }`
- Cada peer salva localmente como `official_route` (com toggle `showOfficialRoute` em Settings, default ON)
- Render: polyline azul tracejada no mapa, distinta da rota pessoal laranja
- Ao entrar no comboio: prompt "Seguir junto com o comboio OU vou me encontrar?"
- Se "vou me encontrar": peer navega com rota própria; detector de proximidade (< 200m da polyline oficial) a cada 30s → banner "Cruzou o trajeto. Seguir junto a partir daqui?"
- Toggle `crossPathBanner` em Settings (default ON) controla esse banner

---

## 4. Pontos abertos / decisões diferidas

São coisas que vamos descobrir quando começar a codar:

1. **Ping (F34.5) — som ON/OFF?** Decidimos visual-só. Mas talvez tenha gente que queira um chime sutil. Vamos ver no uso real.
2. **Lobby (F34.7) — quando exatamente "transiciona" pra modo ativo?** Talvez "quando o admin começa a se mover" seja muito específico. Pode ser "quando peers > 0 começam navegação" — definir na implementação.
3. **Estouro de 15 peers — como impedir?** Quando o 16º tenta entrar, o broker responde com erro `room.full`? Ou cap silencioso (16º só vê os outros mas não broadcasta)? Não é decidido.
4. **State recovery em background super-longo:** se app fica em background 8h sem ser killed (Android benevolente), o comboio vai expirar nos servidores PeerJS. Recovery vai falhar — precisa ser graceful. Definir UX.
5. **Replay (F34.10) — pode "ver as imagens dos pins dos peers"?** O user mencionou isso. Significa: visual frame estático mostrando "estavam comigo" mas sem trajeto deles. Vale renderizar como header do replay com avatares + nomes.

---

## 5. Limitações conhecidas (pra acrescentar na memória do projeto)

1. **PeerJS público (peerjs.com) sem SLA** — se cair, comboio cai. Aceito pra MVP.
2. **App killed = mata tudo** — nenhuma feature funciona sem app aberto. State recovery resolve o "voltar de onde parou", mas não recebe nada enquanto fechado.
3. **Privacidade do GPS** — broadcast de posição é constante. Quando peer entra no comboio, todos os outros peers veem sua localização exata. Por design (essência do comboio), mas tem que aparecer no consentimento de entrada.
4. **Replay Modelo A** preserva privacidade no Modelo C que cogitamos. Significa: se você liga replay e mais ninguém liga, seu replay é solo (só vê seu próprio trajeto). Aceito.
5. **Sucessor admin offline** — cascata FIFO funciona em "best effort". Se TODOS estão offline simultaneamente (network split global), comboio fica órfão até alguém voltar.

---

## 6. Ordem sugerida de entrega

Otimizada pra "valor visível em pouco código":

1. **F34.0** (Settings + toggles) — base pra tudo
2. **F34.1 + F34.2** (pin + admin) — visual no mapa muda imediato + governança
3. **F34.5 + F34.8** (ping + mapa coletivo) — features tangíveis
4. **F34.4** (state recovery) — robustez antes de adicionar mais peso
5. **F34.3 + F34.6** (velocidade + separação) — alertas refinados
6. **F34.7 + F34.9** (lobby + histórico) — sociais
7. **F34.10** (replay) — feature de gravação pesada
8. **F34.11** (rota oficial) — a mais complexa, deixar pro fim quando o resto estiver estável

Cada sub-fase deve sair com:
- Visual Test Checklist (per `feedback_visual_test_checklist`)
- Tests novos cobrindo o domain (não vamos chegar a 360 → 380 fácil)
- Sem regressão em testes existentes

---

## 7. Resumo executivo (TL;DR)

11 sub-fases, ordem ordenada por valor/dependência, todas P2P puro sem backend. Princípio "deixe o usuário decidir" via toggles em Settings. Quando F34 todo entregar:
- Admin com poderes claros, sucessor garantido
- Pins identificáveis (inicial colorida única)
- Comunicação não-verbal (ping)
- Awareness (mapa coletivo, separação alert)
- Histórico opcional (lista + replay opt-in)
- Robustez (state recovery após crash)
- Sincronia de rota (admin compartilha)

**Estimativa**: 8-12 sessões de implementação dependendo do escopo de cada fase. F34.11 sozinha pode ser 2 sessões.

---

_Documento gerado em 2026-05-26 a partir de brainstorm conduzida via Claude Code com system-architect agent. Revisar antes de começar implementação — defenses abertas marcadas na seção 4._
