const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { Pool } = require('pg');
const { createSankhyaReporting, parsePage, erpDate } = require('../sankhyaReporting');

const row = (id, total = '100') => ({ codigoNota: String(id), codigoEmpresa: '102', dataNegociacao: '22/10/2026',
  valorNota: total, nomeMoeda: 'Real', statusNFe: 1, cliente: { email: 'private@example.com' }, chaveNFe: 'sensitive-fiscal-key' });
const page = (rows, more = 'false') => ({ pedido: rows, pagination: { page: '0', total: '12', hasMore: more } });
test('Sankhya page parsing respects textual booleans, scope and minimizes stored data', () => {
  const parsed = parsePage(page([row(1)]), 'orders', 102);
  assert.equal(parsed.hasMore, false); assert.equal(parsed.rows[0].total, 100);
  assert.equal(parsed.rows[0].date, '2026-10-22'); assert.equal(parsed.rows[0].currency, 'BRL');
  assert(!JSON.stringify(parsed).includes('private@example.com')); assert(!JSON.stringify(parsed).includes('sensitive-fiscal-key'));
  assert.equal(parsePage(page([], 'true'), 'orders', 102).hasMore, true);
  assert.throws(() => parsePage(page([{ ...row(1), codigoEmpresa: '100' }]), 'orders', 102), /fora da empresa/);
  assert.throws(() => parsePage({ pedido: [], pagination: {} }, 'orders', 102), /Paginação/);
  assert.throws(() => parsePage(page([{ ...row(1), valorNota: 'invalid' }]), 'orders', 102), /numérico/);
  assert.equal(erpDate('31/02/2026'), null);
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
  } finally {
    await new Promise(resolve => server.close(resolve)); await pool.end();
    await root.query(`DROP SCHEMA ${schema} CASCADE`); await root.end();
  }
});
