# Análise técnica de licitações

O catálogo em **Licitações → Produtos** atende qualquer setor. Produtos e kits têm preço de venda unitário em BRL, composição, unidade, fontes e versões. PDF, DOC, DOCX, texto e páginas públicas são aceitos (20 MB por arquivo). Textos dinâmicos, documentos ilegíveis e OCR com números de baixa confiança são marcados como incompletos.

## Execução e orçamento

A análise de editais inicia desligada. Defaults por conta: nota base mínima 68, 30 licitações iniciadas por dia, 2 milhões de tokens reservados por dia, considerando o dia de São Paulo. A preparação de fichas cadastradas pelo usuário funciona independentemente da ativação dos editais e compartilha o teto de tokens. Falhas também retêm a reserva conservadora; usage real do provedor é registrado quando disponível. Valores monetários de consumo não são inventados.

O worker roda a cada 15 segundos, com lock PostgreSQL entre processos. Cada etapa é persistida: descoberta, paginação de itens, downloads, extração por trecho e comparação. Trabalhos retomam após reinício. Limites adiam a continuação; a configuração permite antecipar a retomada. Fontes e extrações têm cache por hash e conta. Downloads PNCP passam pelo gate (`bulk`) e `pncpFetch`; varreduras usam o slot de trabalhos pesados.

Entram resultados novos e os antigos ainda abertos, não descartados. A nota de elegibilidade usa `base_score`, jamais o próprio bônus. Buscas podem restringir `search_profile.product_ids`; sem seleção, todos os produtos ativos pertinentes são considerados. O universo completo de itens fica registrado, com os demais identificados como fora do escopo. Itens são paginados até uma página vazia, sem presumir que página curta representa o fim. Documentos são reconferidos antes da publicação do resultado; alteração durante a execução reinicia a leitura com cache.

## Decisão e evidências

A IA extrai fatos e pode associar grandezas; não decide a desigualdade. Valores e unidades devem existir nos trechos citados. Comparações usam aritmética decimal exata para mínimos, máximos, intervalos e igualdade, com conversões conhecidas; unidades literais iguais também são comparáveis. Assim, 40 min reprova mínimo de 41 min, sem arredondamento ou tolerância. Condições diferentes, zoom óptico versus híbrido e desempenho total versus individual não são intercambiáveis. IP e resolução têm verificadores específicos. Outros critérios compostos/equivalências permanecem pendentes.

Cada requisito exibe `ok`, `nao_ok` ou `verificar`, com trecho/página do edital e da ficha. Valores conflitantes não geram aprovação. **Atende plenamente** exige todas as exigências técnicas aplicáveis comprovadas, sem dúvida, e leitura completa. Não comprova habilitação jurídica ou condições comerciais. Produtos reprovados não recebem indicação de atendimento. Entre os plenamente compatíveis com preço comparável, vence o menor preço. Preços sem equivalência de unidade/composição não criam vantagem comercial.

Por item, bônus técnico: 20 para pleno; até 8 proporcionalmente ao que está comprovado se há dúvidas e nenhuma reprovação; zero se reprovado ou leitura incompleta. Bônus comercial (só pleno e preço comparável): 5 abaixo da referência, 3 igual, 1 acima, zero sem referência comparável. Agregação usa valores de referência; faltando qualquer valor necessário, todos os itens pertinentes usam pesos iguais. Nota final limitada a 100. A cobertura é por item, nunca inferida para todo o edital a partir de um item.

Mudanças de preço recalculam indicação/pontuação localmente; não consomem IA. Alterações de fichas invalidam resultados afetados e enfileiram nova versão. Resultados originais e fontes permanecem disponíveis; revisões de checklist humano não são sobrescritas. Ao promover, a oportunidade leva a análise da busca de origem.

## APIs e dados

- `/api/licitacoes/products`: cadastro/listagem; `/:id` edição; `/:id/sources` fontes; `/:id/specs` revisão com citação válida; `/:id/reprocess` nova extração.
- `/api/licitacoes/technical/config`, `/jobs`, `/jobs/:id`, `/jobs/:id/retry`: orçamento, fila, resultados e retomada.
- `/api/licitacoes/technical/notice`: observação de um resultado; não dispensa elegibilidade/orçamento. `/sources/:id`: original protegido por conta.
- `/api/licitacoes/opportunities/:id/technical`: análise vinculada, sem alterar checklist manual.
- Paginação de resultados aceita `technical=full|uncertain|no_full|pending`; o filtro ocorre no banco antes da contagem/paginação. A ordenação usa a nota com os bônus persistidos.

Migrações são aditivas. Fontes binárias ficam no PostgreSQL, deduplicadas por conta/hash. Permissões de consulta/edição seguem Licitações; a conta é fixada pela sessão/configuração da aplicação, sem confiar em `account_id` arbitrário do cliente.

## Importação solicitada da loja Aerion

`data/aerionCatalog.json` contém os 31 produtos publicados da loja WordPress local indicada pelo usuário, com tabela `_aerion_trade_price`, sem desconto Pix, campanha ou nível Silver/Gold. Inclui variantes, kits, composição e os trechos institucionais que puderam ser associados à variante. Não associa ficha de aeronave a acessório; dados de controle remoto de outra configuração são omitidos. Faltas permanecem sem comprovação.

O startup importa esse lote apenas em `CHATWOOT_ACCOUNT_ID`, sem ligar a automação. `source_key` por SKU torna a operação idempotente; cadastros existentes não são sobrescritos. O exportador `scripts/exportAerionCatalog.js` consulta a loja local em modo somente leitura. Publicação do código/migrações segue `main` e CI, sem executar código local na produção.

## Verificação

`node --test tests/technicalRules.test.js` cobre limites, unidades, conflitos, critérios compostos e escolha comercial. Com `QUALITY_TEST_DATABASE_URL` apontando para um PostgreSQL de teste, `tests/technicalAnalysis.integration.test.js` valida APIs, migrações idempotentes, retomada, limites, filtros globais, recomposição de preço, isolamento e os 31 cadastros. Cada execução usa e remove seu próprio schema.

Na imagem Docker, `TECHNICAL_DOCUMENT_TEST=1 node --test tests/technicalDocuments.integration.test.js` verifica PDF textual, PDF digitalizado/OCR, tabelas DOCX e DOC legado sem IA ou rede.
