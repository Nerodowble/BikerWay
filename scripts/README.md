# scripts/

Scripts utilitários do BikerWay. Nada aqui roda em produção — são ferramentas
de manutenção executadas localmente via `npx tsx`.

| Script                  | Comando                                          | Uso                                                                       |
| ----------------------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| `validate-catalog.ts`   | `npx tsx scripts/validate-catalog.ts [arquivo]`  | Valida shape, ranges e unicidade do `routes.json` do catálogo de rotas.  |

## validate-catalog.ts

Sem argumentos, valida o catálogo de produção em
`src/infrastructure/catalog/routes.json`. Com um argumento, valida qualquer
arquivo de catálogo candidato (ex: saída de um LLM em `routes-candidate.json`).

- Exit code `0`: arquivo válido.
- Exit code `1`: encontrou ao menos um erro de shape/range/unicidade — imprime
  cada erro agrupado por rota, com path e mensagem clara.

Para entender o que cada campo significa e em que regra se baseia a
validação, ver `prompts/catalog-schema.json` e `docs/07-Catalogo-Atualizacao.md`.
