# Campanhas com IA e ChatGPT Ads

Estado verificado em 05/11/2026. Os números abaixo são uma fotografia da operação;
o dashboard consulta os estados persistidos e a cobertura de cada integração.

## Onde usar

- Conta: **Ecommerce → Marketing → ChatGPT Ads**, `/?ecommerce=chatgpt_ads`.
- Planejamento: **Ecommerce → Campanhas com IA**, `/?ecommerce=assistant`.
- Fluxo: objetivo → recomendação → escolher mídias → revisar.
- Objetivos incluem ajuda para decidir, catálogo geral, ofertas e produto específico.

O planejamento consulta 28 dias completos, contexto da empresa, pagamentos WooCommerce,
catálogo, métricas por origem e públicos agregados. Não inclui cadastros pessoais no
prompt. Lacunas de cobertura e ausência de margem ou verba permanecem explícitas.

## Matriz de operação

| Item | Estado | Evidência ou próximo passo |
| --- | --- | --- |
| Conta ChatGPT Ads | Operacional | Conta ativa, revisão aprovada, BRL, America/Sao_Paulo. |
| Catálogo BR | Operacional | 30 linhas aceitas, zero rejeitadas; API informa 22 produtos elegíveis. Sincronização horária e por mudanças, com SKUs e preços públicos. |
| Pixel e consentimento | Operacional | GTM versão 12; testes desktop e celular de negar, aceitar, revogar e recarregar. SKU de visualização corresponde ao catálogo. |
| Compra por servidor | Habilitada, validação limitada | CAPI aceitou um evento em validate_only. Guardas de pagamento, consentimento, valor e deduplicação testadas. Ainda falta observar uma compra real; nenhum pedido fictício foi criado em produção. |
| Públicos | Estruturas prontas; aguardando população elegível | Cinco listas ready. Sincronização diária habilitada; zero identificadores elegíveis na última execução. Loja e segmentos CRM separados. |
| Acervo Hub | Operacional | 857 imagens/vídeos da marca, incluindo recebidos, gerados e montados; busca, filtro e paginação. |
| Identidade e aprovação | Operacional | Contexto da marca e política hub-policy-v23; briefings de imagem/vídeo; conferência humana de logo, tipografia, cores, composição e dados do produto antes de aprovar. |
| Análise pelo modelo | Dependente do provedor | Hub recebe HTTP 402 do OpenRouter por crédito disponível/reservado. Regularizar em https://openrouter.ai/settings/credits. Proposta por regras está identificada na interface; não é apresentada como análise concluída pelo modelo. |
| Veiculação | Aguardando decisões comerciais | Definir verba por plataforma, margem/CAC e aprovar peças. Nenhuma campanha ChatGPT foi criada ou ativada. Google e Meta existentes foram preservados. |
| Conversões atribuídas ChatGPT | Indisponível | Importação ainda não homologada. A interface não representa ausência de acesso como zero conversões. |

## Criativos e contexto

O Kanban prepara requisitos; o usuário produz no próprio workflow do Hub e seleciona
a mídia existente. Este fluxo não solicita geração automática de imagens ou vídeos.
O Hub consulta get_brand_context e sua política de produção antes da orientação.
O seletor usa o acervo completo da marca, não apenas arquivos desta integração.
Selecionar protege o arquivo contra retenção, mas não aprova nem publica a peça.
Uma alteração relevante no produto exige nova revisão do conteúdo associado.

O modelo recebe contexto agregado, com limites de saída e tempo. Recibos por plano
evitam cobrar novamente uma análise concluída; resultados incertos exigem conciliação.
Em bloqueio de crédito, uma proposta explicitamente baseada em regras permite preparar
briefings. A análise do modelo continua pendente e pode substituir essa proposta.

## Segurança e recuperação

- Credenciais e ledger de públicos criptografados no PostgreSQL; não retornam em relatórios.
- API de anúncios limitada ao host oficial, sem seguir redirecionamentos com credenciais.
- Fila persistente, bloqueios por integração, paginação, backoff e snapshots preservados.
- Catálogo próprio SFTP com chave de host fixada; projeção vazia não apaga catálogo válido.
- A conta não autoriza a opção nativa de substituição completa do feed (HTTP 403).
  O fallback publica a projeção e marca itens removidos como indisponíveis por Delta.
  Liberação opcional deve ser solicitada à OpenAI; o diagnóstico registra feed e ação.
- Públicos exigem prova de elegibilidade publicitária; opt-out prevalece. Compradores
  da loja precisam de pagamento nos últimos 180 dias. CRM mantém segmentos próprios.
- Remoções precedem inclusões; corpo e chave idempotente são persistidos antes do envio,
  com espera pela conclusão assíncrona e recuperação de respostas perdidas.
- Compra exige pagamento confirmado e consentimento válido, com o mesmo event ID
  no navegador e servidor. Testes externos usam validate_only ou interceptação de rede.
- Verba ChatGPT exige parcela própria; não há transferência automática de Google/Meta.

## Implantação e validação

Código publicado por main → CI → imagem. WordPress recebeu apenas measurement.php
sobre a imagem de produção verificada, preservando os outros arquivos e ajustes de
agentes. A cópia correspondente no projeto WordPress do Drive foi atualizada.

CI cobre PostgreSQL, recuperação, autorização, consentimento, compra paga, feed público,
sincronização de públicos e navegação. Testes de navegador não criaram pedidos, leads
ou eventos publicitários: requisições de medição foram interceptadas. Não se deve
interpretar esses testes como uma transação financeira real homologada.

## MCP e dashboard

O plugin oficial ChatGPT Ads Manager foi encontrado instalado no catálogo do ambiente,
mas suas ferramentas não estavam expostas à sessão. A autenticação pelo plugin não foi
verificada. O dashboard usa seu conector próprio; instalação de plugin, autorização MCP
e conexão do dashboard são estados independentes.

## Referências consultadas

- https://developers.openai.com/ads
- https://learn.chatgpt.com/ads/api-reference/authentication
- https://developers.openai.com/ads/custom-audiences
- https://developers.openai.com/ads/product-feeds
- https://developers.openai.com/ads/measurement-pixel
- https://developers.openai.com/ads/api-reference/conversion-setup
