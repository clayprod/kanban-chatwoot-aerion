# Campanhas com IA e ChatGPT Ads

Entrada: **Ecommerce → Campanhas com IA**, ou `/?ecommerce=assistant`.
A área reúne planejamento por produto/família/oferta, comparação de estratégias,
evidências das proteções existentes de Google/Meta e geração/revisão de ativos pelo
Content Hub. É um assistente guiado; não é uma conversa livre nem um operador que
ativa anúncios sem aprovação.

## Conector entregue

- Administrador informa a **Advertiser API key** em campo protegido. A chave vem do
  Ads Manager, Settings → API keys, e não da API de modelos OpenAI.
- `PUT /api/ecommerce/marketing/chatgpt-ads/connection` verifica `GET /ad_account`
  antes de substituir a configuração; criptografia autenticada no PostgreSQL.
  A chave não volta no relatório. `enabled:false` desabilita e preserva os dados.
- `POST /api/ecommerce/marketing/chatgpt-ads/sync` enfileira leitura paginada de
  campanhas, feeds, públicos e definições de eventos. Depois da primeira conexão,
  há consulta diária, lock próprio e retentativas da fila existente.
- Somente o host oficial `https://api.ads.openai.com/v1/` recebe a credencial;
  redirecionamentos são recusados. Erros externos são sanitizados.
- Cada recurso tem cobertura independente. Falha mantém o último resultado,
  sinalizado como indisponível/preservado. Uma consulta parcial não é sucesso completo.
- O conector não escreve na conta de anúncios, não envia membros de públicos e
  não instala Pixel/CAPI. Consulta de definições não comprova recebimento de eventos.

## Próximas etapas dependentes da conta

1. Confirmar conta, moeda, faturamento, revisão e países disponíveis. Se API keys
   ou recursos retornarem acesso negado, solicitar a liberação à OpenAI. Não
   contornar permissões nem usar uma chave de modelos como substituição.
2. Validar feed/SFTP e atributos obrigatórios usando os SKUs e preços públicos
   reais. Não criar um feed concorrente em Google ou Meta.
3. Criar fonte de conversão e segredo próprios, guardado no servidor. Validar em
   ambiente isolado consentimento inicialmente negado, aceito e revogado. Somente
   pagamento confirmado pode produzir a compra. Browser e servidor devem usar o
   mesmo event ID; valores da API precisam da unidade monetária documentada.
4. Verificar elegibilidade e consentimento antes de transmitir identificadores.
   A documentação usa 25.000 usuários correspondidos como limiar de planejamento
   para inclusão/ajuste de lance; exclusões prontas não exigem esse mínimo.
   Não copiar automaticamente listas de Google/Meta ou a base inteira do CRM.
5. Definir uma terceira parcela explícita de orçamento, sem retirar verbas Google
   ou Meta automaticamente. Aprovar criativos e criar campanhas pausadas antes de
   permitir uma ativação expressa.

## IA nesta aplicação

O plugin oficial **ChatGPT Ads Manager** foi encontrado como instalado no catálogo
do ambiente em 04/11/2026. As ferramentas da integração não foram expostas à sessão;
portanto a autenticação e a conta ainda não foram verificadas por ele. Não há um
MCP personalizado registrado por esta entrega. A instalação do plugin, a
autorização da conta e a configuração do dashboard são estados independentes.

## Referências verificadas em 04/11/2026

- https://developers.openai.com/ads
- https://learn.chatgpt.com/ads/api-reference/authentication
- https://learn.chatgpt.com/ads/api-partner-setup
- https://developers.openai.com/ads/custom-audiences
- https://developers.openai.com/ads/product-feeds
- https://developers.openai.com/ads/measurement-pixel
- https://developers.openai.com/ads/api-reference/conversion-setup

## Validação

Testes cobrem destino fixo e paginação, sanitização de erros, autorização de
administrador, persistência criptografada entre instâncias, substituição inválida,
preservação de snapshots, ausência de identificadores pessoais no relatório,
entrada de navegação, deep link e limpeza do campo de chave após conexão.
Os testes PostgreSQL usam schema isolado na CI. Não há testes que criam compras,
leads, públicos ou anúncios fictícios em produção.
