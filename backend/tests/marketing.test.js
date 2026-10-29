const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { Pool } = require('pg');
const { projectProduct, eligibleProducts, metaFeed, reconcileGoogle, campaignPlan, seoOpportunities } = require('../ecommerce/marketingDomain');
const { createProviders } = require('../ecommerce/providers');
const { createEcommerce } = require('../ecommerce/routes');
const { createMarketing, enqueueMarketing } = require('../ecommerce/marketing');
const { advertisingEligible, emailHash, desiredMembers, parseMappings, syncCustomerAudiences } = require('../ecommerce/customerAudiences');
const { paidGa4Payload } = require('../ecommerce/serverMeasurement');

const raw = (id = 1, extra = {}) => ({ id, parent_id: id, sku: `SKU-${id}`, name: 'Drone real', description: 'Especificação fornecida pela loja.',
  url: 'https://loja.aerion.com.br/produto/drone/', image: 'https://loja.aerion.com.br/photo.jpg', brand: 'HUBSAN',
  consumer_price: '100.00', consumer_regular_price: '120.00', currency: 'BRL', availability: 'in_stock',
  status: 'publish', visible: true, categories: ['Drones'], price_source: 'aerion_consumer_card_v1', ...extra });
test('projection only accepts consumer quotes and strips all private pricing and metadata', () => {
  assert.throws(() => projectProduct({ ...raw(), price_source: null }));
  const product = projectProduct(raw(1, { price: '1', wholesale: '2', meta_data: [{ price: '3' }] }));
  assert.equal(product.price, 100); assert.equal(product.regularPrice, 120);
  assert(!JSON.stringify(product).includes('wholesale')); assert(!JSON.stringify(product).includes('meta_data'));
  assert.equal(product.version, projectProduct(raw()).version);
  assert.notEqual(product.version, projectProduct(raw(1, { consumer_price: 110 })).version);
});
test('webhook provisioning creates only missing topics and preserves existing deliveries and secrets', async () => {
  const writes = [];
  const url = 'https://crm.example.com/api/ecommerce/webhooks/woocommerce';
  const providers = createProviders({ transport: async (target, options) => {
    if (options.method !== 'POST') return Response.json([{ id: 1, topic: 'product.created', status: 'active', delivery_url: url }]);
    const body = JSON.parse(options.body); writes.push(body); return Response.json({ id: writes.length + 1, ...body });
  } });
  const result = await providers.ensureProductWebhooks({ url: 'https://loja.aerion.com.br', consumer_key: 'ck', consumer_secret: 'cs', webhook_secret: 'private' }, url);
  assert.equal(writes.length, 2); assert.deepEqual(writes.map(w => w.topic), ['product.updated', 'product.deleted']);
  assert(result.hooks[0].existing); assert(!JSON.stringify(result).includes('private'));
});
test('Google audience creation uses the Admin API enum and keeps paid-buyer exclusions explicit', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const config = { property_id: '123', service_account: { type: 'service_account', client_email: 'reader@example.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) } };
  let count = 0;
  const provider = createProviders({ transport: async (url, options = {}) => {
    if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'test', expires_in: 3600 });
    if (url.includes('/googleAdsLinks')) return Response.json({ googleAdsLinks: [{ customerId: '1234567890', adsPersonalizationEnabled: true }] });
    if (options.method !== 'POST') return Response.json({ audiences: [] });
    const body = JSON.parse(options.body);
    assert.equal(body.filterClauses[0].simpleFilter.scope, 'AUDIENCE_FILTER_SCOPE_ACROSS_ALL_SESSIONS');
    assert.equal(body.filterClauses[0].clauseType, 'INCLUDE');
    assert(!JSON.stringify(body).includes('inAnyNDayPeriod'));
    count++; return Response.json({ ...body, name: `properties/123/audiences/${count}`, adsPersonalizationEnabled: true });
  } });
  const result = await provider.ensureGoogleStoreAudiences(config);
  assert.equal(count, 5); assert.equal(result.store.find(a => a.id === 'paid_buyers').days, 180);
  assert(result.store.find(a => a.id === 'cart').exclusionMethod); assert.equal(result.activationAllowed, false);
});
test('Meta all-visitors rules use the supported URL template and exclude paid buyers for 180 days', async () => {
  const created = [];
  const providers = createProviders({ transport: async (url, options) => {
    if (options.method === 'GET') return Response.json({ data: [] });
    const fields = Object.fromEntries(new URLSearchParams(options.body));
    created.push({ ...fields, rule: JSON.parse(fields.rule) });
    return Response.json({ id: String(created.length) });
  } });
  await providers.ensureMetaStoreAudiences({ account_id: '10', access_token: 'secret' }, '123');
  assert.equal(created.length, 5);
  const rule = created[0].rule;
  assert.equal(rule.inclusions.rules[0].template, 'ALL_VISITORS');
  assert.deepEqual(rule.inclusions.rules[0].filter.filters[0], { field: 'url', operator: 'i_contains', value: '' });
  assert.equal(rule.inclusions.rules[0].retention_seconds, 30 * 86400);
  assert.equal(rule.exclusions.rules[0].retention_seconds, 180 * 86400);
  assert.equal(rule.exclusions.rules[0].filter.filters[0].value, 'Purchase');
});
test('feed blocks duplicate SKU, placeholders, missing brand, invalid URLs and undated preorder', () => {
  const p = projectProduct(raw());
  assert(eligibleProducts([p])[0].eligible);
  assert(eligibleProducts([p, { ...p, id: '2' }]).every(p => p.issues.includes('duplicate_sku')));
  for (const extra of [{ image: 'https://loja.aerion.com.br/placeholder.jpg' }, { brand: '' }, { url: 'javascript:alert(1)' }, { availability: 'preorder' }, { consumer_price: '' }, { consumer_price: -1 }]) {
    assert(!eligibleProducts([projectProduct(raw(1, extra))])[0].eligible);
  }
  const preorder = projectProduct(raw(1, { availability: 'preorder', availability_date: '2099-02-05T00:00:00-03:00' }));
  const feed = metaFeed([preorder]); assert(feed.includes('preorder')); assert(feed.includes('120.00 BRL')); assert(feed.includes('100.00 BRL')); assert(feed.includes('2099-02-05'));
  assert.equal(metaFeed([p, { ...p, id: '2' }]).trim().split('\n').length, 1);
});
test('Google reconciliation distinguishes unavailable, not received, received and approved', () => {
  const product = projectProduct(raw());
  assert.equal(reconcileGoogle([product], null).rows[0].received, null);
  assert.equal(reconcileGoogle([product], { products: [] }).rows[0].reason, 'not_received');
  const snapshot = { observedAt: '2026-10-29', products: [{ offerId: product.sku, destinations: [{ approved: ['BR'] }], issues: [] }, { offerId: 'ORPHAN' }] };
  const report = reconcileGoogle([product], snapshot);
  assert(report.rows[0].received); assert(report.rows[0].approved); assert.equal(report.unexpected[0].sku, 'ORPHAN');
});
test('campaign preparation requires a fixed total and never enables campaigns or stale creative', () => {
  const p = projectProduct(raw());
  for (const budget of [{}, { total: 100, google: 80, meta: 30 }, { total: 100, google: -1, meta: 101 }]) assert.throws(() => campaignPlan(budget, [p], []));
  const plan = campaignPlan({ total: 100, google: 60, meta: 40 }, [p], [{ id: 'old', status: 'approved', product_id: p.id, product_version: 'stale' }]);
  assert.equal(plan.status, 'PAUSED'); assert.equal(plan.activationAllowed, false); assert.equal(plan.automaticTransfer, false);
  assert.equal(plan.remotelyCreated, false); assert.equal(plan.contentIds.length, 0);
});
test('weekly SEO uses 56 complete finalized days, weighted CTR/position and never partial periods', () => {
  const records = Array.from({ length: 56 }, (_, i) => {
    const date = new Date(Date.parse('2026-10-28T12:00:00Z') - i * 86400000).toISOString().slice(0, 10);
    return [{ kind: 'search_total', date, clicks: 1, impressions: 100 }, { kind: 'search_page', date, landing: 'https://loja.aerion.com.br/a/', clicks: i < 28 ? 1 : 2, impressions: 100, position: 8 }];
  }).flat();
  const report = seoOpportunities(records, '2026-10-29'); assert(report.available); assert.equal(report.rows[0].ctr, 1); assert.equal(report.rows[0].decline, -50); assert.equal(report.rows[0].position, 8);
  assert.equal(seoOpportunities(records.slice(2), '2026-10-29').available, false);
});
test('technical audit refuses external URLs and reports canonical, noindex, structured data and HTTP independently', async () => {
  let calls = 0;
  const providers = createProviders({ transport: async () => { calls++; return new Response('<meta name="robots" content="noindex"><link rel="canonical" href="https://aerion.com.br/product/"><script type="application/ld+json">{"@type":"Product","sku":"WRONG"}</script><a href="/loja/">Loja</a>', { headers: { 'content-type': 'text/html' } }); } });
  await assert.rejects(providers.auditProduct({ url: 'https://loja.aerion.com.br' }, { url: 'https://evil.test/' })); assert.equal(calls, 0);
  const result = await providers.auditProduct({ url: 'https://loja.aerion.com.br' }, projectProduct(raw()));
  assert.equal(result.httpStatus, 200); assert.equal(result.indexable, false); assert.equal(result.internalLinks, 1);
  assert(result.issues.includes('cross_domain_canonical_review_required')); assert(result.issues.includes('schema_sku_mismatch'));
});
test('Meta import only follows validated cursors, validates feed ownership and sanitizes permissions', async () => {
  const config = { access_token: 'secret', account_id: '10' };
  const providers = createProviders({ transport: async url => {
    const u = new URL(url);
    if (u.pathname.endsWith('/123')) return Response.json({ id: '123', name: 'Aerion' });
    if (u.pathname.endsWith('/products')) return Response.json({ data: [{ id: '11', retailer_id: 'SKU-1' }] });
    if (u.pathname.endsWith('/product_feeds')) return Response.json({ data: [{ id: '12', name: 'Source' }] });
    if (u.pathname.endsWith('/dpa_eligible_ad_accounts')) return Response.json({ data: [{ id: 'act_10' }] });
    return Response.json({ data: [] });
  } });
  const snapshot = await providers.metaCatalog(config, '123', '12');
  assert.equal(snapshot.products[0].sku, 'SKU-1'); assert.equal(snapshot.adAccountLinked, true);
  await assert.rejects(providers.metaCatalog(config, '123', '999'), /fora do catálogo/);
  const denied = createProviders({ transport: async () => Response.json({ token: 'secret' }, { status: 401 }) });
  await assert.rejects(denied.metaCatalog(config, '123'), e => !e.message.includes('secret'));
});
const consent = { status: 'granted', source: 'store_opt_in', ad_user_data: true, ad_personalization: true, recorded_at: '2026-01-01T12:00:00Z' };
test('audience eligibility requires recorded advertising permission and opt-outs win across duplicates', () => {
  const record = { email: ' Test.Email@Gmail.com ', consent };
  assert(!advertisingEligible({ email: record.email }));
  assert(advertisingEligible(record));
  assert(!advertisingEligible({ ...record, whatsapp_opt_out: true }));
  assert(!advertisingEligible({ ...record, consent: { ...consent, ad_user_data: false } }));
  assert(!advertisingEligible({ ...record, consent: { ...consent, recorded_at: 'invalid' } }));
  assert.notEqual(emailHash(record.email, 'meta_ads'), emailHash(record.email, 'google_ads'));
  assert.equal(emailHash('testemail@gmail.com', 'google_ads'), emailHash(record.email, 'google_ads'));
  assert.deepEqual(desiredMembers([record, { ...record, opt_out: true }], { source: 'store', platform: 'meta_ads' }), []);
  assert.throws(() => parseMappings({ ECOMMERCE_CUSTOMER_LISTS: JSON.stringify([{ source: 'store', platform: 'meta_ads', id: '1', managedBy: 'aerion_crm' }, { source: 'crm', segment: 'customers', platform: 'meta_ads', id: '1', managedBy: 'aerion_crm' }]) }), /collision/);
});
test('server purchase is paid-only, uses the browser transaction ID and respects revoked or stale consent', () => {
  const now = Date.parse('2026-10-29T15:00:00Z');
  const context = { statistics: true, marketing: false, source: 'wp_consent_api_classic_checkout', recordedAt: '2026-10-29T14:00:00Z', clientId: '123.456' };
  const order = { id: 1, status: 'processing', currency: 'BRL', date_paid_gmt: '2026-10-29T14:30:00', line_items: [{ id: 1, product_id: 1, sku: 'SKU-1', name: 'Drone', quantity: 2, total: '100', subtotal: '100' }] };
  const result = paidGa4Payload(order, context, now);
  assert(result.eligible); assert.equal(result.body.events[0].params.transaction_id, '1'); assert.equal(result.body.events[0].params.value, 100);
  assert.equal(result.body.events[0].params.items[0].price, 50); assert.equal(result.body.consent.ad_user_data, 'DENIED');
  assert(!paidGa4Payload({ ...order, status: 'pending' }, context, now).eligible);
  assert(!paidGa4Payload(order, { ...context, revoked: true }, now).eligible);
  assert(!paidGa4Payload(order, { ...context, recordedAt: '2026-01-01' }, now).eligible);
  assert(!paidGa4Payload(order, {}, now).eligible);
});
test('campaign writers create paused shells and never change existing active campaigns', async () => {
  const writes = [];
  let active = false;
  const providers = createProviders({ transport: async (url, options = {}) => {
    if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'test', expires_in: 3600 });
    const path = new URL(url).pathname;
    if (url.includes('googleads.googleapis.com')) {
      const body = JSON.parse(options.body);
      if (path.endsWith('/googleAds:search')) return Response.json({ results: body.query.includes('campaign.resource_name =') ? [{ campaign: { status: 'PAUSED' } }] : active ? [{ campaign: { status: 'ENABLED', resourceName: 'customers/1234567890/campaigns/1' } }] : [] });
      writes.push(body);
      return Response.json({ mutateOperationResponses: [{ campaignBudgetResult: { resourceName: 'customers/1234567890/campaignBudgets/1' } }, { campaignResult: { resourceName: 'customers/1234567890/campaigns/1' } }] });
    }
    if (path.endsWith('/campaigns') && options.method === 'GET') return Response.json({ data: active ? [{ id: '20', name: 'Aerion CRM · Loja · abcdef0123456789', status: 'ACTIVE' }] : [] });
    if (options.method === 'POST') { writes.push(Object.fromEntries(new URLSearchParams(options.body))); return Response.json({ id: '20' }); }
    return Response.json({ id: '20', status: 'PAUSED' });
  } });
  const google = { customer_id: '1234567890', client_id: 'c', client_secret: 's', refresh_token: 'r' }, meta = { account_id: '10', access_token: 's' };
  assert.equal((await providers.stageGoogleSalesCampaign(google, { google: 304 }, '123', 'abcdef0123456789')).status, 'PAUSED');
  assert.equal((await providers.stageMetaSalesCampaign(meta, { meta: 304 }, 'abcdef0123456789')).status, 'PAUSED');
  assert(writes[0].validateOnly); assert.equal(writes[1].mutateOperations[1].campaignOperation.create.status, 'PAUSED'); assert.equal(writes[2].status, 'PAUSED');
  const count = writes.length; active = true;
  await assert.rejects(providers.stageGoogleSalesCampaign(google, { google: 500 }, '123', 'abcdef0123456789'));
  await assert.rejects(providers.stageMetaSalesCampaign(meta, { meta: 500 }, 'abcdef0123456789'));
  assert.equal(writes.length, count);
});

const databaseUrl = process.env.ECOMMERCE_TEST_DATABASE_URL;
test('marketing durable jobs, webhook idempotency, snapshots, approvals and access controls in isolated PostgreSQL', { skip: !databaseUrl }, async t => {
  const schema = `marketing_test_${crypto.randomBytes(8).toString('hex')}`;
  const root = new Pool({ connectionString: databaseUrl });
  await root.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const env = { ECOMMERCE_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'), ECOMMERCE_META_FEED_TOKEN: crypto.randomBytes(32).toString('hex'), ECOMMERCE_PUBLIC_URL: 'https://crm.example.com' };
  let rows = [raw()], fail = false, deleted = false;
  const providers = { test: async () => ({}), woo: async () => ({ data: [] }), bridge: async (config, path, params) => {
    if (path !== 'marketing-products') return { data: [] };
    if (fail) throw new Error('sensitive secret=private-token');
    if (deleted && params.product_id) throw Object.assign(new Error('gone'), { httpStatus: 404 });
    return { data: { price_source: 'aerion_consumer_card_v1', parents_count: rows.length ? 1 : 0, products: rows } };
  }, auditProduct: async () => ({ httpStatus: 200, indexable: true, issues: [], observedAt: new Date().toISOString() }) };
  const service = createEcommerce({ pool, env, providers });
  await service.ensure();
  const worker = createMarketing({ pool, env, providers });
  const app = express();
  app.use(express.json({ verify: (req, res, body) => { req.ecommerceRawBody = body; } }));
  app.use((req, res, next) => { req.auth = req.get('x-role') === 'anonymous' ? null : { role: req.get('x-role') || 'admin', page_permissions: { Ecommerce: 'view' } }; next(); });
  app.use('/api/ecommerce', service.router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.on('listening', resolve));
  const request = async (path, body, method = 'GET', headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ecommerce${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, text };
  };
  try {
    const config = { url: 'https://loja.aerion.com.br', consumer_key: `ck_${'a'.repeat(40)}`, consumer_secret: `cs_${'a'.repeat(40)}`, webhook_secret: crypto.randomBytes(32).toString('hex'), report_user: 'reader', report_password: 'private' };
    assert.equal((await request('/connections/woocommerce', config, 'PUT')).status, 200);
    await t.test('anonymous feed is authenticated, missing projection fails closed and viewers cannot mutate', async () => {
      assert.equal((await request('/feeds/meta?token=wrong', null, 'GET', { 'x-role': 'anonymous' })).status, 401);
      assert.equal((await request(`/feeds/meta?token=${env.ECOMMERCE_META_FEED_TOKEN}`, null, 'GET', { 'x-role': 'anonymous' })).status, 503);
      assert.equal((await request('/marketing/reconcile', {}, 'POST', { 'x-role': 'member' })).status, 403);
      assert.equal((await request('/marketing', null, 'GET', { 'x-role': 'anonymous' })).status, 403);
    });
    await t.test('signed duplicate deliveries coalesce and product events never become orders', async () => {
      const body = { id: 1 }, headers = { 'x-wc-webhook-topic': 'product.updated', 'x-wc-webhook-delivery-id': 'product-delivery-1', 'x-wc-webhook-signature': crypto.createHmac('sha256', config.webhook_secret).update(JSON.stringify(body)).digest('base64') };
      assert.equal((await request('/webhooks/woocommerce', body, 'POST', headers)).status, 202);
      assert.equal((await request('/webhooks/woocommerce', body, 'POST', headers)).status, 202);
      assert.equal((await pool.query("SELECT revision FROM ecommerce_marketing_jobs WHERE kind='product'")).rows[0].revision, '1');
      await worker.tick();
      const report = (await request('/marketing')).data;
      assert.equal(report.products.length, 1); assert.equal(report.products[0].price, 100);
      assert.equal((await pool.query("SELECT count(*)::int n FROM ecommerce_records WHERE kind='order'")).rows[0].n, 0);
      const feed = await request(`/feeds/meta?token=${env.ECOMMERCE_META_FEED_TOKEN}`, null, 'GET', { 'x-role': 'anonymous' });
      assert.equal(feed.status, 200); assert(feed.text.includes('SKU-1'));
    });
    await t.test('failed reconciliation retains valid projection and only sanitized error codes', async () => {
      fail = true; await enqueueMarketing(pool, 'reconcile', 'nightly'); await worker.tick();
      const report = (await request('/marketing')).data;
      assert.equal(report.products.length, 1); assert(!JSON.stringify(report).includes('private-token'));
      assert.equal(report.jobs.find(j => j.kind === 'reconcile').status, 'retry');
      fail = false;
    });
    let contentId;
    await t.test('content approval records the reviewer, never publishes and price change invalidates approval', async () => {
      const content = await request('/marketing/content', { productId: '1', kind: 'creative', copy: 'Uma proposta para revisão.' }, 'POST');
      assert.equal(content.status, 201); contentId = content.data.id;
      assert.equal((await request(`/marketing/content/${contentId}/review`, { status: 'approved' }, 'POST')).status, 200);
      rows = [raw(1, { consumer_price: 110 })];
      await enqueueMarketing(pool, 'product', 1); await worker.tick();
      const report = (await request('/marketing')).data;
      assert.equal(report.contents[0].status, 'stale'); assert.equal(report.products[0].price, 110);
      assert.equal((await request(`/marketing/content/${contentId}/review`, { status: 'approved' }, 'POST')).status, 409);
      const campaign = await request('/marketing/campaign-plan', { total: 100, google: 60, meta: 40 }, 'PUT');
      assert.equal(campaign.status, 200); assert.equal(campaign.data.status, 'PAUSED'); assert.equal(campaign.data.contentIds.length, 0);
    });
    await t.test('SEO publication requires an explicit approved current proposal and safely acknowledges retries', async () => {
      let published = 0;
      providers.publishProductSeo = async (config, product, content) => { published++; return { published: true, content_id: content.id, product: raw(1, { consumer_price: 110, modified_at: '2026-10-29T12:00:00-03:00' }) }; };
      const content = await request('/marketing/content', { productId: '1', kind: 'seo', title: 'Título real do produto', description: 'Descrição real, revisada antes de publicar.' }, 'POST');
      assert.equal(content.status, 201);
      const path = `/marketing/content/${content.data.id}`;
      assert.equal((await request(`${path}/publish-seo`, {}, 'POST')).status, 409); assert.equal(published, 0);
      assert.equal((await request(`${path}/review`, { status: 'approved' }, 'POST')).status, 200);
      assert.equal((await request(`${path}/publish-seo`, {}, 'POST')).status, 202); await worker.tick(); assert.equal(published, 1);
      await enqueueMarketing(pool, 'seo_publish', content.data.id); await worker.tick(); assert.equal(published, 1);
      assert.equal((await request('/marketing')).data.contents.find(c => c.id === content.data.id).status, 'published');
    });
    await t.test('variations retain own SKUs, disappear when unpublished and are removed with parent', async () => {
      rows = [raw(2, { parent_id: 1, sku: 'VAR-2' }), raw(3, { parent_id: 1, sku: 'VAR-3', status: 'draft' })];
      await enqueueMarketing(pool, 'product', 1); await worker.tick();
      const report = (await request('/marketing')).data;
      assert.equal(report.products.length, 2); assert.equal(report.products.filter(p => p.eligible).length, 1);
      const feed = (await request(`/feeds/meta?token=${env.ECOMMERCE_META_FEED_TOKEN}`)).text;
      assert(feed.includes('VAR-2')); assert(!feed.includes('VAR-3')); assert(!feed.includes('SKU-1'));
      deleted = true; await enqueueMarketing(pool, 'product', 1); await worker.tick();
      assert.equal((await request('/marketing')).data.products.length, 0);
    });
    await t.test('source advisory lock prevents publishing an old store snapshot during account edits', async () => {
      const db = await pool.connect();
      try {
        await db.query('SELECT pg_advisory_lock(735101)');
        await enqueueMarketing(pool, 'product', 1); await worker.tick();
        assert.equal((await pool.query("SELECT status FROM ecommerce_marketing_jobs WHERE kind='product'")).rows[0].status, 'pending');
      } finally { await db.query('SELECT pg_advisory_unlock(735101)'); db.release(); }
    });
    await t.test('CRM list synchronization encrypts identifiers, isolates segments and removes revoked members', async () => {
      await pool.query('CREATE TABLE contacts(account_id int,email text,custom_attributes jsonb,additional_attributes jsonb)');
      await pool.query('INSERT INTO contacts VALUES(2,$1,$2,$3)', ['eligible@example.com', { Funil_Vendas: '6 - Qualificado', aerion_advertising_consent: consent }, {}]);
      const listEnv = { ...env, ECOMMERCE_CUSTOMER_LISTS: JSON.stringify([{ source: 'crm', segment: 'qualified', platform: 'meta_ads', id: '44', managedBy: 'aerion_crm' }]) };
      const batches = [];
      const options = { db: pool, env: listEnv, configFor: async () => ({ account_id: '10' }), providers: { customerAudienceBatch: async (config, id, operation, hashes) => batches.push({ id, operation, hashes }) } };
      const first = await syncCustomerAudiences(options);
      assert.equal(first.lists[0].eligible, 1); assert.equal(batches[0].operation, 'add'); assert(/^[a-f0-9]{64}$/.test(batches[0].hashes[0]));
      const stored = (await pool.query('SELECT members FROM ecommerce_marketing_memberships')).rows[0].members;
      assert(!stored.includes('eligible@example.com')); assert(!stored.includes(batches[0].hashes[0]));
      await pool.query("UPDATE contacts SET custom_attributes=custom_attributes || '{\"opt_out\":true}'::jsonb");
      const second = await syncCustomerAudiences(options);
      assert.equal(second.lists[0].eligible, 0); assert.equal(batches[1].operation, 'remove');
      assert(!JSON.stringify(second).includes('eligible@example.com')); assert(!JSON.stringify(second).includes(batches[0].hashes[0]));
    });
    await t.test('paid server retries reuse one transaction and never send pending or revoked orders', async () => {
      env.ECOMMERCE_GA4_MEASUREMENT_ID = 'G-TEST'; env.ECOMMERCE_GA4_MEASUREMENT_SECRET = 'private';
      let sent = 0;
      const originalWoo = providers.woo;
      let order = { id: 123, status: 'processing', currency: 'BRL', date_paid_gmt: new Date(Date.now() - 60000).toISOString().replace(/Z$/, ''),
        line_items: [{ id: 1, product_id: 1, name: 'Drone', sku: 'SKU-1', quantity: 1, total: '100', subtotal: '100' }],
        meta_data: [{ key: '_aerion_measurement_context', value: { statistics: true, marketing: false, source: 'checkout', recordedAt: new Date().toISOString(), clientId: '123.456' } }] };
      providers.woo = async () => ({ data: order });
      providers.ga4ServerPurchase = async (settings, body) => { sent++; assert.equal(body.events[0].params.transaction_id, '123'); };
      await enqueueMarketing(pool, 'paid_event', 123); await worker.tick(); assert.equal(sent, 0, 'default stays off');
      env.ECOMMERCE_GA4_SERVER_PURCHASE_ENABLED = '1'; env.ECOMMERCE_GA4_SERVER_PURCHASE_VALIDATED = '1';
      await enqueueMarketing(pool, 'paid_event', 123); await worker.tick(); assert.equal(sent, 1);
      await enqueueMarketing(pool, 'paid_event', 123); await worker.tick(); assert.equal(sent, 1);
      order = { ...order, id: 124, status: 'pending' };
      await enqueueMarketing(pool, 'paid_event', 124); await worker.tick(); assert.equal(sent, 1);
      order = { ...order, id: 125, status: 'processing', meta_data: [{ key: '_aerion_measurement_context', value: { ...order.meta_data[0].value, revoked: true } }] };
      await enqueueMarketing(pool, 'paid_event', 125); await worker.tick(); assert.equal(sent, 1);
      providers.woo = originalWoo;
    });
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await pool.end(); await root.query(`DROP SCHEMA ${schema} CASCADE`); await root.end();
  }
});
