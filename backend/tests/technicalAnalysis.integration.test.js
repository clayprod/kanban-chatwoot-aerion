'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const express = require('express');
const { createTechnicalTables, createTechnicalAnalysis, technicalFilterClause } = require('../technicalAnalysis');
const { seedTechnicalCatalog } = require('../technicalCatalogSeed');
const docs = require('../technicalDocuments');
test('PostgreSQL + HTTP: catalogue, durable analysis, strict comparison, budget, isolation and seed',
  { skip: !process.env.QUALITY_TEST_DATABASE_URL, timeout: 300000 }, async () => {
    const admin = new Pool({ connectionString: process.env.QUALITY_TEST_DATABASE_URL });
    const schema = `technical_test_${process.pid}`; let pool, server;
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      pool = new Pool({ connectionString: process.env.QUALITY_TEST_DATABASE_URL, options: `-c search_path=${schema},public` });
      await pool.query(`CREATE TABLE licitacao_opportunities(id BIGSERIAL PRIMARY KEY,account_id INTEGER,numero_compra TEXT,links JSONB DEFAULT '{}',metadados JSONB DEFAULT '{}');
        CREATE TABLE pncp_search_jobs(id UUID PRIMARY KEY,account_id INTEGER,filters JSONB DEFAULT '{}',terms TEXT[] DEFAULT '{}');
        CREATE TABLE pncp_search_job_results(job_id UUID,account_id INTEGER,result_key TEXT,score NUMERIC,visibility TEXT,quality_hidden BOOLEAN DEFAULT FALSE,payload JSONB,updated_at TIMESTAMPTZ DEFAULT NOW());
        CREATE TABLE edital_watchlist(id BIGSERIAL PRIMARY KEY,account_id INTEGER,palavras_chave TEXT[],filtros JSONB DEFAULT '{}');
        CREATE TABLE edital_signals(id BIGSERIAL PRIMARY KEY,account_id INTEGER,watchlist_id BIGINT,payload JSONB,criado_em TIMESTAMPTZ DEFAULT NOW(),quality_hidden BOOLEAN DEFAULT FALSE,status TEXT DEFAULT 'novo');`);
      await createTechnicalTables(pool); await createTechnicalTables(pool);
      let calls = 0, downloads = 0, filesRevision = 0;
      const input = { titulo: 'Compra de drones', orgao_cnpj: '12345678000195', ano: '2026', sequencial: '1', score: 75, open: true, numero_controle_pncp: '12345678000195-1-000001/2026' };
      const getIds = i => ({ cnpj: i.orgao_cnpj || '', ano: i.ano || '', sequencial: i.sequencial || '' });
      const dependencies = { pool, workerLockKey: 10000000 + process.pid, getAccountId: req => Number(req.headers['x-test-account'] || 1), getIds,
        getNotice: async () => ({ open: true }),
        getItems: async () => Object.assign([{ numeroItem: 1, descricao: 'Drone profissional', quantidade: 2, unidadeMedida: 'UNIDADE', valorUnitarioEstimado: 120 }], { complete: true, nextPage: null }),
        getFiles: async () => [{ titulo: 'Termo.txt', url: 'https://example.org/termo.txt', dataAtualizacao: filesRevision }],
        gate: async fn => fn(), heavy: async (_name, fn) => fn(), isEligible: i => i.open === true,
        documentIO: { ...docs, download: async () => { downloads++; return { bytes: Buffer.from('Drone profissional. Autonomia mínima de 41 min.'), content_type: 'text/plain', url: 'https://example.org/termo.txt' }; } },
        ai: async ({ user }) => {
          calls++; const value = JSON.parse(user), chunk = value.document;
          if (!chunk) return { ok: true, data: { matches: [] }, usage: { total_tokens: 20 } };
          const product = !value.context.items;
          if (!product) assert.ok(value.context.items.every(i => !('description' in i) && typeof i.number==='string' && i.quantity != null), 'Only structured item identity metadata may accompany the source; listing descriptions cannot contaminate extraction');
          const quote = product ? /Autonomia de (\d+) min/.exec(chunk.text)?.[0] : 'Autonomia mínima de 41 min';
          const n = Number(/(\d+) min/.exec(quote)?.[1]);
          return { ok: true, data: { complete: true, facts: [{ item_number: product ? 'all' : '1', label: quote, key: 'flight_time', kind: 'numeric', value: n, unit: 'min', operator: product ? 'eq' : 'min', conditions: '', quote, location: chunk.location, source_id: chunk.source_id }],
            ...(value.blocks ? {coverage:value.blocks.map(b=>({block_id:b.id,classification:'requirements',fact_indexes:[0],reason:'Exigência conferida no texto.'}))} : {}) }, usage: { total_tokens: 100 } };
        } };
      let service = createTechnicalAnalysis(dependencies);
      const app = express(); app.use(express.json()); service.register(app);
      server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
      const url = `http://127.0.0.1:${server.address().port}`;
      const request = async (method, route, body, account = 1) => {
        const response = await fetch(url + route, { method, headers: { 'Content-Type': 'application/json', 'x-test-account': String(account) }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, data: await response.json() };
      };
      const base = '/api/licitacoes';
      const product = (await request('POST', `${base}/products`, { name: 'Drone A', model: 'A', category: 'drone', keywords: ['drone'], sale_price: 100, unit: 'un', package_confirmed: true, active: true })).data;
      assert.ok(product.id); assert.equal((await service.settings(1)).enabled, false);
      const noJob = await service.observe(1, input, { terms: ['drone'] }); assert.equal(noJob, null);
      const attached = await request('POST', `${base}/products/${product.id}/sources`, { name: 'Ficha A.txt', text: 'Ficha do Drone A. Autonomia de 40 min. Dados técnicos da variante A.' });
      assert.equal(attached.status, 202);
      for (let n = 0; n < 4; n++) await service.tick();
      const p = (await request('GET', `${base}/products`)).data[0]; assert.equal(p.specs.length, 1, JSON.stringify(p.processing)); assert.equal(p.specs_complete, true);
      assert.equal((await request('GET', `${base}/products`, null, 2)).data.length, 0);
      assert.equal((await request('GET', `${base}/technical/sources/${attached.data.source.id}`, null, 2)).status, 404);
      await request('PUT', `${base}/technical/config`, { enabled: true, min_score: 68, daily_limit: 30, daily_tokens: 2000000 });
      const jobId = (await service.observe(1, input, { terms: ['drone'] })).id;
      // Gate waits are durable scheduling events, including analyses marked
      // failed by older releases. Neither recovery nor waiting loses progress.
      await pool.query("UPDATE technical_jobs SET status='failed',attempts=3,error='PNCP bulk gate wait exceeded (paused)' WHERE id=$1", [jobId]);
      await pool.query("UPDATE technical_jobs SET started_day=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date WHERE id=$1", [jobId]);
      await pool.query('UPDATE technical_usage SET notices=1 WHERE account_id=1');
      await createTechnicalTables(pool);
      let recovered = (await pool.query('SELECT * FROM technical_jobs WHERE id=$1', [jobId])).rows[0];
      assert.equal(recovered.status, 'queued'); assert.equal(recovered.stage, 'waiting_pncp'); assert.equal(recovered.attempts, 0); assert.equal(recovered.error, null);
      assert.equal(recovered.started_day, null);
      assert.equal((await pool.query('SELECT notices FROM technical_usage WHERE account_id=1')).rows[0].notices, 0);
      await createTechnicalTables(pool);
      assert.equal((await pool.query('SELECT notices FROM technical_usage WHERE account_id=1')).rows[0].notices, 0);
      await pool.query("UPDATE technical_jobs SET status='failed',stage='queued',attempts=3,error='terminated' WHERE id=$1", [jobId]);
      await createTechnicalTables(pool);
      recovered = (await pool.query('SELECT * FROM technical_jobs WHERE id=$1', [jobId])).rows[0];
      assert.equal(recovered.status, 'queued'); assert.equal(recovered.error, null);
      const deferredService = createTechnicalAnalysis({ ...dependencies, heavy: async () => { throw Object.assign(new Error('PNCP bulk budget deferred'), { code: 'PNCP_BULK_DEFERRED' }); } });
      await deferredService.tick();
      recovered = (await pool.query('SELECT * FROM technical_jobs WHERE id=$1', [jobId])).rows[0];
      assert.equal(recovered.status, 'queued'); assert.equal(recovered.attempts, 0); assert.equal(recovered.started_day, null); assert.deepEqual(recovered.state, {});
      const waitingPublic = (await request('GET', `${base}/technical/jobs/${jobId}`)).data;
      assert.match(waitingPublic.stage_label, /retomada automática/); assert.equal(waitingPublic.error, null);
      await pool.query('UPDATE technical_jobs SET next_run_at=NOW() WHERE id=$1', [jobId]);
      assert.equal((await service.observe(1, { ...input, score: 60, sequencial: '2' }, { terms: ['drone'] })), null);
      assert.equal((await service.observe(1, { ...input, open: false, sequencial: '2' }, { terms: ['drone'] })), null);
      for (let n = 0; n < 15; n++) {
        if (n === 3) service = createTechnicalAnalysis(dependencies); // process restart must retain checkpoints
        await service.tick();
      }
      const analysis = (await request('GET', `${base}/technical/jobs/${jobId}`)).data;
      assert.equal(analysis.progress.total_chunks, 1);
      assert.equal(analysis.progress.total_comparisons, 1);
      assert.equal(analysis.status, 'completed', JSON.stringify(analysis)); assert.equal(analysis.result.full_items, 0);
      assert.equal(analysis.result.items[0].products[0].requirements[0].status, 'nao_ok');
      assert.equal(analysis.result.technical_bonus, 0); assert.equal(downloads, 1);
      assert.equal((await request('GET', `${base}/technical/jobs/${jobId}`, null, 2)).status, 404);
      const brief = (await request('POST', `${base}/technical/notice`, { item: input, profile: { terms: ['drone'] }, summary: true })).data.analysis;
      assert.equal(brief.summary_only, true); assert.equal(brief.result.items[0].products, undefined);
      const beforeEquivalent = calls;
      const equivalent = await service.observe(1, input, { terms: ['drone', 'uav'] });
      assert.notEqual(equivalent.id, jobId);
      assert.equal(equivalent.context.reused_from, jobId); assert.equal(equivalent.status, 'completed');
      assert.equal(equivalent.result.items[0].products[0].requirements[0].status, 'nao_ok');
      assert.equal(calls, beforeEquivalent);
      const excluded = await service.observe(1, input, { terms: ['drone'], excluded_terms: ['drone'] });
      assert.equal(excluded.result, null); assert.equal(excluded.context.reused_from, undefined);
      await pool.query("UPDATE technical_jobs SET status='superseded' WHERE id=$1", [excluded.id]);
      // Daily copies from the old scheduler cannot hide the existing result or
      // consume AI again. Adopt an evidenced legacy result into the stable key.
      const beforeReuse = calls;
      await pool.query("UPDATE technical_jobs SET context=context-'semantic_revision'-'rules_version' WHERE id=$1", [jobId]);
      const dailyCopy = (await pool.query("INSERT INTO technical_jobs(account_id,kind,target,revision,context) SELECT account_id,kind,target,'daily-copy',context FROM technical_jobs WHERE id=$1 RETURNING id", [jobId])).rows[0];
      assert.equal((await service.observe(1, input, { terms: ['drone'] })).id, jobId);
      assert.equal((await pool.query('SELECT status FROM technical_jobs WHERE id=$1', [dailyCopy.id])).rows[0].status, 'superseded');
      assert.equal(calls, beforeReuse);
      // A daily freshness check reads the manifest, not the entire AI pipeline.
      await pool.query("UPDATE technical_jobs SET updated_at=NOW()-INTERVAL '25 hours',state=jsonb_set(state,'{final_manifest_checked_at}',to_jsonb((NOW()-INTERVAL '25 hours')::text)) WHERE id=$1", [jobId]);
      const validating = await service.observe(1, input, { terms: ['drone'] });
      assert.equal(validating.id, jobId); assert.equal(validating.state.needs_revalidation, true);
      assert.equal((await service.refreshedJob(validating)).result.documents_complete, false);
      await service.tick();
      assert.equal((await pool.query('SELECT status FROM technical_jobs WHERE id=$1', [jobId])).rows[0].status, 'completed');
      assert.equal(calls, beforeReuse); assert.equal(downloads, 1);
      // A changed attachment invalidates the old comparison immediately.
      await pool.query("UPDATE technical_jobs SET updated_at=NOW()-INTERVAL '25 hours',state=jsonb_set(state,'{final_manifest_checked_at}',to_jsonb((NOW()-INTERVAL '25 hours')::text)) WHERE id=$1", [jobId]);
      filesRevision = 1;
      await service.observe(1, input, { terms: ['drone'] }); await service.tick();
      assert.equal((await request('GET', `${base}/technical/jobs/${jobId}`)).data.result, null);
      assert.equal((await pool.query('SELECT state->>\'needs_revalidation\' AS pending FROM technical_jobs WHERE id=$1', [equivalent.id])).rows[0].pending, 'true');
      for (let n = 0; n < 12; n++) await service.tick();
      assert.equal((await request('GET', `${base}/technical/jobs/${jobId}`)).data.status, 'completed');
      const jid = '00000000-0000-0000-0000-000000000021';
      await pool.query("INSERT INTO pncp_search_jobs(id,account_id,terms) VALUES($1,1,ARRAY['drone'])", [jid]);
      await pool.query("INSERT INTO pncp_search_job_results(job_id,account_id,result_key,score,visibility,payload) VALUES($1,1,'notice',75,'visible',$2::jsonb)", [jid, JSON.stringify(input)]);
      await service.observe(1, input, { terms: ['drone'] }, `job:${jid}`, 'notice', new Date());
      const filtered = async mode => (await pool.query(`SELECT count(*)::int AS n FROM pncp_search_job_results WHERE account_id=1 ${technicalFilterClause(mode)}`)).rows[0].n;
      assert.equal(await filtered('full'), 0); assert.equal(await filtered('no_full'), 1); assert.equal(await filtered('uncertain'), 0);

      const b = (await request('POST', `${base}/products`, { name: 'Drone B', keywords: ['drone'], sale_price: 90, unit: 'un', package_confirmed: true })).data;
      await request('POST', `${base}/products/${b.id}/sources`, { name: 'Ficha B.txt', text: 'Ficha do Drone B. Autonomia de 42 min. Modelo B completo.' });
      for (let n = 0; n < 18; n++) await service.tick();
      const newest = (await pool.query("SELECT * FROM technical_jobs WHERE kind='notice' AND account_id=1 ORDER BY id DESC LIMIT 1")).rows[0];
      const full = (await service.refreshedJob(newest)).result;
      assert.equal(full.full_items, 1); assert.equal(full.items[0].recommended_product.product_id, b.id); assert.equal(full.commercial_bonus, 5);
      assert.equal(await filtered('full'), 1);
      const beforeReprice = calls;
      const bp = (await request('GET', `${base}/products`)).data.find(p => p.id === b.id);
      await request('PUT', `${base}/products/${b.id}`, { ...bp, sale_price: 130 });
      assert.equal(calls, beforeReprice);
      const repriced = await service.refreshedJob(newest); assert.equal(repriced.result.commercial_bonus, 1); assert.equal(repriced.result.score, 96);
      assert.equal(Number((await pool.query('SELECT score FROM pncp_search_job_results WHERE job_id=$1', [jid])).rows[0].score), 96);
      const callsBeforePrice = calls;
      await request('PUT', `${base}/products/${product.id}`, { ...p, sale_price: 80 });
      assert.equal(calls, callsBeforePrice); // prices cannot cause AI consumption
      assert.equal((await request('GET', `${base}/technical/jobs/${jobId}`)).data.result.items[0].products[0].sale_price, 80);

      // Background sweep must reach saved results even without opening their cards.
      // Invalid PNCP identities on the first page cannot starve the remaining results.
      for (let n = 0; n < 45; n++) await pool.query("INSERT INTO pncp_search_job_results(job_id,account_id,result_key,score,visibility,payload) VALUES($1,1,$2,99,'visible',$3::jsonb)", [jid, `invalid-${n}`, JSON.stringify({ ...input, orgao_cnpj: 'invalid' })]);
      await pool.query("INSERT INTO pncp_search_job_results(job_id,account_id,result_key,score,visibility,payload) VALUES($1,1,'existing-unopened',75,'visible',$2::jsonb)", [jid, JSON.stringify({ ...input, sequencial: '3' })]);
      for (let n = 0; n < 3; n++) await service.tick();
      assert.ok((await pool.query("SELECT job_id FROM technical_candidates WHERE account_id=1 AND result_key='existing-unopened'")).rows[0]?.job_id);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM technical_candidates WHERE account_id=1 AND result_key LIKE 'invalid-%'")).rows[0].n, 45);
      const observedAt=(await pool.query("SELECT updated_at::text AS value FROM technical_candidates WHERE account_id=1 AND result_key='existing-unopened'")).rows[0].value;
      await service.tick();
      assert.equal((await pool.query("SELECT updated_at::text AS value FROM technical_candidates WHERE account_id=1 AND result_key='existing-unopened'")).rows[0].value,observedAt,'unchanged microsecond timestamps must not repeatedly re-observe a saved notice');
      await pool.query("UPDATE pncp_search_job_results SET updated_at=NOW()+INTERVAL '1 second' WHERE result_key='existing-unopened'");
      await service.tick();
      assert.equal((await pool.query("SELECT c.source_updated_at=date_trunc('milliseconds',r.updated_at) AS current FROM technical_candidates c JOIN pncp_search_job_results r ON r.result_key=c.result_key AND r.account_id=c.account_id WHERE c.account_id=1 AND c.result_key='existing-unopened'")).rows[0].current,true);

      // Explicit re-extraction invalidates the old verdict immediately.
      await request('POST', `${base}/products/${product.id}/sources`, { name: 'Ficha B.txt', text: 'Ficha da variante B. Autonomia de 42 min. Novos dados técnicos.' });
      const invalidated = (await request('GET', `${base}/technical/jobs/${jobId}`)).data;
      assert.equal(invalidated.result.items[0].products[0].status, 'uncertain');
      assert.equal(invalidated.result.technical_bonus, 0);

      // Token reservations survive failed calls; hitting the cap pauses rather than dropping work.
      await request('PUT', `${base}/technical/config`, { enabled: true, min_score: 68, daily_limit: 1, daily_tokens: 10000 });
      await pool.query(`UPDATE technical_usage SET tokens=10000 WHERE account_id=1`);
      let waiting;
      for(let n=0;n<8;n++){
        await service.tick();
        waiting = await pool.query("SELECT status,error FROM technical_jobs WHERE account_id=1 AND kind='product' ORDER BY id DESC LIMIT 1");
        if(waiting.rows[0].error)break;
      }
      assert.equal(waiting.rows[0].status, 'queued'); assert.match(waiting.rows[0].error, /Limite diário|Teto diário insuficiente/);

      const legacy = (await pool.query("INSERT INTO technical_products(account_id,name,sale_price,source_key) VALUES(77,'Kit antigo',30000,'aerion-store:102003506') RETURNING id")).rows[0];
      const seeded = await seedTechnicalCatalog(pool, 77); assert.equal(seeded.inserted, 19);
      const archived = (await pool.query('SELECT active,superseded_by FROM technical_products WHERE id=$1', [legacy.id])).rows[0];
      assert.equal(archived.active, false); assert.ok(archived.superseded_by);
      assert.equal((await request('GET', `${base}/products`, null, 77)).data.length, 19);
      assert.equal((await seedTechnicalCatalog(pool, 77)).inserted, 0);
      await pool.query("UPDATE technical_products SET sale_price=123.45 WHERE account_id=77 AND source_key='aerion-store:102003505'");
      await seedTechnicalCatalog(pool, 77);
      assert.equal(Number((await pool.query("SELECT sale_price FROM technical_products WHERE account_id=77 AND source_key='aerion-store:102003505'")).rows[0].sale_price), 123.45);
      assert.equal((await service.settings(77)).enabled, true);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM technical_products WHERE account_id=2')).rows[0].n, 0);

      // An exhausted provider pauses the entire account after one attempt, instead
      // of failing/retrying each catalogue entry independently.
      await pool.query("UPDATE technical_jobs SET next_run_at=NOW()+INTERVAL '1 day'");
      const blockedProduct = (await request('POST', `${base}/products`, { name: 'Blocked product', sale_price: 10 }, 88)).data;
      await request('POST', `${base}/products/${blockedProduct.id}/sources`, { text: 'Autonomia de 40 min.' }, 88);
      let exhaustedCalls = 0;
      const blockedService = createTechnicalAnalysis({ ...dependencies, ai: async () => { exhaustedCalls++; return { ok: false, error: 'openai:429 You have no credits remaining',http_status:429,provider:'openai',model:'test-model' }; } });
      for (let n = 0; n < 6; n++) await blockedService.tick();
      assert.equal(exhaustedCalls, 1);
      const rejectedUsage=(await pool.query('SELECT tokens,actual_tokens FROM technical_usage WHERE account_id=88')).rows[0];
      assert.equal(Number(rejectedUsage.tokens),0);assert.equal(Number(rejectedUsage.actual_tokens),0);
      const rejectedCall=(await pool.query('SELECT provider,model,http_status,request_hash,operation FROM technical_ai_calls WHERE account_id=88')).rows[0];
      assert.equal(rejectedCall.http_status,429);assert.equal(rejectedCall.provider,'openai');assert.equal(rejectedCall.model,'test-model');assert.ok(rejectedCall.request_hash);assert.ok(rejectedCall.operation);
      assert.match((await blockedService.settings(88)).provider_error, /sem créditos/);
      assert.equal((await request('GET', `${base}/technical/config`, null, 88)).data.health.provider_blocked, true);
      assert.equal((await request('POST', `${base}/technical/resume`, {}, 88)).status, 200);
      assert.equal((await blockedService.settings(88)).provider_error, null);
      await pool.query("UPDATE technical_jobs SET next_run_at=NOW()+INTERVAL '1 day'");
      const fallbackProduct = (await request('POST', `${base}/products`, { name: 'Fallback product', sale_price: 10 }, 89)).data;
      await request('POST', `${base}/products/${fallbackProduct.id}/sources`, { text: 'Autonomia de 42 min.' }, 89);
      const offsets = [];
      const fallbackService = createTechnicalAnalysis({ ...dependencies, getProviderCount: () => 2, ai: async args => {
        offsets.push(args.providerOffset);
        return args.providerOffset === 0 ? { ok: false, error: 'openai:429 You have no credits remaining' } : dependencies.ai(args);
      } });
      for (let n = 0; n < 5; n++) await fallbackService.tick();
      assert.deepEqual(offsets, [0, 1]);
      assert.equal((await pool.query('SELECT specs_complete FROM technical_products WHERE id=$1', [fallbackProduct.id])).rows[0].specs_complete, true);
      assert.equal((await pool.query('SELECT calls FROM technical_usage WHERE account_id=89')).rows[0].calls, 2);
      assert.equal((await fallbackService.settings(89)).provider_error, null);
      const nextProduct = (await request('POST', `${base}/products`, { name: 'Fallback next product', sale_price: 10 }, 89)).data;
      await request('POST', `${base}/products/${nextProduct.id}/sources`, { text: 'Autonomia de 43 min. Outra ficha técnica.' }, 89);
      for (let n = 0; n < 5; n++) await fallbackService.tick();
      assert.deepEqual(offsets, [0, 1, 1]);
      assert.equal((await pool.query('SELECT calls FROM technical_usage WHERE account_id=89')).rows[0].calls, 3);
      const limitedProduct = (await request('POST', `${base}/products`, { name: 'Limited fallback', sale_price: 10 }, 90)).data;
      await request('POST', `${base}/products/${limitedProduct.id}/sources`, { text: 'Autonomia de 44 min.' }, 90);
      const limitedService = createTechnicalAnalysis({ ...dependencies, getProviderCount: () => 2, ai: async args =>
        ({ ok: false, error: args.providerOffset === 0 ? 'openai:429 You have no credits remaining' : 'groq:429 Rate limit reached; retry in 60 seconds' }) });
      await limitedService.tick();
      const limited = await limitedService.settings(90);
      assert.match(limited.provider_error, /temporariamente indisponível/);
      assert.match(limited.provider_error, /sem saldo suficiente/);
      assert.ok(new Date(limited.provider_retry_at).getTime() - Date.now() < 3 * 60 * 1000);
      assert.equal((await pool.query("SELECT attempts FROM technical_jobs WHERE account_id=90 AND kind='product'")).rows[0].attempts, 0);
      const revised = await service.observe(1, { ...input, dataAtualizacao: '2026-10-20T10:00:00Z' }, { terms: ['drone'] });
      assert.notEqual(revised.id, jobId);
      assert.equal((await service.observe(1, input, { terms: ['drone'] })).id, revised.id);

      // Broad local triage is inexpensive; only three products per item need
      // deeper matching. Identical item descriptions are legal quota lots.
      await pool.query("UPDATE technical_jobs SET next_run_at=NOW()+INTERVAL '1 day'");
      let scopedConflict = false;
      const shortlistService = createTechnicalAnalysis({ ...dependencies,
        getItems: async () => Object.assign([1,2].map(numeroItem => ({numeroItem,descricao:'Drone profissional',quantidade:1,unidadeMedida:'UNIDADE',valorUnitarioEstimado:120})), {complete:true,nextPage:null}),
        ai: async args => {
          const result = await dependencies.ai(args);
          if (JSON.parse(args.user).context?.items) {
            result.data.facts.forEach(f => { f.item_number='all'; f.category='equipment'; });
            if (scopedConflict) { result.data.conflicts=[{item_numbers:['1'],message:'Condição do item 1 requer revisão.',quote:'Autonomia mínima de 41 min'}]; }
          }
          return result;
        }
      });
      for (const [n,price] of [[41,500],[44,200],[42,100],[45,300],[40,10]]) {
        const p = (await request('POST', `${base}/products`, {name:`Drone ${n}`,keywords:['drone'],sale_price:price,unit:'un',package_confirmed:true},91)).data;
        await request('POST', `${base}/products/${p.id}/sources`, {text:`Autonomia de ${n} min.`},91);
      }
      for(let n=0;n<15;n++) await shortlistService.tick();
      await request('PUT', `${base}/technical/config`, {enabled:true,min_score:68,daily_limit:30,daily_tokens:2000000},91);
      const selected = await shortlistService.observe(91,input,{terms:['drone']});
      for(let n=0;n<20;n++) await shortlistService.tick();
      let selectedResult=(await request('GET',`${base}/technical/jobs/${selected.id}`,null,91)).data;
      assert.equal(selectedResult.result.items.length,2);
      for(const i of selectedResult.result.items) {
        assert.equal(i.candidate_count,5); assert.equal(i.products.length,3);
        assert.deepEqual(i.products.map(p=>p.sale_price),[100,200,300]);
        assert.equal(i.requirements.length,1); assert.equal(i.recommended_product.sale_price,100);
      }
      const settled=(await pool.query('SELECT tokens,actual_tokens FROM technical_usage WHERE account_id=91')).rows[0];
      assert.equal(settled.tokens,settled.actual_tokens);
      assert.equal((await request('POST',`${base}/technical/jobs/${selected.id}/more`,{item_number:'1'},92)).status,404);
      assert.equal((await request('POST',`${base}/technical/jobs/${selected.id}/more`,{item_number:'1'},91)).data.queued,2);
      assert.equal((await request('POST',`${base}/technical/jobs/${selected.id}/more`,{item_number:'1'},91)).status,400);
      for(let n=0;n<8;n++) await shortlistService.tick();
      selectedResult=(await request('GET',`${base}/technical/jobs/${selected.id}`,null,91)).data;
      assert.equal(selectedResult.result.items[0].products.length,5);
      assert.equal(selectedResult.result.items[1].products.length,3);
      assert.equal(selectedResult.result.items[0].products.at(-1).status,'failed');
      // Updating the extraction rules reuses verified downloads after checking
      // the manifest. A scoped conflict does not invalidate the other quota lot.
      const downloadsBeforeRevision=downloads; scopedConflict=true;
      await pool.query("DELETE FROM technical_extractions WHERE account_id=91 AND kind='notice'");
      await pool.query("UPDATE technical_jobs SET context=jsonb_set(context,'{rules_version}','2'),state=jsonb_set(state,'{extraction_format}','2') WHERE id=$1",[selected.id]);
      const scopedJob=await shortlistService.observe(91,input,{terms:['drone','rpa']});
      for(let n=0;n<20;n++) await shortlistService.tick();
      const scopedResult=(await request('GET',`${base}/technical/jobs/${scopedJob.id}`,null,91)).data.result;
      assert.equal(downloads,downloadsBeforeRevision);
      assert.equal(scopedResult.documents_complete,false);assert.equal(scopedResult.full_items,0,'without proof of independent awards, an unresolved item prevents full-lot approval');
      assert.equal(scopedResult.items[0].documents_complete,false);
      assert.equal(scopedResult.items[1].documents_complete,true);
      // Score mode is deliberately independent of fixed notice/token budgets.
      // More than three green notices proceed even after legacy counters filled.
      await pool.query("UPDATE technical_jobs SET next_run_at=NOW()+INTERVAL '1 day'");
      await request('PUT',`${base}/technical/config`,{enabled:true,limit_mode:'score',min_score:68,daily_limit:1,daily_tokens:10000},92);
      await pool.query(`INSERT INTO technical_usage(account_id,day,notices,tokens) VALUES(92,(NOW() AT TIME ZONE 'America/Sao_Paulo')::date,100,9000000)`);
      const scoreProduct=(await request('POST',`${base}/products`,{name:'Drone por aderência',keywords:['drone'],sale_price:90,unit:'un',package_confirmed:true},92)).data;
      await request('POST',`${base}/products/${scoreProduct.id}/sources`,{text:'Autonomia de 42 min.'},92);
      for(let n=0;n<3;n++)await service.tick();
      const greens=[];
      for(const score of [68,80,90,95,85]) greens.push(await service.observe(92,{...input,sequencial:String(score),score},{terms:['drone']}));
      assert.equal(await service.observe(92,{...input,sequencial:'67',score:67},{terms:['drone']}),null);
      for(let n=0;n<42;n++){
        await pool.query("UPDATE technical_jobs SET next_run_at=NOW() WHERE id=ANY($1::bigint[]) AND status='queued'",[greens.map(j=>j.id)]);
        await service.tick();
      }
      for(const green of greens) assert.equal((await request('GET',`${base}/technical/jobs/${green.id}`,null,92)).data.status,'completed');
      const firstGreenCall=(await pool.query("SELECT (j.context->'payload'->>'score')::int AS score FROM technical_ai_calls a JOIN technical_jobs j ON j.id=a.job_id WHERE a.account_id=92 AND j.kind='notice' ORDER BY a.id LIMIT 1")).rows[0];
      assert.ok([95,90].includes(firstGreenCall.score),'the two highest scores share the first concurrent batch');
      assert.equal((await request('GET',`${base}/technical/config`,null,92)).data.config.limit_mode,'score');
      await pool.query("UPDATE technical_jobs SET next_run_at=NOW()+INTERVAL '1 day'");
      const dense=(await request('POST',`${base}/products`,{name:'Ficha densa',sale_price:100},93)).data;
      await request('POST',`${base}/products/${dense.id}/sources`,{text:'Autonomia de 42 min. '+ 'Detalhe técnico. '.repeat(200)},93);
      let denseCalls=0;
      const adaptiveService=createTechnicalAnalysis({...dependencies,ai:async args=>{
        denseCalls++;const chunk=JSON.parse(args.user).document;
        if(chunk.text.length>2500)return{ok:false,error:'length',truncated:true,usage:{total_tokens:100}};
        const facts=chunk.text.includes('Autonomia de 42 min')?[{item_number:'all',label:'Autonomia',key:'flight_time',kind:'numeric',value:42,unit:'min',operator:'eq',conditions:'',quote:'Autonomia de 42 min',location:chunk.location,source_id:chunk.source_id}]:[];
        const blocks=JSON.parse(args.user).blocks;
        return{ok:true,data:{complete:true,facts,conflicts:[],...(blocks?{coverage:blocks.map(b=>({block_id:b.id,classification:b.text.includes('Autonomia de 42 min')?'requirements':'context',fact_indexes:b.text.includes('Autonomia de 42 min')?[0]:[],reason:'Trecho conferido.'}))}:{})},usage:{total_tokens:100}};
      }});
      for(let n=0;n<8;n++)await adaptiveService.tick();
      const denseProduct=(await request('GET',`${base}/products`,null,93)).data[0];
      assert.equal(denseProduct.specs_complete,true);assert.equal(denseProduct.specs.length,1);assert.equal(denseCalls,3);
      await pool.query("UPDATE technical_jobs SET next_run_at=NOW()+INTERVAL '1 day'");
      const larger=(await request('POST',`${base}/products`,{name:'Fallback com capacidade maior',sale_price:100},99)).data;
      await request('POST',`${base}/products/${larger.id}/sources`,{text:'Autonomia de 42 min.'},99);
      const capacityOffsets=[];
      const capacityService=createTechnicalAnalysis({...dependencies,getProviderCount:()=>2,ai:async args=>{
        capacityOffsets.push(args.providerOffset);
        return args.providerOffset===0?{ok:false,requestTooLarge:true,error:'413'}:dependencies.ai(args);
      }});
      for(let n=0;n<4;n++)await capacityService.tick();
      assert.equal((await request('GET',`${base}/products`,null,99)).data[0].specs_complete,true);
      assert.deepEqual(capacityOffsets,[0,1]);
    } finally {
      if (server) await new Promise(resolve => server.close(resolve));
      if (pool) await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end();
    }
  });
