# Checklist de Validação Humana do Catálogo

Use depois que `scripts/validate-catalog.ts` saiu com código 0. O script só
garante que o shape e os ranges estão corretos — esta checklist garante que
os **valores semânticos** fazem sentido. Imprima ou copie para o lado e
marque cada item.

> Aplique a checklist em CADA rota nova ou alterada. Não precisa reaplicar
> em rotas que não foram tocadas pela rodada do LLM.

---

## Identidade

- [ ] `rota_id` está em kebab-case e termina com a sigla do estado correto.
- [ ] `rota_id` não colide com nenhum outro `rota_id` do `routes.json` final.
- [ ] `nome_rota` inclui a sigla da rodovia entre parênteses quando aplicável
      (ex: `(SC-390)`, `(BR-101)`).
- [ ] `estado_pais` lista todos os estados que a rota atravessa, em ordem.

## Geografia

- [ ] `coordenada_inicio.cidade` é o ponto de largada usual de motociclistas
      (não um cruzamento aleatório no meio da rodovia).
- [ ] `coordenada_inicio.latitude/longitude` abre num mapa (Google Maps ou
      OSM) e cai EM cima da cidade nomeada — não num bairro distante.
- [ ] Idem para `coordenada_fim`.
- [ ] `distancia_total_km` bate (±5%) com a distância sugerida pelo Google
      Maps via moto entre as duas cidades.

## Polilinha

- [ ] A polilinha tem entre 5 e 10 pontos.
- [ ] O primeiro ponto coincide com `coordenada_inicio` (tolerância 0.01°).
- [ ] O último ponto coincide com `coordenada_fim` (tolerância 0.01°).
- [ ] Plotando os pontos no Google My Maps ou geojson.io, a sequência segue
      o traçado real da rodovia (não pula serra reto pelo morro).
- [ ] Os pontos estão razoavelmente distribuídos (não 4 pontos colados no
      começo e o 5º no fim).

## Pavimento e curvas

- [ ] `tipo_pavimento` confere com pelo menos 3 pontos amostrais em Street
      View ao longo do trajeto.
- [ ] Se `tipo_pavimento = "terra"`, há justificativa explícita em
      `descricao_biker` (rota exploratória/turística especial).
- [ ] `nivel_curvas` confere com a topologia: trecho de serra = `alto`,
      reta longa = `baixo`, ondulado = `medio`.

## Autonomia

- [ ] Caminhou pelo trajeto no OSM/Google e identificou todos os postos
      `amenity=fuel` ATIVOS.
- [ ] `trecho_critico_sem_posto_km` corresponde ao maior gap real observado
      (NÃO subestimar — é o que dispara o alerta de autonomia no app).
- [ ] Postos marcados como "fechado permanentemente" no Google foram
      ignorados.

## Pedágio

- [ ] Cada pedágio do trajeto foi conferido em pelo menos **3 fontes**: site
      oficial da concessionária + notícia datada do último reajuste + ANTT/ARTESP
      (ou AI Overview como desempate).
- [ ] O somatório considera apenas categoria 5 (moto) ou 9 (moto especial).
- [ ] Soma é para **uma passagem completa só (one-way)** — o app dobra no
      round-trip automaticamente.
- [ ] Em rotas multi-estado, todos os pedágios de todos os estados estão
      somados.
- [ ] `pedagios_detalhados[]` está preenchido. Para rota sem pedágio, use
      array vazio `[]` (não omitir o campo — array vazio sinaliza "auditado").
- [ ] Cada item do array tem `nome`, `valor_moto_reais` e `sistema`
      (`fisica` ou `free_flow`); `km`, `concessionaria` e `fonte_url` foram
      preenchidos quando conhecidos.
- [ ] Soma dos `valor_moto_reais` bate com `total_pedagios_moto_reais`
      dentro da tolerância de R$ 0,50.
- [ ] Se houver reajuste em vigor com data futura próxima (< 60 dias), os
      valores gravados são os **pós-reajuste** (o app sobreestima ligeiramente
      até a vigência, em vez de subestimar depois).

## Pontos de apoio

- [ ] Há pelo menos 1 ponto do tipo `posto_gasolina`.
- [ ] Cada ponto tem nome real e coordenadas que abrem no mapa em cima do
      estabelecimento.
- [ ] `descricao_biker` de cada ponto justifica por que importa para um
      motociclista (estacionamento, segurança, conveniência).
- [ ] Mirantes têm estacionamento seguro confirmado (não em curva ou
      acostamento estreito).

## Interconexões

- [ ] Cada `rota_id` em `interconexoes_ids` existe no catálogo OU é um nome
      planejado (registrado no log de expansão).
- [ ] As rotas listadas realmente se cruzam ou compartilham trecho no mundo
      real.

## Narrativa (campos opcionais)

- [ ] `descricao_biker` da rota tem voz de motociclista, sem adjetivos
      vagos ("incrível", "imperdível") e sem copy turística.
- [ ] `melhor_epoca` menciona explicitamente o que evitar (chuva, neblina,
      frio extremo).
- [ ] `dicas_seguranca` cita riscos específicos verificáveis (assalto em
      trecho X, animais em trecho Y, neblina entre KM A e B).
- [ ] `fontes_dados` lista pelo menos 2 URLs que foram realmente abertas
      durante a revisão (não inventadas).
- [ ] `confiabilidade` reflete o número real de fontes cruzadas: `alta` >= 3,
      `media` = 2, `baixa` = 1 ou nenhuma.
- [ ] `ultima_revisao` é a data de hoje (formato `YYYY-MM-DD`).

## Coerência inter-rota

- [ ] Nenhuma rota nova duplica trajeto de uma rota existente (verificar
      pares de coord_inicio/coord_fim).
- [ ] Nenhuma rota nova quebra a regra dos 20 km mínimos.
- [ ] O catálogo final continua tendo cobertura razoável por região (não
      ficou 100% SP/SC).

## Sanidade final

- [ ] Validator (`npx tsx scripts/validate-catalog.ts`) retornou exit code 0.
- [ ] `npx tsc --noEmit` continua sem erros.
- [ ] `npx jest` continua passando.
- [ ] Diff de `routes.json` é razoável (não houve perda silenciosa de rotas
      existentes em modo REVISAR).

---

Se algum item falhar: volte ao LLM com o ponto específico e peça correção
pontual (não regenere o catálogo inteiro).
