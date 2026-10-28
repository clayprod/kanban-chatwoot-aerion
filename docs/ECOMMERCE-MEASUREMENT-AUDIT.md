# Auditoria de medição — Aerion

## Autorizações Google verificadas em 28/10/2026

A conta técnica confirmada pelo usuário é `aerion-ecommerce-reader@cybernetic-post-481513-c2.iam.gserviceaccount.com`, a mesma identidade federada já usada pelo dashboard. GA4, propriedade `508163931`, estava habilitado, conectado e com sincronização bem-sucedida às 14:33 de Brasília em 28/10, sem erro registrado.

Um token foi emitido no servidor para essa mesma identidade com o escopo `content`; a leitura `GET https://merchantapi.googleapis.com/accounts/v1/accounts` retornou **403 `SERVICE_DISABLED`**. O Google informou que a Merchant API ainda não foi usada ou está desativada no projeto `275930572314` (`cybernetic-post-481513-c2`). A autorização do usuário no Merchant Center não habilita automaticamente a API no projeto Cloud. Ativar [Merchant API no projeto](https://console.developers.google.com/apis/api/merchantapi.googleapis.com/overview?project=275930572314), aguardar a propagação e repetir a leitura antes de afirmar que contas, produtos ou fontes foram validados. Nenhum produto, feed ou permissão foi alterado nesse diagnóstico. Referência de leitura: [Merchant API accounts.list](https://developers.google.com/merchant/api/reference/rest/accounts_v1/accounts/list).

Verificação em 21/10/2026 no WordPress em produção, configuração publicada do GTM e Graph API. Não foram criados pedidos, compras fictícias ou campanhas. Os resultados do navegador ficam em `.tmp/measurement/browser-audit.json` e não contêm identificadores de visitantes.

## Evidências da configuração inicial, antes das correções

| Superfície | Evidência | Consequência |
| --- | --- | --- |
| GTM | GTM-5G8QBHHC, versão publicada 7, tags de GA4/Ads, contatos e leads | Não há tags de eventos ecommerce configuradas; a presença das palavras `purchase` no runtime genérico não significa uma tag de compra ativa. |
| WooCommerce/GTM4WP | `integrate-woocommerce-track-enhanced-ecommerce=false` | Produto, carrinho e checkout não alimentam o ecommerce do data layer. |
| Pixel | 1668777180919759, Site Aerion, associado à conta 1318645390292737; último evento indicado pela API em 20/10 | Pixel existente confirmado. Isso não valida compras nem qualidade de correspondência. |
| Facebook for WooCommerce | `facebook_config.pixel_id=0`, `use_s2s=false` | A integração instalada não comprova envio de compras pelo servidor/CAPI. |
| Consentimento | Google Consent Mode v2 começa negado; WP Consent API indica statistics/marketing negados no primeiro acesso | Preservar consentimento ao configurar novos eventos e testar aceitação/recusa. |
| Google Shopping | Feed público `/loja/google-merchant.xml`, 11 ofertas | HUBSAN Mini 7 recebe marca fixa Autel Robotics e `in_stock` apesar da página informar pré-venda com entrega em 05/02/2027. O feed existente não comprova aprovação no Merchant Center nem vínculo com Ads. |
| Fontes do dashboard | WooCommerce e Meta conectados; GA4 e Google Ads não configurados no backend | Não tratar fontes ausentes como zero nem afirmar que todas as plataformas já estão conectadas. |

## Contrato de eventos preparado no WordPress

`integrations/wordpress/measurement.php` é a fonte canônica instalada junto do plugin de relatórios no projeto WordPress. Ativa a integração ecommerce do GTM4WP e mantém o contêiner existente, usa SKU para compatibilidade com o feed, limpa ecommerce anterior e impede inclusão de dados pessoais brutos no data layer.

Compra exige `is_paid()` e data de pagamento. A página de um pedido Pix/boleto ainda pendente não pode disparar `purchase` nem consumir a marca de pedido já rastreado do GTM4WP. `transaction_id` usa o ID interno estável do pedido; `event_id=aerion_purchase_ID` fica preparado para uma eventual implementação CAPI com o mesmo nome/ID. Isso, isoladamente, não implementa envio pelo servidor.

`value` representa produtos após descontos, sem frete, impostos ou taxas. `shipping`, `tax`, `currency` e `items` permanecem separados. Reembolsos futuros exigem evento/ajuste próprio, não repetição da compra. Pix aprovado sem retorno do comprador exige uma integração de pagamento/servidor para completar cobertura; browser-only não resolve esse cenário.

A loja lança o desconto Pix como uma taxa negativa, separada dos cupons. O plugin 1.1.1 e o normalizador do CRM reconhecem os dois rótulos usados pela loja, descontam o valor dos produtos e preservam a soma dos itens. No CRM, o rateio usa centavos e reembolsos da taxa evitam descontá-la duas vezes. A consulta privada encontrou um pedido concluído no histórico, sem taxa Pix; não houve alteração de receita histórica desse pedido. O tratamento é necessário para as próximas compras Pix e não altera a cobrança da loja.

O feed canônico em `class-aerion-google-merchant.php` usa marca do cadastro/taxonomia, com identificação por nome/SKU para HUBSAN e Autel quando não houver cadastro. Não inventa marca para outros produtos. MPN/GTIN originais ainda exigem conferência com fabricante; SKU interno não é automaticamente um MPN válido. Não marcar `identifier_exists=false` para contornar identificador ausente de produto que possui identificador do fabricante.

A disponibilidade do feed segue a pré-venda efetivamente exibida pela loja: `preorder` e `availability_date` em ISO 8601, com o fuso do WordPress. Encomendas usam `backorder`; sem uma data válida e não vencida a oferta é omitida até correção do cadastro, sem informar estoque imediato. Referências: [disponibilidade](https://support.google.com/merchants/answer/6324448) e [data de disponibilidade](https://support.google.com/merchants/answer/6324470).

Auditoria do catálogo: 30 produtos publicados, 22 disponíveis para compra. Onze dos 22 estavam fora do feed somente porque `_aerion_shipping_validated` ainda era `no`, apesar de terem peso e dimensões cadastrados: kits Alpha/Max/Lite, módulo RTK e carregadores. A fonte revisada verifica as medidas atuais utilizadas na cotação do checkout, permite produtos virtuais sem pacote e exporta peso/dimensões em kg/cm; não altera preços, estoque nem marca dados como fisicamente certificados. Itens sem medidas completas permanecem excluídos. Ofertas sem estoque podem constar no feed como `out_of_stock`, sem significar disponibilidade para compra.

O Moove intercepta suas configurações com `pre_option` na prioridade 99. A política de consentimento aplica as categorias depois dessa leitura na prioridade 100, mantém estatísticas/publicidade desativadas por padrão e expõe escolhas separadas. Apenas filtrar `option_*` não cobre a tabela própria do plugin.

## Próxima validação das plataformas

- GTM: API ativada, Publish verificado, configuração preparada em workspace separado, com backup das versões anteriores. Validar os eventos efetivamente enviados no navegador após cada publicação.
- GA4: obter acesso à propriedade, conferir stream, fuso e moeda, validar DebugView e usar um funil fechado de usuários para abandono. Não calcular abandono por `1 - eventos_purchase/eventos_add_to_cart`.
- Google Ads: desbloquear conta e identificar ação de compra. Não reutilizar como compra o label existente de lead/contato. Evitar marcar compra nativa e compra importada do GA4 como duas ações primárias para a mesma venda.
- Merchant Center: conferir conta, domínio verificado, fonte cadastrada, aprovação de cada oferta, frete/devolução e vínculo com a conta Ads. Feed acessível não prova nenhuma dessas etapas.
- Meta: conferir Purchase, valor, moeda, catálogo e IDs, consentimento e diagnóstico de eventos. Se adicionar CAPI, usar `Purchase` e o mesmo `event_id` no navegador/servidor, além de idempotência e controle de retentativas. A autorização atual de relatórios não equivale à permissão de administrar públicos/campanhas.

## Configuração reproduzível do GTM

`integrations/gtm/configure.cjs` usa a identidade federada técnica para auditar, preparar e publicar separadamente. Guarda o JSON original da versão publicada e o estado em diretório privado; prepara um workspace próprio e recusa publicar se alguém alterou a versão em produção. A rotina não altera o Default Workspace nem campanhas/orçamentos.

`ecommerce.cjs` gera a tag GA4 com ecommerce estruturado e corrige o Pixel Meta para respeitar consentimento de marketing, enviar SKU/valor/moeda e deduplicar compra por ID. Os testes cobrem consentimento negado, concessão/revogação, dados de produtos e repetição da mesma transação. A tag Google Ads existente é de formulário/contato: seu label não é reutilizado para compras. CAPI e compras primárias Google Ads continuam sendo integrações separadas, dependentes das permissões e ações correspondentes.

Permissões efetivas encontradas: administrador da conta com somente leitura no contêiner. O acesso administrativo existente permitiu corrigir apenas o grant do próprio usuário técnico nesse contêiner para `publish`, preservando os demais acessos. O GTM compilou/publicou a versão 8, com oito tags anteriores preservadas. A validação no navegador confirmou GA4 `view_item` com BRL/SKU e bloqueio da Meta antes do consentimento; a inicialização da Meta foi ajustada para permitir nova tentativa por evento após o consentimento, com guarda própria contra PageView duplicado.

A versão 9 confirmou no navegador uma única chamada Meta PageView/ViewContent após aceitar cookies, sem SDK antes do aceite. O teste anônimo de carrinho encontrou um problema anterior: `form_submit` também disparava Lead e a conversão de formulário Ads ao adicionar produtos. A configuração revisada usa `generate_lead`, já emitido pelo tema ao receber sucesso do formulário, e mantém os cliques diretos de contato da ação Ads existente. As tags `lead_home` e `lead_contato` passam a exigir a página correspondente. Nenhum formulário real de contato foi enviado para testar, evitando criar leads fictícios.

O checkout emite `begin_checkout` antes da restauração do consentimento salvo. A configuração revisada recupera o estado atual de checkout uma vez no Pixel. No GA4, eventos ecommerce exigem o estado de estatísticas permitido e o estado inicial da página é reenviado uma vez após a restauração; ações anteriores de adicionar/remover produtos não são repetidas. O teste de carrinho não preenche dados pessoais nem envia o pedido; o item de teste é removido ao terminar.

O Default Workspace contém uma exclusão pendente de `lead_home`. Publicar em workspace próprio preserva essa alteração e não atualiza automaticamente o workspace antigo. A configuração publicada deve ser conferida em **Versões**, ou em um workspace novo criado a partir da versão atual. Não descartar alterações do Default Workspace para fazê-las aparecer.

Resultado final: versão **10** publicada, workspace de consulta `Aerion Ecommerce - publicado v10` (ID 12). O navegador confirmou Meta ViewContent/AddToCart/InitiateCheckout e GA4 view_item/add_to_cart/view_cart/begin_checkout, BRL e SKU corretos, sem Lead/Purchase/conversão Ads de formulário no fluxo de carrinho. O carrinho anônimo foi esvaziado. A coleta GA4 após consentimento também usa `analytics.google.com`; o auditor cobre esse host e os endpoints `/collect`, além de `google-analytics.com`.

## Novos acessos Google

O acesso da identidade técnica ao Google Ads permitiu listar a conta **103-898-3099**. A consulta de campanhas foi bloqueada com `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION`: o projeto Cloud está com acesso Test e precisa de Explorer, Basic ou Standard. Isso é separado da permissão do usuário na conta e de uma eventual restrição de veiculação. A [visão geral da Google Ads API](https://console.cloud.google.com/google/ads-apis/overview?project=cybernetic-post-481513-c2) contém a solicitação de upgrade. Não reutilizar a conversão de contato como compra enquanto não for possível consultar/criar a ação correta.

Depois da aprovação Explorer informada pelo usuário, a leitura de conta/campanhas/conversões retornou HTTP 200. Conta Aerion Technologies Ltda, BRL, America/Sao_Paulo, status ENABLED; a campanha Performance Max existente está PAUSED. A ação existente `Aerion (web) purchase`, ID `7463161089`, é uma compra GA4 da propriedade Aerion `508163931` e estava HIDDEN. Foi importada com status ENABLED como ação secundária (`primary_for_goal=false`), sem ligar campanhas nem alterar lances. Não foi criada uma segunda tag de compra Ads. O dashboard seleciona somente essa ação para conversões/valor de compra, usando `all_conversions` e `all_conversions_value` para incluir a ação secundária. Resultados das metas de leads ficam separados e não inflam o ROAS de compras. A promoção da compra a objetivo de lances exige validar o recebimento e a cobertura de pagamentos reais primeiro.

Após a orientação explícita do usuário para priorizar compras, a ação passou a **primária**. A Performance Max recebeu metas próprias: PURCHASE/WEBSITE habilitada para lances e as duas metas de formulário desabilitadas apenas nessa campanha. As metas de leads da conta foram preservadas para campanhas de leads. A verificação confirmou campanha PAUSED, orçamento de R$ 20/dia e as mesmas 52 exclusões de conta, 12 critérios de campanha e sete listas compartilhadas. Backups e plano validado ficam no diretório operacional privado da VPS. Isso prepara futuras compras, sem inventar eventos nem reativar anúncios.

A importação terminou: Google Ads com sete registros de campanha/dia em janeiro de 2026 e Search Console com 9.501 registros. No período consultado, Ads sem investimento é zero, não fonte ausente. A inspeção das 30 URLs de produtos encontrou dez indexadas, 15 detectadas mas não indexadas e cinco desconhecidas pelo Google. Os sitemaps atuais de índice e produtos foram cadastrados, lidos pelo Google e retornaram zero erros/avisos. Isso não garante indexação ou aprovação Shopping.

Search Console: API ativada e acesso `siteFullUser` confirmado em `sc-domain:aerion.com.br`, com consulta de desempenho HTTP 200. A integração usa escopo exclusivo `webmasters.readonly`, credencial federada cifrada e sincronização em lotes independentes. A aba SEO apresenta totais diários, páginas, consultas e sitemaps. Cliques/impressões dos totais não são obtidos somando consultas anônimas omitidas. CTR usa totais ponderados; posição usa impressões. Datas seguem o Pacífico, dados são finalizados e a última data disponível fica visível. Detalhamentos limitados são sinalizados; esses dados não provam indexação ou aprovação no Shopping.

Após a correção do catálogo, o feed público retornou 29 ofertas: 21 em estoque, uma pré-venda e sete sem estoque. Os 22 produtos disponíveis para compra estão presentes. EVO Nest permanece excluído por cadastro de envio incompleto. A API Merchant retornou `SERVICE_DISABLED`; o administrador ainda precisa habilitar a API e conceder acesso à conta para conferir fonte importada, reprovações e exibição. `robots.txt` permite os produtos e aponta para um sitemap que inclui os 30 produtos publicados; não foi encontrado bloqueio geral de rastreamento no site.

## Recuperação e públicos

Separar carrinho sem pedido, checkout iniciado, pedido pendente e pagamento falho. Público de remarketing pode usar ViewContent/AddToCart/InitiateCheckout com exclusão de Purchase e janelas a definir após validar o sinal. Não ativar otimização por compras sem sinal de compra confiável.

Estrutura proposta para revisão, ainda não criada/ativada na conta:

| Público | Inclusão | Exclusão | Uso |
| --- | --- | --- | --- |
| Produto visto, 30 dias | ViewContent | AddToCart e Purchase | Reapresentar o produto ou sua aplicação |
| Carrinho, 14 dias | AddToCart | Purchase | Resolver dúvidas de frete, prazo e pagamento |
| Checkout, 7 dias | InitiateCheckout | Purchase | Recuperar intenção mais recente |
| Compradores, 180 dias | Purchase | Conforme campanha | Excluir aquisição e avaliar acessórios compatíveis |

Essas janelas são uma proposta inicial, não um resultado medido. É preciso verificar o volume disponível e a correspondência dos eventos antes de criar públicos semelhantes ou mudar a otimização. O histórico importado tem somente uma compra paga; ele não sustenta afirmar que já existe uma base robusta de compradores para aprendizado. Os sinais ajudam os modelos da plataforma; não criam automaticamente uma persona nem garantem redução de CPA. Anúncios dinâmicos também exigem um catálogo Meta conectado com os mesmos IDs/SKUs enviados pelo Pixel. Acesso `ads_read` usado no relatório não autoriza criar públicos/campanhas; CAPI permanece pendente de configuração específica.

Recuperação por mensagem exige contato identificado, base legal/consentimento aplicável, exclusão de quem já pagou e descadastro. WhatsApp segue as regras de verificação de número, preview, variações, cooldown e orçamento total por instância em AGENTS.md. Nenhuma mensagem automática ou campanha foi ativada nesta auditoria.

Referências oficiais: [ecommerce GA4](https://developers.google.com/analytics/devguides/collection/ga4/ecommerce), [Meta Pixel](https://developers.facebook.com/documentation/meta-pixel/reference), [autorização GTM](https://developers.google.com/tag-platform/tag-manager/api/v2/authorization), [marca no Merchant Center](https://support.google.com/merchants/answer/6324351), [identificadores de produto](https://support.google.com/merchants/answer/6324478).
