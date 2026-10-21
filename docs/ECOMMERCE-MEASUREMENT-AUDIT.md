# Auditoria de medição — Aerion

Verificação em 21/10/2026 no WordPress em produção, configuração publicada do GTM e Graph API. Não foram criados pedidos, compras fictícias ou campanhas. Os resultados do navegador ficam em `.tmp/measurement/browser-audit.json` e não contêm identificadores de visitantes.

## Evidências encontradas

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

O feed canônico em `class-aerion-google-merchant.php` usa marca do cadastro/taxonomia, com identificação por nome/SKU para HUBSAN e Autel quando não houver cadastro. Não inventa marca para outros produtos. MPN/GTIN originais ainda exigem conferência com fabricante; SKU interno não é automaticamente um MPN válido. Não marcar `identifier_exists=false` para contornar identificador ausente de produto que possui identificador do fabricante.

A disponibilidade do feed segue a pré-venda efetivamente exibida pela loja: `preorder` e `availability_date` em ISO 8601, com o fuso do WordPress. Encomendas usam `backorder`; sem uma data válida e não vencida a oferta é omitida até correção do cadastro, sem informar estoque imediato. Referências: [disponibilidade](https://support.google.com/merchants/answer/6324448) e [data de disponibilidade](https://support.google.com/merchants/answer/6324470).

Auditoria do catálogo: 30 produtos publicados, 22 disponíveis para compra. Onze dos 22 estavam fora do feed somente porque `_aerion_shipping_validated` ainda era `no`, apesar de terem peso e dimensões cadastrados: kits Alpha/Max/Lite, módulo RTK e carregadores. A fonte revisada verifica as medidas atuais utilizadas na cotação do checkout, permite produtos virtuais sem pacote e exporta peso/dimensões em kg/cm; não altera preços, estoque nem marca dados como fisicamente certificados. Itens sem medidas completas permanecem excluídos. Ofertas sem estoque podem constar no feed como `out_of_stock`, sem significar disponibilidade para compra.

O Moove intercepta suas configurações com `pre_option` na prioridade 99. A política de consentimento aplica as categorias depois dessa leitura na prioridade 100, mantém estatísticas/publicidade desativadas por padrão e expõe escolhas separadas. Apenas filtrar `option_*` não cobre a tabela própria do plugin.

## Próxima validação das plataformas

- GTM: ativar Tag Manager API no projeto `cybernetic-post-481513-c2` e conceder Publish à identidade técnica. Criar workspace separado, preservar a versão anterior, configurar eventos GA4 a partir do data layer e revisar disparadores/consentimento da Meta. Validar antes de publicar.
- GA4: obter acesso à propriedade, conferir stream, fuso e moeda, validar DebugView e usar um funil fechado de usuários para abandono. Não calcular abandono por `1 - eventos_purchase/eventos_add_to_cart`.
- Google Ads: desbloquear conta e identificar ação de compra. Não reutilizar como compra o label existente de lead/contato. Evitar marcar compra nativa e compra importada do GA4 como duas ações primárias para a mesma venda.
- Merchant Center: conferir conta, domínio verificado, fonte cadastrada, aprovação de cada oferta, frete/devolução e vínculo com a conta Ads. Feed acessível não prova nenhuma dessas etapas.
- Meta: conferir Purchase, valor, moeda, catálogo e IDs, consentimento e diagnóstico de eventos. Se adicionar CAPI, usar `Purchase` e o mesmo `event_id` no navegador/servidor, além de idempotência e controle de retentativas. A autorização atual de relatórios não equivale à permissão de administrar públicos/campanhas.

## Configuração reproduzível do GTM

`integrations/gtm/configure.cjs` usa a identidade federada técnica para auditar, preparar e publicar separadamente. Guarda o JSON original da versão publicada e o estado em diretório privado; prepara um workspace próprio e recusa publicar se alguém alterou a versão em produção. A rotina não altera o Default Workspace nem campanhas/orçamentos.

`ecommerce.cjs` gera a tag GA4 com ecommerce estruturado e corrige o Pixel Meta para respeitar consentimento de marketing, enviar SKU/valor/moeda e deduplicar compra por ID. Os testes cobrem consentimento negado, concessão/revogação, dados de produtos e repetição da mesma transação. A tag Google Ads existente é de formulário/contato: seu label não é reutilizado para compras. CAPI e compras primárias Google Ads continuam sendo integrações separadas, dependentes das permissões e ações correspondentes.

Permissões efetivas encontradas: administrador da conta com somente leitura no contêiner. O acesso administrativo existente permitiu corrigir apenas o grant do próprio usuário técnico nesse contêiner para `publish`, preservando os demais acessos. O GTM compilou/publicou a versão 8, com oito tags anteriores preservadas. A validação no navegador confirmou GA4 `view_item` com BRL/SKU e bloqueio da Meta antes do consentimento; a inicialização da Meta foi ajustada para permitir nova tentativa por evento após o consentimento, com guarda própria contra PageView duplicado.

Após a correção do catálogo, o feed público retornou 29 ofertas: 21 em estoque, uma pré-venda e sete sem estoque. Os 22 produtos disponíveis para compra estão presentes. EVO Nest permanece excluído por cadastro de envio incompleto. A API Merchant retornou `SERVICE_DISABLED`; o administrador ainda precisa habilitar a API e conceder acesso à conta para conferir fonte importada, reprovações e exibição. `robots.txt` permite os produtos e aponta para um sitemap que inclui os 30 produtos publicados; não foi encontrado bloqueio geral de rastreamento no site.

## Recuperação e públicos

Separar carrinho sem pedido, checkout iniciado, pedido pendente e pagamento falho. Público de remarketing pode usar ViewContent/AddToCart/InitiateCheckout com exclusão de Purchase e janelas a definir após validar o sinal. Não ativar otimização por compras sem sinal de compra confiável.

Recuperação por mensagem exige contato identificado, base legal/consentimento aplicável, exclusão de quem já pagou e descadastro. WhatsApp segue as regras de verificação de número, preview, variações, cooldown e orçamento total por instância em AGENTS.md. Nenhuma mensagem automática ou campanha foi ativada nesta auditoria.

Referências oficiais: [ecommerce GA4](https://developers.google.com/analytics/devguides/collection/ga4/ecommerce), [Meta Pixel](https://developers.facebook.com/documentation/meta-pixel/reference), [autorização GTM](https://developers.google.com/tag-platform/tag-manager/api/v2/authorization), [marca no Merchant Center](https://support.google.com/merchants/answer/6324351), [identificadores de produto](https://support.google.com/merchants/answer/6324478).
