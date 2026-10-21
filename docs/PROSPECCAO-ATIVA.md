# Prospecção ativa por IA — estrutura

Documento de desenho. Nada aqui está implementado ainda.

## O problema que motiva

Hoje a Aerion tem três coisas que mandam WhatsApp, e elas não se conhecem:

| Remetente | Onde vive | Respeita o quê |
|---|---|---|
| Campanha de disparo | n8n / disparo-wpp | nada do que mandamos (medido) |
| Follow-up da IA | `backend/aiFollowups.js` | gap 5min, 12/h, 40/dia por número |
| Vendedor humano | Chatwoot | bom senso |

Isso já causou dano real: em 24/09 o número `comercial_aerion` fez **71 envios num dia,
com 24 numa única hora**, somando campanha + humano. O teto de 30/dia que existe no
código governa apenas a campanha.

E o n8n ignora o que mandamos: a campanha #111 foi enviada com `minInterval: 120` e
`sendPeriod: comercial`, e ele disparou **18 mensagens em 12 minutos, até 18h25**.
Também descarta a fila sozinho com `timeout_7_dias` — a #108 perdeu 33 de 46 assim.

Somar um terceiro remetente (prospecção) a esse arranjo é garantir bloqueio.

## Decisão central: fila única de saída

**Nenhuma feature manda WhatsApp direto. Todas enfileiram.**

```
  disparo em massa  ─┐
  follow-up da IA   ─┼──►  outbound_queue  ──►  despachante  ──►  Evolution
  prospecção ativa  ─┘      (prioridade,          (1 msg por
  (qualquer coisa nova)      agendamento)          vez, por número)
```

O despachante é o único lugar que fala com a Evolution, e o único que decide
*quando*. Ele aplica, por número: intervalo mínimo entre mensagens, teto por hora,
teto por dia, janela comercial (9h–18h, almoço 12h–13h, seg–sex, feriado nacional),
e a conta já existente de `carga_inbox` — que soma campanha, humano e IA na mesma régua.

Isso resolve de uma vez o conflito entre remetentes, o pacing que o n8n ignora e o
`timeout_7_dias`.

**Prioridade na fila** (quando dois itens competem pelo mesmo número):
1. `resposta` — alguém respondeu e espera retorno
2. `followup` — relacionamento em andamento
3. `campanha` — disparo em massa
4. `prospeccao` — contato frio

Já existe o molde no repo: `watchlist_notifications` + `processWatchlistNotifications`
(fila `pending/sent/failed`, `attempts`, índice único para dedupe, worker por cron).
A fila nova segue esse padrão, com pacing e prioridade em cima.

## O funil da prospecção

```
Radar Trends          Busca RFB           Validação            Abordagem
perfil sugerido  ──►  empresas       ──►  o telefone      ──►  fila (prioridade
(filters: cnae,       candidatas          é mesmo dela?         mais baixa)
 uf, porte...)                            └─ não → Google
                                              scraping
```

### 1. Origem: perfis do Radar Trends

`suggestion.filters` já tem a forma certa (`cnae[]`, `uf`, `porte`, `capital_min/max`,
`abertura_min/max_anos`, `only_matriz`, `situacao`) — é o mesmo objeto que
`searchCompaniesFromTrendProfile` (`frontend/src/App.js:9163`) injeta na busca.
O worker consome isso direto, sem formato novo.

### 2. Busca: base RFB

Reusa `/api/rfb/search`. Filtra o que já existe na base por CNPJ antes de gastar
qualquer coisa com validação.

### 3. Validação do telefone — a parte crítica

**É aqui que mora o risco do projeto.** O telefone da Receita é o que a empresa
declarou na abertura: muitas vezes é do contador, de um sócio que saiu, ou de uma linha
desativada. Abordar o número errado em nome da Aerion é pior que não abordar.

Medido na base atual: **23% é fixo, 40% está em formato antigo de 8 dígitos**. E
atenção — fixo **não** é descartável: `551136466600` é fixo e tem WhatsApp Business.
Quem decide se o número existe é a Evolution (`verificarNumerosWhatsapp`), nunca
heurística de formato.

Mas "existe no WhatsApp" ≠ "é da empresa". Cadeia proposta, parando no primeiro sim:

1. **Existe no WhatsApp?** `verificarNumerosWhatsapp`. Não existe → vai para o passo 4.
2. **O nome do perfil bate com a empresa?** A Evolution devolve `name` no retorno de
   verificação. Comparar com razão social e nome fantasia (normalizado, sem sufixo
   jurídico — `nomeCurtoEmpresa` já faz isso). Bate → validado.
3. **Confirmação na abertura.** Quando o nome não confirma nem nega, a primeira
   mensagem pergunta: *"Falo com alguém da [empresa curta]?"*. Barato, honesto, e a
   resposta valida ou descarta. **É a opção que eu recomendo** para o primeiro corte —
   sem scraping, sem risco, e gera o dado de validação.
4. **Google + scraping** (só quando 1 falha). Mesma query do botão que já existe
   (`googleSearchUrlForCompany`, `App.js:23916`): nome fantasia + cidade + UF.
   Extrair telefones do resultado, validar na Evolution, e **só atualizar o cadastro se
   o novo número existir e o nome do perfil bater**. Nunca sobrescrever cegamente.

> Ponto a decidir: scraping de resultado do Google quebra com mudança de layout e é
> bloqueável por captcha. Antes de construir isso, vale verificar se compensa — pela
> cadeia acima, o passo 3 já resolve boa parte sem infraestrutura nova.

### 4. Importação

Reusa `POST /api/leads/import` (`backend/index.js:19320`), que já faz dedupe por CNPJ e
por nome, normaliza telefone e grava os atributos. Entra em `1. Inbox (Novos)` com label
de origem (`prospeccao-ia`), e a conversa nasce atribuída ao responsável padrão
(`atribuirResponsavelPadrao`, já implementado).

### 5. Abordagem

Fundamentada no que funciona na base de vocês, não em suposição. Medido em 21/10 sobre
870 aberturas reais:

| Abordagem | Envios | Resposta |
|---|---|---|
| "Poderia me indicar quem cuida..." | 550 | 19% |
| **"Tenho conversado com empresas de topografia sobre otimizar tempo..."** | 43 | **35%** |

A prova social responde quase o dobro. A abordagem da IA parte dela, combinada com as
técnicas do processo comercial (`Processos-Comerciais-Vendas.md`, base Chris Voss):
pergunta calibrada com "Como"/"O que", labeling, buscar o "não". As mesmas travas do
follow-up valem: nada de preço, nada de despedida, variação obrigatória de texto.

## Fases

**1. Fila única** — tabela, despachante, e migrar o follow-up para ela. Sem feature
nova: só tira os remetentes de cima uns dos outros. É o pré-requisito de tudo.

**2. Campanha na fila** — tirar o ritmo do n8n. Resolve o pacing e o `timeout_7_dias`.

**3. Prospecção** — origem, busca, validação pelos passos 1–3, importação, abordagem.

**4. Scraping** — só se a fase 3 mostrar que o passo 3 não cobre o suficiente.

Cada fase entrega valor sozinha e nasce desligada, com liga/desliga em `ai_settings`
(que sobrevive a deploy) e modo sombra antes de executar.

## O que fica de fora por enquanto

- Enriquecimento pago de dados (Apollo, Lusha): resolveria a validação de telefone
  melhor que scraping, mas é decisão de custo, não técnica.
- Prospecção por e-mail ou LinkedIn: o processo comercial prevê, mas o canal aqui é
  WhatsApp.
