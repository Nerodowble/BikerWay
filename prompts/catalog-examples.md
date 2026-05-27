# Exemplos preenchidos do catálogo

Estes dois exemplos mostram o "padrão completo" desejado para a próxima
rodada de curadoria: todos os campos OBRIGATÓRIOS do schema atual MAIS todos
os campos OPCIONAIS recomendados (`ultima_revisao`, `confiabilidade`,
`dificuldade`, `melhor_epoca`, `descricao_biker`, `fontes_dados`,
`dicas_seguranca`).

Use-os como template visual quando pedir uma rodada de REVISAR ou EXPANDIR ao
LLM. Eles são exemplos **didáticos** — `ultima_revisao`, `confiabilidade` e
campos opcionais aqui não refletem ainda o que está em produção em
`src/infrastructure/catalog/routes.json`.

> Observação técnica: o app hoje (`src/domains/catalog/types.ts`) só lê os
> campos obrigatórios. Os opcionais já podem ser gravados — o JSON.parse não
> reclama de campos extras. Em uma próxima migração do tipo, eles serão
> incorporados ao card sem precisar de nova rodada de curadoria.

---

## Exemplo 1 — Serra do Rio do Rastro (SC-390)

```json
{
  "rota_id": "serra-do-rio-do-rastro-sc",
  "nome_rota": "Serra do Rio do Rastro (SC-390)",
  "estado_pais": "SC, Brasil",
  "coordenada_inicio": {
    "cidade": "Lauro Müller",
    "latitude": -28.388889,
    "longitude": -49.395833
  },
  "coordenada_fim": {
    "cidade": "Bom Jardim da Serra",
    "latitude": -28.339722,
    "longitude": -49.625833
  },
  "distancia_total_km": 32,
  "total_pedagios_moto_reais": 0.00,
  "caracteristicas": {
    "tipo_pavimento": "asfalto",
    "nivel_curvas": "alto",
    "trecho_critico_sem_posto_km": 25
  },
  "interconexoes_ids": ["serra-do-corvo-branco-sc", "br-101-sc"],
  "pontos_apoio_homologados": [
    {
      "tipo": "mirante",
      "nome": "Mirante da Serra do Rio do Rastro",
      "latitude": -28.391944,
      "longitude": -49.560278,
      "descricao_biker": "Mirante icônico no topo da serra com vista panorâmica das curvas em S, ponto de parada obrigatório com estacionamento amplo para motos."
    },
    {
      "tipo": "posto_gasolina",
      "nome": "Posto Lauro Müller (entrada da serra)",
      "latitude": -28.391667,
      "longitude": -49.398889,
      "descricao_biker": "Último posto antes da subida da serra, fundamental abastecer pois não há postos no trecho serrano."
    },
    {
      "tipo": "restaurante",
      "nome": "Restaurante do Alemão (Bom Jardim da Serra)",
      "latitude": -28.342222,
      "longitude": -49.628333,
      "descricao_biker": "Tradicional entre motociclistas, refeições quentes e local de encontro pós-descida da serra."
    },
    {
      "tipo": "mirante",
      "nome": "Mirante Curva do S",
      "latitude": -28.385000,
      "longitude": -49.530000,
      "descricao_biker": "Vista da famosa Curva do S, paisagem panorâmica e parada rápida para fotos."
    }
  ],
  "polilinha_simplificada": [
    {"lat": -28.388889, "lng": -49.395833},
    {"lat": -28.391944, "lng": -49.460000},
    {"lat": -28.391944, "lng": -49.560278},
    {"lat": -28.370000, "lng": -49.600000},
    {"lat": -28.339722, "lng": -49.625833}
  ],
  "ultima_revisao": "2026-05-22",
  "confiabilidade": "alta",
  "dificuldade": "intermediario",
  "melhor_epoca": "Março a outubro. Evitar junho a agosto: neblina densa pela manhã e geadas pontuais no topo da serra que tornam o asfalto escorregadio.",
  "descricao_biker": "A Serra do Rio do Rastro é o trecho mais famoso da SC-390 e referência obrigatória para qualquer biker do Sul. São 32 km de asfalto novo (recapeado em 2024) com curvas em S espelhadas que sobem 600 m de elevação em poucos quilômetros — o famoso 'caracol' visto do mirante. Pista boa, sinalização razoável e tráfego pesado de turistas aos fins de semana, especialmente nas manhãs de sábado e tardes de domingo. Ideal para naked e sport-touring; com touring grande exige atenção redobrada nas ferraduras. Abasteça em Lauro Müller antes de subir — entre a base e Bom Jardim da Serra são 25 km sem nenhum posto.",
  "fontes_dados": [
    "https://pt.wikipedia.org/wiki/Serra_do_Rio_do_Rastro",
    "https://www.openstreetmap.org/relation/-",
    "https://www.deinfra.sc.gov.br/",
    "https://motonline.com.br/estradas/serra-do-rio-do-rastro"
  ],
  "dicas_seguranca": [
    "Neblina densa frequente entre maio e setembro entre o mirante e Bom Jardim da Serra — reduza velocidade e ligue piscas.",
    "Tráfego intenso de turistas aos fins de semana: evite ultrapassagens nas curvas cegas, especialmente na subida.",
    "Sem cobertura de celular Vivo/Tim entre KM 8 e KM 22 da subida.",
    "Posto de Lauro Müller só atende 24h em dias úteis; aos domingos pode fechar à noite."
  ]
}
```

---

## Exemplo 2 — Rota Romântica (RS-235)

```json
{
  "rota_id": "rota-romantica-rs",
  "nome_rota": "Rota Romântica (RS-235)",
  "estado_pais": "RS, Brasil",
  "coordenada_inicio": {
    "cidade": "São Leopoldo",
    "latitude": -29.760278,
    "longitude": -51.147222
  },
  "coordenada_fim": {
    "cidade": "São Francisco de Paula",
    "latitude": -29.448333,
    "longitude": -50.583611
  },
  "distancia_total_km": 184,
  "total_pedagios_moto_reais": 0.00,
  "caracteristicas": {
    "tipo_pavimento": "asfalto",
    "nivel_curvas": "medio",
    "trecho_critico_sem_posto_km": 18
  },
  "interconexoes_ids": ["rota-do-sol-rs", "serra-gaucha-rs"],
  "pontos_apoio_homologados": [
    {
      "tipo": "restaurante",
      "nome": "Café Colonial Bela Vista (Gramado)",
      "latitude": -29.379722,
      "longitude": -50.876111,
      "descricao_biker": "Café colonial farto, estacionamento amplo e parada clássica para grupos de motociclistas na serra."
    },
    {
      "tipo": "mirante",
      "nome": "Mirante Vale do Quilombo (Gramado)",
      "latitude": -29.355833,
      "longitude": -50.890278,
      "descricao_biker": "Vista panorâmica do Vale do Quilombo, parada cênica gratuita com estacionamento."
    },
    {
      "tipo": "posto_gasolina",
      "nome": "Posto Ipiranga Nova Petrópolis",
      "latitude": -29.376111,
      "longitude": -51.116389,
      "descricao_biker": "Posto bem localizado no meio da rota, conveniência e área coberta para motos."
    },
    {
      "tipo": "restaurante",
      "nome": "Restaurante Cantina Pastasciutta (Canela)",
      "latitude": -29.365278,
      "longitude": -50.811944,
      "descricao_biker": "Comida italiana farta, ambiente acolhedor e bom estacionamento para motos."
    },
    {
      "tipo": "mirante",
      "nome": "Mirante Cascata do Caracol (Canela)",
      "latitude": -29.290833,
      "longitude": -50.798889,
      "descricao_biker": "Vista da cascata de 131m, parque com estacionamento seguro e estrutura turística."
    }
  ],
  "polilinha_simplificada": [
    {"lat": -29.760278, "lng": -51.147222},
    {"lat": -29.690000, "lng": -51.130000},
    {"lat": -29.376111, "lng": -51.116389},
    {"lat": -29.379722, "lng": -50.876111},
    {"lat": -29.365278, "lng": -50.811944},
    {"lat": -29.448333, "lng": -50.583611}
  ],
  "ultima_revisao": "2026-05-22",
  "confiabilidade": "alta",
  "dificuldade": "iniciante",
  "melhor_epoca": "Setembro a abril. Inverno (junho a agosto) traz neblina forte na serra de Gramado/Canela e madrugadas próximas de zero — evitar para iniciantes.",
  "descricao_biker": "A Rota Romântica conecta a região metropolitana de Porto Alegre à Serra Gaúcha pela RS-235, passando por colônias alemãs e italianas (Nova Petrópolis, Gramado, Canela) antes de subir o último trecho até São Francisco de Paula. São 184 km de asfalto bem conservado, com curvas suaves e elevação progressiva — ótima para iniciantes ganharem confiança em serra sem o terror das ferraduras do Rio do Rastro. Tráfego turístico pesado em alta temporada e em todo o mês de julho (festival de Gramado). Pontos de apoio sobrando: postos, cafés coloniais e mirantes a cada 15 a 25 km. Combine com a Rota do Sol (RS-389) para um circuito completo Serra-Litoral.",
  "fontes_dados": [
    "https://pt.wikipedia.org/wiki/RS-235",
    "https://www.rotaromantica.com.br/",
    "https://www.openstreetmap.org/",
    "https://duasrodas.com.br/estradas/rota-romantica-rs"
  ],
  "dicas_seguranca": [
    "Neblina densa nas manhãs de inverno entre Nova Petrópolis e Gramado — atrasar a saída até o meio da manhã ajuda.",
    "Trânsito turístico pesado em julho (Festival de Cinema de Gramado): contar com lentidão no trecho urbano de Gramado e Canela.",
    "Atenção a animais soltos no trecho final (Canela → São Francisco de Paula), especialmente ao entardecer.",
    "Postos abundantes mas evite deixar o tanque baixar de meio antes de Nova Petrópolis aos domingos à noite."
  ]
}
```
