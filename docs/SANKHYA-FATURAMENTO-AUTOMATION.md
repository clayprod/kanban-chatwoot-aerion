# Automação do faturamento Sankhya — diagnóstico em 22/10/2026

## Resultado

O proxy documentado permite consultar pedidos da empresa **102**, mas não oferece acesso à **100** nem consultas livres a tabelas do ERP. Ele não atende, sozinho, à substituição integral da carga manual das duas empresas. O nome `api-empresa100.gohobby.com.br` não representa a autorização: o PDF v3 restringe explicitamente as operações à 102, inclusive sobrescrevendo `codigoEmpresa` enviado pelo cliente.

Referência: `Proxy-Sankhya-API-Reference-Parceiro-v3.pdf`, na raiz do projeto WordPress `aerion-elevate-hub`, páginas 2, 5 e 6. Documento privado de parceiro; a chave deve permanecer no servidor e não é incluída neste diagnóstico.

## Testes de leitura, sem modificar o ERP

- Credencial de parceiro existente no WordPress: configurada; integração em modo `live`, empresa 102.
- `GET /v1/vendas/pedidos?page=0`: HTTP 200; seis registros, todos com `codigoEmpresa=102`. Resposta com `pagination.page="0"`, `total="12"` e `hasMore="false"`. A divergência entre total e registros visíveis não permite afirmar que o parceiro vê todos os pedidos; confirmar o significado do total e o recorte aplicado.
- `GET /v1/vendas/nfe?page=0`: HTTP 502 em duas tentativas; mensagem `Resposta do Sankhya em formato inesperado`. O proxy falha de forma fechada; não tentar contornar o filtro de empresa/produtos.
- Nenhum cliente, pedido, nota ou pagamento foi criado, cancelado ou alterado.

O contrato expõe listagem/consulta de NF-e e DANFE. O vínculo pedido–nota vem de `codigoPedidoOrigem` na consulta individual de NF-e; não está na listagem. Isso permite conciliação quando a leitura estiver funcionando, mas não equivale a autorização para emitir notas ou dar baixa no financeiro.

## Fonte atual do dashboard

`backend/index.js` consulta o PostgreSQL indicado por `FATURAMENTO_DATABASE_URL`, sem passar pelo Metabase. O Metabase e o Kanban consomem a base carregada pelo fluxo de exportação/importação. A conexão de produção existe e não há overrides `FATURAMENTO_QUERY*`.

Os quatro relatórios de realizado usam `vendas`, filtrando grupos cuja descrição começa com `AERION` e `natureza_nf2='Venda'`. Somam `valor_total_prod` e contam `numero_nota` distinto; não há filtro explícito por empresa nesses SQLs. As metas continuam em `metas_aerion` e não devem ser substituídas por pedidos.

O esquema atual de `vendas` inclui `empresa`, `numero_unico`, `numero_nota`, `data_de_faturamento`, `codigo_do_produto`, `cod_grupoprod`, `valor_total_prod`, `codigo_vendedor`, `descricao_vendedor`, `situacao_nf`, `natureza_nf2`, `arquivo_origem` e `importado_em`. São dados por item; somar `valor_total_nota` em cada linha duplicaria o cabeçalho. O `valorNota` do proxy também não pode substituir automaticamente a receita de produtos, por diferenças de frete, impostos e descontos.

## Contrato necessário para automatizar as empresas 100 e 102

Solicitação técnica para encaminhar ao responsável pelo middleware (não enviada automaticamente):

> Precisamos de uma integração gerencial somente de leitura para o faturamento Aerion das empresas 100 e 102. O proxy de parceiro v3 atual força a 102, e a listagem `/v1/vendas/nfe?page=0` está retornando 502, “Resposta do Sankhya em formato inesperado”. Poderiam corrigir essa rota e disponibilizar um acesso gerencial autorizado às duas empresas? Precisamos de notas e itens, data de faturamento, NUNOTA, sequência do item, situação fiscal/cancelamento, devoluções, valor dos produtos/descontos, produto/grupo e vendedor. Precisamos também de paginação estável, filtros de período e alterações desde uma data, política de exclusões e limites de consulta. Confirmem se a leitura de notas inclui todo o recorte gerencial Aerion ou somente produtos autorizados ao parceiro, e como identificar a origem pedido–nota. Não precisamos de permissão para criar pedidos, emitir/cancelar notas ou baixar pagamentos para esta automação.

## Implementação após liberação

1. Ler pedidos e notas em bases separadas: pedido é carteira, nota faturada é realizado. Pagamento recebido é outra medida e exige dados financeiros próprios.
2. Guardar uma cópia operacional sincronizada em tabelas novas. Usar chaves de empresa + NUNOTA e empresa + NUNOTA + sequência do item, sem usar número visível da nota como chave global.
3. Atualizar por inclusão/alteração com operações idempotentes e checkpoints transacionais; revisar cancelamentos e devoluções de períodos anteriores. Uma resposta 502 não apaga dados anteriores nem marca o lote como completo.
4. Percorrer a paginação e normalizar booleanos textuais (`"false"` não é verdadeiro). Não parar uma varredura por página vazia quando o contrato indicar continuação.
5. Conciliar por mês, empresa, vendedor e produto com a base atual. Definir expressamente o recorte AERION, as empresas e o tratamento de devoluções. O proxy de produtos tem uma lista restrita; isso não comprova cobertura do catálogo gerencial inteiro.
6. Só depois da conciliação alterar a origem dos relatórios do Kanban. Manter as metas comerciais e a carga antiga preservadas para comparação e retorno.

Não foi ativada uma importação parcial da 102 como se fosse o faturamento consolidado das duas empresas. O bloqueio atual é de escopo e disponibilidade da API, não do acesso às tabelas do Metabase.
