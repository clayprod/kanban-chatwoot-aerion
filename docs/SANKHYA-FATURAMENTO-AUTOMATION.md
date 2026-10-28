# Automação do faturamento Sankhya — diagnóstico em 22/10/2026

## Atualização de 28/10/2026 — contrato v4.1, empresas 100 e 102

O `Proxy-Sankhya-API-Reference-Parceiro-v4.1.pdf` (proxy 1.4.2), na raiz do projeto `aerion-elevate-hub` no drive compartilhado, autoriza a **leitura das duas empresas**. As seções iniciais e os endpoints de pedidos/notas exigem `codigoEmpresa=100` para a 100; a ausência desse parâmetro mantém o padrão 102. A antiga orientação na última página de não enviar empresa está desatualizada em relação ao contrato e às rotas descritas no próprio PDF.

`backend/sankhyaReporting.js` aceita conexões administrativas 100 e 102 e envia `codigoEmpresa` explicitamente em todas as páginas e consultas individuais de NF-e. A listagem pode omitir os itens; nesse caso a sincronização consulta o detalhe da nota antes de publicar a geração. Resposta de outra empresa, outro NUNOTA ou falha no detalhe preserva a última carga completa. Não se usa `valorNota` para substituir valores ausentes de produtos. Permanecem os limites de lote, o isolamento por empresa/recurso e a minimização dos dados armazenados.

`backend/salesRealizado.js` escolhe uma única origem por empresa através de `feed_realizado`: base anterior ou notas autorizadas do proxy. Isso permite a migração independente e evita somar importações antigas aos mesmos documentos automáticos. Se uma empresa automática ainda não tiver carga completa, o relatório sinaliza cobertura parcial sem retornar silenciosamente à importação antiga. O código de moeda nacional `0` só é BRL com configuração explícita `national_currency='BRL'`. A ativação dos gráficos deve considerar a conciliação do recorte de produtos autorizado ao parceiro.

Diagnóstico de produção por consulta somente de leitura em 28/10: apenas a conexão 102 estava cadastrada, habilitada e com `feed_realizado=false`. Pedidos e notas tinham sucesso na sincronização. A geração de notas continha 30 documentos, todos sem valor de produtos e sem identificação BRL no cabeçalho normalizado; essa situação motivou a consulta individual de detalhes. Nenhuma origem financeira foi trocada durante esse diagnóstico.

Teste autenticado no proxy com a chave existente: a primeira página de NF-e da 100 retornou 50 registros, todos da 100, com `hasMore="true"`; a 102 retornou 30, com `hasMore="false"`. A consulta individual funcionou nas duas empresas e trouxe `itens[].valorTotal`. A moeda veio como `<MOEDA CORRENTE>`, código `0`, sem confirmação automática de BRL. A listagem inicial da 100 não representa uma importação completa: é obrigatório continuar a paginação.

Configuração: `PUT /api/sankhya/connections/100` ou `/102`, com a chave enviada por canal de servidor. `POST /api/sankhya/sync` agenda todas as empresas habilitadas. O relatório administrativo informa a fonte financeira de cada empresa em `revenueCompanies`, além dos estados separados dos recursos. A interface identifica empresa, origem e última atualização, inclusive quando uma falha conserva dados anteriores.

Verificação: testes unitários de origem única, indisponibilidade e critérios fiscais; testes PostgreSQL com banco local temporário para as duas empresas, paginação, rejeição de empresa incorreta, consulta de itens e preservação de gerações; testes do status na interface. O CI executa os dois arquivos de testes do Sankhya/realizado. O histórico abaixo descreve contratos e decisões anteriores e não limita a autorização v4.1.

## Composição híbrida autorizada em 23/10/2026

O usuário solicitou alimentar o gráfico existente mantendo a empresa **100 na base atual** e usando a empresa **102 automática**. `backend/salesRealizado.js` atende os quatro endpoints de realizado (mensal, anual, por vendedor mensal e anual) quando a conexão 102 tem `feed_realizado=true`.

- A parcela da 100 mantém a apuração de produtos AERION/Venda do PostgreSQL existente, com filtro explícito `empresa=100`.
- A parcela da 102 usa exclusivamente a última geração completa de pedidos sincronizados. Não soma novamente os registros manuais antigos da 102 nem registros da empresa 3.
- Entram somente pedidos confirmados, não pendentes e que não sejam orçamento. O valor é a soma de `itens[].valorTotal`, sem adicionar frete ou impostos do cabeçalho. Não se usa `valorNota` como substituto do valor dos produtos.
- O código de moeda nacional `0` só é aceito como BRL quando a conexão foi explicitamente configurada com `national_currency='BRL'`. Documentos sem moeda ou valor de produtos identificados são sinalizados como cobertura parcial.
- As respostas incluem valores e contagens separados por empresa, origem, critério e atualização. O gráfico mantém o formato atual e detalha as parcelas no tooltip. A legenda identifica **100: faturamento; 102: pedidos confirmados**. O total é realizado comercial, sem afirmar que os pedidos já são notas faturadas.
- As metas comerciais continuam na mesma tabela. Em falha de página posterior da sincronização, conserva-se a geração completa anterior da 102.

O parâmetro `feed_realizado` é uma ativação administrativa explícita; sem ele, permanece a consulta anterior. O antigo diagnóstico abaixo registra a situação anterior a essa composição. A rota de NF-e com 502 continua sendo um problema separado, sem impedir a alimentação comercial pelos pedidos que o usuário autorizou.

## Resultado

O proxy documentado permite consultar pedidos da empresa **102**, mas não oferece acesso à **100** nem consultas livres a tabelas do ERP. Ele não atende, sozinho, à substituição integral da carga manual das duas empresas. O nome `api-empresa100.gohobby.com.br` não representa a autorização: o PDF v3 restringe explicitamente as operações à 102, inclusive sobrescrevendo `codigoEmpresa` enviado pelo cliente.

Referência: `Proxy-Sankhya-API-Reference-Parceiro-v3.pdf`, na raiz do projeto WordPress `aerion-elevate-hub`, páginas 2, 5 e 6. Documento privado de parceiro; a chave deve permanecer no servidor e não é incluída neste diagnóstico.

## Testes de leitura, sem modificar o ERP

- Credencial de parceiro existente no WordPress: configurada; integração em modo `live`, empresa 102.
- `GET /v1/vendas/pedidos?page=0`: HTTP 200; seis registros, todos com `codigoEmpresa=102`. Resposta com `pagination.page="0"`, `total="12"` e `hasMore="false"`. A divergência entre total e registros visíveis não permite afirmar que o parceiro vê todos os pedidos; confirmar o significado do total e o recorte aplicado.
- `GET /v1/vendas/nfe?page=0`: HTTP 502 em duas tentativas; mensagem `Resposta do Sankhya em formato inesperado`. O proxy falha de forma fechada; não tentar contornar o filtro de empresa/produtos.
- Nenhum cliente, pedido, nota ou pagamento foi criado, cancelado ou alterado.

O contrato expõe listagem/consulta de NF-e e DANFE. O vínculo pedido–nota vem de `codigoPedidoOrigem` na consulta individual de NF-e; não está na listagem. Isso permite conciliação quando a leitura estiver funcionando, mas não equivale a autorização para emitir notas ou dar baixa no financeiro.

Também foram consultados dois NUNOTA da empresa 102 presentes na base gerencial: 57692 e 54442. Ambas as consultas individuais retornaram HTTP 404, `Nota não encontrada`. A consulta 54442 consta como exemplo no PDF v3. Esses retornos não provam inexistência das notas no ERP: o contrato também usa 404 para documentos fora do escopo da chave. O usuário não lembra o pedido usado em uma importação anterior; não há base para afirmar que aquele mesmo fluxo foi reproduzido ou identificar a causa interna da regressão. A integração WordPress tem tanto busca pela API quanto recebimento de DANFE/XML por webhook, e esses caminhos não são equivalentes à listagem gerencial.

## Fonte atual do dashboard

`backend/index.js` consulta o PostgreSQL indicado por `FATURAMENTO_DATABASE_URL`, sem passar pelo Metabase. O Metabase e o Kanban consomem a base carregada pelo fluxo de exportação/importação. A conexão de produção existe e não há overrides `FATURAMENTO_QUERY*`.

Os quatro relatórios de realizado usam `vendas`, filtrando grupos cuja descrição começa com `AERION` e `natureza_nf2='Venda'`. Somam `valor_total_prod` e contam `numero_nota` distinto; não há filtro explícito por empresa nesses SQLs. As metas continuam em `metas_aerion` e não devem ser substituídas por pedidos.

O esquema atual de `vendas` inclui `empresa`, `numero_unico`, `numero_nota`, `data_de_faturamento`, `codigo_do_produto`, `cod_grupoprod`, `valor_total_prod`, `codigo_vendedor`, `descricao_vendedor`, `situacao_nf`, `natureza_nf2`, `arquivo_origem` e `importado_em`. São dados por item; somar `valor_total_nota` em cada linha duplicaria o cabeçalho. O `valorNota` do proxy também não pode substituir automaticamente a receita de produtos, por diferenças de frete, impostos e descontos.

O recorte atual AERION/Venda retornou registros das empresas 3, 100 e 102; a última importação observada foi em 16/10/2026. Esse recorte antigo não foi alterado como parte da ativação separada da 102. Deve ser revisado na conciliação antes de se apresentar como consolidado exclusivo de 100 e 102.

## Automação parcial da 102 autorizada pelo usuário

O usuário autorizou iniciar com a 102 e incluir a 100 depois. `backend/sankhyaReporting.js` implementa uma sincronização somente de leitura, com configuração cifrada no PostgreSQL e dois fluxos independentes: pedidos e notas fiscais. A empresa 100 é recusada no contrato atual; as tabelas já guardam a empresa na chave para uma futura extensão autorizada.

Prioridade atual junto à Gohobby: corrigir a leitura fiscal da **102**. A ampliação para a 100 é uma segunda etapa. Repetir a listagem com `codigoEmpresa=102&page=0` também retornou 502, com a mesma mensagem de formato inesperado. A consulta de pedidos retornou datas ISO (`2026-10-22`), totais numéricos e moeda descrita como `<MOEDA CORRENTE>`; esse rótulo genérico não foi interpretado automaticamente como confirmação de BRL.

- A cada minuto o agendador verifica o trabalho pendente. Cada recurso faz uma varredura a cada 30 minutos, com lotes limitados a três páginas e checkpoints persistentes.
- Respostas de erro usam espera de 30 minutos, sem interromper o fluxo de pedidos quando a listagem de notas falha. Chaves e corpos de erro upstream não aparecem na resposta ou no log.
- Páginas novas ficam em uma geração separada. Só a conclusão de uma varredura publica a nova geração. Se uma página posterior falhar, o painel conserva a carga anterior inteira, sem misturar os totais antigos e novos.
- Guardam-se somente cabeçalhos necessários à operação, sem dados pessoais do cliente, chave fiscal, endereços ou títulos financeiros. Totais não são consolidados quando a moeda não está identificada como BRL.
- Em **Metas e Resultados**, um botão de atualizar e uma linha discreta mostram a última atualização dos pedidos da 102 e a fonte atual do faturamento. Detalhes do erro ficam no título do texto. Não converte pedidos em receita, nem apresenta ausência de leitura fiscal como zero notas.
- Os gráficos existentes de faturamento continuam na base anterior até a leitura e conciliação fiscal. A contagem de notas com `statusNFe=1` não é, por si só, uma apuração de receita líquida de cancelamentos/devoluções.

API administrativa: `PUT /api/sankhya/connections/102` configura a chave por canal de servidor e habilita explicitamente a conexão; não há credencial padrão. `POST /api/sankhya/sync` solicita o próximo ciclo, sem bloquear a interface. `GET /api/sankhya/report?ano=2026` retorna apenas agregados e estados operacionais. A chave não é retornada ao navegador.

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
