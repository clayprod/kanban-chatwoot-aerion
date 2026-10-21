const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { encrypt, decrypt, verifyWebhook, normalizeOrder, dateRange, buildReport } = require('../ecommerce/domain');
const { createProviders, isPublicAddress, storeUrl } = require('../ecommerce/providers');
const { validateConfig } = require('../ecommerce/routes');

const order = (overrides = {}) => ({ id: 17, number: '17', status: 'completed', currency: 'BRL',
  date_paid_gmt: '2026-10-21T02:30:00', date_created_gmt: '2026-10-20T23:00:00', date_modified_gmt: '2026-10-21T10:00:00',
  total: '120', shipping_total: '10', total_tax: '10', discount_total: '20',
  line_items: [{ id: 1, product_id: 3, name: 'Drone', quantity: 2, subtotal: '120', total: '100', sku: 'A3' }],
  coupon_lines: [{ code: 'aerion', discount: '10' }, { code: 'outubro', discount: '10' }],
  meta_data: [{ key: '_aerion_utm_link_id', value: 'abc' }], ...overrides });

test('credentials require a dedicated key and authenticated encryption detects tampering', () => {
  const key = crypto.randomBytes(32);
  const secret = { access_token: 'never-log-this' };
  const value = encrypt(secret, key);
  assert(!value.includes(secret.access_token));
  assert.deepEqual(decrypt(value, key), secret);
  assert.throws(() => decrypt(value, crypto.randomBytes(32)));
  const parts = value.split('.');
  parts[2] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => decrypt(parts.join('.'), key));
});
test('webhook signature covers the exact original bytes', () => {
  const raw = Buffer.from('{ "id": 17 }');
  const signature = crypto.createHmac('sha256', 'secret').update(raw).digest('base64');
  assert(verifyWebhook(raw, signature, 'secret'));
  assert(!verifyWebhook(Buffer.from('{"id":17}'), signature, 'secret'));
  assert(!verifyWebhook(raw, 'invalid', 'secret'));
  assert(!verifyWebhook(undefined, signature, 'secret'));
});
test('paid date uses Sao Paulo and product refunds exclude shipping and taxes', () => {
  const normalized = normalizeOrder(order(), [{ amount: '36', line_items: [{ total: '-30', total_tax: '-6', quantity: -1,
    meta_data: [{ key: '_refunded_item_id', value: 1 }] }] }]);
  assert.equal(normalized.paidDay, '2026-10-20');
  assert.equal(normalized.revenue, 70);
  assert.equal(normalized.items[0].refundedQuantity, 1);
  assert.equal(normalized.items[0].revenue, 70);
  assert.equal(normalized.refunded, 36);
  assert.equal(normalized.unallocatedRefund, 0);
  assert.equal(normalized.attribution.linkId, 'abc');
  assert(!JSON.stringify(normalized).includes('billing'));
});
test('pending, cancelled and failed orders cannot increase paid revenue', () => {
  for (const status of ['pending', 'cancelled', 'failed']) {
    const result = normalizeOrder(order({ status }));
    assert.equal(result.paid, false); assert.equal(result.revenue, 0);
  }
  assert.equal(normalizeOrder(order({ date_paid_gmt: null })).paid, false);
  const pending = normalizeOrder(order({ status: 'pending', date_paid_gmt: null, date_created_gmt: '2026-10-21T02:30:00' }));
  assert.equal(pending.createdDay, '2026-10-20');
});
test('amount-only refunds remain explicitly unallocated', () => {
  assert.equal(normalizeOrder(order(), [{ amount: '12', line_items: [] }]).unallocatedRefund, 12);
});
test('date validation rejects invalid days, reversed and oversized periods', () => {
  for (const query of [{ from: '2026-02-30' }, { from: '2026-11-01', to: '2026-10-01' },
    { from: '2020-01-01', to: '2026-10-21' }, { from: 'sql' }]) assert.throws(() => dateRange(query));
  assert.deepEqual(dateRange({ from: '2026-10-01', to: '2026-10-07' }), { from: '2026-10-01', to: '2026-10-07', previousFrom: '2026-09-24', previousTo: '2026-09-30' });
});
test('report separates sources, currencies and non-additive coupon revenue', () => {
  const range = dateRange({ from: '2026-10-20', to: '2026-10-21' });
  const report = buildReport({ range, orders: [normalizeOrder(order()), normalizeOrder(order({ id: 18, currency: 'USD' }))],
    metrics: [
      { provider: 'ga4', kind: 'total', date: '2026-10-20', sessions: 10, purchases: 2 },
      { provider: 'ga4', kind: 'traffic', date: '2026-10-20', sessions: 10, purchases: 2 },
      { provider: 'meta_ads', date: '2026-10-20', currency: 'BRL', spend: 20, conversions: 4 },
      { provider: 'google_ads', date: '2026-10-20', currency: 'USD', spend: 50, conversions: 5 },
    ], connections: ['woocommerce', 'ga4', 'google_ads', 'meta_ads'].map(provider => ({ provider, last_success_at: new Date() })) });
  assert.equal(report.summary.revenue, 100);
  assert.equal(report.summary.orders, 1);
  assert.equal(report.summary.sessions, 10);
  assert.equal(report.summary.purchases, 2);
  assert.equal(report.summary.spend, 20);
  assert.equal(report.orders.length, 2);
  assert.equal(report.coupons.length, 2);
  assert.equal(report.coupons[0].revenue, 100);
  assert.equal(report.coupons[1].revenue, 100);
  assert.deepEqual(report.currencies, ['BRL', 'USD']);
});
test('unconnected sources are unavailable rather than zero', () => {
  const report = buildReport({ range: dateRange({ from: '2026-10-20', to: '2026-10-21' }) });
  assert.equal(report.summary.revenue, null); assert.equal(report.summary.spend, null); assert.equal(report.summary.sessions, null);
  assert.equal(report.daily[0].revenue, null);
});
test('comparison before the imported history stays unavailable', () => {
  const report = buildReport({ range: dateRange({ from: '2026-01-01', to: '2026-10-21' }), connections: [
    { provider: 'woocommerce', last_success_at: new Date(), info: { history_from: '2025-10-21' } },
  ] });
  assert.equal(report.summary.revenue, 0);
  assert.equal(report.summary.previousRevenue, null);
});
test('store URL blocks credentials, redirects to paths, plaintext and local networks', () => {
  for (const url of ['http://loja.aerion.com.br', 'https://root:password@example.com', 'https://127.0.0.1', 'https://10.1.2.3', 'https://[::1]', 'https://example.com/wp-admin', 'https://example.com:8080']) assert.throws(() => storeUrl(url));
  assert.equal(storeUrl('https://loja.aerion.com.br'), 'https://loja.aerion.com.br');
  assert(!isPublicAddress('169.254.169.254')); assert(!isPublicAddress('::ffff:127.0.0.1'));
  assert(!isPublicAddress('fc00::1')); assert(isPublicAddress('8.8.8.8'));
});
test('configuration validates service-account JSON and normalizes ad-account IDs', () => {
  assert.throws(() => validateConfig('ga4', { property_id: 'G-123', service_account: '{}' }));
  assert.throws(() => validateConfig('ga4', { property_id: '123', service_account: '{bad' }));
  assert.equal(validateConfig('google_ads', { customer_id: '123-456-7890', client_id: 'app', client_secret: 'secret' }).customer_id, '1234567890');
  assert.equal(validateConfig('meta_ads', { account_id: 'act_123', access_token: 'token' }).account_id, '123');
});
test('Google Ads reporting converts micros, keeps account currency and omits developer token', async () => {
  const requests = [];
  const providers = createProviders({ transport: async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify(url.includes('oauth2') ? { access_token: 'access', expires_in: 3600 } : {
      results: [{ segments: { date: '2026-10-20' }, campaign: { id: '1', name: 'Drone' },
        metrics: { costMicros: '12500000', clicks: '3', impressions: '100', conversions: '1', conversionsValue: '150' } }],
    }), { status: 200 });
  } });
  const data = await providers.metrics('google_ads', { customer_id: '1234567890', client_id: 'client', client_secret: 'secret', refresh_token: 'refresh' }, '2026-10-20', '2026-10-20', { currency: 'BRL', timezone: 'America/Sao_Paulo' });
  assert.equal(data[0].spend, 12.5); assert.equal(data[0].currency, 'BRL'); assert.equal(data[0].conversions, 1);
  assert.equal(requests[1].options.headers['developer-token'], undefined);
  assert(!requests[0].url.includes('secret'));
});

test('federated identity signs short assertions and keeps Analytics and Ads token caches separate', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = { type: 'workload_identity', client_email: 'reader@aerion-project.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    audience: '//iam.googleapis.com/projects/123456/locations/global/workloadIdentityPools/aerion/providers/vps-production',
    issuer: 'https://crm.aerion.com.br', subject: 'ecommerce-reader', token_audience: 'aerion-ecommerce', key_id: 'rotation-1' };
  const config = validateConfig('google_ads', { customer_id: '1234567890', auth_type: 'google_identity', service_account: JSON.stringify(account) });
  assert.equal(validateConfig('ga4', { property_id: '123', service_account: JSON.stringify(account) }).service_account.type, 'workload_identity');
  const requests = [];
  const providers = createProviders({ transport: async (url, options) => {
    requests.push({ url, options });
    if (url.includes('sts.googleapis.com')) {
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('audience'), account.audience);
      const [header, payload, signature] = body.get('subject_token').split('.');
      assert(crypto.verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')));
      const claims = JSON.parse(Buffer.from(payload, 'base64url'));
      assert.equal(claims.iss, account.issuer); assert.equal(claims.sub, account.subject);
      assert.equal(claims.aud, account.token_audience); assert.equal(claims.exp - claims.iat, 300);
      assert.equal(JSON.parse(Buffer.from(header, 'base64url')).kid, 'rotation-1');
      return Response.json({ access_token: 'federated' });
    }
    if (url.includes('iamcredentials.googleapis.com')) {
      const { scope, lifetime } = JSON.parse(options.body);
      assert.equal(options.headers.Authorization, 'Bearer federated'); assert.equal(lifetime, '3600s');
      return Response.json({ accessToken: scope[0].endsWith('adwords') ? 'ads-token' : 'analytics-token', expireTime: new Date(Date.now() + 3600000).toISOString() });
    }
    if (url.includes('analyticsdata.googleapis.com')) {
      assert.equal(options.headers.Authorization, 'Bearer analytics-token'); return Response.json({ rows: [] });
    }
    assert.equal(options.headers.Authorization, 'Bearer ads-token');
    return Response.json({ results: [{ customer: { currencyCode: 'BRL', timeZone: 'America/Sao_Paulo' } }] });
  } });
  // Identical config apart from provider: each API must receive its own scope and cached token.
  const shared = { ...config, property_id: '123' };
  await providers.test('ga4', shared);
  await providers.test('google_ads', shared);
  await providers.test('ga4', shared);
  await providers.test('google_ads', shared);
  assert.equal(requests.filter(r => r.url.includes('sts.googleapis.com')).length, 2);
  assert.deepEqual(requests.filter(r => r.url.includes('iamcredentials.googleapis.com')).map(r => JSON.parse(r.options.body).scope),
    [['https://www.googleapis.com/auth/analytics.readonly'], ['https://www.googleapis.com/auth/adwords']]);
  for (const bad of [{ audience: 'https://evil.example/' }, { client_email: 'reader@example.com' }, { type: 'external_account' }, { subject: '' }]) {
    assert.throws(() => validateConfig('ga4', { property_id: '123', service_account: JSON.stringify({ ...account, ...bad }) }));
  }
});

test('federation failures never expose upstream tokens or the signing key', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const config = { property_id: '123', service_account: { type: 'workload_identity', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    audience: 'pool', issuer: 'https://crm.aerion.com.br', subject: 'reader', token_audience: 'reports', key_id: 'key' } };
  const providers = createProviders({ transport: async () => new Response('private-upstream-assertion', { status: 403 }) });
  await assert.rejects(providers.test('ga4', config), error => error.retrySeconds === 3600 && !error.message.includes('private-upstream'));
});
test('Meta selects one purchase action instead of summing overlapping action types and paginates by cursor', async () => {
  const requests = [];
  const providers = createProviders({ transport: async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ data: requests.length === 1 ? [{ date_start: '2026-10-20', campaign_id: '5', spend: '2',
      actions: [{ action_type: 'omni_purchase', value: '2' }, { action_type: 'purchase', value: '2' }],
      action_values: [{ action_type: 'omni_purchase', value: '100' }, { action_type: 'purchase', value: '100' }] }] : [],
      ...(requests.length === 1 ? { paging: { next: 'https://do-not-follow.example/?access_token=secret', cursors: { after: 'next' } } } : {}) }), { status: 200 });
  } });
  const result = await providers.metrics('meta_ads', { account_id: '3', access_token: 'secret' }, '2026-10-20', '2026-10-21', { currency: 'BRL' });
  assert.equal(result[0].conversions, 2); assert.equal(result[0].conversionValue, 100);
  assert.equal(requests.length, 2); assert(requests[1].url.includes('after=next'));
  assert(!requests[0].url.includes('secret')); assert(requests[1].url.startsWith('https://graph.facebook.com/'));
});
test('upstream errors do not leak tokens and rate limits retain a retry delay', async () => {
  const providers = createProviders({ transport: async () => new Response('secret-token', { status: 429, headers: { 'retry-after': '1000' } }) });
  await assert.rejects(providers.test('meta_ads', { account_id: '1', access_token: 'secret-token' }), error =>
    error.retrySeconds === 1000 && !error.message.includes('secret-token'));
});
module.exports = { order };
