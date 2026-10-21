# Ecommerce Aerion

O CRM importa dados de uma loja WooCommerce, uma propriedade GA4 e uma conta de anúncios de cada plataforma (Google e Meta). Não altera pedidos, produtos, cupons ou campanhas. Não cria contatos nem dispara mensagens.

## Configuração do servidor

Defina no ambiente persistente do backend, inclusive no serviço worker se houver:

```dotenv
ECOMMERCE_ENCRYPTION_KEY=<32 bytes aleatórios em hexadecimal: 64 caracteres>
ECOMMERCE_PUBLIC_URL=https://dominio-do-crm
# Opcionais, para atualizações controladas de versão:
ECOMMERCE_GOOGLE_ADS_VERSION=v25
ECOMMERCE_META_API_VERSION=v25.0
```

A chave cifra credenciais com AES-256-GCM. Guarde-a no gerenciador de segredos e no backup operacional; mantenha o mesmo valor entre deploys. Trocar/perder a chave impede ler credenciais existentes. Não use a senha da VPS nem a chave de sessão do CRM como chave Ecommerce. As credenciais são inseridas por um administrador em **Ecommerce → Conexões**, salvas cifradas no PostgreSQL e nunca devolvidas ao navegador.

As tabelas `ecommerce_connections`, `ecommerce_records`, `ecommerce_webhooks` e `ecommerce_oauth_states` são criadas de forma aditiva na inicialização. O banco do WordPress não é acessado diretamente pelo CRM. O backup do PostgreSQL deve incluir essas tabelas; a chave de criptografia precisa de backup separado.

Em **Usuários**, conceda a permissão **Ecommerce → Ver** aos usuários escolhidos. O acesso amplo legado não libera esse módulo automaticamente. Administradores podem configurar conexões; a opção Editar não permite alterar a loja ou os anúncios.

## WooCommerce e relatórios Aerion

1. Em WooCommerce → Configurações → Avançado → API REST, gere uma chave com acesso **Read**, associada a um usuário autorizado a consultar pedidos, produtos, cupons e configurações da loja.
2. No CRM, informe domínio HTTPS público, Consumer Key e Consumer Secret. Defina um segredo aleatório de pelo menos 32 caracteres para os webhooks.
3. Configure webhooks de pedido criado, atualizado e excluído, usando o mesmo segredo e a URL `https://dominio-do-crm/api/ecommerce/webhooks/woocommerce`. O receptor valida o HMAC sobre os bytes originais e registra apenas ID, tópico e ID da entrega. O processamento busca o estado atual do pedido na API.
4. Para links/visitas Aerion, inclua e ative o plugin **Aerion Ecommerce Reports** no projeto WordPress. A versão canônica está em `integrations/wordpress/aerion-ecommerce-reports.php`. O instalador `install-into-website.ps1 -WebsiteRoot <raiz-do-site>` adiciona o plugin ao Dockerfile e ao entrypoint sem executar deploy. Ele recusa substituir conteúdo divergente.
5. Crie um usuário técnico com a função **Aerion — Leitor de relatórios**, disponibilizada ao ativar o plugin, e gere uma Application Password em seu perfil. Informe usuário e senha de aplicativo nos campos de relatórios do CRM. Essa função permite ler somente os relatórios privados Aerion, além da capacidade básica `read`; não concede gestão da loja.
6. Clique em **Testar acesso salvo** e **Sincronizar agora**. O relatório de vendas funciona sem o plugin; links e visitas próprios dependem dele.

O plugin expõe somente `GET /wp-json/aerion-reports/v1/health`, `/links` e `/visits`. Exige a capacidade `aerion_read_reports`, não exporta hashes de sessão nem dados de clientes e envia `Cache-Control: private, no-store`. Visitas são agregadas por link/dia em UTC, como na tabela original. Links são atribuídos conforme o cookie existente do Aerion Core: último link em até 30 dias. O módulo não instala tags nem altera consentimento.

## Google Analytics 4

1. Use um projeto Google Cloud da Aerion e habilite a Google Analytics Data API.
2. Crie uma conta de serviço e conceda ao e-mail dela o papel de leitor na propriedade GA4.
3. Informe o ID numérico da propriedade (não o Measurement ID `G-...`) e o JSON da conta de serviço.
4. Teste o acesso. A importação usa apenas o escopo `analytics.readonly`.

Quando a organização bloqueia a criação de chaves de contas de serviço, use **Workload Identity Federation**, preservando `iam.disableServiceAccountKeyCreation`. A VPS pode emitir uma asserção OIDC RS256 com validade de cinco minutos, validada por um provedor exclusivo com JWKS carregado, emissor e audiência definidos e condição sobre o subject. Conceda `roles/iam.workloadIdentityUser` na conta técnica somente ao principal desse subject; não conceda papéis de projeto à identidade. O conector troca a asserção no STS e solicita ao IAM Credentials um token temporário restrito ao escopo da plataforma.

O campo de credenciais aceita também este formato operacional (valores ilustrativos, sem credenciais reais):

```json
{
  "type": "workload_identity",
  "client_email": "reader@PROJECT_ID.iam.gserviceaccount.com",
  "audience": "//iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/providers/PROVIDER_ID",
  "issuer": "https://dominio-do-crm",
  "subject": "ecommerce-reader",
  "token_audience": "aerion-ecommerce",
  "key_id": "ID_DA_CHAVE_DO_EMISSOR",
  "private_key": "CHAVE_PRIVADA_PEM_DO_EMISSOR_DA_VPS"
}
```

A chave acima pertence ao emissor OIDC da VPS, não à conta de serviço Google. Mantenha-a no armazenamento privado operacional e cifrada no CRM; nunca a inclua no repositório. Habilite também as APIs IAM Service Account Credentials e Security Token Service. Rotacione a chave atualizando o JWKS e as credenciais cifradas antes de remover a chave anterior. A autenticação federada não concede acesso aos dados: ainda é necessário adicionar a conta técnica como Visualizador na propriedade GA4.

São importados totais diários, aquisição por origem/mídia/campanha/conteúdo, páginas de entrada e ocorrências dos eventos `view_item`, `add_to_cart`, `begin_checkout` e `purchase`. Usuários ativos são exibidos por dia; não são somados como pessoas únicas do período. O fuso da propriedade e os avisos de cobertura retornados pelo GA4 são preservados. Ausência de eventos não comprova que a tag esteja funcionando: validar no navegador, DebugView e, para Meta, Events Manager.

## Google Ads

1. Habilite a Google Ads API no projeto Google Cloud e obtenha acesso de produção conforme o processo atual de aprovação do projeto. O fluxo de developer token foi descontinuado em setembro de 2026.
2. Configure o consentimento OAuth e um cliente do tipo aplicativo Web. A publicação/verificação do aplicativo deve permitir acesso offline durável; modo de teste externo pode exigir reautorização frequente.
3. Cadastre a URI exata mostrada na tela Conexões: `https://dominio-do-crm/api/ecommerce/oauth/google/callback`.
4. Salve Client ID, Client Secret e ID da conta anunciante. Informe o ID da conta administradora apenas se necessária.
5. Clique em **Autorizar Google Ads**, entre com uma conta que tenha acesso de leitura ao anunciante e conclua a autorização. O refresh token é obtido no backend e armazenado cifrado.

A API usa o escopo `adwords`, que não é um escopo exclusivo de leitura. A restrição vem do papel da conta Google e dos conectores, que só executam consultas. O callback valida estado temporário, cookie e identidade da configuração; o estado só pode ser consumido uma vez.

Alternativamente, selecione **Conta técnica Google** em Autenticação Google Ads e informe as credenciais JSON da conta de serviço ou da identidade federada descrita acima. Nesse modo, Client ID/Secret e autorização OAuth de usuário não são necessários. Adicione o e-mail técnico ao anunciante com acesso **Somente leitura** e mantenha a aprovação de produção da API no projeto Google Cloud. Os tokens do Analytics e do Ads são emitidos e armazenados em cache separadamente por escopo. Para retornar ao OAuth de usuário, selecione esse modo, salve e autorize novamente.

## Meta Ads

Use um aplicativo pertencente à Aerion, configure o acesso necessário à Marketing API e associe um usuário de sistema à conta de anúncios com capacidade de análise. Informe ID da conta e token com `ads_read`. Requisitos de acesso/revisão do aplicativo dependem de sua configuração no Meta Business. Tokens podem ser revogados ou expirar: o painel registra falha e permite substituí-los.

Um token de usuário concedido por OAuth com `ads_read` também pode ser usado após validar o acesso direto à conta pela API. A autorização do MCP no computador e a credencial do servidor são independentes: a sincronização da VPS não deve depender de uma sessão local do Codex. Quando a provisão registrar `authorization_expires_at` nos metadados da conexão, a tela Conexões mostra a data de validade. Renove antes dessa data; não trate um token OAuth de 60 dias como permanente. Testar o acesso preserva esses metadados e a cobertura histórica. Ao substituir o token, a validade anterior é removida até ser confirmada para a nova credencial.

A Insights API é consultada por campanha/dia. As conversões de compra usam uma única categoria agregada (`omni_purchase`, com fallback em `purchase`), sem somar categorias sobrepostas. A janela solicitada é 7 dias após clique e 1 dia após visualização. O módulo não adiciona Pixel ou Conversions API: isso exige primeiro auditar as tags já instaladas, consentimento, eventos e deduplicação por `event_id`.

## Métricas e limites

- Receita comercial: soma dos itens de pedidos com pagamento registrado, após descontos e reembolsos discriminados de itens, excluindo frete e impostos. Pedidos pendentes, falhos, cancelados e na lixeira não somam receita. Reembolsos posteriores corrigem o período original do pagamento.
- Reembolsos lançados apenas como valor, sem separar produto/frete/impostos, ficam explicitamente pendentes de conciliação. O painel mostra o valor não discriminado e avisa que ele ainda não foi descontado da receita de produtos. Não inferir a distribuição desses valores.
- Pedidos totalmente reembolsados permanecem como pedidos que tiveram pagamento; sua receita líquida de itens tende a zero. A contagem não representa pedidos líquidos de devoluções.
- Consolidação financeira em BRL; outras moedas ficam identificadas e fora dos totais consolidados. Não há conversão cambial automática. Relatórios de mídia preservam moeda e dia no fuso da conta.
- Compras GA4, conversões Google/Meta e pedidos WooCommerce são medidas distintas. Não somar conversões das plataformas nem compará-las como se tivessem a mesma janela. As conversões Google podem incluir ações além de compra. ROAS de mídia usa valor de conversão da plataforma.
- Receita de pedido com vários cupons aparece associada a cada cupom. Não somar essas linhas como receita única. Desconto de cupom reflete a aplicação original, antes de eventual devolução.
- Links Aerion medem somente links registrados pelo gerador existente. Visitantes-dia não representa pessoas únicas no período. Identidade de campanha não é inferida por nome e UTMs ausentes não são reconstruídas.
- API não conectada aparece indisponível, não zero. Importações parciais e dados antigos mantêm sinalização e timestamp. Abertura de relatório consulta o PostgreSQL local; não dispara chamadas às plataformas.

## Sincronização e diagnóstico

O cron verifica conexões a cada minuto. Cada fonte tem seu próprio lock PostgreSQL, compartilhado entre réplicas. As fontes podem avançar em paralelo. Lotes persistem o cursor; falhas não publicam um lote incompleto de métricas nem apagam o checkpoint.

O bootstrap solicita até um ano de dados disponíveis. WooCommerce reconcilia alterações a cada 15 minutos, com limite superior fixo por ciclo, sobreposição no watermark e upsert por ID. Produtos e cupons são relidos por páginas. Webhooks aceleram a reconciliação; o polling recupera atualizações perdidas. GA4 e anúncios atualizam a cada hora, reconsultam dias recentes e reconciliam 90 dias diariamente. Atrasos da plataforma continuam existindo. Ajustes de atribuição mais antigos que 90 dias exigem reimportação operacional.

Na tela Conexões, acompanhe erro, progresso, último sucesso e próxima tentativa. HTTP 429 aplica espera; acessos recusados exigem revisão de autorização. Ao trocar a identidade da fonte, os dados anteriores daquela fonte são removidos para não misturar lojas/contas. Desativar uma conexão conserva o histórico já importado. Campos secretos em branco preservam os valores salvos.

O rodapé informa desde quando cada fonte teve histórico solicitado. Comparações comerciais anteriores a essa cobertura ficam indisponíveis. Uma falha no plugin de links/visitas não interrompe os pedidos WooCommerce: o painel mostra o erro específico e o último sucesso dos relatórios Aerion. A recuperação usa o próprio checkpoint de visitas, limitado ao ano solicitado. Produtos, cupons e links removidos da origem são retirados do catálogo local apenas após concluir a leitura de todas as páginas daquele catálogo; pedidos históricos preservam seus itens e cupons.

## Verificação e publicação

```sh
cd backend
npm run test:ecommerce
# Defina ECOMMERCE_TEST_DATABASE_URL para executar também a integração PostgreSQL.
cd ../frontend
npm test -- --watchAll=false --runInBand EcommerceView.test.js
npm run build
```

Os testes de integração criam e removem um schema isolado no banco de teste; não aponte essa variável para produção. Os testes PHP rodam com `php integrations/wordpress/reports.test.php` na raiz, ou no container `php:8.2-cli` com a pasta montada somente para leitura. O CI exige os testes do backend/bridge; as telas têm testes próprios.

CRM em produção somente via branch `main` no GitHub e CI/GHCR. Para WordPress, seguir também `ops/production/README.md` do projeto da loja e usar `/usr/local/sbin/aerion-wordpress-deploy IMAGE` na publicação da imagem aprovada. Não executar `compose up` diretamente nem copiar código de desenvolvimento para produção. Ativar o plugin e configurar contas são etapas operacionais posteriores ao deploy.

## Análise consolidada e medição

O menu reúne visão geral, vendas/produtos (com cupons), marketing (mídia, tráfego e UTMs) e conexões. O gráfico compara receita, investimento total/por plataforma e pedidos ainda pendentes, com legendas selecionáveis e agrupamento diário/semanal/mensal; volume fica em modo separado. Pedidos pendentes são apenas `pending`/`on-hold` sem pagamento em BRL, pelo valor total incluindo frete e impostos; falhas e cancelamentos não entram nesse saldo. A série diária representa a situação atual de pedidos criados naquele dia.

CPC = investimento/cliques; CTR = cliques/impressões; CPM = investimento×1000/impressões; CPA = investimento/conversões informadas; ROAS atribuído = valor atribuído/investimento. Os totais usam somas ponderadas, nunca média dos índices de campanhas. O retorno da loja (MER) usa receita de produtos WooCommerce/investimento e não representa atribuição. O consolidado inclui somente BRL e sinaliza plataformas ausentes. ROAS entre plataformas pode conter dupla atribuição.

A política de eventos WooCommerce fica em `integrations/wordpress/measurement.php`, incluída no plugin 1.1.1. O instalador copia os dois arquivos para o projeto WordPress; para atualizar o feed revisado, passar também `-ExpectedPreviousMerchantHash <SHA256 verificado>`. Ele recusa sobrescrever versão divergente. A fonte e os testes são validados no CI antes de qualquer deploy. Auditoria, limitações e próximas verificações em [ECOMMERCE-MEASUREMENT-AUDIT.md](ECOMMERCE-MEASUREMENT-AUDIT.md).

O desconto Pix da loja é uma taxa negativa (`Desconto no Pix` ou `Mercado Pago Discount`), além dos descontos de cupom. A normalização desconta esse valor das receitas de produtos com rateio em centavos, considera eventual devolução da própria taxa no reembolso e não classifica taxas de frete como desconto de produto. O evento de compra aplica o mesmo desconto e ajusta os preços dos itens; frete, impostos e taxas positivas não entram no valor dos produtos.
