# Automação de marketing Aerion

Implementação sobre `fc51ca1`, preservando o conector Merchant, seus relatórios e o feed Google diário entregues pelo outro agente. Não há envio de produtos pela Merchant API e nenhuma campanha existente é atualizada por esta automação.

## Componentes entregues

Em **Ecommerce → Marketing → Automação e catálogos** ficam produtos elegíveis, conciliação Google, importações Meta, públicos, auditoria de URLs, oportunidades de SEO, revisão de conteúdos, planejamento de orçamento, prontidão e histórico. O gráfico de busca orgânica fica na aba SEO; Merchant, mídia paga, GA4 e receita WooCommerce continuam com fontes separadas.

`/api/ecommerce/report` foi preservado e recebe blocos adicionais `marketing`, `visibility`, `diagnostics`, `metaCatalog` e `coverage`. `GET /api/ecommerce/marketing` fornece a operação completa. Leitura exige permissão Ecommerce; mutações exigem administrador. O feed possui autenticação própria e não aceita a sessão do navegador como substituto do token.

O PostgreSQL armazena projeções, trabalhos, revisões, aprovações, recebimentos e históricos. `ecommerce_marketing_memberships` guarda identificadores SHA-256 **cifrados** com AES-GCM; estes não aparecem no relatório. Contextos e emails brutos não são persistidos nessa tabela. Credenciais seguem no armazenamento cifrado existente.

## Produtos e WordPress

O pacote WordPress 1.2.0 contém `aerion-ecommerce-reports.php`, `measurement.php` e **`marketing.php`**. O instalador copia os três, conserva as verificações de divergência e só substitui o arquivo Merchant quando o operador fornece explicitamente seu hash anterior.

Novas rotas WordPress:

| Rota em `/wp-json/aerion-reports/v1/` | Método | Permissão |
| --- | --- | --- |
| `marketing-products` | GET | `aerion_read_reports` |
| `marketing-audience-customers` | GET | `aerion_sync_audiences` |
| `marketing-seo` | POST | `aerion_publish_seo` e emissor SEO auditado |

A cotação executa como usuário anônimo, usa `Aerion_Pricing::quote($product,'consumer',0)` e restaura o usuário em `finally`. A projeção aceita exclusivamente `price_source=aerion_consumer_card_v1`. Não usa o preço REST ou metadados de revenda como fallback. Variações mantêm SKU próprio; o pai variável não é inventado como oferta vendável.

Cadastrar webhooks WooCommerce `product.created`, `product.updated` e `product.deleted`, com o **mesmo segredo e URL** já usados pelos eventos de pedido. A rota também aceita restauração/lixeira. Corpos JSON são verificados por HMAC sobre os bytes originais; entrega repetida não enfileira novamente. O corpo do produto não é confiado como projeção: o worker relê a loja.

O worker executa no cron existente de um minuto, com prioridade para alterações de produto/pagamento, até oito trabalhos por ciclo. Reconcilia o catálogo completo diariamente, mantém leases recuperáveis e revisões para eventos recebidos durante um processamento. Uma falha não substitui um snapshot completo válido. O alvo de cinco minutos depende de fila e disponibilidade normais; importação/aprovação das plataformas tem prazo separado.

SKU duplicado, imagem placeholder, descrição/URL ausente, preço público inválido, marca/identificador ausente ou pré-venda sem data futura impedem exportação. Categorias formam Drones, Kits, Payloads, Acessórios e Outros; Outros pede classificação, sem inventá-la. Exclusão de produto remove a família correspondente; reconciliação remove itens e variações que deixaram de existir.

## Catálogo Meta

Usa a identidade já salva em Meta Ads. A preparação consulta todos os catálogos próprios do Business ID, reutiliza o único Aerion identificado e cria um apenas quando nenhum apropriado foi encontrado. Mais de um exige seleção explícita. Um catálogo com outra fonte bloqueia a preparação: não é criado um segundo mecanismo concorrente.

O botão **Configurar fonte e conjuntos Meta** enfileira uma fonte `Aerion CRM · consumidor`, coleta `HOURLY`, grupos por `custom_label_0` e associação ao Pixel/dataset. A associação à conta anunciante é consultada; se faltar, fica uma ação no painel. A sincronização horária lê itens, uploads, contagens de inválidos, vínculo e agenda. Recebimento e saúde da conexão aparecem separadamente. Correspondência de eventos ainda exige diagnóstico da plataforma.

Configurações do servidor:

| Variável | Uso |
| --- | --- |
| `ECOMMERCE_MARKETING_ENABLED=0` | Suspende workers e feed sem apagar dados |
| `ECOMMERCE_META_CATALOG_ID` | Catálogo explícito; evita descoberta ambígua |
| `ECOMMERCE_META_BUSINESS_ID` | Necessário para descobrir/criar catálogo quando não há ID explícito |
| `ECOMMERCE_META_FEED_ID` | Fonte existente, validada contra o catálogo |
| `ECOMMERCE_META_PIXEL_ID` | Default `1668777180919759`, Site Aerion |
| `ECOMMERCE_META_FEED_TOKEN` | Opcional, pelo menos 32 caracteres; se ausente, derivado por HMAC da chave Ecommerce |

IDs resultantes são persistidos no estado `meta_setup`. O feed TSV é `/api/ecommerce/feeds/meta?token=SEGREDO`; a URL completa só vai à fonte Meta, não aos relatórios. Não registrar query strings dessa rota no proxy. A primeira carga precisa terminar antes de servir o feed; uma loja indisponível não vira feed vazio. Rotação da chave/token exige atualizar a agenda da fonte pelo botão de configuração.

## Públicos e cadastros

Meta: visitantes/produtos 30 dias, carrinho 14, checkout 7, compradores 180; aquisição/recuperação excluem Purchase 180 dias. Recursos existentes de mesmo nome não são reescritos: aparecem para conferência. Criação parcial é recuperada pela busca por nome antes de repetir POST.

GA4: públicos por eventos e retenções equivalentes; vínculo Google Ads e `adsPersonalizationEnabled` são lidos. A API limita `inAnyNDayPeriod` a 60 dias. Por isso os compradores 180d ficam em público separado para exclusão nas campanhas: não são substituídos por exclusão permanente nem declarados como já excluídos. O nome público é versionado. Nenhuma campanha é ativada ao criar listas.

Sincronização de cadastros roda diariamente após configurar `ECOMMERCE_CUSTOMER_LISTS`, um JSON como:

```json
[
  {"source":"crm","segment":"qualified","platform":"meta_ads","id":"ID_DA_LISTA","managedBy":"aerion_crm"},
  {"source":"store","platform":"google_ads","id":"ID_DA_LISTA","managedBy":"aerion_crm"}
]
```

Substituir os IDs por números de **listas próprias dedicadas** à integração. Uma mesma lista não pode misturar loja, CRM ou dois segmentos. O proprietário da lista precisa ser a conta configurada; mudança de conta/origem bloqueia o ledger existente para revisão. CRM oferece `customers`, `qualified`, `early`, `nurturing` e `excluded`; etapa comercial não vira compra online. Loja representa cadastros registrados, não uma lista artificial de compradores.

Só há inclusão quando o cadastro comprova:

```json
{"status":"granted","ad_user_data":true,"ad_personalization":true,"source":"origem verificável","recorded_at":"2026-10-29T12:00:00Z"}
```

No CRM esse objeto vive em `custom_attributes.aerion_advertising_consent`; no WordPress, no user meta `aerion_advertising_consent`. `withdrawn_at`, prova ausente/inválida/futura, `whatsapp_opt_out`, `opt_out`, `nao_contatar` e `bloqueado` impedem inclusão. Supressão em cadastro duplicado vence. A função dedicada WordPress é `aerion_audience_sync`; um leitor de relatórios não recebe acesso a emails automaticamente.

Remoções precedem inclusões. Meta atualiza o ledger cifrado após cada lote aceito. Google usa OfflineUserDataJobs com consentimento explícito, acompanha o estado antes de confirmar o novo conjunto e remove revogações em seguida. Tamanho correspondente permanece indisponível quando a plataforma não informa; elegíveis e inclusões não são rotulados como pessoas correspondidas.

## Medição de compras

O emissor Meta de servidor existente **não é substituído nem duplicado**. GTM mantém workspace, backup, controle de versão e compra Google Ads principal existentes.

Checkout clássico registra contexto somente com consentimento de estatísticas, client ID válido e correspondente ao cookie da própria sessão. Não recolhe emails, nomes ou telefones nesse contexto. Blocos de checkout e visitantes sem esse contexto não são declarados cobertos. Consentimento revogado ou contexto com mais de 72h impede envio. Atualizações posteriores de consentimento precisam alcançar o contexto persistido para impedir um envio ainda pendente; não presumir que uma escolha posterior no navegador revoga dados já transmitidos.

O worker GA4 lê novamente o pedido, exige `processing/completed` e data paga, respeita exclusões de pedidos de teste, conserva `transaction_id=ID_WOO` e calcula valor dos itens após descontos, sem frete/impostos. Tentativas usam o mesmo ID; uma aceitação HTTP não é apresentada como compra já registrada no GA4. O ledger guarda somente destino, transação, estado e motivo.

Fica **desligado** até configurar todos:

```
ECOMMERCE_GA4_SERVER_PURCHASE_ENABLED=1
ECOMMERCE_GA4_SERVER_PURCHASE_VALIDATED=1
ECOMMERCE_GA4_MEASUREMENT_ID=G-...
ECOMMERCE_GA4_MEASUREMENT_SECRET=...
```

Validar em uma propriedade/compra de teste pelo método `ga4ServerPurchase(...,{validate:true})` antes de declarar `VALIDATED=1`. Não enviar compra/lead fictício à propriedade de produção. Revalidar ao trocar o fluxo. Não há segunda ação primária Ads nem CAPI paralelo nesta entrega. Conversões otimizadas dependem da ação/dados elegíveis e não são habilitadas por inferência.

## SEO, conteúdos e campanhas

Auditoria técnica diária verifica HTTP, robots/noindex, canonical, links internos na página e JSON-LD Product/SKU. Não segue redirecionamentos para hosts arbitrários; limita bytes/tempo. Canonical entre domínio principal e loja gera revisão, sem alteração automática. Sitemaps continuam usando os dados do Search Console e o comportamento nativo WordPress/WooCommerce. Não há chamada à Indexing API. CrUX/Core Web Vitals e vínculo Search Console–GA4 ficam indisponíveis/não verificados quando não há fonte validada.

Toda semana, usa 56 dias completos finalizados em dois períodos de 28 dias: ao menos 100 impressões, posição 4–20, CTR abaixo de 2% ou queda de cliques de pelo menos 20%. Prepara até 20 propostas por semana, baseadas nos fatos existentes do produto. Só associa URL exata; domínio principal e loja não são fundidos por suposição. Propostas têm versão e evidência e não são publicadas automaticamente.

Conteúdos registram SKU, versão, abordagem, condições reais e destino/UTMs. O briefing Content Hub é exportável no painel; não há API de briefing genérico identificada no Hub para enviar automaticamente. Geração de arquivos, associação dos retornos e publicação de criativos em anúncios dependem dessa integração e da aprovação dos arquivos. Não há geração silenciosa paga de mídia.

SEO exige primeiro **Aprovar versão**, depois **Publicar SEO aprovado**. O aplicativo só envia a proposta aprovada correspondente à versão atual. WordPress exige `aerion_publish_seo` e `AERION_APPROVED_SEO_OUTPUT=true`, após auditar o emissor SEO atual. Há adaptadores para título nativo, Yoast e Rank Math; a saída própria de descrição não roda quando esses plugins estão presentes. Validar que o tema não tenha outro emissor antes de habilitar. O publisher compara a data de alteração, rejeita concorrência com 409 e reconhece repetição do mesmo ID de conteúdo. Produtos variáveis exigem revisão específica do destino canônico; a publicação automática inicial cobre produtos simples.

Preço, estoque, condições e versão alterados invalidam conteúdos aprovados; saídas SEO aprovadas deixam de substituir o padrão se o produto foi modificado. Canonical, redirecionamentos e especificações não são alterados por esse publisher.

O planejamento exige teto mensal total e divisão positiva em centavos, cuja soma seja o total. Não transfere verba entre plataformas. As estruturas locais têm `PAUSED` e ativação proibida. A API administrativa `POST /marketing/campaigns/stage` pode preparar **somente novas estruturas pausadas**, depois de orçamento salvo, conteúdo criativo aprovado atual e revisão explícita das exclusões (`exclusionsReviewed:true`). As operações Google são validadas antes do mutate; Meta e Google confirmam PAUSED por leitura posterior. Um recurso existente ativo com o mesmo nome bloqueia, sem atualizar status/orçamento/segmentação. Orçamento diário estimado usa mensal/30,4; não representa garantia de cobrança. Grupos de recursos/conjuntos, arquivos aprovados, metas de compra, exclusão de compradores e elegibilidade de catálogo ainda precisam estar completos antes de ativação — não há endpoint de ativação.

## Matriz de entrega e habilitação

As linhas de infraestrutura abaixo significam código e testes locais operacionais; o painel só declara a operação de uma conta depois de observar a integração.

| Componente | Situação verificável | Próxima ação |
| --- | --- | --- |
| Fila, HMAC, projeção, retentativas, aprovações e isolamento | Operacional em testes PostgreSQL/PHP | Publicar código pelo CI e instalar o pacote WordPress correspondente |
| Merchant existente | Conexão de produção verificada em 29/10, sem erro | Preservar fonte e acompanhar aprovação/destinos no Merchant |
| Catálogo Meta | Dependente de ação do administrador | Conceder `catalog_management`, selecionar Business/catálogo, executar preparação e validar conta/dataset |
| Públicos Meta/GA4 | Dependente de acesso de escrita e processamento externo | Executar os botões de preparação; conferir regras existentes, vínculo Ads e exclusões |
| Listas de cadastro | Dependente de ação do administrador | Mapear listas dedicadas, atribuir capacidade WordPress e registrar elegibilidade comprovada |
| GA4 pelo servidor | Desabilitado até validação | Validar contexto, consentimento e deduplicação em teste; configurar fluxo/segredo e flags |
| Meta CAPI existente | Dependente de auditoria da origem | Conciliar o emissor SERVER existente antes de qualquer novo envio |
| SEO | Diagnóstico e propostas operacionais; publicação condicionada | Auditar emissor do tema, conceder capacidade e habilitar o adaptador somente após validar |
| Content Hub | Briefing preparado no painel | Integrar uma interface de entrada/retorno de arquivos e revisar os criativos |
| Campanhas | Planejamento pausado; sem orçamento fornecido nesta tarefa | Informar total/divisão, aprovar recursos e revisar exclusões; manter estruturas novas pausadas |
| Core Web Vitals / vínculo Search Console–GA4 | Não verificados | Validar nas contas Google; não apresentar ausência como zero |

Produção: `main` → CI → GHCR, conforme AGENTS.md. Não copiar checkout de desenvolvimento para contêiner e não substituir a implantação WordPress atual por uma árvore antiga/incompleta. No momento desta implementação, o clone remoto da loja inspecionado não continha o pacote/rotina de produção descritos em `docs/ECOMMERCE.md`; integrar o artefato na fonte de implantação atual antes de publicar a loja.

## Verificação

`npm run test:ecommerce --prefix backend` executa as suítes com concorrência de arquivo 1: advisory locks de integração são globais dentro do banco, mesmo com schemas separados. Para integração, definir `ECOMMERCE_TEST_DATABASE_URL` para um banco de teste. Cada suíte cria/remove seu próprio schema; não simula vendas ou leads em produção.

PHP 8.2: `reports.test.php`, `measurement.test.php`, `merchant.test.php`, `marketing.test.php`. Frontend: `MarketingAutomationView.test.js`, `EcommerceView.test.js`, `MerchantView.test.js`, `ecommerceChart.test.js`; build de produção e `scripts/check-ecommerce-ui.cjs` com fixtures locais em 1440×1000 e 390×844. O CI inclui as novas suítes e exporta os três arquivos WordPress.

Referências usadas via Context7: [webhooks WooCommerce](https://developer.woocommerce.com/docs/apis/rest-api/v3/webhooks), [públicos Meta](https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/guides/website-custom-audiences), [GA4 Admin audiences e limites](https://developers.google.com/analytics/devguides/config/admin/v1/rpc/google.analytics.admin.v1alpha), [validação Measurement Protocol](https://developers.google.com/analytics/devguides/collection/protocol/ga4/validating-events), [Customer Match](https://developers.google.com/google-ads/api/docs/remarketing/audience-segments/customer-match/manage).
