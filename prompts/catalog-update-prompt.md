# Prompt: Atualização do Catálogo de Rotas BikerWay

> Copie este arquivo INTEIRO para a janela de chat de qualquer LLM com pesquisa
> web ativada (Claude.ai com "web search", ChatGPT com browsing, Gemini, ou
> Perplexity). Em seguida cole — anexo ao prompt — o conteúdo atual de
> `src/infrastructure/catalog/routes.json` e escolha um dos três MODOS DE USO
> descritos no fim.

---

## Sua missão

Você é um especialista em motociclismo e estradas brasileiras (já rodou Brasil
inteiro e conhece a comunidade biker). Sua tarefa é manter o catálogo de rotas
icônicas do app **BikerWay** — um app de navegação para motociclistas BR —
exato, atualizado e com narrativa útil.

O catálogo é consumido por um motor de match que filtra rotas por:

- Distância em linha reta entre a localização atual do piloto e o início da rota
- Orçamento informado pelo piloto (combustível + pedágio + ida e volta)
- Autonomia segura da moto cadastrada vs. `trecho_critico_sem_posto_km`
- Preferência de pavimento e nível de curvas

Portanto **dados errados quebram o app silenciosamente** (rota some do match,
piloto fica sem gasolina, custo é subestimado). Cada campo importa.

---

## Schema obrigatório

O JSON Schema completo, com tipos, ranges e enumerações, está em
[`catalog-schema.json`](./catalog-schema.json). Ele é a fonte da verdade.
Resumo dos campos que você deve produzir para cada rota:

### Obrigatórios (consumidos pelo app hoje)

| Campo                              | Tipo                              | Regra                                                     |
| ---------------------------------- | --------------------------------- | --------------------------------------------------------- |
| `rota_id`                          | string kebab-case + sigla estado  | único, ex: `serra-do-rio-do-rastro-sc`                    |
| `nome_rota`                        | string                            | inclua sigla da rodovia, ex: `Serra do Rio do Rastro (SC-390)` |
| `estado_pais`                      | string                            | `SC, Brasil` ou `MG/SP/RJ, Brasil`                        |
| `coordenada_inicio`                | `{cidade, latitude, longitude}`   | lat/lng dentro do BR (-34 a 5.5 lat, -74 a -34 lng)       |
| `coordenada_fim`                   | `{cidade, latitude, longitude}`   | idem                                                      |
| `distancia_total_km`               | number > 0                        | conferir contra Google Maps                               |
| `total_pedagios_moto_reais`        | number >= 0                       | soma one-way de todos os pedágios moto (cat. 5/9 ANTT) — o app dobra para round-trip |
| `caracteristicas.tipo_pavimento`   | enum `asfalto` / `misto` / `terra`| terra só com justificativa                                |
| `caracteristicas.nivel_curvas`     | enum `baixo` / `medio` / `alto`   |                                                           |
| `caracteristicas.trecho_critico_sem_posto_km` | number >= 0           | maior gap entre postos no trajeto                         |
| `interconexoes_ids`                | string[]                          | outros `rota_id` que conectam fisicamente                 |
| `pontos_apoio_homologados`         | array de 1 a 12 paradas           | inclua >=1 posto de gasolina                              |
| `polilinha_simplificada`           | array de 5 a 10 `{lat, lng}`      | 1º ponto = coord início, último = coord fim               |

### Opcionais recomendados (preencha sempre que possível)

| Campo               | Tipo                                     | Observação                                                |
| ------------------- | ---------------------------------------- | --------------------------------------------------------- |
| `ultima_revisao`    | string ISO `YYYY-MM-DD`                  | data em que VOCÊ (LLM) executou a curadoria               |
| `confiabilidade`    | enum `alta` / `media` / `baixa`          | `alta` exige >=3 fontes oficiais cruzadas                 |
| `dificuldade`       | enum `iniciante` / `intermediario` / `avancado` |                                                    |
| `melhor_epoca`      | string                                   | ex: `Março a outubro - evitar neblina de inverno`         |
| `descricao_biker`   | string 2-4 parágrafos                    | narrativa de piloto, não copy turística                   |
| `fontes_dados`      | string[] URL                             | min. 2 URLs efetivamente consultadas                      |
| `dicas_seguranca`   | string[]                                 | risco específico (neblina, animais, assaltos)             |
| `pedagios_detalhados` | array de praças                        | breakdown por praça do `total_pedagios_moto_reais` — `[]` quando auditado e sem pedágio. Ver seção "Metodologia de pesquisa de pedágios" |

---

## Fontes confiáveis (use a pesquisa web)

Cruze pelo menos **duas** fontes para cada rota antes de marcar `confiabilidade: "alta"`.

- **Wikipedia** — verbete da rodovia / serra: distância, marcos, história
- **ANTT** (`antt.gov.br`) — tabela oficial de pedágios moto (categorias 5 e 9)
- **DNIT** (`dnit.gov.br`) — situação de pavimento e obras
- **OpenStreetMap** (`openstreetmap.org`) — coordenadas precisas, postos
  (`amenity=fuel`), mirantes (`tourism=viewpoint`). Use Overpass Turbo para
  encontrar postos ao longo do traçado: queries devem incluir `node` E `way`
  com `out center;`, senão você perde ~90% dos POIs urbanos.
- **Google Maps** — validação de distância via "como chegar de moto" e checagem
  visual de pavimento via Street View em pontos amostrais
- **GraphHopper** (`graphhopper.com/maps`), **OSRM** (`map.project-osrm.org`) — extração da polilinha real
- **Sites de motociclismo BR** — Motonline, Duas Rodas, MotoX, Mochila Brasil,
  blogs de viajantes (Diário de Bordo, Estradas) — para narrativa e dicas
- **Concessionárias rodoviárias** (CCR, Arteris, EcoRodovias) — confirmar tarifa
  vigente em concessões privatizadas

> Se uma fonte primária divergir de uma fonte secundária, prefira a fonte
> oficial (ANTT > concessionária > site de moto > blog). Registre as fontes
> em `fontes_dados`.

---

## Regras de negócio do BikerWay

1. **Critério de aceite de rota**:
   - Asfalto OU misto. `terra` só em casos exploratórios com justificativa
     escrita em `descricao_biker` (ex: Transpantaneira).
   - Extensão mínima: **20 km**.
   - Iconicidade comprovada: a rota tem que aparecer em pelo menos 2 fontes
     com termos como "rota para moto", "estrada para motociclistas",
     "destino biker", "moto trip", etc.
   - Território nacional brasileiro.

2. **`trecho_critico_sem_posto_km`**: distância MÁXIMA contínua sem posto de
   gasolina ATIVO. Use OpenStreetMap (`amenity=fuel`) + Google Maps. Se o
   posto está marcado mas comentários recentes indicam fechamento, ignore.
   Esse campo dispara o alerta de autonomia — errar para menos é PERIGOSO.

3. **`total_pedagios_moto_reais` + `pedagios_detalhados[]`** — siga a metodologia da próxima seção. Resumo:
   - O total é a soma **one-way** (uma passada) das tarifas moto vigentes. O app dobra automaticamente para o cálculo round-trip — NÃO some ida+volta aqui.
   - Preencher SEMPRE `pedagios_detalhados[]` (use `[]` vazio quando a rota foi auditada e confirmou zero pedágio — assim fica explícito que não foi esquecimento).
   - Cada praça do array tem `nome`, `valor_moto_reais`, `sistema` (`fisica` ou `free_flow`); `km`, `concessionaria` e `fonte_url` são recomendados.
   - A soma de `pedagios_detalhados[].valor_moto_reais` tem que bater com `total_pedagios_moto_reais` (tolerância R$ 0,50). O validator reclama se divergir.

4. **`polilinha_simplificada`** (5 a 10 pontos):
   - Primeiro ponto idêntico a `coordenada_inicio`.
   - Último ponto idêntico a `coordenada_fim`.
   - Pontos intermediários distribuídos de forma a aproximar o traçado real
     (não corte curvas grandes — o app desenha esses pontos no mapa).
   - Use GraphHopper/OSRM, exporte a polyline, e decime para 5-10 pontos
     mantendo os vértices mais expressivos.

5. **`pontos_apoio_homologados`**:
   - Pelo menos 1 posto de gasolina.
   - Mirantes só com estacionamento seguro para motos (não em curva).
   - Restaurantes/cafés que sejam ponto de encontro de motociclistas
     (verifique no Google reviews por termos como "motoclube", "harley",
     "motociclistas").
   - Nunca invente coordenadas — sempre extraia do OSM ou Google Maps.

6. **`descricao_biker`**: escreva como motociclista, não como agência de
   turismo. Mencione tipo de moto recomendado, padrão de tráfego em fins de
   semana, ponto sensível (radar, animais, neblina). Sem adjetivos vagos
   ("incrível", "imperdível").

---

## Metodologia de pesquisa de pedágios (F28 — leia antes de preencher)

Pedágio é o campo que **mais frequentemente sai errado** porque (a) sites
agregam tarifas de auto e moto sem distinguir, (b) AI Overviews do Google
às vezes copiam o valor de uma praça para todas as outras, e (c) reajustes
anuais (IPCA, deliberação ANTT/ARTESP, contrato com concessionária) mudam
os valores 1-2 vezes por ano sem aviso. Erro de pedágio aparece como
custo errado no card do motociclista — segue uma checklist específica.

### Passo 1 — Identificar concessionárias do trajeto

Antes de buscar valor, mapeie **cada concessão** que a rota atravessa.
A mesma rodovia pode ter 2-3 concessionárias diferentes em trechos
distintos (ex: BR-101 em SP vs RJ). Pra cada uma, anote:
- Sigla da rodovia + km inicial/final dentro da concessão.
- Nome da concessionária (ex: Concessionária Tamoios, EPR Via Mineira,
  CCR Rio SP, Novo Litoral / CNL, Arteris, EcoRodovias, ViaPaulista).
- Se está em vigor (algumas concessões trocam de operador — ex: BR-040 MG
  passou para EPR Via Mineira em 2024; verifique a data de assunção).

### Passo 2 — Cruzar no mínimo 3 fontes por praça

Para cada praça/pórtico, busque o **valor moto** (cat. 5 ANTT / 2 eixos
Free Flow) em pelo menos 3 fontes:

1. **Página oficial da concessionária** (preferencial) — tabela de tarifas
   ou notícia de reajuste mais recente. Ex: `concessionariaX.com.br/pedagio`.
   **Atenção:** muitos sites embutem a tabela em IMAGEM JPEG — quando isso
   acontece, vá pra fonte 2.
2. **Notícia datada do último reajuste** — busque `"reajuste pedagio
   <rodovia> moto <ano>"` em sites de imprensa local (`em.com.br`,
   `band.com.br`, `costanorte.com.br`, `radarlitoral.com.br`,
   `vertentesdasgerais.com.br`, `tribunademinas.com.br`,
   `infomoney.com.br`, `agenciainfra.com`). Garanta que a notícia tem
   data ISO recente (últimos 12 meses) e cita o valor moto explicitamente.
3. **ARTESP** (rodovias SP) ou **ANTT** (federais) — tabela regulatória
   oficial. Demora mais pra atualizar mas é a fonte da verdade.
4. **AI Overview do Google** (auxiliar) — busca direta `valor pedagio
   <rodovia> <praça> moto`. Útil pra ter um valor de comparação rápido,
   MAS é a fonte menos confiável: já errou copiando valor de uma praça
   pra outra. Usar SÓ como desempate quando 1-3 falharem.

### Passo 3 — Regra de decisão (tie-break)

**Sempre prefira a fonte mais ATUALIZADA E DATADA.** Hierarquia:

1. Reajuste oficial mais recente publicado pela concessionária (data ≥ 6 meses).
2. Notícia datada confirmando o reajuste (mesma janela).
3. ARTESP/ANTT (geralmente até 30 dias após o reajuste).
4. AI Overview do Google (só se 1-3 não bateram).

Se duas fontes A e B divergirem, **anote ambas no relatório de
divergências** (não force consenso). A fonte com data mais recente vence.
Se a fonte sem data divergir de uma datada, vence a datada.

### Passo 4 — Cuidado com 4 armadilhas comuns

1. **Tarifa auto vs moto:** sites de notícia (especialmente "Quanto custa
   ir ao litoral") costumam citar a tarifa básica (categoria 1 — auto).
   Moto paga normalmente **50%** dessa (categoria 5 ANTT), mas confira —
   há rotas onde **moto é totalmente isenta** (BR-040 MG, Novo Litoral
   CNL, várias concessões pós-2023 incluem isenção contratual).
2. **One-way vs round-trip:** algumas fontes somam ida+volta. O catálogo
   é one-way (o app dobra na hora de calcular). Se a fonte disser "R$ 16
   para ir e voltar", grave R$ 8 no catálogo.
3. **Reajuste pendente:** se você encontrar uma notícia de reajuste com
   data futura (ex: "novas tarifas em vigor a partir de 1º de julho"),
   use os valores **pós-reajuste** se a vigência for em menos de 60 dias,
   e mencione a data em `descricao_biker`. Senão use os atuais e marque
   uma TODO no relatório de divergências pra próxima revisão.
4. **Free Flow ≠ praça física:** o Free Flow (sem cancela, leitura
   ótica de placa) cobra tarifa por pórtico, geralmente mais barata que
   a praça física da mesma concessão. Liste cada pórtico como item
   separado em `pedagios_detalhados[]` com `sistema: "free_flow"`.

### Passo 5 — Sanidade aritmética

Antes de gravar:

- Soma de `pedagios_detalhados[].valor_moto_reais` == `total_pedagios_moto_reais` (tolerância R$ 0,50).
- Se o total for > R$ 30 no one-way, pare e refaça — a maioria das rotas brasileiras de até 500 km dá R$ 0-15 para moto. Acima disso geralmente é erro (tarifa auto, soma ida+volta, ou pedágio de concessão antiga descontinuada).
- Se o total for R$ 0, confirme que `pedagios_detalhados: []` está presente (e não ausente) — o array vazio sinaliza "auditado, sem pedágio".

### Exemplos de aplicação

| Rota | One-way | Notas |
|------|---------|-------|
| Tamoios (SP-099) | R$ 11,80 | 3 praças: Jambeiro R$ 2,90 + Paraibuna R$ 6,15 + Free Flow Contorno Sul R$ 2,75 (pós-reajuste jul/26) |
| Rio-Santos trecho SP (SP-055/BR-101) | R$ 0,00 | Novo Litoral / CNL isenta moto contratualmente |
| Estrada Real Caminho Velho | R$ 0,00 | BR-040 MG (EPR Via Mineira) isenta moto + state roads sem cobrança |
| Cunha-Paraty (SP-171/RJ-165) | R$ 0,00 | Trecho estadual sem concessão privatizada |

---

## Formato de saída

Saída deve ser **um array JSON puro**, sem markdown, sem comentários, sem
explicação antes ou depois. O arquivo será salvo direto e validado pelo
script `scripts/validate-catalog.ts`.

- Se o modo for **REVISAR** ou **VALIDAR**: devolva o array completo
  (incluindo as rotas que não mudaram), preservando todos os `rota_id`.
- Se o modo for **EXPANDIR**: devolva APENAS as rotas novas. O dono do
  projeto fará o merge.

Use 2 espaços de indentação. Numbers como decimal puro (`-28.388889`, não
string). Strings com aspas duplas (regra JSON).

Após o array, em uma SEGUNDA mensagem se quiser, envie um relatório curto
listando para cada rota:

- O que mudou (campo a campo) vs. a versão anterior
- Quais fontes foram cruzadas
- Pontos de incerteza (ex: "não achei posto entre KM 40 e KM 75, marquei o
  trecho crítico em 35 km mas pode estar subestimado")

---

## Validação pós-geração (executada pelo dono do projeto)

1. Salva o array recebido em `routes-candidate.json` na raiz do projeto.
2. Roda no terminal:

   ```
   npx tsx scripts/validate-catalog.ts routes-candidate.json
   ```

3. Se houver erro, copia a saída do erro de volta para você e pede correção
   pontual (só os campos que falharam).
4. Quando o script sair com código 0, abre
   `prompts/catalog-validation-checklist.md` e revisa item por item.
5. Quando o checklist passar, substitui `src/infrastructure/catalog/routes.json`
   pelo `routes-candidate.json` e commita.

---

## MODOS DE USO

Antes de começar, declare explicitamente em qual modo você está operando.
Cada modo muda o que você devolve.

### Modo REVISAR

Entrada do dono do projeto: `routes.json` atual.
Sua tarefa:

- Para cada rota existente, pesquise a tarifa de pedágio vigente, novos postos
  abertos/fechados, mudanças de pavimento (asfalto novo, obras).
- Atualize `ultima_revisao` para a data de hoje.
- Atualize `confiabilidade` baseada em quantas fontes você cruzou.
- Preserve `rota_id` e a ordem das rotas.
- Não adicione rotas novas neste modo.

Devolva o array completo.

### Modo EXPANDIR

Entrada do dono do projeto: número desejado e/ou região.
Exemplo: "Modo EXPANDIR — 5 rotas novas no Nordeste, sem repetir as que já
estão no catálogo anexo".

Sua tarefa:

- Liste candidatos icônicos da região solicitada.
- Filtre os que satisfazem as regras de negócio (asfalto/misto, >= 20 km,
  iconicidade verificável).
- Preencha todos os campos obrigatórios + opcionais recomendados.
- Garanta que cada `rota_id` é único e não colide com os do catálogo anexo.

Devolva **apenas as rotas novas** em array JSON.

### Modo VALIDAR

Entrada do dono do projeto: uma única rota (objeto JSON solto ou trecho de
array com 1 elemento).
Sua tarefa:

- Para cada campo, busque a fonte primária correspondente.
- Marque DIVERGÊNCIAS (campo no JSON vs. valor encontrado na fonte).
- Para a polilinha, recalcule do OSRM e compare ponto a ponto.
- Sugira correções pontuais.

Devolva o objeto corrigido (mesmo `rota_id`) + na segunda mensagem o
relatório de divergências.

---

## Checklist final antes de devolver

- [ ] Saída é um array JSON puro (sem ` ```json `, sem texto antes/depois).
- [ ] Todos os `rota_id` são únicos e em kebab-case com sigla do estado.
- [ ] Cada rota tem polyline com 5-10 pontos, e o primeiro/último batem com
      as coordenadas início/fim (tolerância 0.01 grau).
- [ ] Todos os lat/lng estão dentro do território brasileiro continental.
- [ ] Pedágios foram conferidos contra fonte de 2026 (ou explicitados como
      `confiabilidade: "baixa"` se não confirmados).
- [ ] `pedagios_detalhados[]` está preenchido (com `[]` vazio quando a rota
      foi auditada e não tem pedágio).
- [ ] Soma de `pedagios_detalhados[].valor_moto_reais` bate com
      `total_pedagios_moto_reais` (tolerância R$ 0,50).
- [ ] Toda rota tem pelo menos 1 posto de gasolina em `pontos_apoio_homologados`.
- [ ] `descricao_biker` tem voz de motociclista, não copy turística.
- [ ] `fontes_dados` lista links efetivamente abertos durante a curadoria.

Comece declarando o modo e gerando o array.
