# Qualidade das buscas de licitações

O perfil confirmado é independente de setor. `searchQuality.js` centraliza a
correspondência textual e a classificação oficial. IA sugere o entendimento e
termos; o usuário confirma antes de ativar. O mesmo perfil segue para editais,
jobs e assinaturas de PCA.

## Operação

- A criação guiada interpreta uma descrição, esclarece abrangência/tipo de item,
  permite edição manual e consulta uma amostra de até dez resultados. A prévia
  não cria job, assinatura ou notificação. Rascunhos são isolados por conta.
- `match_mode`: `literal` ou `expanded`; somente `related_terms` aprovados entram
  na expansão. `terms`, `excluded_terms`, `item_kind` e `confirmed_at` completam
  o perfil versionado em `filters.search_profile` ou `pca_watchlist.search_profile`.
- Materiais/serviços usam os campos oficiais dos itens, não palavras do objeto.
  Classificação ausente ou conflitante fica pendente. Compras mistas podem entrar
  pelos materiais pertinentes; o valor desses itens é separado do valor global.
- Contratações sem evidência no índice e sem leitura completa dos itens entram
  em `search_pending_candidates`. A verificação continua em lotes, com cursor de
  página dos itens, sem publicar resultados não comprovados na lista principal.
- Assinaturas de editais consultam páginas recentes e mantêm cursor rotativo.
  PCA usa paginação por ID, retomada a cada 15 minutos. Jobs diários mantêm a
  sondagem inicial e acrescentam duas páginas de revisão rotativa por termo.
- A manutenção a cada cinco minutos usa advisory lock e o heavy slot, revisa
  lotes do acervo e verifica candidatos pendentes. PNCP continua no gate; a
  manutenção usa prioridade `bulk`, a prévia `interactive`.
- `quality_hidden` é separado de `visibility`/`status`: revisão automática não
  altera descartes manuais nem oportunidades promovidas. O histórico fica em
  `search_quality_history`; alteração de perfil reinicia a revisão. Pendências
  de informação são revisitadas, sem exclusão por suposição.
- A auditoria de 90 dias mede o processamento e o acervo local. Releituras não
  são publicações únicas. Não existe histórico de auditoria anterior à implantação;
  ausência de coleta nunca deve ser interpretada como ausência de mercado.

## Interfaces

`POST /api/licitacoes/search/guide/interpret`, `/preview`, `/drafts`;
`GET /api/licitacoes/search/guide/drafts`; `GET /api/licitacoes/search/quality/audit`.
Jobs existentes podem ser revisados por
`PUT /api/licitacoes/pncp/search/deep/:jobId/profile`, após parar a coleta.
O perfil também é aceito nas buscas imediatas e nas assinaturas de ambos os tipos.

As migrações são aditivas no startup. A revisão histórica começa após a camada
de dados ficar pronta, sem disparar novamente notificações do acervo. O fallback
legado AUTEL fica literal; uma expansão futura depende de escolha explícita.

## Verificação

`npm test` no backend inclui os testes da política. Para executar o teste real
de PostgreSQL, configure `QUALITY_TEST_DATABASE_URL` com um banco **de teste**;
o teste cria e remove somente seu próprio schema. Ele nunca carrega `.env`.
O frontend possui testes de confirmação, rascunho e invalidação de prévia.

Implantação apenas pela branch `main` no GitHub/CI; não copiar código local para produção.
