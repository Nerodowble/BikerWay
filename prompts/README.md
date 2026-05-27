# prompts/ — Framework de curadoria do catálogo BikerWay

Este diretório contém o **framework reutilizável** para manter
`src/infrastructure/catalog/routes.json` atualizado usando qualquer LLM com
pesquisa web (Claude.ai, ChatGPT, Gemini, Perplexity). A ideia é que o dono
do projeto não dependa do Claude Code ou de uma sessão específica: basta
copiar o prompt central para a janela do LLM escolhido e o framework
direciona a saída para um formato validável.

## Conteúdo

| Arquivo                              | Para quê serve                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `catalog-update-prompt.md`           | Prompt central — cole inteiro no LLM. Define missão, schema, fontes, regras de negócio e 3 modos.    |
| `catalog-schema.json`                | JSON Schema (draft-07) referenciado pelo prompt. Validado pelo `scripts/validate-catalog.ts`.        |
| `catalog-validation-checklist.md`    | Checklist humano para revisar a saída do LLM antes de aplicar (semântica, não shape).                |
| `catalog-examples.md`                | Duas rotas exemplares com TODOS os campos obrigatórios + opcionais recomendados (template visual).   |

## Como usar com cada LLM

| LLM             | Como anexar o `routes.json` atual                                                          |
| --------------- | ------------------------------------------------------------------------------------------ |
| **Claude.ai**   | Ativar Web Search. Cole `catalog-update-prompt.md` e anexe `routes.json` como arquivo.     |
| **ChatGPT**     | Ative Browsing/Search. Cole o prompt e anexe o JSON, ou cole o JSON em bloco de código.    |
| **Gemini**      | Modelo com Google Search ativado. Anexe o JSON via upload de arquivo.                      |
| **Perplexity**  | Modo "Pro" com busca web. Cole o prompt e o JSON inline.                                   |

Em todos os casos, sempre **declare o modo** logo no início (REVISAR /
EXPANDIR / VALIDAR) — está descrito no fim do prompt central.

## Frequência sugerida

- **Trimestral**: rodada de REVISAR completa. Pedágios reajustam em
  janeiro/julho e postos abrem/fecham — três meses é o intervalo confortável.
- **Sob demanda**: EXPANDIR quando aparecer rota nova relevante (notícia,
  pedido da comunidade biker).
- **Sob demanda**: VALIDAR uma rota específica quando um usuário reportar
  dado errado.

## Checklist pré-aplicação (resumo)

1. Salvar saída do LLM em `routes-candidate.json` na raiz.
2. `npx tsx scripts/validate-catalog.ts routes-candidate.json` → exit 0.
3. Abrir `catalog-validation-checklist.md` e marcar item a item.
4. Diff visual contra `src/infrastructure/catalog/routes.json`.
5. Substituir o arquivo, rodar `npx tsc --noEmit && npx jest`.
6. Commit. Detalhes em `docs/07-Catalogo-Atualizacao.md`.
