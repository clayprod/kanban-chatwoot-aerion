# AGENTS.md — regras para agentes trabalhando neste repositório

## PNCP: todas as chamadas centralizadas no gate (regra obrigatória)

Toda requisição HTTP às APIs do PNCP (`api/search/`, `api/pncp/v1`, `api/consulta/v1`) DEVE passar
por `withPncpGate(fn, { priority })` em `backend/index.js`. Nunca chame o PNCP direto
(fetch/axios/curl) em código novo: chamadas fora do gate concorrem entre si e derrubam o IP —
o PNCP throttla por connection reset, não só 429.

Prioridades do gate (fila única, um request por vez):

- `interactive` — buscas que o usuário está esperando na tela: busca de editais ao vivo, aba
  **Contratos/Resultados**, dossiês, enriquecimento da página visível. Sempre têm precedência.
- `sync` — matcher de watchlists, backfills, syncs agendados.
- `bulk` — deep jobs da busca de editais, PCA, varreduras grandes. **Jobs esperam**: só rodam com
  o gate saudável e >30% do orçamento horário (`PNCP_HOURLY_BUDGET`). É intencional que fiquem
  lentos enquanto alguém usa a UI — resultado imediato para o usuário vem primeiro.

Varredores grandes (deep job, PCA, sync de contratos/atas) são serializados por
`withPncpHeavyJobSlot` — apenas um roda por vez.

Regra do usuário (2026-07-16): as buscas da aba Contratos/Resultados são imediatas
(`interactive`); os jobs da busca de editais podem esperar. A aba Contratos/Resultados é um lugar
de BUSCA de licitações finalizadas (por empresa, descrição, órgão) — independente da busca de
editais; não pré-popular com o acervo dos jobs.

## Deploy

NUNCA subir código local/dev para produção. Prod = branch `main` no GitHub via CI (ghcr).
