# Assistente de campanhas — contrato para a interface

Backend Ecommerce; preserve a tela existente. A implementação visual pode usar este contrato sem alterar o Hub nem as rotas do worker.

## Caminho guiado

1. Objetivo e até oito produtos (a recomendação inicial concentra até três disponíveis/elegíveis).
2. Plano inicial por regras, seguido de orientação textual da IA com dados reais. Exibir as duas origens; estado `queued` não significa que a IA já respondeu.
3. Revisar plano, condições e orçamento mensal total com parcelas Google/Meta fixas. Sem verba preenchida, mostrar “Ainda não definido”, nunca zero ou uma verba inventada.
4. Criar briefing em `/marketing/content` (existente), gerar imagem com teto de custo em USD, acompanhar fila, selecionar arquivo e aprovar versão.
5. Vídeo usa por padrão a foto real já publicada no catálogo. Outra opção é animar uma imagem gerada e aprovada do mesmo produto/versão. Mostrar a origem; não aprovar automaticamente um criativo recém-gerado. A duração deve pertencer à rota disponível no Hub.
6. Criar apenas estruturas pausadas depois de revisar ativos, metas de compra, exclusões, elegibilidade e orçamento. Ativação/publicação não fazem parte da geração.

## Rotas

Todas as escritas abaixo exigem o administrador já autenticado do dashboard. Prefixo `/api/ecommerce`.

| Método / rota | Corpo / resposta |
|---|---|
| `GET /marketing` | `assistant.configured`, `assistant.latestPlan`, `assistant.capabilities`, além de `contents`, `jobs` e `history` existentes |
| `PUT /marketing/assistant/connection` | Administrador: `{url,brandId,token,enabled:true}`; testa a marca antes de substituir configuração, cifra a credencial no PostgreSQL e nunca devolve o token. `{enabled:false}` suspende a conexão sem apagar a credencial. Não reapresentar o campo secreto preenchido. |
| `POST /marketing/assistant/capabilities` | Sem corpo; enfileira leitura das rotas reais do Hub |
| `POST /marketing/assistant/plan` | `{goal, productIds?:[], budget?:{total,google,meta}}`; salva plano por regras e enfileira orientação da IA se conectado |
| `POST /marketing/assistant/preview` | Mesma entrada do plano; somente calcula comparação por regras. Não salva, não enfileira IA nem gera arquivos. `scope:'product'|'family'|'sale'`, `family?`, `economics?:{averageOrderValue,contributionMarginPercent,reservePerOrder}` também são aceitos em `/plan`. A seleção completa fica em `strategy.productIds`; até três produtos servem de briefing inicial da IA. |
| `POST /marketing/safety/google` | Enfileira leitura das proteções Google e repete diariamente após a primeira solicitação; nenhuma alteração nas contas. Resultado em `marketing.mediaSafety`. Falhas preservam snapshots e indicam indisponibilidade. |
| `POST /marketing/safety/meta` | Leitura equivalente dos conjuntos, otimização e campos de posicionamento retornados pela Meta. Resultado em `marketing.mediaSafetyMeta`; não certifica controles de conta/listas não retornados. Sem alteração de público ou entrega. |
| `POST /marketing/content/:id/generate` | `{capability:'text-to-image',aspectRatio:'4:5',maximumCostUsd:1,providerId?,modelId?}` |
| `POST /marketing/content/:id/generate` | Vídeo: `{capability:'image-to-video',aspectRatio:'9:16',duration:5,maximumCostUsd:2,sourceContentId?,providerId?,modelId?}`. Sem `sourceContentId`, usa a foto real da loja. Valores são exemplos de contrato, não recomendação de gasto nem garantia de rota. |
| `POST /marketing/content/:id/assets/select` | `{url}`; aceita somente arquivo devolvido pelo Hub para esse rascunho |
| `POST /marketing/content/:id/review` | Aprovação existente. Geração vinculada exige arquivo concluído e selecionado; preço/versão desatualizados impedem aprovação. |

Cada rascunho aceita uma solicitação de geração. Repetir não cobra de novo; para uma nova tentativa intencional, criar nova versão do briefing. Um resultado incerto exige conferir o Hub, nunca repetir silenciosamente.

`assistant.source=encrypted_database` indica persistência que sobrevive ao deploy; variáveis de ambiente são somente fallback. Uma configuração persistida desabilitada também bloqueia o fallback. `contentHub.failure` contém código e orientação sanitizados quando o provedor falha; saldo em atraso não significa que a API do Hub esteja desconectada. Mostrar falha por rota junto do conteúdo, sem declarar geração concluída.

`contents[].data.contentHub`: `requestId`, `jobId`, `status` (`queued`, `running`, `ready_for_review`, `failed`), `assets[]` (`url`,`contentType`,`bytes`), `selectedAsset`, `costUsd`, `generation` e `productVersion`. Custo desconhecido não é zero. Qualidade automática do Hub não aprova o arquivo no CRM.

## Configuração privada

`ECOMMERCE_CONTENT_HUB_URL=https://hub.tenryu.com.br`, `ECOMMERCE_CONTENT_HUB_BRAND=aerion-technologies` (marca já existente), `ECOMMERCE_CONTENT_HUB_TOKEN` somente no backend. Não colocar token no frontend, URLs, relatórios ou logs. A identidade é a integração de servidor existente, separada do OAuth do MCP. No VPS, o endereço público devolve 403 ao servidor; a alternativa permitida é exclusivamente `http://tenryu_hub-api:3000`, na rede Docker privada compartilhada e ainda autenticada por Bearer. Nenhum outro endereço HTTP é permitido.

O Hub oferece `/api/marketing/capabilities/:brandId`, `/advice`, `/generations` e `/requests/:id`, sob o Bearer já existente. Geração usa o mesmo motor MCP/console, com referências de produto obrigatórias, marca e teto por pedido, além do teto geral do Hub. Não usa um gerador concorrente. Pedidos são idempotentes no Hub por 30 dias; o CRM conserva o identificador no conteúdo.

## Regras de produto

- Público sem tamanho/entrega confirmados não ganha verba própria automaticamente. A IA recomenda; não promete vendas ou um “público vencedor” antes de dados reais.
- A otimização de lance/entrega ocorre dentro da parcela aprovada de cada plataforma. O assistente não transfere dinheiro entre Google e Meta nem muda campanhas existentes.
- Comparar gasto, cliques, checkouts, compras pagas e margem; nunca otimizar vendas pela soma de conversões de lead e compra. Sem margem e histórico, CAC/ROAS desejados ficam em aberto.
- Não espalhar verba entre muitas campanhas no início. Referência primária: [Google — práticas para varejistas em Performance Max](https://support.google.com/google-ads/answer/11546049?hl=pt-BR).
- CRM/distribuição permanece separado de visitantes da loja e exige prova de elegibilidade publicitária.

O fluxo completo só deve ser anunciado operacional após CI, deploy dos dois serviços, configuração privada e teste real de retorno de arquivos. A existência destas rotas não comprova que a interface do outro agente já as consome.
