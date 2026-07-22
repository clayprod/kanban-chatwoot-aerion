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

### Proxies rotativos (lanes paralelas)

Com `WEBSHARE_TOKEN` setado, o gate abre LANES paralelas: cada proxy vivo do webshare
(`backend/pncpProxyPool.js`) é uma lane com pacing (gapMs) próprio, e o teto de concorrência é
dinâmico (`getPncpMaxConcurrent` = proxies vivos limitados por `PNCP_PROXY_LANES`, default 6,
+ 1 lane direta; sem pool = 1, comportamento antigo). Requests `interactive`/`sync` usam as
lanes de proxy; `bulk` roda SEMPRE na lane direta (banda limitada no free tier). O proxy da
chamada em curso vive num AsyncLocalStorage (`PNCP_CALL_CONTEXT`) — funções de fetch novas do
PNCP devem usar `pncpFetch`/`fetchJsonWithCurl`, que já leem de lá.

Throttle: em lane de proxy, quarentena só a lane (2+ seguidos → backoff 2–30min); 3+ proxies
distintos com throttle em 90s = limite global → freio global do gate (pausa + gap) como antes.
Falha de TRANSPORTE do proxy (banda do webshare esgotada, CONNECT recusado — ver
`isPncpProxyTransportError`) é outra coisa: quarentena longa do proxy (10min→2h), não conta na
janela de 90s, e o gate REFAZ a request pelo IP direto no mesmo slot — o caller não vê a falha.
Com todos os proxies mortos o sistema degrada sozinho para o modo antigo (1 request, IP direto).
Instrumentação em `proxy_pool` e `lanes_busy` no snapshot do gate. `PNCP_PROXY_ENABLED=0`
desliga tudo. O PNCP NÃO geo-bloqueia a API de consulta (testado 2026-07-22, saídas
GB/US/ES/PT/JP, inclusive 5 requests paralelos por IPs distintos).

Regra do usuário (2026-07-16): as buscas da aba Contratos/Resultados são imediatas
(`interactive`); os jobs da busca de editais podem esperar. A aba Contratos/Resultados é um lugar
de BUSCA de licitações finalizadas (por empresa, descrição, órgão) — independente da busca de
editais; não pré-popular com o acervo dos jobs.

## Deploy

NUNCA subir código local/dev para produção. Prod = branch `main` no GitHub via CI (ghcr).
