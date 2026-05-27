# 07 - Processo de atualização do catálogo de rotas

Este documento descreve o processo de **curadoria trimestral** do catálogo de
rotas icônicas do BikerWay (`src/infrastructure/catalog/routes.json`),
usando o framework de prompts em `prompts/` e o validador em
`scripts/validate-catalog.ts`. O objetivo é manter os dados confiáveis
(pedágios, postos, pavimento) sem depender de uma sessão específica de LLM —
qualquer LLM com pesquisa web (Claude.ai, ChatGPT, Gemini, Perplexity)
consegue executar a rodada usando os mesmos artefatos.

## Quando atualizar

| Gatilho                                              | Modo                       | Frequência típica         |
| ---------------------------------------------------- | -------------------------- | ------------------------- |
| Revisão programada (pedágios reajustam jan/jul)      | REVISAR (todas as rotas)   | trimestral                |
| Notícia de rota nova ou pedido da comunidade biker   | EXPANDIR (N rotas em UF X) | sob demanda               |
| Usuário reportou dado errado em rota específica      | VALIDAR (1 rota)           | imediato                  |
| Obra/interdição relevante em rota do catálogo        | VALIDAR + atualização      | conforme aparecer         |

## Passo a passo

### 1. Preparar a sessão do LLM

1. Abra `prompts/catalog-update-prompt.md`, selecione tudo e copie.
2. No LLM escolhido (Claude.ai, ChatGPT, Gemini, Perplexity), inicie um chat
   novo com **pesquisa web ativada**.
3. Cole o prompt como primeira mensagem.
4. Em seguida, no mesmo chat, anexe ou cole o conteúdo atual de
   `src/infrastructure/catalog/routes.json` e declare o modo:
   - "Modo REVISAR. Atualize todas as rotas para 2026."
   - "Modo EXPANDIR. Gere 5 rotas novas no Centro-Oeste, sem repetir as do
     anexo."
   - "Modo VALIDAR. Verifique cada campo desta rota: { ... }"

### 2. Salvar a saída

1. Salve o array JSON retornado em `routes-candidate.json` na raiz do projeto
   (este arquivo é descartado depois — não commitar). Em modo EXPANDIR, faça
   o merge manual: pegue o `routes.json` atual, append das rotas novas, salve
   como candidato.
2. Verifique que a saída NÃO tem ` ```json `, comentários ou texto fora do
   array. Se tiver, peça ao LLM para devolver "apenas JSON puro".

### 3. Validar a estrutura

```
npx tsx scripts/validate-catalog.ts routes-candidate.json
```

Comportamento esperado:

- **Exit 0**: shape, ranges e unicidade estão corretos. Avance para o passo 4.
- **Exit 1**: o terminal lista erros agrupados por rota, com `path` e
  mensagem. Copie a lista, volte ao LLM e peça correção pontual ("corrija
  apenas os seguintes campos: ..."). Re-rode até dar exit 0.

### 4. Validar a semântica (humano)

Abra `prompts/catalog-validation-checklist.md` e percorra cada item para
cada rota nova ou alterada. O validador não pega:

- Coordenada que cai no meio do mato em vez da cidade.
- Pedágio com valor antigo (precisa abrir ANTT para conferir).
- Polilinha geometricamente correta mas geograficamente absurda (corta
  serra reto pelo morro).
- Texto em `descricao_biker` com tom de agência de turismo.

Esta etapa é o que justifica a curadoria humana. Não pule.

### 5. Substituir e validar o app

1. Backup: `cp src/infrastructure/catalog/routes.json src/infrastructure/catalog/routes.json.bak` (opcional).
2. Sobrescreva: `mv routes-candidate.json src/infrastructure/catalog/routes.json`.
3. Re-rode o validador no arquivo de produção:
   ```
   npx tsx scripts/validate-catalog.ts
   ```
4. Rode o ciclo padrão de testes:
   ```
   npx tsc --noEmit
   npx jest --colors=false
   ```
5. Em desenvolvimento, abra a tela de catálogo no Expo e role a lista —
   confira que rotas alteradas renderizam sem erro visual.

### 6. Commit

Padrão de mensagem:

```
catalog: revisão trimestral 2026-Q2 (REVISAR)

- atualiza pedágios para tabela ANTT 2026
- adiciona ultima_revisao + confiabilidade em todas as rotas
- corrige trecho_critico em Estrada Real (era 45km, OSM confirma 38km)
- fontes: ANTT, OpenStreetMap, Wikipedia, Motonline
```

ou para expansão:

```
catalog: adiciona 5 rotas no Nordeste (EXPANDIR)

- chapada-diamantina-ba (BR-242)
- transamazonica-trecho-pa (BR-230)
- ...
```

Apague o `.bak` se criou. Não commite o `routes-candidate.json`.

## Critérios de aceite / rejeição da rodada

**Aceitar a rodada se TODOS verdadeiros**:

- Validador estrutural exit 0.
- Checklist humano marcado item a item.
- `npx tsc --noEmit` continua sem erro.
- `npx jest` continua passando no mesmo número de suites.
- Em modo REVISAR, o número total de rotas é o mesmo do arquivo anterior (LLM
  pode ter perdido rotas no caminho — diff visual antes de commitar).
- Em modo EXPANDIR, nenhum `rota_id` novo colide com os existentes.

**Rejeitar e refazer se**:

- LLM devolveu menos rotas que o input em modo REVISAR.
- Mais de 30% das rotas mudaram simultaneamente — provável alucinação,
  separar a rodada em lotes menores.
- `fontes_dados` contém URLs claramente inventadas (verifique abrindo 2-3 ao
  acaso).
- Checklist humano falha em >3 itens — pedir nova rodada ao LLM em vez de
  corrigir manualmente.

## Como reportar problemas pós-deploy

Quando um usuário do app reportar dado errado (ex: posto fechou, pedágio
mudou, pavimento virou terra):

1. Abrir issue no repositório com label `catalog-bug`, citando `rota_id`,
   campo e fonte do usuário.
2. Rodar modo VALIDAR para essa rota específica.
3. Aplicar correção pontual via PR pequeno (não esperar a rodada trimestral).
4. Atualizar `ultima_revisao` apenas dessa rota.

## Backlog de melhorias para o framework

Quando for tocar nesse processo de novo, considere:

- Script auxiliar `scripts/diff-catalog.ts` que mostra mudanças campo a campo
  entre `routes.json` antigo e candidato.
- Cache local de pedágios ANTT em CSV para reduzir alucinação do LLM.
- Templates de issue do GitHub específicos para reportes de catálogo.
- Quando `src/domains/catalog/types.ts` incorporar os campos opcionais
  (`ultima_revisao`, `confiabilidade`, etc), expor esses campos no card da
  tela de resultados.
