const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Pool } = require('pg');
const quality = require('../searchQuality');
const { createSearchQualityTables, reviewSearchBatch, queueCandidates, persistRejectedJobCandidates } = require('../searchQualityStore');

test('PostgreSQL: migrations, PCA pagination/classification, reversible review and account isolation',
  { skip: !process.env.QUALITY_TEST_DATABASE_URL }, async () => {
    const admin = new Pool({ connectionString: process.env.QUALITY_TEST_DATABASE_URL });
    const schema = `quality_test_${process.pid}`;
    let pool;
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      await admin.query('CREATE EXTENSION IF NOT EXISTS unaccent');
      pool = new Pool({ connectionString: process.env.QUALITY_TEST_DATABASE_URL, options: `-c search_path=${schema},public` });
      await pool.query(`CREATE FUNCTION immutable_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT public.unaccent($1)'`);
      await pool.query(`CREATE TABLE pca_watchlist(id BIGSERIAL PRIMARY KEY, account_id INTEGER);
        CREATE TABLE edital_watchlist(id BIGSERIAL PRIMARY KEY, account_id INTEGER);
        CREATE TABLE pca_planos(id BIGINT PRIMARY KEY,id_pca_pncp TEXT,orgao_cnpj TEXT,orgao_razao_social TEXT,
          codigo_unidade TEXT,unidade_nome TEXT,ano_pca INTEGER,data_publicacao DATE,data_atualizacao TIMESTAMP,responsaveis JSONB,contatos JSONB);
        CREATE TABLE pca_itens(id BIGINT PRIMARY KEY,plano_id BIGINT,descricao TEXT,
          descricao_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('portuguese',immutable_unaccent(descricao))) STORED,
          valor_total NUMERIC,valor_unitario NUMERIC,quantidade NUMERIC,unidade_medida TEXT,mes_previsto INTEGER,numero_item TEXT,
          categoria_item TEXT,futura_contratacao_id TEXT,futura_contratacao_nome TEXT,codigo_item_catalogo TEXT,
          classificacao_nome TEXT,classificacao_codigo TEXT,data_estimada_inicio DATE,payload_raw JSONB DEFAULT '{}');
        CREATE TABLE pca_signals(id BIGSERIAL PRIMARY KEY,account_id INTEGER,item_id BIGINT,watchlist_id BIGINT,status TEXT,
          promovido_para_opportunity_id BIGINT,criado_em TIMESTAMP DEFAULT NOW());
        CREATE TABLE edital_signals(id BIGSERIAL PRIMARY KEY,account_id INTEGER,watchlist_id BIGINT,status TEXT,payload JSONB);
        CREATE TABLE pncp_search_job_results(job_id UUID,account_id INTEGER,result_key TEXT,visibility TEXT,payload JSONB);
        CREATE TABLE pncp_search_jobs(id UUID PRIMARY KEY,account_id INTEGER,filters JSONB,terms TEXT[],negative_terms TEXT[]);
        CREATE TABLE licitacao_opportunities(id BIGINT PRIMARY KEY,account_id INTEGER,metadados JSONB);`);
      await createSearchQualityTables(pool);
      await createSearchQualityTables(pool); // deployment retry must be safe
      await pool.query("INSERT INTO pca_planos(id,ano_pca) VALUES(1,2026)");
      await pool.query(`INSERT INTO pca_itens(id,plano_id,descricao,payload_raw)
        SELECT n,1,'Trator agrícola',jsonb_build_object('classificacaoCatalogo',1) FROM generate_series(1,625) n`);
      await pool.query(`INSERT INTO pca_itens(id,plano_id,descricao,payload_raw) VALUES
        (626,1,'Trator agrícola','{"classificacaoCatalogo":2}'),
        (627,1,'Trator agrícola','{}'),
        (628,1,'Trator agrícola','{"materialOuServico":"M","classificacaoCatalogo":2}'),
        (629,1,'Trator para serviços; equipamento agrícola','{"classificacaoCatalogo":1}'),
        (630,1,'Aquisição cautelar','{}'),(631,1,'Equipamento AUTEL','{"classificacaoCatalogo":1}')`);
      const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
      const ctx = { ...quality, pool, uniqueQualityTerms: quality.unique,
        PCA_ITENS_TABLE: 'pca_itens', PCA_PLANOS_TABLE: 'pca_planos', PCA_SIGNALS_TABLE: 'pca_signals', LICITACAO_TABLE: 'licitacao_opportunities',
        toIntOrNull: v => Number.parseInt(v, 10) || null, toNullableNumber: v => v == null ? null : Number(v),
        normalizeSearchText: quality.normalize, getQuerySpecificAllowlist: () => [],
        containsTermStrictFlexible: quality.matchesTerm, containsTermStrict: quality.matchesTerm,
        classifyPcaTermOrigin: () => 'original', PCA_TERM_ORIGIN_WEIGHT: { original: 1, ia: 0.5 }, PCA_TERM_ORIGIN_RANK: { original: 3, ia: 1 },
        buildPcaScoreBreakdown: () => [], scalePcaMatchScore: Number, decoratePcaScoredRow: r => r, pcaVectorAvailable: false, console };
      vm.createContext(ctx);
      vm.runInContext(source.slice(source.indexOf('const normalizeForTsQuery ='), source.indexOf('const parseAtoOuArray =')) +
        source.slice(source.indexOf('const matchPcaItens ='), source.indexOf('// fetchPncpConsulta com retry')) +
        '; globalThis.matcher = matchPcaItens;', ctx);
      const searchProfile = quality.normalizeProfile({ terms: ['trator agricola'], item_kind: 'material' });
      const input = { positivos: ['trator agricola'], termoOriginal: 'trator agricola', accountId: 1, searchProfile, tam: 500, filtros: { match_after_id: '0' } };
      const first = await ctx.matcher(input);
      assert.equal(first.total, 627); // 625 materials + unknown + conflicting
      assert.equal(first.items.length, 500);
      const second = await ctx.matcher({ ...input, filtros: { match_after_id: first.items.at(-1).item_id } });
      assert.equal(second.items.length, 127);
      assert.equal(new Set([...first.items, ...second.items].map(i => i.item_id)).size, 627);
      assert.equal(second.items.filter(i => i.search_quality.status === 'pending_classification').length, 2);
      assert.equal(second.items.some(i => !i.search_quality.accepted), false);
      const brand = await ctx.matcher({ positivos: ['AUTEL'], termoOriginal: 'AUTEL', accountId: 1, tam: 50 });
      assert.equal(brand.total, 1); assert.equal(brand.items[0].item_id, '631');

      const id = '00000000-0000-0000-0000-000000000001';
      for (const [key, visibility, title] of [['a','visible','Aquisição cautelar'], ['b','hidden','Aquisição cautelar'], ['c','pipeline','Aquisição cautelar'], ['d','visible','Drone AUTEL']]) {
        await pool.query('INSERT INTO pncp_search_job_results VALUES($1,1,$2,$3,$4::jsonb,FALSE,NULL)',
          [id,key,visibility,JSON.stringify({ titulo: title, quality_items_complete: true })]);
      }
      await pool.query('INSERT INTO pncp_search_job_results VALUES($1,2,\'foreign\',\'visible\',$2::jsonb,FALSE,NULL)',
        [id, JSON.stringify({ titulo: 'Aquisição cautelar', quality_items_complete: true })]);
      let result = await reviewSearchBatch(pool, { source: 'job', id, accountId: 1, profile: quality.normalizeProfile({ terms: ['AUTEL'] }), limit: 2 });
      assert.equal(result.complete, false);
      result = await reviewSearchBatch(pool, { source: 'job', id, accountId: 1, profile: quality.normalizeProfile({ terms: ['AUTEL'] }), limit: 2 });
      const { rows } = await pool.query('SELECT * FROM pncp_search_job_results ORDER BY result_key');
      assert.equal(rows.find(r => r.result_key === 'a').quality_hidden, true);
      assert.equal(rows.find(r => r.result_key === 'b').visibility, 'hidden');
      assert.equal(rows.find(r => r.result_key === 'c').visibility, 'pipeline');
      assert.equal(rows.find(r => r.result_key === 'c').quality_hidden, false);
      assert.equal(rows.find(r => r.result_key === 'foreign').quality_review, null);
      await reviewSearchBatch(pool, { source: 'job', id, accountId: 1, profile: quality.normalizeProfile({ terms: ['cautelar'] }), limit: 100 });
      const restored = await pool.query("SELECT * FROM pncp_search_job_results WHERE result_key='a'");
      assert.equal(restored.rows[0].quality_hidden, false);
      assert.equal(restored.rows[0].visibility, 'visible');
      const history = await pool.query('SELECT COUNT(*)::int AS n FROM search_quality_history');
      assert.equal(history.rows[0].n, 8);

      // Exercise the real deferred verification SQL without any external calls.
      const serviceProfile = quality.normalizeProfile({ terms: ['AUTEL'], item_kind: 'material' });
      await pool.query('INSERT INTO pncp_search_jobs VALUES($1,1,$2::jsonb,$3,$4)',
        [id, JSON.stringify({ search_profile: serviceProfile }), ['AUTEL'], []]);
      await pool.query('INSERT INTO pncp_search_job_results VALUES($1,1,\'pending\',\'visible\',$2::jsonb,FALSE,NULL)',
        [id, JSON.stringify({ titulo: 'AUTEL', quality_items_next_page: 1 })]);
      await queueCandidates(pool, { source: 'job', id, accountId: 1, profile: serviceProfile,
        items: [{ titulo: 'AUTEL', quality_items_next_page: 1 }], getKey: () => 'pending' });
      const details = [{ descricao: 'Manutenção AUTEL', materialOuServico: 'S', numeroItem: 1 }];
      details.complete = true; details.nextPage = null;
      Object.assign(ctx, { PNCP_SEARCH_JOBS_TABLE: 'pncp_search_jobs', EDITAL_WATCHLIST_TABLE: 'edital_watchlist',
        PNCP_SEARCH_JOB_RESULTS_TABLE: 'pncp_search_job_results', EDITAL_SIGNALS_TABLE: 'edital_signals',
        canRunPncpPriority: () => true, extractPncpCompraIdentifiers: () => ({ cnpj: '00000000000001', ano: 2026, sequencial: 1 }),
        fetchPncpCompraItens: async () => details, matchesWatchlistEntityFilters: () => true });
      vm.runInContext(source.slice(source.indexOf('const verifyPendingSearchCandidates ='), source.indexOf('let searchQualityMaintenanceRunning =')) +
        ';globalThis.verifyPending = verifyPendingSearchCandidates;', ctx);
      await ctx.verifyPending();
      const verified = await pool.query("SELECT status,payload FROM search_pending_candidates WHERE result_key='pending'");
      assert.equal(verified.rows[0].status, 'verified');
      assert.equal(verified.rows[0].payload.quality_items_complete, true);
      const rejectedService = await pool.query("SELECT quality_hidden FROM pncp_search_job_results WHERE result_key='pending'");
      assert.equal(rejectedService.rows[0].quality_hidden, true);

      await queueCandidates(pool, { source: 'job', id, accountId: 1, profile: serviceProfile,
        items: [{ titulo: 'AUTEL', quality_items_next_page: 1 }], getKey: () => 'pending' });
      const retained = await pool.query("SELECT status,payload FROM search_pending_candidates WHERE result_key='pending'");
      assert.equal(retained.rows[0].status, 'verified'); // repeated snapshots cannot reset the continuation
      assert.equal(retained.rows[0].payload.quality_items_complete, true);

      // Enrichment can disprove an earlier provisional match. It must remove the
      // old visible row immediately, while retaining manual/pipeline decisions.
      const disproved = { titulo: 'AUTEL', quality_items_complete: true,
        quality_items: [{ numeroItem: 1, descricao: 'Manutenção AUTEL', materialOuServico: 'S' }] };
      disproved.search_quality = quality.evaluateResult(disproved, serviceProfile);
      await persistRejectedJobCandidates(pool, { id, accountId: 1, items: [disproved], getKey: () => 'd' });
      const disprovedRow = await pool.query("SELECT * FROM pncp_search_job_results WHERE result_key='d'");
      assert.equal(disprovedRow.rows[0].quality_hidden, true);
      assert.equal(disprovedRow.rows[0].payload.quality_items_complete, true);
      await persistRejectedJobCandidates(pool, { id, accountId: 1, items: [disproved], getKey: () => 'c' });
      const manualRow = await pool.query("SELECT * FROM pncp_search_job_results WHERE result_key='c'");
      assert.equal(manualRow.rows[0].visibility, 'pipeline');
      assert.equal(manualRow.rows[0].quality_hidden, false);
    } finally {
      if (pool) await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });
