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

O cabeçalho da vitrine usa o título real da campanha em destaque que fornece os produtos. Exceções de preço de um único SKU não renomeiam toda a campanha. Sem campanha, o texto é “Produtos em destaque”. Mantém o estilo visual e não transforma o título em link.

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
