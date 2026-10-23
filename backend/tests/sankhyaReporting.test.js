const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { Pool } = require('pg');
const { createSankhyaReporting, parsePage, erpDate } = require('../sankhyaReporting');
const { hybridRealizado } = require('../salesRealizado');

const row = (id, total = '100') => ({ codigoNota: String(id), codigoEmpresa: '102', dataNegociacao: '22/10/2026',
  valorNota: total, nomeMoeda: 'Real', statusNFe: 1, itens: [{valorTotal:70},{valorTotal:20}], cliente: { email: 'private@example.com' }, chaveNFe: 'sensitive-fiscal-key' });
const page = (rows, more = 'false') => ({ pedido: rows, pagination: { page: '0', total: '12', hasMore: more } });
test('Sankhya page parsing respects textual booleans, scope and minimizes stored data', () => {
  const parsed = parsePage(page([row(1)]), 'orders', 102);
  assert.equal(parsed.hasMore, false); assert.equal(parsed.rows[0].total, 100);
  assert.equal(parsed.rows[0].date, '2026-10-22'); assert.equal(parsed.rows[0].currency, 'BRL');
  assert.equal(parsed.rows[0].productValue,90,'product values must exclude the extra header amounts');
  assert(!JSON.stringify(parsed).includes('private@example.com')); assert(!JSON.stringify(parsed).includes('sensitive-fiscal-key'));
  assert.equal(parsePage(page([], 'true'), 'orders', 102).hasMore, true);
  assert.throws(() => parsePage(page([{ ...row(1), codigoEmpresa: '100' }]), 'orders', 102), /fora da empresa/);
  assert.throws(() => parsePage({ pedido: [], pagination: {} }, 'orders', 102), /Paginação/);
  assert.throws(() => parsePage(page([{ ...row(1), valorNota: 'invalid' }]), 'orders', 102), /numérico/);
  assert.equal(erpDate('31/02/2026'), null);
});

test('confirmed orders never count as invoiced revenue, including non-pending orders', async () => {
  const invoice = {id:'1',resource:'invoices',date:'2026-10-22',authorized:true,invoiceStatus:'1',currency:'BRL',productValue:50};
  const pool = {query: async sql => {
    if (sql.includes('connections')) return {rows:[{feed_realizado:true}]};
    assert(sql.includes("resource='invoices'"), 'fiscal revenue must read invoices rather than orders');
    if (sql.includes('SELECT *')) return {rows:[{last_success_at:'2026-10-23'}]};
    return {rows:[invoice,
      {...invoice,id:'2',resource:'orders',confirmed:true,pending:false,productValue:999},
      {...invoice,id:'3',authorized:false,invoiceStatus:'2',productValue:999},
      {...invoice,id:'4',authorized:false,confirmed:false,productValue:999}].map(data=>({data}))};
  }};
  const result=await hybridRealizado({pool,legacyPool:null,year:2026});
  assert.equal(result.meses[9].receita_102,50);
  assert.equal(result.meses[9].vendas_102,1);
});

test('Sankhya synchronization publishes only completed snapshots and isolates invoice outages', { skip: !process.env.ECOMMERCE_TEST_DATABASE_URL }, async t => {
  const schema = `sankhya_test_${crypto.randomBytes(8).toString('hex')}`;
  const root = new Pool({ connectionString: process.env.ECOMMERCE_TEST_DATABASE_URL });
  await root.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: process.env.ECOMMERCE_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
  const env = { ECOMMERCE_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') };
  let mode = 'initial'; const calls = [];
  const transport = async (url, options) => {
    calls.push({ url, method: options.method });
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers['X-Partner-Key'], 'test-private-key');
    if (mode === 'transport-error') throw new Error('upstream test-private-key private-address');
    if (url.includes('/nfe')) return new Response(JSON.stringify({ erro: 'test-private-key' }), { status: 502 });
    const n = new URL(url).searchParams.get('page');
    if (mode === 'initial') return new Response(JSON.stringify(page([row(1)])));
    if (n === '0') return new Response(JSON.stringify(page([row(1, '200')], 'true')));
    if (mode === 'second-page-failure') return new Response('test-private-key', { status: 502 });
    return new Response(JSON.stringify(page([row(2, '300')])));
  };
  const authorize = (req, res, next) => req.get('x-test-admin') === 'yes' ? next() : res.sendStatus(403);
  const erp = createSankhyaReporting({ pool, env, transport, authorize });
  const app = express(); app.use(express.json()); app.use('/api/sankhya', erp.router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.on('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/sankhya`;
  const request = async (path, method = 'GET', data, admin = true) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(admin ? { 'x-test-admin': 'yes' } : {}) }, body: data ? JSON.stringify(data) : undefined });
    const text = await response.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: response.status, body, text };
  };
  try {
    await erp.ensure();
    await t.test('defaults stay disabled, access is admin-only and company 100 is refused', async () => {
      await erp.tick(); assert.equal(calls.length, 0);
      assert.equal((await request('/report', 'GET', null, false)).status, 403);
      assert.equal((await request('/connections/100', 'PUT', { partner_key: 'test-private-key', enabled: true })).status, 400);
      assert.equal((await request('/connections/102', 'PUT', { origin: 'http://127.0.0.1', partner_key: 'test-private-key' })).status, 400);
      assert.equal((await request('/connections/102', 'PUT', { partner_key: 'test-private-key', enabled: true })).status, 200);
      const saved = (await pool.query('SELECT * FROM sankhya_reporting_connections')).rows[0];
      assert(!JSON.stringify(saved).includes('test-private-key'));
    });
    await t.test('orders import automatically while invoices fail without exposing the key', async () => {
      await erp.tick();
      const report = await request('/report?ano=2026');
      assert.equal(report.status, 200); assert(!report.text.includes('test-private-key'));
      const orders = report.body.streams.find(s => s.resource === 'orders');
      const invoices = report.body.streams.find(s => s.resource === 'invoices');
      assert.equal(orders.documents, 1); assert.equal(orders.gross_total, 100);
      assert.equal(invoices.status, 'error'); assert.equal(invoices.gross_total, null);
      assert.equal(report.body.currentRevenueSource, 'existing_reporting_database');
      const previous = calls.length; await erp.tick(); assert.equal(calls.length, previous, 'backoff should avoid repeated requests');
    });
    await t.test('failed later pages cannot replace the last published snapshot and resume safely', async () => {
      mode = 'second-page-failure';
      await erp.run(102, 'orders', { force: true });
      let report = (await request('/report?ano=2026')).body;
      let orders = report.streams.find(s => s.resource === 'orders');
      assert.equal(orders.status, 'error'); assert.equal(orders.gross_total, 100); assert.equal(orders.documents, 1);
      mode = 'resume';
      const start = calls.length; await erp.run(102, 'orders', { force: true });
      assert(calls[start].url.endsWith('page=1'));
      report = (await request('/report?ano=2026')).body; orders = report.streams.find(s => s.resource === 'orders');
      assert.equal(orders.status, 'connected'); assert.equal(orders.gross_total, 500); assert.equal(orders.documents, 2);
      mode = 'transport-error'; await erp.run(102, 'orders', { force: true });
      report = (await request('/report?ano=2026')).body; orders = report.streams.find(s => s.resource === 'orders');
      assert.equal(orders.gross_total, 500); assert(!JSON.stringify(report).includes('test-private-key'));
    });
    await t.test('revenue graphs keep company 100 and count only authorized company 102 invoices', async () => {
      await pool.query(`CREATE TABLE grupo_produto(cod_grupoprod int,descricao text);
        INSERT INTO grupo_produto VALUES(1,'AERION DRONES'),(2,'OTHER');
        CREATE TABLE vendas(empresa int,ano int,mes int,numero_unico int,numero_nota int,codigo_vendedor int,descricao_vendedor text,
          valor_total_prod numeric,natureza_nf2 text,cod_grupoprod int);
        INSERT INTO vendas VALUES(100,2026,10,10,1,33,'Vendedor',80,'Venda',1),
          (100,2026,10,10,1,33,'Vendedor',20,'Venda',1),
          (100,2026,10,11,2,33,'Vendedor',900,'Venda',2),
          (102,2026,10,10,1,33,'Vendedor',9999,'Venda',1),
          (3,2026,10,11,2,33,'Vendedor',8888,'Venda',1)`);
      assert.equal(await hybridRealizado({pool,legacyPool:pool,year:2026}),null);
      assert.equal((await request('/connections/102','PUT',{enabled:true,feed_realizado:true,national_currency:'BRL'})).status,200);
      let report=await hybridRealizado({pool,legacyPool:pool,year:2026});
      assert.equal(report.meses[9].receita_102,0,'order snapshots cannot substitute unavailable invoices');
      assert.equal(report.sources[1].available,false); assert.equal(report.partial,true);
      const generation='fiscal-test';
      await pool.query("UPDATE sankhya_reporting_streams SET published_generation=$1,last_success_at=now(),status='connected',error=null WHERE resource='invoices'",[generation]);
      const live=(id,overrides={})=>({id,companyId:102,date:'2026-10-22',resource:'invoices',authorized:true,invoiceStatus:'1',confirmed:true,pending:false,currency:null,currencyCode:'0',
        productValue:50,total:75,sellerCode:'33',sellerName:'Vendedor',operationName:'VENDA',...overrides});
      for(const data of [live('1'),live('2',{authorized:false,invoiceStatus:'2'}),live('3',{resource:'orders'}),live('4',{operationName:'ORÇAMENTO DE VENDA'}),live('5',{currencyCode:'1',currency:null})]){
        await pool.query("INSERT INTO sankhya_reporting_documents(company_id,resource,document_id,date,data,generation) VALUES(102,'invoices',$1,'2026-10-22',$2,$3)",[data.id,data,generation]);
      }
      await pool.query("INSERT INTO sankhya_reporting_documents(company_id,resource,document_id,date,data,generation) VALUES(102,'invoices','old','2026-10-22',$1,'unpublished')",[live('old',{productValue:999})]);
      report=await hybridRealizado({pool,legacyPool:pool,year:2026});
      assert.equal(report.meses[9].receita_100,100);assert.equal(report.meses[9].receita_102,50);
      assert.equal(report.meses[9].receita,150);assert.equal(report.meses[9].vendas,2);
      assert.equal(report.excludedIncompleteDocuments,1);assert.equal(report.partial,true);
      assert.equal(report.sources[1].basis,'notas_autorizadas_produtos');
      const seller=await hybridRealizado({pool,legacyPool:pool,year:2026,bySeller:true});
      assert.equal(seller.vendedores.length,1);assert.equal(seller.vendedores[0].receita,150);
      const month=await hybridRealizado({pool,legacyPool:pool,year:2026,month:10});
      assert.equal(month.receita,150);assert.equal(month.vendas_100,1);assert.equal(month.vendas_102,1);
    });
  } finally {
    await new Promise(resolve => server.close(resolve)); await pool.end();
    await root.query(`DROP SCHEMA ${schema} CASCADE`); await root.end();
  }
});
