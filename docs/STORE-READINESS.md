# Validação da loja — 04/11/2026

## Evidência obtida

- Seis conexões do Ecommerce disponíveis; Merchant com 29 ofertas aprovadas.
- Meta com 30 itens, uma fonte horária e nenhuma rejeição observada.
- Navegação pública anônima: produto, carrinho e checkout enviam os eventos GA4/Meta esperados; nenhuma compra ou lead foi criado, e o carrinho foi esvaziado.
- Ambiente isolado: banco vazio, produtos sintéticos, mesma versão WordPress/WooCommerce/plugins, rede Docker interna, email e chamadas externas bloqueados. Acesso somente por túnel SSH. Nenhuma credencial ou dado de cliente foi copiado.
- Quatro cenários de navegador: pagamento aprovado, pendente, recusado e aprovado com consentimento negado; desktop e celular. A compra paga fornece SKU, BRL e valor dos produtos sem frete. Pendente/recusado não geram Purchase. Recarregar a confirmação não envia outra compra; compra sem consentimento não envia medição publicitária/Analytics. Os pedidos existem exclusivamente no banco isolado.
- Os hits de Analytics são interceptados antes de sair do navegador. Sinais auxiliares de `google.com` não são contados como um segundo envio a `google-analytics.com`/`analytics.google.com`. O replay de consentimento conserva o mesmo ID de transação.
- Rótulos Meta: compradores pagos em `GENERAL_CUSTOMERS`; visitantes, interesse, carrinho e checkout em `ENGAGED_USERS`. Regras e campanhas preservadas.

## Código e operação

O cabeçalho da vitrine usa o título real da campanha em destaque que fornece os produtos. Exceções de preço de um único SKU não renomeiam toda a campanha. Sem campanha, o texto é “Produtos em destaque”. Mantém o estilo visual de texto; o título é um link para a campanha ativa, conforme a preferência mais recente.

O bridge privado `marketing-webhooks` exige `aerion_read_reports` e retorna apenas metadados e impressões digitais SHA-256 de segredos fortes; o segredo bruto nunca é enviado. O worker confronta ID, tópico, status, destino e impressão digital. Uma leitura indisponível continua sem confirmação; não é declarada sucesso.

A publicação SEO aprovada pode ser habilitada pela opção WordPress `aerion_approved_seo_output_enabled=yes`, mantendo capacidade específica, revisão prévia, versão do produto e proteção contra concorrência. Habilitar o mecanismo não aprova ou publica textos automaticamente.

Fixtures reproduzíveis: `integrations/wordpress/testing/seed.php`, `isolation.php` e `assert-orders.php`; navegador em `scripts/validate-isolated-store.cjs`. A fixture exige `AERION_READINESS_TEST=1` e nunca deve ser instalada na loja de produção. O resultado/screenshot fica em `.tmp/checkout-validation/`.

## Pendências que impedem declarar homologação completa

- Mercado Pago: só há credenciais de produção configuradas. O gateway simulado valida o fluxo WooCommerce, não comprova autorização Pix/cartão, antifraude, reembolso ou webhook real da adquirente. Exige credenciais/contas sandbox do aplicativo existente.
- Compra GA4 de servidor: depende de segredo Measurement Protocol, validação e prova atualizada de consentimento; não habilitar apenas porque o checkout simulado aprovou.
- Emissor Meta de servidor existente: auditar origem, valor, consentimento e IDs antes de habilitar ou adicionar qualquer emissor.
- Campanhas: orçamento total/divisão e criativos aprovados continuam obrigatórios. Não ativar por inferência.
- Base CRM: ausência de prova publicitária continua impedindo envio. Cookie de navegação não concede autorização à base inteira.
- Merchant: justificar a ausência de `EVO-NEST` sem trocar o mecanismo de feed existente.
- Core Web Vitals, revogação e continuidade entre domínios exigem evidência própria; HTTP 200 e consentimento inicial não cobrem esses testes.

## Deploy e conferência final em 04/11

- PR #7 integrada em `c8f2539`, CI concluída. WordPress em `aerion-wordpress:readiness-main-c8f2539`, usando o wrapper protegido. Exatamente dois arquivos alterados e outros 658 preservados. O código dos dois arquivos também foi sincronizado no projeto local do G Drive.
- Os dois endereços públicos da loja retornaram `Black November 🔥` em `<h2>`, com aparência de texto. O ajuste seguinte restaura o link do título para a campanha, conforme solicitado.
- Os três webhooks assinados de produtos foram conferidos pelo bridge privado: estado operacional, sem rotação dos segredos existentes.
- O mecanismo SEO aprovado está habilitado e a identidade de integração possui a capacidade específica. Nenhum texto novo foi publicado ou aprovado automaticamente.
- Rótulos dos cinco públicos Meta relidos diretamente da API: quatro `engaged_users` e compradores `general_customers`. A organização não altera regras ou campanhas.
- Os públicos GA4 existem; a exclusão de compradores 180d é aplicada na campanha, conforme a estratégia existente. Sua criação não comprova que as exclusões das futuras campanhas já foram concluídas.
- A API Admin GA4 permite ler o fluxo `12276810230`, mas nega leitura de seus segredos Measurement Protocol com `403 PERMISSION_DENIED: The caller does not have permission`. A tag GTM do navegador não utiliza esse segredo. A conversão Ads de compra existente `7463161089` permanece primária; nenhuma segunda ação primária de compra foi criada.

O dashboard separa confirmação adicional GA4 de servidor, emissor Meta de servidor, públicos de eventos por plataforma e listas de cadastros CRM. Públicos com os cinco IDs retornados ficam aguardando processamento externo, com revisão de regras explícita; erro ou recurso ausente mantém pendência. Isso não atesta tamanho, entrega, exclusão ou aprovação da plataforma.

Não foi adotado envio de HTTP que se passe pelo navegador para contornar a permissão GA4. O caminho suportado atual usa o GTM web; para confirmação independente de o comprador retornar à página de sucesso, falta habilitar uma credencial de servidor com acesso autorizado e completar a validação de consentimento. Um administrador pode fornecer um segredo privado do fluxo existente sem conceder administração geral à integração.

Auditoria móvel em laboratório (CPU 4x e rede 1,6 Mbps), sem interação: loja LCP 3,45s/CLS 0,001; produto Mini 7 LCP 12,66s/CLS 0,423. Não são Core Web Vitals de usuários reais. O produto demanda investigação de renderização/galeria antes de declarar otimização completa; nenhuma alteração visual especulativa foi aplicada com base somente nesse ensaio.

O EVO-NEST não entra no feed Google por falta de peso, comprimento, largura e altura, verificados diretamente no WooCommerce. Está sem estoque e sem encomenda habilitada. Não foram inventadas medidas ou alterada sua disponibilidade para forçar aprovação.

## Integração Hub e revogação de consentimento

O Hub passou nos 853 testes da CI após configurar o Chrome disponível no runner; API e worker publicados a partir de `main`. CRM conectado à marca existente `aerion-technologies` pela rede Docker privada autenticada. A resposta pública 403 não foi tratada como sucesso. Capabilities de imagens/vídeos lidas e plano do Mini 7 com recomendação real da IA salvo para revisão, sem verba ou ativação. Contrato de UI em `CAMPAIGN-ASSISTANT-API.md`; a conexão de backend não comprova que a interface já consome todas as novas ações.

O teste identificou que “Aceitar todos” mantém um sinal interno do Moove que impede salvar uma revogação subsequente na mesma página. A opção nativa de recarga após decisão resolve sem um segundo gravador de cookies. Teste de navegador passou em desktop e celular: negado inicialmente, permitido após aceite, negado após salvar revogação e persistido negado após recarga. Coleta externa interceptada; nenhum pedido ou lead criado. Depois da revogação somente sinais Google `G100` sem armazenamento publicitário/Analytics são admitidos pelo teste, conforme o Consent Mode; evento Meta ou coleta GA4 com armazenamento permitido reprova. Script reproduzível: `scripts/validate-store-consent.cjs` (`--candidate-native-reload` testa a opção antes de implantá-la).

## Verificação posterior e interface do assistente

- WordPress implantado pelo wrapper protegido em `aerion-wordpress:readiness-main-75f7aad`; os testes acima passaram na implantação real, sem injeção da opção candidata. O título Black November permanece clicável com aparência de texto nos dois domínios. Código do site atualizado também no projeto do G Drive.
- Conexão do Hub persistida no PostgreSQL com criptografia autenticada, verificada após recriação do serviço. O token não é exposto ao navegador nem depende de variáveis temporárias do Docker.
- Interface acrescenta seleção de produto, objetivo, plano assistido por IA, produção de imagem/vídeo por etapa, limite de estimativa de geração em USD, acompanhamento e seleção/aprovação explícita. Mantém o roteiro e os gráficos existentes. Verificada em 1440px e 390px sem rolagem horizontal; testes de criação, falha e aprovação executados.
- Vídeo real do Mini 7: trabalho `c8e54d41-470a-4867-8bb9-5699adbd61ef`, 4 segundos, arquivo MP4 recebido pelo CRM, custo informado US$ 0,36666. Continua rascunho, sem aprovação ou publicação automática.
- Imagem real gerada via OpenRouter: trabalho `f75c3b95-70d0-4c37-a4c6-e3648a908965`, custo informado US$ 0,09. Revisão original falhou porque tentou usar ModelArk com saldo vencido. A correção mantém revisão obrigatória na rota disponível e exige resposta estruturada. O mesmo arquivo foi revisado novamente, sem outra geração, e passou a trava automática (85/100). A análise apontou fidelidade técnica 70/100 e identidade visual 60/100; essas observações precisam ser revistas por uma pessoa antes de aprovação. O CRM exibe a análise e seus pontos de atenção. Não confundir análise automática com criativo aprovado.
- Crédito de produção é separado de orçamento publicitário; teto informado limita a estimativa antes da geração e não garante custo final exato do provedor. Nenhuma campanha foi ativada.

Auditoria em leitura do Facebook for WooCommerce instalado: configuração `facebook_config.pixel_id` igual a `0`, sem Pixel válido confirmado para esse emissor. Seu código de Purchase permite estados `pending` e `on-hold`; portanto não conectar CAPI desse plugin sem primeiro restringir a pagamento efetivo, comprovar consentimento e reconciliar o mesmo `event_id` com o GTM. O Pixel válido do GTM é uma integração distinta. Nenhum evento sintético foi enviado e nenhum segundo emissor foi habilitado.
