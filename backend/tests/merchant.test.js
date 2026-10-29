const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { Pool } = require('pg');
const { buildMerchantReport } = require('../ecommerce/merchant');
const { createProviders } = require('../ecommerce/providers');
const { createEcommerce, validateConfig } = require('../ecommerce/routes');
const { createSync } = require('../ecommerce/store');
const { decrypt, encryptionKey } = require('../ecommerce/domain');

const range = { from: '2026-10-01', to: '2026-10-02' };
const metric = (offerId, marketingMethod, clicks, impressions) => ({ kind: 'merchant_performance', date: '2026-10-01', offerId, marketingMethod, title: offerId, clicks, impressions });
const metrics = [metric('A', 'ORGANIC', 10, 100), metric('B', 'ORGANIC', 5, 50), metric('A', 'ADS', 20, 100)];
const pending = { id: 'accounts/5890381416/products/pt~BR~A', offerId: 'A', title: 'Drone A', availability: 'IN_STOCK',
  destinations: [{ context: 'FREE_LISTINGS', pending: ['BR'], approved: [], disapproved: [] }],
  issues: [{ code: 'pending_initial_policy_review_free_listings', context: 'FREE_LISTINGS', countries: ['BR'], severity: 'DISAPPROVED', resolution: 'pending_processing', description: 'Pending initial review' }] };
const catalog = { observedAt: '2026-10-28T19:30:00Z', products: [pending,
  { ...pending, id: 'accounts/5890381416/products/pt~BR~B', offerId: 'B', title: 'Drone B', destinations: [{ context: 'FREE_LISTINGS', approved: ['BR'] }], issues: [] }], sources: [] };
const connection = { config: { account_id: '5890381416' }, enabled: true, last_success_at: '2026-10-28T19:30:00Z', info: { performance_last_success_at: '2026-10-28T19:30:00Z' } };

test('Merchant preserves method separation, weighted CTR and current catalog outside the date filter', () => {
  const report = buildMerchantReport(catalog, metrics, range, connection);
  assert.deepEqual(report.methods.find(r => r.method === 'ORGANIC'), { method: 'ORGANIC', clicks: 15, impressions: 150, ctr: 10 });
  assert.deepEqual(report.methods.find(r => r.method === 'ADS'), { method: 'ADS', clicks: 20, impressions: 100, ctr: 20 });
  assert.equal(report.products.length, 3);
  assert.equal(report.catalog.pending, 1, 'initial-review severity must not turn pending country into rejection');
  assert.equal(report.catalog.approved, 1); assert.equal(report.catalog.disapproved, 0);
  const old = buildMerchantReport(catalog, metrics, { from: '2025-01-01', to: '2025-01-02' }, connection);
  assert.equal(old.catalog.total, 2); assert.equal(old.products.length, 0);
});

test('Merchant distinguishes successful empty performance, unavailable and preserved stale data', () => {
  assert.equal(buildMerchantReport(null, [], range, null).methods[0].clicks, null);
  assert.equal(buildMerchantReport(catalog, [], range, { ...connection, last_success_at: null }).methods[0].clicks, null);
  assert.equal(buildMerchantReport(catalog, [], range, connection).methods[0].clicks, 0);
  assert.equal(buildMerchantReport(catalog, [], range, connection).methods[0].ctr, null);
  const stale = buildMerchantReport(catalog, metrics, range, { ...connection, info: { ...connection.info, performance_error: 'Acesso recusado.' } });
  assert.equal(stale.methods[0].clicks, 15); assert.equal(stale.performanceError, 'Acesso recusado.');
  const incomplete = buildMerchantReport(catalog, [], range, { ...connection, info: { ...connection.info, history_from: '2026-10-02' } });
  assert.equal(incomplete.methods[0].clicks, null); assert.equal(incomplete.coveragePartial, true);
});

test('Merchant connection accepts saved technical identities and rejects unsupported account/source values', () => {
  assert.equal(validateConfig('merchant_center', { account_id: '5890381416' }).identity_source, 'ga4');
  assert.throws(() => validateConfig('merchant_center', { account_id: 'https://other.example' }));
  assert.throws(() => validateConfig('merchant_center', { account_id: '5890381416', identity_source: 'meta_ads' }));
  assert.throws(() => validateConfig('merchant_center', { account_id: '5890381416', identity_source: 'own' }));
});

function googleFixture(handler) {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const scopes = [], calls = [];
  const account = { type: 'service_account', client_email: 'reader@example.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const providers = createProviders({ transport: async (url, options) => {
    calls.push({ url, options });
    if (url.includes('oauth2.googleapis.com')) {
      const payload = JSON.parse(Buffer.from(new URLSearchParams(options.body).get('assertion').split('.')[1], 'base64url'));
      scopes.push(payload.scope); return Response.json({ access_token: 'merchant-test-token', expires_in: 3600 });
    }
    assert.equal(options.headers.Authorization, 'Bearer merchant-test-token');
    return handler(url, options);
  } });
  return { providers, config: { account_id: '5890381416', service_account: account }, scopes, calls };
}

test('Merchant paginates products and sources, reads upload health and removes feed URL credentials', async () => {
  const fixture = googleFixture((url, options) => {
    assert.equal(options.method || 'GET', 'GET', 'catalog must never write to Merchant');
    if (url.includes('/products?')) return Response.json({ products: new URL(url).searchParams.has('pageToken') ? [] : [{
      name: pending.id, offerId: 'A', productAttributes: { title: 'Drone A', brand: 'Autel Robotics' }, productStatus: { destinationStatuses: [{ reportingContext: 'FREE_LISTINGS', pendingCountries: ['BR'] }] },
    }], ...(new URL(url).searchParams.has('pageToken') ? {} : { nextPageToken: 'page-2' }) });
    if (url.includes('/dataSources?')) return Response.json({ dataSources: [{ name: 'accounts/5890381416/dataSources/1', input: 'FILE', displayName: 'Feed Aerion',
      fileInput: { fetchSettings: { enabled: true, frequency: 'FREQUENCY_DAILY', fetchUri: 'https://user:password@example.com/feed.xml?token=private' } } }] });
    return Response.json({ processingState: 'SUCCEEDED', itemsTotal: '1', uploadTime: '2026-10-28T19:00:00Z' });
  });
  const snapshot = await fixture.providers.merchantCatalog(fixture.config);
  assert.equal(snapshot.products.length, 1); assert.equal(snapshot.products[0].title, 'Drone A');
  assert.equal(snapshot.sources[0].feedUrl, 'https://example.com/feed.xml');
  assert.equal(snapshot.sources[0].itemsTotal, 1); assert.equal(snapshot.sources[0].processingState, 'SUCCEEDED');
  assert.equal(fixture.scopes[0], 'https://www.googleapis.com/auth/content');
  assert.equal(fixture.calls.filter(c => c.url.includes('/products?')).length, 2);
});

test('Merchant fails closed on repeated cursors or products from another account', async () => {
  const repeated = googleFixture(() => Response.json({ products: [], nextPageToken: 'repeat' }));
  await assert.rejects(repeated.providers.merchantCatalog(repeated.config), /Paginação/);
  const wrong = googleFixture(url => Response.json(url.includes('/products?') ? { products: [{ name: 'accounts/999/products/id', offerId: 'A' }] } : { dataSources: [] }));
  await assert.rejects(wrong.providers.merchantCatalog(wrong.config), /fora da conta/);
});

test('Merchant performance preserves two offers and marketing methods on the same day with pagination', async () => {
  const fixture = googleFixture((url, options) => {
    assert(url.endsWith('/reports:search')); assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert(body.query.includes('date, marketing_method, offer_id, title, clicks, impressions'));
    return Response.json({ results: [{ productPerformanceView: { date: { year: 2026, month: 10, day: 1 }, offerId: body.pageToken ? 'B' : 'A',
      title: 'Drone', marketingMethod: body.pageToken ? 'ADS' : 'ORGANIC', clicks: '10', impressions: '100' } }], ...(!body.pageToken ? { nextPageToken: 'next' } : {}) });
  });
  const rows = await fixture.providers.metrics('merchant_center', fixture.config, range.from, range.to);
  assert.equal(rows.length, 2); assert.equal(rows[0].offerId, 'A'); assert.equal(rows[1].marketingMethod, 'ADS');
});

test('Merchant persists shared identity, snapshots and independent performance failures in PostgreSQL', { skip: !process.env.ECOMMERCE_TEST_DATABASE_URL }, async t => {
  const schema = `merchant_test_${crypto.randomBytes(8).toString('hex')}`;
  const root = new Pool({ connectionString: process.env.ECOMMERCE_TEST_DATABASE_URL });
  await root.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: process.env.ECOMMERCE_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
  const env = { ECOMMERCE_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') };
  let failCatalog = false, failPerformance = false;
  const providers = { test: async (provider, config) => {
    if (provider === 'merchant_center') assert.equal(config.service_account.client_email, 'reader@example.com');
    return { account_name: 'Aerion' };
  }, merchantCatalog: async () => { if (failCatalog) throw Object.assign(new Error('Catálogo indisponível.'), { retrySeconds: 3600 }); return catalog; },
  metrics: async () => { if (failPerformance) throw Object.assign(new Error('Desempenho indisponível.'), { retrySeconds: 3600 }); return metrics; } };
  const ecommerce = createEcommerce({ pool, providers, env });
  const app = express(); app.use(express.json()); app.use((req, res, next) => { req.auth = { role: req.get('x-admin') === 'yes' ? 'admin' : 'member', page_permissions: { Ecommerce: 'view' } }; next(); });
  app.use('/api/ecommerce', ecommerce.router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.on('listening', resolve));
  const request = async (path, method = 'GET', data, admin = true) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ecommerce${path}`, { method,
      headers: { 'Content-Type': 'application/json', 'x-admin': admin ? 'yes' : 'no' }, body: data ? JSON.stringify(data) : undefined });
    return { status: response.status, body: await response.json() };
  };
  try {
    await ecommerce.ensure();
    await request('/connections/ga4', 'PUT', { property_id: '123', service_account: JSON.stringify({ type: 'service_account', client_email: 'reader@example.com', private_key: 'private-key-only-on-server' }) });
    assert.equal((await request('/connections/merchant_center', 'PUT', { account_id: '5890381416', identity_source: 'ga4' }, false)).status, 403);
    assert.equal((await request('/connections/merchant_center', 'PUT', { account_id: '5890381416', identity_source: 'ga4' })).status, 200);
    assert.equal((await request('/connections/merchant_center/test', 'POST')).status, 200);
    const saved = (await pool.query("SELECT * FROM ecommerce_connections WHERE provider='merchant_center'")).rows[0];
    assert.deepEqual(decrypt(saved.secrets, encryptionKey(env)), {}, 'shared credentials are referenced, not copied');
    assert(!JSON.stringify((await request('/status')).body).includes('private-key-only-on-server'));
    const start = async () => pool.query("UPDATE ecommerce_connections SET cursor=$1 WHERE provider='merchant_center'", [{ from: range.from, next: range.from, to: range.to, generation: crypto.randomUUID() }]);
    const sync = createSync({ pool, providers, env });
    await start(); await sync.run('merchant_center', { force: true });
    let report = (await request('/report?from=2026-10-01&to=2026-10-02', 'GET', null, false)).body;
    assert.equal(report.merchant.catalog.total, 2); assert.equal(report.merchant.methods[0].clicks, 15);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM ecommerce_records WHERE provider='merchant_center' AND kind='metric'")).rows[0].n, 3);
    assert.equal(report.ads.length, 0, 'Merchant ads cannot become another paid-media source');
    failCatalog = true; await sync.run('merchant_center', { force: true });
    report = (await request('/report?from=2026-10-01&to=2026-10-02')).body;
    assert.equal(report.merchant.catalog.total, 2, 'failed snapshots preserve published catalog');
    assert.match(report.merchant.catalogError, /Catálogo indisponível/);
    failCatalog = false; failPerformance = true;
    await start(); await sync.run('merchant_center', { force: true });
    report = (await request('/report?from=2026-10-01&to=2026-10-02')).body;
    assert.equal(report.merchant.catalog.total, 2); assert.equal(report.merchant.methods[0].clicks, 15);
    assert.match(report.merchant.performanceError, /indisponível/);
    assert.equal((await request('/connections/merchant_center', 'PUT', { account_id: '777', identity_source: 'ga4' })).status, 200);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM ecommerce_records WHERE provider='merchant_center'")).rows[0].n, 0, 'account changes cannot retain another account catalog');
  } finally {
    await new Promise(resolve => server.close(resolve)); await pool.end();
    await root.query(`DROP SCHEMA ${schema} CASCADE`); await root.end();
  }
});
