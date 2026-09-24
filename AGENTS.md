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

## Disparo WhatsApp: politica anti-ban (regra obrigatoria)

Os numeros da Aerion sao ativo de negocio: se o WhatsApp bloquear a conta, nao existe
recurso rapido. Medido em 2026-09-24, as tres instancias estavam com **~60% de taxa de
sucesso** (287, 352 e 319 erros acumulados) — o erro dominante era `{"exists": false}`
da Evolution, ou seja, mensagem para numero que nao tem WhatsApp. Bater repetidamente em
numero inexistente e o padrao de quem comprou lista, e um dos sinais mais fortes que o
anti-abuso do WhatsApp usa.

Regras para qualquer feature que mande mensagem:

1. **Verificar antes de enfileirar.** Todo publico passa por `verificarNumerosWhatsapp`
   (`backend/whatsappNumeros.js`), que consulta `POST /chat/whatsappNumbers/{instancia}`
   na Evolution. NAO use heuristica de fixo x celular: `551136466600` e fixo e tem
   WhatsApp Business ativo. Quem decide e a Evolution. A verificacao e fail-open (erro
   dela nao derruba a campanha) mas devolve `verificacao_indisponivel` — a UI tem que
   avisar em vez de fingir que verificou.
2. **Nunca disparar sem preview.** `POST /api/disparo/preview` roda o mesmo calculo do
   envio e mostra a perda por motivo. Campanha cega ja fez 258 leads virarem 1
   destinatario sem ninguem perceber.
3. **Respeitar os tetos.** `DISPARO_MAX_POR_DIA_INSTANCIA` (30/dia por instancia) e
   `minInterval` >= 30s sao piso, nao sugestao. O pacing real roda no n8n.
4. **Variar a mensagem (bloqueante).** `validarVariacaoMensagens`
   (`backend/disparoMensagens.js`) exige 1 variacao a cada
   `DISPARO_CONTATOS_POR_VARIACAO` contatos (default 25), com teto
   `DISPARO_MAX_VARIACOES` (default 6), e o `/api/disparo/send` devolve 400 se o pool
   nao atender. Campanha com midia tambem precisa de arquivos diferentes: o WhatsApp
   compara o hash do anexo. A comparacao normaliza espaco e caixa, entao mudar
   " Oi " para "OI" nao conta como variacao. Campanha pequena (ate o limite) segue
   passando com uma mensagem so. Atencao: `{nome}` NAO deve ser usado como muleta de
   variacao nesta base — tem contato cadastrado como "A.C.COMPCELL COMERCIO DE
   INFORMATICA LTDA" e "~Raul Saroa", e personalizar com isso piora a mensagem.
5. **Cooldown e atendimento vivo.** Nao reenviar para quem recebeu mensagem nossa ha
   pouco (`cooldownDias`) nem interromper conversa com atividade recente
   (`conversaAtivaDias`). Atencao: `conversations.status = 0` NAO significa atendimento
   em curso nesta base (2040 abertas x 3 resolvidas) — sempre combinar com
   `last_activity_at`.
6. **Opt-out e absoluto.** `whatsapp_opt_out`, `opt_out`, `nao_contatar`, `bloqueado`
   valem em qualquer modo, inclusive em selecao manual de contatos.
7. **Fixar o numero do lead.** `fixarNumero` faz o contato receber sempre da instancia da
   ultima conversa dele. Lead que recebe de numeros diferentes a cada campanha reporta.
8. **A IA de follow-up divide o mesmo numero.** `backend/aiFollowups.js` posta pelo
   Chatwoot, que sai pela mesma instancia Evolution do inbox. O teto dela
   (`AI_FOLLOWUP_MAX_PER_DAY`) e um orcamento SEPARADO do disparo — ao subir um, lembrar
   que os dois somam no mesmo numero.

## Deploy

NUNCA subir código local/dev para produção. Prod = branch `main` no GitHub via CI (ghcr).
