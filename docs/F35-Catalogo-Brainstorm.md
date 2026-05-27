# F35 — Brainstorm do Módulo de Catálogo de Rotas

> Documento de pré-implementação. Captura uma sessão de brainstorm conduzida em 2026-05-26 sobre como tirar o módulo de descoberta de rotas da sensação atual "pobre / Excel-com-mapa" e levar pra "amigo que conhece estrada".
>
> Princípio mestre que orientou todas as decisões: **respostas humanas pra perguntas humanas, não respostas técnicas pra perguntas técnicas.** Em paralelo, manter os princípios fundadores do projeto: 100% P2P, sem backend próprio, sem custo de infra escalando.

---

## 1. Contexto curto

### O que existe hoje (F0-F31)
- 15 rotas em `routes.json` curadas manualmente com auxílio de LLM (framework em `prompts/catalog-update-prompt.md`)
- Cada rota tem dados densos: nome, coordenadas, distância, pavimento, nível de curvas, trecho crítico sem posto, **pedágios detalhados por praça (F28)**, pontos de apoio, polyline, opcionais (descricao_biker, dicas_seguranca, melhor_epoca, dificuldade, confiabilidade, fontes_dados, ultima_revisao, interconexoes_ids)
- Tela `CatalogFiltersScreen` pede orçamento, preço gasolina, autonomia, pavimento, nível curvas ANTES de mostrar qualquer rota
- Tela `CatalogResultsScreen` lista cards ordenados por distância em linha reta
- Tela `RouteDetailScreen` com várias seções ricas
- Preview azul OSRM real em background pros top 5 cards

### O que o dono sentiu
"Ainda é bem pobre esse processo para o usuário. Podemos analisar e pensar bastante, até mesmo fora da casinha."

### A leitura da sessão
O catálogo hoje obriga o piloto a fazer perguntas técnicas (orçamento, autonomia, curvas) que ele raramente faz na vida real. As perguntas que ele faz são humanas: "hoje vai chover?", "tô sem ideia, me surpreende", "qual a próxima rota pra trip de feriado". O app responde só à pergunta técnica e esconde a riqueza dos dados curados atrás de um formulário.

---

## 2. Princípio mestre

**Toda escolha deve ser avaliada pela perspectiva do "Willian sábado 7h da manhã":** ele acordou, café, olha o céu, abre o app. O que o app mostra primeiro? Como ele responde à dúvida REAL dele em 10 segundos?

Decisões que derivam disso:
- **Mostrar antes de pedir.** Cards visíveis primeiro, filtros como refinamento.
- **Contexto importa.** Clima, hora, perfil do piloto, histórico — tudo que já temos deve falar.
- **Custo é parte da decisão (validado pelo dono).** Continuar exibindo orçamento, pedágios, autonomia — mas não como pré-requisito, e sim como informação ao lado dos atrativos.
- **Identidade ao longo do tempo.** O piloto deve sentir que o app o conhece e cresce com ele.

---

## 3. As 5 ideias — detalhadas

### IDEIA A. Fim de Semana Perfeito — feed contextual

**Status: amada pelo dono. Manter preços/valores visíveis (priorização do dono).**

#### Cenário vivo
Willian abre o app sábado 7h. Tela inicial do catálogo. **Antes do scroll**, ele vê 3-4 cards verticais grandes — cada um com uma sugestão pra ele AGORA, dada sua localização, o clima de hoje, e o que ele já fez.

#### UI esboço

```
┌─────────────────────────────────────────┐
│ 🌤️ HOJE VALE A PENA                    │ ← seção título
│                                          │
│ ┌─────────────────────────────────────┐ │
│ │ 🌤️ Serra do Mar tá perfeita        │ │
│ │                                     │ │
│ │ Tamoios — 21°C, sem chuva           │ │
│ │ 95 km daqui • 1h20 de viagem        │ │
│ │ Pedágio R$ 23,60 round-trip         │ │ ← VALOR mantido
│ │ Combustível ~R$ 78                  │ │ ← VALOR mantido
│ │ ⛽ último posto a 35 km no trecho   │ │
│ │                                     │ │
│ │ [VER ROTEIRO]                       │ │
│ └─────────────────────────────────────┘ │
│                                          │
│ ┌─────────────────────────────────────┐ │
│ │ ⛈️ Litoral norte saturado HOJE      │ │
│ │                                     │ │
│ │ Sábado de verão = Tamoios entupida  │ │
│ │ entre 7h-11h. Se quer mar, considere│ │
│ │ Rio-Santos via Bertioga (saindo já) │ │
│ │ ou Mongaguá pelo Imigrantes.        │ │
│ │                                     │ │
│ │ [ALTERNATIVAS]                      │ │
│ └─────────────────────────────────────┘ │
│                                          │
│ ┌─────────────────────────────────────┐ │
│ │ 🌅 Você nunca foi pra Mauá          │ │
│ │                                     │ │
│ │ Visconde de Mauá — RJ • 280 km      │ │
│ │ Pedágio R$ 0 • combustível ~R$ 162  │ │
│ │ Melhor época: abril-setembro ✓      │ │
│ │                                     │ │
│ │ [DESCOBRIR]                         │ │
│ └─────────────────────────────────────┘ │
│                                          │
│ TODAS AS ROTAS (15) ▼                    │ ← acesso à lista completa
│ FILTRAR DETALHADO ▼                      │ ← acesso aos filtros antigos
└─────────────────────────────────────────┘
```

#### Mecânica — como o feed é gerado

A cada visita ao catálogo, um "ranker" local roda. Sem servidor. Inputs:
- **Posição atual do piloto** → distância haversine pra cada rota
- **Clima nas próximas 12h** em cada destino (Open-Meteo já cacheamos)
- **Perfil do piloto**: `estiloPilotagem`, `anosPilotando`, `preferenciaTempo` (já existe, nunca usado)
- **Histórico**: rotas abertas/iniciadas antes (SQLite simples — `route_history` table)
- **Dados curados da rota**: `melhor_epoca`, `dicas_seguranca`, `confiabilidade`

Pra cada rota, calcula 3 scores:
1. **Score de oportunidade** (0-100): clima compatível com `melhor_epoca`? distância razoável? tempo agora favorece?
2. **Score de novidade** (0-100): você nunca abriu = 100. Já abriu 5 vezes = 30. Já completou = 10.
3. **Score de adequação** (0-100): seu nível bate com a `dificuldade` da rota? Sua autonomia segura cobre o `trecho_critico`?

O feed mostra:
- **Top 1 de oportunidade** (= "hoje vale a pena")
- **Top 1 de cuidado/alerta** (= "hoje EVITA" — se houver algum trigger forte tipo "Tamoios sábado verão")
- **Top 1 de novidade** (= "você nunca foi pra X")
- Opcionalmente 1 sazonal (= "Rota Romântica RS abre próximo, planeja agora")

Cards são **gerados** a cada abertura — não armazenados. Cache 30 min pra não recalcular toda hora.

#### Detalhes que validamos com o dono

**Preço continua exibido** porque o piloto avalia custo na decisão. Mostramos:
- Pedágio round-trip (já temos detalhado)
- Combustível estimado (usa moto ativa do piloto + DEFAULT_FUEL_PRICE_REAIS ou último valor editado)
- Distância da posição atual

**O que não fazer:** transformar em "tile de Pinterest" sem contexto. Tudo o que aparece no card tem que ter MOTIVO de aparecer — número solto sem significado polui.

#### Esforço estimado
~1-2 semanas. Logica do ranker (1 sessão), UI dos cards (1 sessão), integração com clima e histórico (1 sessão), refinamento de copy (0.5 sessão).

#### Dependências
- F35.0 (UX foundation) — inverter Filters→Results
- Tabela `route_history` no SQLite
- Open-Meteo (já temos cache)
- Perfil do piloto (já existe; só precisa ser lido)

#### Risco
**Conteúdo dos cards parecer "raso" se a curadoria não casar.** Ex: clima diz "21°C sem chuva", mas `melhor_epoca` da rota diz "abril a setembro" e hoje é janeiro. Pode parecer contradição. Mitigação: ranker deve PRIORIZAR a curadoria humana sobre o clima quando há conflito. "Hoje tá bom de clima MAS o curador diz que melhor época é abril-set, então não recomendo no card primário."

#### Ponto aberto
Quantos cards no feed? 3 fixos? 3-5 variáveis? Auto-rotação no scroll horizontal? Discutir na implementação.

---

### IDEIA B. Stamps Brasil — passaporte de rotas completadas

**Status: amada pelo dono. CORTAR fotos por enquanto (custo de armazenamento). Manter ideia de rede social futura.**

#### Cenário vivo
Willian termina de rodar Cunha-Paraty no domingo de tarde. Volta pra casa, descansa. Segunda de manhã abre o app por hábito. Aparece uma notificação animada no topo:

> 🏆 **Conquista desbloqueada**
> **Cunha-Paraty (SP/RJ)** completa.
> Você agora tem **6 rotas em SP**, **2 no RJ**.
> **VER MEU PASSAPORTE ›**

#### UI esboço

Acessada via Settings → "Meu Passaporte":

```
┌─────────────────────────────────────────┐
│ ← Voltar                                 │
│                                          │
│ 🏆  MEU PASSAPORTE                       │
│                                          │
│ 8 rotas completadas em 2026              │
│ 1.420 km rodados                         │
│ 4 estados visitados                      │
│                                          │
│ ┌─────────────────────────────────────┐ │
│ │  [mapa do Brasil estilizado]        │ │
│ │  SP: ████████░░ 73%                 │ │ ← progresso por estado
│ │  RJ: ██░░░░░░░░ 30%                 │ │
│ │  MG: █░░░░░░░░░  8%                 │ │
│ │  SC: ░░░░░░░░░░  0%                 │ │
│ │  RS: ███░░░░░░░ 33%                 │ │
│ │  RN: ░░░░░░░░░░  0%                 │ │
│ └─────────────────────────────────────┘ │
│                                          │
│ CONQUISTAS                               │
│ 🏔️ Conquistou Tamoios (15/03/2026)      │
│ 🌅 Madrugou em Ouro Preto (22/03/2026)  │
│ 🌊 Litoral Sul completo (12/04/2026)    │
│                                          │
│ HISTÓRICO DE ROTAS                       │
│ • Cunha-Paraty • 25/05 • 92 km          │
│ • Rio-Santos • 12/04 • 175 km           │
│ • Tamoios • 15/03 • 82 km               │
│ ...                                      │
└─────────────────────────────────────────┘
```

#### Mecânica — como "completar" é detectado

Sem foto, o stamp é só metadata. Critério de "completou":
1. Piloto **iniciou navegação** (clicou em "INICIAR ROTA" no app) PARA aquela rota do catálogo
2. GPS registrou passagem em ≥ **80% dos pontos da polyline** dentro de uma janela razoável (ex: 24h)
3. Posição final do trajeto ≥ a 2km da `coordenada_fim` da rota

Quando esses 3 batem → app dispara o "stamp" → grava em `trip_history`:
```sql
CREATE TABLE trip_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rota_id TEXT NOT NULL,
  completed_at INTEGER NOT NULL,
  duration_minutes INTEGER,
  distance_km REAL,
  -- nada de foto, nada de GPS detalhado (isso é replay F34.10)
  notes TEXT  -- futura nota livre do piloto, opcional
);
```

Bem leve. Sem GPS detalhado salvo (esse é o role do Replay, F34.10). Só "fui, completei, quanto tempo demorou".

#### Conquistas temáticas (badges)

Regras pré-definidas no código (não dinâmicas) — exemplos:
- **"Conquistou X"** — completou primeira rota daquela rota_id
- **"Conquistou o Sudeste"** — completou ≥ 1 rota em SP, MG, RJ, ES
- **"Litoral completo"** — completou todas as rotas com tag costeira
- **"Madrugador"** — completou ≥ 3 rotas saindo antes das 6h da manhã
- **"Cinco serras em 2026"** — completou ≥ 5 rotas de `nivel_curvas: alto` no mesmo ano
- **"Aniversário de rota"** — completou alguma rota há exatamente 1 ano (lembrete + sugestão de repetir)

Total: ~10-15 badges hardcoded. Adicionar mais é só código.

#### Cortado por decisão do dono
- ❌ **Fotos**: não armazenar imagens das viagens. Custo de storage e processamento alto. Se o piloto quiser ter fotos, ele usa o app de Galeria normalmente.
- ❌ **Backend / nuvem**: o passaporte é 100% local no SQLite.

#### Reservado pro futuro (anotado, não fazer agora)
- 🔮 **Compartilhamento social**: futuramente, criar uma rede social BikerWay onde pilotos compartilham conquistas, comparam passaportes, viraem amigos. Mas isso é "outro produto" — sairemos do P2P puro e precisará backend. Anotado como horizonte distante.

#### Esforço estimado
~1 semana. Logica de detecção (1 sessão), tela de passaporte (1 sessão), badges (0.5 sessão), notificação de stamp (0.5 sessão).

#### Dependências
- Tabela `trip_history` no SQLite (migração)
- Hook na navegação ativa pra rastrear conclusão (já temos GPS rodando)

#### Risco
**Falso positivo de "completou".** Cara passou de carro pela mesma estrada, ou de Uber, e o app contou. Mitigação: precisa ter iniciado a navegação ATIVAMENTE pela rota no app (não basta passar GPS). Ainda assim, alguém pode tentar burlar — mas é gamificação local, não tem prêmio em dinheiro, baixo incentivo pra cheat.

#### Ponto aberto
Notificação local de stamp deve ser via `expo-notifications` (push local sem servidor) ou só um banner ao abrir o app? Discutir.

---

### IDEIA C. Comboio Whisper — boletim P2P da estrada

**Status: amada pelo dono mas dúvida de viabilidade. EXPLICAR: 100% viável, zero custo de infra.**

#### Esclarecimento de viabilidade

**Você perguntou: "processamento, banco de dados, servidor?"**

**Resposta curta:** custa o mesmo que o comboio que você JÁ TEM HOJE rodando. Que é zero.

**Resposta longa:**

| O que precisa | Como funciona | Custo |
|---------------|---------------|-------|
| **Servidor próprio?** | NÃO. Usa o mesmo broker público (peerjs.com) que o comboio já usa pra signaling. | R$ 0 |
| **Banco de dados externo?** | NÃO. As "notas" são efêmeras (TTL 6h) e ficam só em RAM nos celulares dos peers + cache opcional em SQLite local (5-20kb por nota). Não persiste em servidor algum. | R$ 0 |
| **Processamento pesado?** | NÃO. É só broadcast de string curta (max 100 chars + lat/lng + timestamp) via PeerJS DataChannel. Mesma tecnologia que já mandamos posição GPS a cada 3s. | R$ 0 |
| **Tráfego de rede grande?** | NÃO. Uma nota tem ~80 bytes JSON serializado. 1 piloto reportando = 80 bytes. 1 piloto recebendo 10 reportes = 800 bytes. Negligenciável vs voz que já passa kbps. | R$ 0 |

**Por baixo dos panos:** estendemos o PeerJS Broker model (F29.2b) com **canais por rota**. Quando o piloto está navegando uma rota do catálogo, ele entra automaticamente no canal `bikerway-route-{rota_id}` (broker model: primeiro vira broker daquele canal, demais conectam como subscribers). Reporta uma observação → broker rebroadcasta a todos no canal. Outros pilotos que abrem aquela rota nas próximas 6h fazem o mesmo, recebem o histórico recente, mostram na UI.

**Tecnicamente é parecido com o SOS Comunitário (F29) que já funciona.** Diferença: canal é por rota_id em vez de geohash, e o payload é "observação textual short" em vez de coordenadas de emergência.

#### Cenário vivo
Willian sai cedo pra fazer Serra do Rio do Rastro com 3 amigos. Comboio formado, voz rolando, navegação ativa. Passam por uma neblina forte no km 22. Willian toca em "Reportar" no app, escolhe **NEBLINA** dos presets, app broadcasta.

Em algum lugar de SP, naquele mesmo momento, o Pedro abre o BikerWay planejando ir pra Rio do Rastro no fim de semana. Toca em "Serra do Rio do Rastro" no catálogo. Antes mesmo de ver os pedágios, aparece no topo do RouteDetail:

> ⚠️ **Pilotos rodando esta rota agora**
> 🌫️ Neblina forte km 22 — há 35 min (por @piloto)
> ⛽ Posto Lauro Müller fechado — há 4h
> 🔄 atualiza em tempo real

#### UI esboço

```
ROUTEDETAILSCREEN — Serra do Rio do Rastro (SC-390)
┌──────────────────────────────────────────┐
│ ← Voltar                                  │
│                                           │
│ Serra do Rio do Rastro (SC-390)           │
│                                           │
│ ⚠️ AVISOS RECENTES (4)        🔄          │ ← seção nova, no topo
│ ─────────────────────────────             │
│ 🌫️ Neblina forte km 22                   │
│    há 35 min                              │
│ ⛽ Posto Lauro Müller fechado domingo     │
│    há 4h                                  │
│ 🪨 Brita no acostamento km 35             │
│    há 2h                                  │
│ ▼ ver todos (1 mais antigo)               │
│                                           │
│ SOBRE A ROTA                              │
│ ...                                       │
└──────────────────────────────────────────┘
```

Quando o piloto está navegando ATIVAMENTE a rota, surge na ComboioScreen (ou Home, durante navegação) um botão flutuante "⚠️ REPORTAR":

```
[botão flutuante no canto]
┌──────────────┐
│ ⚠️ REPORTAR  │
└──────────────┘

(tocar abre)
┌──────────────────────────────────┐
│ Reportar nesta rota               │
│                                   │
│ 🌫️ NEBLINA                       │
│ 🌧️ PISTA MOLHADA                 │
│ ⛽ POSTO FECHADO                  │
│ 🪨 BURACO/BRITA                  │
│ 🚨 ALERTA POLICIAL               │
│ ❌ CANCELAR                       │
└──────────────────────────────────┘
```

Sem digitação. Toques de 1 dedo. Pilotando com luva, ainda dá.

#### Mecânica anti-abuso

- **Limite por piloto**: máximo 1 reporte por hora (por rota). Evita spam.
- **Geocerca**: piloto precisa ter GPS dentro do polyline (raio 500m) nas últimas 30 min pra reportar. Se você nunca rodou aquela rota, não pode reportar.
- **TTL**: 6 horas. Depois disso, some sozinho.
- **Sem identidade pública**: o reporte mostra "por @piloto" anônimo, ou só "há X min". Sem nome real, sem foto.
- **Dedup**: 2 reportes do mesmo tipo no mesmo km dentro de 30 min se fundem (não duplica).

#### Esforço estimado
~2-3 semanas. Canal PeerJS novo (1 sessão), UI de reporte + presets (1 sessão), UI de avisos no RouteDetail (1 sessão), regras anti-abuso + geocerca (1 sessão), tests + edge cases (1 sessão).

#### Dependências
- F29.2b PeerJS broker model (já existe!)
- Sistema de canais multi-tópico no PeerJS (extensão pequena)
- Navegação ativa com GPS rodando (já existe)

#### Risco
**Spam/trote.** Atenuado pelos limites + geocerca + TTL curto. Vamos ver no uso real.

#### Ponto aberto
- Os pilotos do **comboio** do Willian (3 amigos) também viram automáticamente os reportes uns dos outros, ou cada um precisa abrir o RouteDetail individualmente? Sugestão: durante comboio ativo, broadcast dos reportes vai pra todos do comboio direto. Discutir.

---

### IDEIA D. Modo Caçador — descobrir estradas sem curadoria

**Status: EM STANDBY (decisão do dono em 2026-05-26).** A feature de descoberta via Overpass é viável e barata, mas o mecanismo de **coleta da resenha** do piloto (que alimentaria o catálogo curado) exigiria algum backend leve (Supabase, Cloudflare Worker, Formspree, Telegram bot, etc). Dono não quer adicionar essa dependência agora. Sem coleta, a feature perde o propósito de alimentar o pipeline — vira só "descobrir estradas aleatórias" sem ROI pro catálogo.
>
> **Revisitar quando:** o dono decidir voltar e topar uma infra leve de coleta. Conteúdo abaixo preservado pra referência futura.

#### Cenário vivo
Willian já fez todas as 15 rotas do catálogo. Tédio. Toca num botão novo no catálogo: **"🗺️ ME SURPREENDA"**. App busca estradas próximas no OpenStreetMap, devolve 3 candidatas BETA, marcadas claramente como "não verificadas". Ele escolhe uma, vai rodar. Volta, app pergunta "deu certo?", ele preenche uma mini-resenha. Esse insight vai pra você (o dono do projeto), que decide se promove a candidata a rota oficial curada.

#### A pergunta crítica do dono: como o dado chega até você?

Aqui estão as opções viáveis, da mais simples pra mais complexa:

##### Opção 1 — Share Sheet (mais simples, recomendada pra MVP)

Quando o piloto preenche a resenha, o app gera uma string JSON formatada e abre o **share sheet nativo do celular**. O piloto escolhe pra onde mandar (WhatsApp, Email, Telegram, copiar pra área de transferência).

```
[App gera esse texto:]

🗺️ Nova rota candidata pro BikerWay

Origem: -23.681, -46.605 (Diadema, SP)
Destino: -24.123, -46.834 (Apiaí, SP)
Nome sugerido: SP-152 Iporanga-Apiaí
Distância: 67 km
Tipo: serra, asfalto

Avaliação do piloto:
- Dificuldade: intermediário
- Melhor época: maio a setembro
- Posto mais próximo: BR Apiaí
- Dica de segurança: "neblina forte de manhã, evite antes das 9h"
- Comentário livre: "Estrada muito boa, 4 mirantes, paralelo à rota oficial"

Coordenadas para validação:
[lista de pontos GPS amostrais do trajeto que o piloto rodou]

---
Submitted via BikerWay app v0.X.Y
```

O piloto manda pra você por WhatsApp/Email. Você recebe na sua caixa, lê, valida, e usa o framework `prompts/catalog-update-prompt.md` pra transformar isso numa rota curada em `routes.json`. Manual.

**Vantagens**: zero infra, zero custo, zero código de backend. Funciona AGORA.
**Desvantagem**: depende do piloto querer mandar (alguns vão esquecer). Você processa manualmente.

##### Opção 2 — Google Form / Tally Form

App gera um deep link pra um Google Form **pré-preenchido** com os dados:
```
https://docs.google.com/forms/d/e/.../viewform?usp=pp_url
&entry.123=Diadema
&entry.456=Apiaí
&entry.789=Dica+aqui
```

Piloto toca, abre o formulário no navegador com tudo já preenchido, só revisa e clica Enviar.

Você recebe via Google Sheets automaticamente. Dashboard prontinho.

**Vantagens**: zero backend, dados centralizados pra você, sem ação manual de copy-paste. Tally tem free plan idêntico.
**Desvantagem**: depende de você manter o form vivo + ler o Sheets. Piloto precisa de internet quando envia.

##### Opção 3 — GitHub Issues API

App abre uma issue automaticamente num repo privado seu (ex: `bikerway/route-submissions`) com o JSON formatado como Markdown.

**Vantagens**: organização tipo "kanban" de submissões, comentários, versionamento.
**Desvantagem**: requer token de API embutido (risco se vazar). Mais setup.

##### Opção 4 — Email com mailto:

```
mailto:willian@bikerway.app?subject=Nova%20rota%20candidata&body=<json>
```

App abre o cliente de email do piloto com tudo já preenchido. Piloto só toca enviar.

**Vantagens**: super simples, sem dependência de serviço.
**Desvantagem**: piloto precisa ter cliente de email configurado.

##### Recomendação inicial

**Opção 1 (Share Sheet) pra MVP**. É o que tem menor surface de coisa pra dar errado. O piloto manda como prefere — WhatsApp pessoal pra você, ou pra um número/grupo dedicado que você configurar.

**Migrar pra Opção 2 (Google Form/Tally)** quando o volume de submissões justificar — talvez quando você estiver recebendo > 10/mês.

#### Mecânica do "Surpreenda"

Quando o piloto toca o botão:

1. App consulta Overpass num raio de 200 km da posição atual:
   ```
   way[highway=secondary][surface=asphalt](bbox);
   way[highway=tertiary][surface=asphalt](bbox);
   node[tourism=viewpoint](bbox);
   ```
2. Aplica heurística: estradas com densidade de curvas > X vertices/km E com pelo menos 1 mirante a < 5km do trajeto
3. Filtra: não pode duplicar uma rota já curada (compara coords de início/fim com tolerância de 5km)
4. Retorna 3 candidatas

UI das candidatas: card visivelmente diferente das curadas — amarelo, com warning grande:

```
┌─────────────────────────────────────────┐
│ ⚠️ ROTA NÃO VERIFICADA — BETA            │
│                                          │
│ SP-152 (Iporanga ↔ Apiaí)               │
│ 67 km • asfalto • muitas curvas         │
│ 4 mirantes detectados                    │
│                                          │
│ ⚠️ Sem dados de pedágio                  │
│ ⚠️ Sem dicas de segurança                │
│ ⚠️ Sem garantia de postos                │
│                                          │
│ [VER NO MAPA] [VOU ARRISCAR]            │
└─────────────────────────────────────────┘
```

Se o piloto roda e volta:
- App detecta conclusão (mesma lógica do Stamps): GPS bateu > 80% do traçado proposto
- 24h depois, banner discreto: "Como foi a SP-152?"
- Tap → formulário compacto:

```
Como foi a rota?
  
🎯 Dificuldade
  ○ Iniciante
  ● Intermediário
  ○ Avançado

📅 Melhor época
  ___________________ (text input curto)

⚠️ Dica de segurança
  ___________________ (text input)

⛽ Posto que você usou
  ___________________

💬 Recomenda pra outros?
  ● Sim 🤘
  ○ Mais ou menos
  ○ Não, foi ruim

[ENVIAR PRA EQUIPE BIKERWAY]
```

Tap "ENVIAR" → share sheet com JSON formatado. Piloto manda pra você.

#### Esforço estimado
~2-3 semanas. Heurística Overpass (1 sessão), UI de candidatas BETA (1 sessão), detecção de conclusão + formulário (1 sessão), share sheet integração (0.5 sessão), tests (0.5 sessão).

#### Dependências
- Stamps (B) — reutiliza detecção de conclusão de rota
- Overpass client (já temos pro POI)

#### Risco
**Segurança do piloto** — algoritmo pode mandar pra estrada ruim. Mitigação: aviso visual MUITO forte ("BETA", "NÃO VERIFICADA"), sem `pontos_apoio_homologados` listados, sem dados de pedágio assumidos, e o piloto **escolhe explicitamente** "VOU ARRISCAR".

#### Ponto aberto
- Quantas candidatas mostrar de cada vez? 3 parece bom (não overwhelm). Discutir.
- "Não recomenda" vira sinal pra remover da lista de candidatos por X dias?

---

### IDEIA E. Plano de Trip — combos multi-dia

**Status: amada pelo dono. Marcada como das mais promissoras. DETALHAR pra implementar.**

#### Cenário vivo
Willian quer planejar um feriado de 3 dias em julho. Hoje ele faria isso no Google Maps + planilha + buscas separadas de pousada. Quer um único lugar pra fazer tudo.

No BikerWay, ele abre o catálogo e toca em **"🗺️ TRIPS"**. App mostra:

```
┌─────────────────────────────────────────┐
│ ← Catálogo                               │
│                                          │
│ 🗺️ TRIPS DE FIM DE SEMANA                │
│                                          │
│ ┌─────────────────────────────────────┐ │
│ │ 🏔️ Trip "Litoral SP + Serra do Mar"│ │
│ │                                     │ │
│ │ DIA 1: Diadema → Caraguatatuba      │ │
│ │   via Tamoios (82 km, R$ 11,80 ped.)│ │
│ │   pernoite em Caraguá               │ │
│ │ DIA 2: Caraguatatuba → Ubatuba      │ │
│ │   via Rio-Santos (175 km, R$ 0)     │ │
│ │   volta via Imigrantes              │ │
│ │                                     │ │
│ │ Total: 280 km • R$ 23,60 pedágio    │ │
│ │ Combustível ~R$ 240 (ida e volta)   │ │
│ │ Pernoite: 1 noite em Caraguatatuba  │ │
│ │                                     │ │
│ │ [VER ROTEIRO COMPLETO]              │ │
│ │ [VER POUSADAS EM CARAGUATATUBA]     │ │
│ └─────────────────────────────────────┘ │
│                                          │
│ ┌─────────────────────────────────────┐ │
│ │ 🏔️ Trip "Estrada Real - 3 dias"    │ │
│ │ Ouro Preto → Tiradentes → Paraty    │ │
│ │ Total: 710 km • 3 noites • R$ 0 ped │ │
│ │ ...                                 │ │
│ └─────────────────────────────────────┘ │
│                                          │
│ + CRIAR MEU PRÓPRIO TRIP                 │
└─────────────────────────────────────────┘
```

#### Mecânica — como os trips são gerados

Auto-detecção via `interconexoes_ids`:

1. App olha cada rota e seus `interconexoes_ids` (já no JSON)
2. Constrói um **grafo dirigido**: nó = rota, aresta = "conecta com"
3. Pra trips de 2 dias: pega todos os pares (A → B) onde `A.coordenada_fim` está a < 30km de `B.coordenada_inicio`
4. Pra trips de 3 dias: pega trios (A → B → C) idem
5. Filtra: total distância > 100 km (justifica o trip) E pelo menos 1 rota com `nivel_curvas: medio` ou `alto` (justifica MOTO)

Pra cada trip detectado:
- Soma distâncias, pedágios, combustível
- Identifica "ponto de pernoite" = `coordenada_fim` da rota do dia anterior
- Sugere pousadas/hotéis no ponto de pernoite via integração com **LUGARES** (F31 já temos)

#### "Criar meu próprio trip" (modo manual)

Pra pilotos que querem montar combinações que o app não sugeriu:

1. Tela "Criar Trip"
2. Toca em "Dia 1" → seleciona uma rota do catálogo
3. Toca em "Dia 2" → mostra só rotas cuja `coordenada_inicio` está perto do `coordenada_fim` do Dia 1
4. Repete pra Dia 3 se quiser
5. Salva como "Minha Trip Litoral Norte • julho 2026" no SQLite

```sql
CREATE TABLE saved_trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rota_ids TEXT NOT NULL,  -- JSON array, ordenado
  pernoite_locations TEXT,  -- JSON array, opcional
  scheduled_for INTEGER,  -- timestamp da data planejada
  notes TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER  -- null até trip ser feito
);
```

#### Compartilhar trip via WhatsApp

Botão "Compartilhar Trip" → gera um texto formatado:

```
🏍️ Plano de Trip BikerWay

Dia 1: Tamoios (Diadema → Caraguatatuba)
Dia 2: Rio-Santos (Caraguatatuba → Ubatuba)

Total: 280 km • R$ 23,60 pedágio
Saída prevista: sábado 25/06 às 7h
Pernoite: Caraguatatuba

[link deep do BikerWay pra abrir a trip se o destinatário tiver o app]
```

Manda no grupo do WhatsApp da galera de moto, todos veem.

#### Lembrete pré-trip

Se o piloto salvou trip com `scheduled_for`, dia anterior recebe notificação local (sem servidor):

> 🏍️ Amanhã: Trip "Litoral SP + Serra do Mar"
> Tanque cheio? Bagagem pronta? Pousada confirmada em Caraguatatuba?
> Ver checklist ›

#### Esforço estimado
~3 semanas. Grafo de adjacência (0.5 sessão), gerador automático (1 sessão), tela de Trips (1 sessão), construtor manual (1 sessão), share + lembrete (0.5 sessão), tests (0.5 sessão).

#### Dependências
- `interconexoes_ids` precisa estar bem populado nas rotas (verificar — algumas têm vazias)
- F31 LUGARES (já temos) — pra sugestões de pousadas
- expo-notifications (lembrete) — leve

#### Risco
**Combinações ruins.** Trip auto pode gerar combo de 4 rotas que faz pouco sentido (ex: Sul + Sudeste, distância impossível em fim de semana). Mitigação: limitar a 4 rotas conectadas, cap de 500km/dia, e validar manualmente os top "trips canônicos" e marcar como **destacados**.

#### Ponto aberto
- Pernoite — só sugere por proximidade, ou tenta calcular "lugares COM pousadas" via Overpass automaticamente?
- "Trip canônico" curado vs auto-gerado — deveria existir uma tag tipo `trip_recomendado` no JSON pra você marcar as combinações que VOCÊ aprovou? Provavelmente sim.

---

## 4. Conexões entre as ideias (sinergia)

Essas 5 ideias se reforçam mutuamente:

```
    ┌──────────────┐
    │ A. Feed      │ ── "você nunca foi pra X"
    │ Fim Semana   │       ↓
    │ Perfeito     │ ── leva piloto a fazer rota
    └──────┬───────┘
           │
           ↓
    ┌──────────────┐
    │ B. Stamps    │ ── completou rota
    │ Brasil       │       ↓
    │              │ ── volta no Feed (A) sabendo
    └──────┬───────┘       que aquela já fez, recomenda outra
           │
           ↓
    ┌──────────────┐
    │ E. Plano Trip│ ── trip composto de várias rotas
    │              │       ↓
    │              │ ── cada rota completada = stamp (B)
    └──────────────┘

    ┌──────────────┐
    │ C. Whisper   │ ── reportes em tempo real durante navegação
    │              │       ↓
    │              │ ── piloto vê AVISOS na rota (modulo curado)
    │              │       ↓
    │              │ ── reduz risco em Trip (E) e ajuda decisão em Feed (A)
    └──────────────┘

    ┌──────────────┐
    │ D. Caçador   │ ── descobre rotas NÃO curadas
    │              │       ↓
    │              │ ── piloto submete resenha → você cura → vira rota curada
    │              │       ↓
    │              │ ── nova rota aparece em A, contábil pra B e E
    └──────────────┘
```

A, B, E formam um ciclo virtuoso: **descobre → completa → ganha → descobre mais**. C e D são "fontes externas" que alimentam: C com info viva, D com novas rotas.

---

## 5. Plano F35 sugerido — sub-fases

Total: 13 sub-fases. Ordenadas por dependência + valor visível.

| Sub-fase | O quê | Esforço | Dependência |
|----------|-------|---------|-------------|
| **F35.0** | UX foundation: inverter Filters→Results, chips de tema, interconexoes clicáveis, ver-no-mapa in-place | Low-med | — |
| **F35.1** | `route_history` + `trip_history` tables (migration #6); hook em "INICIAR ROTA" pra registrar trip iniciado | Low | — |
| **F35.2** | Detecção de "completou rota" (80% polyline em janela) | Med | F35.1 |
| **F35.3** | **Stamps Brasil (B)**: tela passaporte + ~10 badges hardcoded | Med | F35.2 |
| **F35.4** | Notificação de stamp (expo-notifications local) | Low | F35.3 |
| **F35.5** | **Fim de Semana Perfeito (A)**: ranker local + 3-4 cards no topo do catálogo | Med | F35.0 + F35.1 |
| **F35.6** | **Plano de Trip (E)**: grafo de adjacência + tela de trips auto-gerados | Med | F35.0 |
| **F35.7** | Trip manual builder + saved_trips + share | Med | F35.6 |
| **F35.8** | Lembrete pré-trip (expo-notifications) | Low | F35.7 |
| **F35.9** | **Comboio Whisper (C)** — canal PeerJS por rota + UI de reporte | Med-high | F29.2b (já existe) |
| **F35.10** | Whisper — UI de avisos no RouteDetail + anti-abuso | Med | F35.9 |
| ~~F35.11~~ | ~~Modo Caçador~~ — EM STANDBY | — | — |
| ~~F35.12~~ | ~~Caçador submissão~~ — EM STANDBY | — | — |

**Ordem recomendada (ativas):**
1. F35.0 (UX foundation) — desbloqueia tudo
2. F35.1 + F35.2 (history tracking + detecção) — base de A e B
3. F35.3 + F35.4 (Stamps) — primeira feature emocionalmente engajante
4. F35.5 (Feed Fim de Semana) — primeira feature visualmente nova
5. F35.6 + F35.7 + F35.8 (Trips) — segundo grande pulo
6. F35.9 + F35.10 (Whisper) — terceiro grande pulo, ambicioso

**Estimativa total (sem Caçador)**: ~8-12 semanas de trabalho solo. Pode rodar em paralelo com sub-fases de F34 (Comboio) se quiser.

---

## 6. Cortes e decisões confirmadas

### Cortado por decisão do dono
- ❌ **Fotos no Stamps**: custo de storage alto, não vale
- ❌ **Backend / servidor próprio**: nada (manteve 100% P2P)
- ❌ **Rede social externa de stamps**: anotado pra futuro distante, fora do escopo F35
- ⏸️ **Modo Caçador (D)**: em STANDBY — sem mecanismo de coleta confortável, a feature perde o propósito de alimentar o pipeline. Revisitar quando dono toparar infra leve de coleta.

### Mantido por decisão do dono
- ✅ **Valores monetários (pedágio + combustível) nos cards do Feed**: piloto avalia custo na decisão
- ✅ **Gamificação leve (badges)**: validada como motivadora
- ✅ **Whisper auto pro comboio**: durante comboio ativo, reportes vão automaticamente em destaque pros peers do comboio (não só pra "mundo" via RouteDetail)
- ✅ **Trip canônico curado**: campo `trips_canonicos` no JSON, gerado por IA + validado manualmente; trips auto-gerados aparecem abaixo dos canônicos marcados como "🤖 auto"

### Decisões finais consolidadas (UI/UX)

| Pergunta | Decisão final |
|----------|---------------|
| Cards no Feed (A) | **5 inicial**, testar e iterar |
| Notificação de Stamp (B) | **Banner rápido de 4 segundos** ao abrir o app |
| Whisper auto pros peers do comboio (C) | **SIM** — broadcast em destaque pro comboio durante uso |
| Trip canônico no JSON (E) | **SIM** — campo `trips_canonicos` no JSON, curados por IA + validação manual |
| ~~Quantas candidatas no Caçador (D)~~ | EM STANDBY |
| ~~Submissão Caçador (D)~~ | EM STANDBY |

---

## 7. Limitações conhecidas pra documentar

1. **Detecção de "completou" tem falsos positivos.** Cara passa de carro / Uber, app pode contar. Aceito porque gamificação local sem prêmio = baixo incentivo pra cheat.
2. **Whisper só funciona com app aberto.** Limitação do PeerJS (igual SOS). Se piloto fechou app, não envia nem recebe.
3. **Caçador depende de OSM** — em estradas com cobertura ruim de tag, heurística falha. Algumas regiões do BR (sertão NE) podem ter resultados pobres.
4. **Trip auto** — `interconexoes_ids` é hoje preenchida de forma inconsistente nas 15 rotas. Vamos precisar revisar pra que os trips auto-gerados façam sentido.

---

## 8. Conexão com outros docs

- `docs/F34-Comboio-Brainstorm.md` — plano do comboio; F34.10 (Replay) é parecido com F35.2 (detecção de conclusão); compartilham infraestrutura
- `prompts/catalog-update-prompt.md` — framework de curadoria; relevante pra D (Caçador) quando você recebe submissões
- `prompts/catalog-validation-checklist.md` — pra validar novas rotas curadas a partir de submissões

---

_Documento gerado em 2026-05-26. Revisar antes de começar implementação. Pontos abertos na seção 6 precisam de decisão._
