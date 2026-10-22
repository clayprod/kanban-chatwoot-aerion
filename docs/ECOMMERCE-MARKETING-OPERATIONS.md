# Operação de públicos e campanhas da Aerion

Auditoria das plataformas em 21/10/2026. Dados de etapa do CRM são uma fotografia atual, não a situação histórica de cada contato no período do gráfico.

## O que já foi ajustado

- GTM 10: ecommerce GA4 e Meta com SKU, valor, consentimento e deduplicação. Carrinho não gera Lead nem conversão de formulário. Compra exige pagamento confirmado.
- Google Ads: conta 103-898-3099 conectada. A compra GA4 existente 7463161089 está habilitada e primária; não foi duplicada com uma compra nativa Ads. O ROAS do painel usa somente essa ação.
- A Performance Max 23461641736 usa metas próprias de compra. A campanha permanece pausada, com R$ 20/dia. Exclusões, critérios, públicos, criativos e orçamento existentes foram preservados.
- O conjunto Meta ativo já usa OFFSITE_CONVERSIONS/PURCHASE e o Pixel 1668777180919759. Seus posicionamentos publicados são Facebook e Instagram; Audience Network não consta nesse conjunto.
- O painel exibe uma prévia agregada do CRM em Marketing → Tráfego e conversão. Ela não exporta identificadores nem envia listas.

Verificação em produção em 22/10/2026: revisão `fe31c3a`, endpoint de públicos HTTP 200, 3.794 contatos, 47 em etapas qualificadas e 7 em etapas de clientes/recompra. Google Ads, Meta Ads, WooCommerce e Search Console conectados; a leitura do GA4 continua bloqueada por permissão da propriedade. O CI validou também a consulta de públicos em PostgreSQL.

O gráfico tem escalas independentes: receita/pedidos pendentes à esquerda e investimento à direita. O modo CPC/ROAS usa R$/clique à esquerda e vezes à direita. As taxas são recalculadas pelos totais de cada agrupamento; tooltips preservam os valores reais.

## Pixel e públicos Meta: confirmação e bloqueio atual

Em 22/10/2026, o MCP oficial confirmou no dataset os eventos ViewContent, AddToCart e InitiateCheckout. A qualidade de correspondência informada para esses eventos foi 6,1; isso não comprova qualidade de Purchase. A janela consultada inclui os testes de navegação, e suas contagens não devem ser interpretadas como clientes reais. O detalhamento de origem reportou 219 eventos SERVER e 249 BROWSER; o dataset tem `server_last_fired_time`. Portanto, há sinal de servidor reportado pelo Meta, cuja origem e deduplicação ainda precisam ser identificadas, apesar de `use_s2s=false` no plugin Facebook for WooCommerce auditado. Não instalar um segundo envio de compras sem conciliar essa origem. Nenhum Purchase foi retornado na janela consultada, e nenhuma compra foi simulada.

As regras revisáveis estão em `integrations/meta/remarketing-audiences.json`: visitantes e produto visto 30 dias, carrinho 14 dias, checkout 7 dias e compradores 180 dias. Os quatro primeiros excluem Purchase dos últimos 180 dias. As regras estão preparadas, **não criadas na conta**. O MCP retornou `Authorization Error`, HTTP 401 / OAuthException 190, na tentativa de criação. Uma leitura posterior confirmou zero públicos. A credencial tem `ads_read` e `ads_mcp_management` concedidos, mas isso não comprovou autorização de escrita para essa operação; investigar a autorização antes de repetir. Nenhuma campanha, orçamento ou lista de contatos foi alterada por essa tentativa.

## Por que público e posicionamento precisam de controles distintos

Um sinal de público ajuda a plataforma a encontrar compradores, mas não funciona como lista fechada de posicionamentos. O objetivo de conversão também precisa representar resultado comercial: um clique em contato ou formulário de carrinho não deve ensinar que houve uma compra.

A conta Google tem 52 exclusões: 13 de conteúdo, 38 categorias de aplicativos e uma lista de palavras negativas. A auditoria de posicionamentos retornou 441 linhas históricas, incluindo 416 impressões em freegamingo.com e 53 em myfunmax.com. Esse relatório fornece impressões por posicionamento; não fornece custo ou conversões por site e não permite afirmar quanto dinheiro foi gasto em cada um.

Há sete listas compartilhadas, incluindo nomes relacionados a jogos e conteúdo infantil. Nenhum vínculo de `campaign_shared_set` foi retornado para essa Performance Max; a lista negativa de nível de conta é um mecanismo separado. É necessário conferir os membros e a compatibilidade de cada vínculo antes de aplicar listas. Não substituir exclusões existentes por um bloqueio genérico sem essa revisão.

A campanha usa PRESENCE_OR_INTEREST. Revisar a cobertura comercial pretendida antes de mudar a geografia. Não alterar região, raio, lances ou orçamento para tentar compensar um sinal de conversão incorreto.

## Segmentação a partir do Kanban/Chatwoot

Esclarecimento do usuário em 22/10/2026: o CRM é centrado em distribuição; a loja atende tanto distribuidores quanto consumidores finais. A classificação abaixo é uma prévia dos cadastros reais do CRM, não um conjunto de exemplos fictícios nem uma base já usada para procurar compradores da loja. Não misturar automaticamente os dois contextos.

Para a loja, usar um funil simples por comportamento: visitantes 30 dias, interesse em produtos 30 dias, carrinho 14 dias, checkout 7 dias e compradores pagos 180 dias. Excluir compradores dos quatro primeiros grupos como regra inicial de aquisição/recuperação, preservando uma estratégia própria de recompra. Esses nomes, eventos equivalentes e janelas são o contrato comum entre plataformas; correspondência, volume, processamento e consentimento podem produzir integrantes diferentes. O tipo distribuidor/consumidor final precisa de informação declarada ou origem confiável, não de uma inferência por clique.

Públicos por eventos usam janelas móveis após sua criação/configuração e entrada dos sinais: pessoas entram ao cumprir a regra e saem ao expirar a janela ou cumprir uma exclusão. Não é necessário reenviar uma planilha para cada novo carrinho. Listas por cadastro precisam de sincronização de inclusões, mudanças e remoções; essa sincronização ainda não foi implementada. Um público semelhante ou um sinal de audiência é um uso distinto do remarketing, e não deve nascer automaticamente de toda a base de distribuição. Performance Max pode expandir além dos sinais, conforme https://support.google.com/google-ads/answer/14530785?hl=pt-BR .

| Segmento | Etapas atuais | Uso inicial |
| --- | --- | --- |
| Clientes e recompra | 13, 18, 23 | Exclusão de aquisição, acessórios e recompra |
| Qualificados e oportunidades | 6 a 12 | Remarketing comercial e referência de qualidade |
| Inbox e primeiros contatos | 1 a 5 | Qualificação; não tratar como compradores |
| Pausados e nutrição | 15, 17 | Conteúdo de consideração adequado ao interesse |
| Perdidos e descartados | 14, 16 | Separar das referências de compradores/SQL |
| Sem classificação | Outras ou vazias | Revisar antes de segmentar |

Fechado-Ganho e Novos Clientes indicam classificação comercial no CRM, não comprovam pagamento no WooCommerce. Qualificado pode ter sido sugerido/aplicado por automação. Conferir a qualidade antes de usar esses grupos como base de compradores ou semelhantes.

O endpoint de prévia consulta somente a conta Chatwoot configurada, conta emails distintos com formato válido e exclui bloqueios/descadastros registrados. Retorna apenas totais, etapas e tipos de cliente: não retorna nomes, emails, telefones nem IDs de contatos. O total exibido é disponibilidade de cadastro, não tamanho de público correspondente na plataforma. Cadastros duplicados entre segmentos ainda precisam ser reconciliados no envio futuro.

Google Customer Match e Meta Custom Audiences precisam de uma integração de envio própria, elegibilidade da conta e tratamento da autorização dos dados para essa finalidade. Não afirmar consentimento ou correspondência que o cadastro não demonstra. Uma lista de contatos importados não deve ser rotulada como lista de compradores. Nenhuma base bruta foi enviada nesta implementação.

Começar com o PostgreSQL existente e segmentos revisáveis. BigQuery pode ser uma fase posterior; ele não é uma etapa obrigatória para organizar os segmentos atuais.

## Conversões do funil comercial

Compra online vem do WooCommerce pago. Qualificação e fechamento comercial devem ter eventos próprios, com origem e valor verificáveis; não transformar automaticamente toda movimentação de card em Purchase. Registrar um fechamento no CRM não reconstrói o clique de anúncio original. Atribuição offline exige identificadores/origem e o contrato de dados apropriado.

Prioridades seguintes: revisar a origem da lista CRM existente “Drones”; definir públicos por linha profissional, HUBSAN e revenda; separar visitantes, carrinho e checkout com exclusão de compradores; completar CAPI respeitando consentimento e o mesmo event_id; acompanhar compras reais e qualidade dos leads. A campanha Meta antiga de revendas continua pausada e separada da campanha ativa da loja.

## Briefing para o Tenryu Content Hub

Integração de criativos fica preparada para uma fase posterior, conforme pedido do usuário. Cada briefing deverá levar produto/SKU, linha comercial, etapa do funil, público, objetivo, oferta e prazo vigentes, formato, destino/UTMs, variações de abordagem e responsável pela revisão. O retorno deverá registrar os arquivos e versões aprovadas. Publicação e orçamento de anúncios são ações separadas da geração do criativo.

Usar especificações do catálogo e condições reais da loja, especialmente a pré-venda do HUBSAN. Não inventar autonomia, certificações, disponibilidade imediata, desconto ou prazo. Comparar criativos com métricas da mesma janela de atribuição e distinguir clique, lead qualificado e compra paga.
