const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { Pool } = require('pg');
const { createEcommerce } = require('../ecommerce/routes');
const { createSync, upsertRecord } = require('../ecommerce/store');
const { decrypt, encryptionKey } = require('../ecommerce/domain');

const databaseUrl = process.env.ECOMMERCE_TEST_DATABASE_URL;
test('Ecommerce API and resumable sync with isolated PostgreSQL schema', { skip: !databaseUrl }, async t => {
  const schema = `ecommerce_test_${crypto.randomBytes(8).toString('hex')}`;
  const root = new Pool({ connectionString: databaseUrl });
  await root.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const env = { ECOMMERCE_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'), ECOMMERCE_PUBLIC_URL: 'https://crm.example.com' };
  let metricFail = false;
  let orderPages = [];
  let snapshotOrder = { id: 1, number: '1', currency: 'BRL', status: 'completed', date_paid_gmt: '2026-10-20T12:00:00', date_created_gmt: '2026-10-20T11:00:00',
    date_modified_gmt: '2026-10-20T12:00:00', line_items: [{ id: 5, product_id: 3, quantity: 1, name: 'Drone', total: '120', subtotal: '120' }], refunds: [] };
  const providers = {
    test: async provider => ({ currency: 'BRL', timezone: 'America/Sao_Paulo', provider }),
    woo: async (config, path, params) => {
      if (path === 'orders') { orderPages.push(params); return { data: [snapshotOrder] }; }
      if (path.startsWith('orders/')) return { data: snapshotOrder };
      return { data: [] };
    },
    bridge: async () => ({ data: [] }),
    metrics: async (provider, config, from) => {
      if (metricFail) throw Object.assign(new Error('Falha de teste sem segredos.'), { retrySeconds: 3600 });
      return [{ kind: 'total', date: from, sessions: 10, purchases: 1 }];
    },
    exchangeCode: async () => ({ refresh_token: 'private-refresh-token' }),
  };
  const users = { 2: { role: 'member', page_permissions: { Ecommerce: 'view' } }, 3: { role: 'member', page_permissions: { Ecommerce: 'none' } },
    4: { role: 'member', page_permissions: {} } };
  const ecommerce = createEcommerce({ pool, providers, env, getUserById: async id => users[id] });
  const app = express();
  app.use(express.json({ verify: (req, res, data) => { req.ecommerceRawBody = data; } }));
  app.use((req, res, next) => {
    const who = req.get('x-test-user');
    if (who === 'admin') req.auth = { role: 'admin' };
    else if (who) req.auth = { role: 'member', uid: Number(who) };
    next();
  });
  app.use('/api/ecommerce', ecommerce.router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/ecommerce`;
  const request = async (path, { user = 'admin', method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'x-test-user': user, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { response, data, text };
  };
  try {
    await ecommerce.ensure();
    await t.test('report access requires an explicit grant and connection mutation requires admin', async () => {
      assert.equal((await request('/report', { user: '3' })).response.status, 403);
      assert.equal((await request('/report', { user: '4' })).response.status, 403);
      assert.equal((await request('/report', { user: '' })).response.status, 403);
      assert.equal((await request('/report', { user: '2' })).response.status, 200);
      assert.equal((await request('/connections/ga4', { user: '2', method: 'PUT', body: {} })).response.status, 403);
      assert.equal((await request('/connections/ga4', { method: 'PUT', body: {}, headers: { origin: 'https://untrusted.example.com' } })).response.status, 403);
    });
    const woo = { url: 'https://loja.aerion.com.br', consumer_key: `ck_${'a'.repeat(40)}`, consumer_secret: `cs_${'b'.repeat(40)}`, webhook_secret: 'private-webhook-secret-that-is-long-enough' };
    await t.test('configuration persists encrypted secrets and responses never return them', async () => {
      assert.equal((await request('/connections/woocommerce', { method: 'PUT', body: woo })).response.status, 200);
      const row = (await pool.query("SELECT * FROM ecommerce_connections WHERE provider='woocommerce'")).rows[0];
      assert(!JSON.stringify(row).includes(woo.consumer_secret));
      assert.equal(decrypt(row.secrets, encryptionKey(env)).consumer_secret, woo.consumer_secret);
      const state = await request('/status', { user: '2' });
      assert(!state.text.includes(woo.consumer_secret)); assert(!state.text.includes('secrets'));
      assert.equal((await request('/connections/woocommerce', { method: 'PUT', body: { consumer_secret: '' } })).response.status, 200);
      const saved = (await pool.query("SELECT secrets FROM ecommerce_connections WHERE provider='woocommerce'")).rows[0];
      assert.equal(decrypt(saved.secrets, encryptionKey(env)).consumer_secret, woo.consumer_secret);
    });
    await t.test('WooCommerce import without optional bridge completes and retains a fixed modified-before watermark', async () => {
      const sync = createSync({ pool, providers, env });
      await sync.run('woocommerce', { force: true });
      const row = (await pool.query("SELECT * FROM ecommerce_connections WHERE provider='woocommerce'")).rows[0];
      assert.equal(row.status, 'connected'); assert(row.last_success_at); assert.equal(row.cursor, null);
      assert(orderPages[0].modified_before); assert.equal(orderPages[0].dates_are_gmt, 'true');
      const report = await request('/report?from=2026-10-20&to=2026-10-21');
      assert.equal(report.data.summary.revenue, 120); assert.equal(report.data.summary.orders, 1);
    });
    await t.test('webhook signature and idempotency, duplicate bodies and updates', async () => {
      const body = { id: 1 };
      const signature = crypto.createHmac('sha256', woo.webhook_secret).update(JSON.stringify(body)).digest('base64');
      const options = { method: 'POST', user: '', body, headers: { 'x-wc-webhook-delivery-id': 'delivery-1', 'x-wc-webhook-topic': 'order.updated', 'x-wc-webhook-signature': signature } };
      assert.equal((await request('/webhooks/woocommerce', { ...options, headers: { ...options.headers, 'x-wc-webhook-signature': 'bad' } })).response.status, 401);
      assert.equal((await request('/webhooks/woocommerce', options)).response.status, 202);
      assert.equal((await request('/webhooks/woocommerce', options)).response.status, 202);
      assert.equal(Number((await pool.query('SELECT count(*) FROM ecommerce_webhooks')).rows[0].count), 1);
      snapshotOrder = { ...snapshotOrder, status: 'cancelled' };
      await createSync({ pool, providers, env }).run('woocommerce', { force: true });
      assert.equal((await request('/report?from=2026-10-20&to=2026-10-21')).data.summary.revenue, 0);
    });
    await t.test('an unavailable optional UTM bridge cannot stop order reconciliation', async () => {
      await request('/connections/woocommerce', { method: 'PUT', body: { report_user: 'report-reader', report_password: 'private-app-password' } });
      providers.bridge = async () => { throw new Error('plugin unavailable'); };
      await createSync({ pool, providers, env }).run('woocommerce', { force: true });
      const row = (await pool.query("SELECT * FROM ecommerce_connections WHERE provider='woocommerce'")).rows[0];
      assert.equal(row.status, 'connected'); assert(row.last_success_at); assert(row.info.tracking_error);
      providers.bridge = async () => ({ data: [] });
    });
    await t.test('complete catalogue snapshots remove coupons that no longer exist in WooCommerce', async () => {
      await upsertRecord(pool, 'woocommerce', 'coupon', 'removed-coupon', null, { code: 'removed-coupon' });
      await createSync({ pool, providers, env }).run('woocommerce', { force: true });
      assert.equal(Number((await pool.query("SELECT count(*) FROM ecommerce_records WHERE kind='coupon' AND record_id='removed-coupon'")).rows[0].count), 0);
    });
    await t.test('failed GA4 batches resume without duplicates and replace stale metrics atomically', async () => {
      await request('/connections/ga4', { method: 'PUT', body: { property_id: '123', service_account: JSON.stringify({ type: 'service_account', client_email: 'analytics@example.com', private_key: 'test-private-key' }) } });
      const cursor = { from: '2026-10-01', to: '2026-10-21', next: '2026-10-01' };
      await pool.query("UPDATE ecommerce_connections SET cursor=$1 WHERE provider='ga4'", [cursor]);
      const sync = createSync({ pool, providers, env });
      metricFail = true;
      await sync.run('ga4', { force: true });
      let row = (await pool.query("SELECT * FROM ecommerce_connections WHERE provider='ga4'")).rows[0];
      assert.equal(row.status, 'error'); assert.deepEqual({ ...row.cursor, generation: undefined }, { ...cursor, generation: undefined });
      metricFail = false;
      await sync.run('ga4', { force: true });
      row = (await pool.query("SELECT * FROM ecommerce_connections WHERE provider='ga4'")).rows[0];
      assert.equal(row.status, 'connected'); assert.equal(row.cursor, null);
      await pool.query("UPDATE ecommerce_connections SET cursor=$1 WHERE provider='ga4'", [cursor]);
      await sync.run('ga4', { force: true });
      assert.equal(Number((await pool.query("SELECT count(*) FROM ecommerce_records WHERE provider='ga4'")).rows[0].count), 3);
    });
    await t.test('changing the source account removes old data and disables Google until authorization', async () => {
      await upsertRecord(pool, 'google_ads', 'metric', 'old', '2026-10-20', { date: '2026-10-20', spend: 100 });
      const config = { customer_id: '1234567890', client_id: 'client', client_secret: 'private-client-secret' };
      await request('/connections/google_ads', { method: 'PUT', body: config });
      await request('/connections/google_ads', { method: 'PUT', body: { ...config, customer_id: '2345678901' } });
      const row = (await pool.query("SELECT * FROM ecommerce_connections WHERE provider='google_ads'")).rows[0];
      assert.equal(row.enabled, false);
      assert.equal(Number((await pool.query("SELECT count(*) FROM ecommerce_records WHERE provider='google_ads'")).rows[0].count), 0);
    });
    await t.test('OAuth state requires its cookie, expires once and stores refresh token encrypted', async () => {
      let auth = await request('/connections/google_ads/authorize', { method: 'POST' });
      const state = new URL(auth.data.url).searchParams.get('state');
      assert.equal((await request(`/oauth/google/callback?state=${state}&code=code`, { user: '' })).response.status, 400);
      const headers = { cookie: `ecommerce_oauth=${state}` };
      const result = await request(`/oauth/google/callback?state=${state}&code=code`, { user: '', headers });
      assert.equal(result.response.status, 302);
      assert.equal((await request(`/oauth/google/callback?state=${state}&code=code`, { user: '', headers })).response.status, 400);
      const row = (await pool.query("SELECT * FROM ecommerce_connections WHERE provider='google_ads'")).rows[0];
      assert.equal(decrypt(row.secrets, encryptionKey(env)).refresh_token, 'private-refresh-token');
      assert(!JSON.stringify(row).includes('private-refresh-token'));
      assert.equal(row.enabled, true);
    });
    await t.test('technical Google identity stays encrypted, enables sync and rejects user OAuth', async () => {
      const identity = { type: 'workload_identity', client_email: 'reader@aerion-project.iam.gserviceaccount.com', private_key: 'private-vps-identity-key',
        audience: '//iam.googleapis.com/projects/123456/locations/global/workloadIdentityPools/aerion/providers/vps-production',
        issuer: 'https://crm.example.com', subject: 'ecommerce-reader', token_audience: 'aerion-ecommerce', key_id: 'key-1' };
      const result = await request('/connections/google_ads', { method: 'PUT', body: { auth_type: 'google_identity', service_account: JSON.stringify(identity) } });
      assert.equal(result.response.status, 200);
      let row = (await pool.query("SELECT * FROM ecommerce_connections WHERE provider='google_ads'")).rows[0];
      assert.equal(row.enabled, true);
      assert.equal(decrypt(row.secrets, encryptionKey(env)).service_account.private_key, identity.private_key);
      assert.equal(decrypt(row.secrets, encryptionKey(env)).refresh_token, undefined);
      assert(!(await request('/status')).text.includes(identity.private_key));
      assert.equal((await request('/connections/google_ads/authorize', { method: 'POST' })).response.status, 400);
      await request('/connections/google_ads', { method: 'PUT', body: { enabled: true } });
      row = (await pool.query("SELECT * FROM ecommerce_connections WHERE provider='google_ads'")).rows[0];
      assert.equal(decrypt(row.secrets, encryptionKey(env)).service_account.private_key, identity.private_key);
      await request('/connections/google_ads', { method: 'PUT', body: { auth_type: 'oauth' } });
      row = (await pool.query("SELECT * FROM ecommerce_connections WHERE provider='google_ads'")).rows[0];
      assert.equal(row.enabled, false);
    });
    await t.test('testing access preserves coverage and authorization expiry; replacing a Meta token clears its old expiry', async () => {
      const config = { account_id: '123456', access_token: 'private-meta-token' };
      assert.equal((await request('/connections/meta_ads', { method: 'PUT', body: config })).response.status, 200);
      await pool.query("UPDATE ecommerce_connections SET info=$1 WHERE provider='meta_ads'", [{ history_from: '2025-10-21', authorization_expires_at: '2026-12-20T18:00:00Z', authorization_type: 'user_oauth', authorization_app_id: '123' }]);
      assert.equal((await request('/connections/meta_ads/test', { method: 'POST' })).response.status, 200);
      let row = (await pool.query("SELECT * FROM ecommerce_connections WHERE provider='meta_ads'")).rows[0];
      assert.equal(row.info.history_from, '2025-10-21');
      assert.equal(row.info.authorization_expires_at, '2026-12-20T18:00:00Z');
      await request('/connections/meta_ads', { method: 'PUT', body: { enabled: true } });
      row = (await pool.query("SELECT * FROM ecommerce_connections WHERE provider='meta_ads'")).rows[0];
      assert.equal(row.info.authorization_expires_at, '2026-12-20T18:00:00Z');
      await request('/connections/meta_ads', { method: 'PUT', body: { access_token: 'replacement-meta-token' } });
      row = (await pool.query("SELECT * FROM ecommerce_connections WHERE provider='meta_ads'")).rows[0];
      assert.equal(row.info.authorization_expires_at, undefined);
      assert.equal(row.info.authorization_type, undefined);
      assert.equal(row.info.history_from, '2025-10-21');
    });
    await t.test('per-provider PostgreSQL lock prevents two workers from fetching the same source', async () => {
      const client = await pool.connect();
      await client.query('SELECT pg_advisory_lock(735101)');
      orderPages = [];
      try { await createSync({ pool, providers, env }).run('woocommerce', { force: true }); assert.equal(orderPages.length, 0); }
      finally { await client.query('SELECT pg_advisory_unlock(735101)'); client.release(); }
    });
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await pool.end();
    await root.query(`DROP SCHEMA ${schema} CASCADE`);
    await root.end();
  }
});
