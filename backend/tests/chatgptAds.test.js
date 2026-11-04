const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createChatgptAds } = require('../ecommerce/chatgptAds');
const { encrypt, decrypt, encryptionKey } = require('../ecommerce/domain');
function fixture(failPixel = false) {
  const env = { ECOMMERCE_ENCRYPTION_KEY: 'ab'.repeat(32) }, states = new Map(), writes = [];
  const row = { enabled: true, config: { account: { id: 'adacct_test' } }, secrets: encrypt({ apiKey: 'advertiser-secret' }, encryptionKey(env)) };
  const pool = { query: async (sql, args) => {
    if (sql.startsWith('SELECT *')) return { rows: [{ ...row }] };
    if (sql.startsWith('SELECT data')) return { rows: states.has(args[0]) ? [{ data: structuredClone(states.get(args[0])) }] : [] };
    if (sql.startsWith('UPDATE ecommerce_marketing_connections')) { assert.equal(row.secrets, args[1]);row.secrets = args[0];return { rowCount: 1 }; }
    throw Error('Unexpected query');
  } };
  const transport = async (url, options) => {
    const path = url.pathname.replace('/v1/', '');
    if (options.method === 'GET') return Response.json(path === 'ad_account' ? { id: 'adacct_test', currency_code: 'BRL', review: { status: 'in_review' } } : { data: [], has_more: false });
    assert.equal(options.method, 'POST');assert(options.headers['Idempotency-Key']);writes.push(path);
    if (path === 'conversions/pixels') { if (failPixel) throw Error('private-upstream-secret');return Response.json({ id: 'source_1', pixel_id: '123456' }); }
    if (path === 'conversions/api_keys') return Response.json({ api_key: 'capi-private-secret' });
    if (path.endsWith('/sftp_access')) return Response.json({ connection_uri: 'sftp://user@sftp.openai.com', password: 'sftp-private-secret' });
    return Response.json({ id: 'resource_' + writes.length });
  };
  const service = createChatgptAds({ pool, env, enqueue: async () => {}, transport, saveState: async (_, name, data) => states.set(name, structuredClone(data)) });
  return { service, pool, writes, row, env };
}
test('ChatGPT account setup is resumable, separates store and CRM, encrypts generated credentials and never activates campaigns', async () => {
  const f = fixture();await f.service.setup(f.pool);const count = f.writes.length;
  await f.service.setup(f.pool);assert.equal(f.writes.length, count);
  const status = await f.service.status();assert.equal(status.setup.resources.pixel.pixelId, '123456');
  assert.equal(status.setup.resources.event_purchase.eventType, 'order_created');
  assert.equal(status.setup.resources.store_buyers.source, 'store');assert.equal(status.setup.resources.crm_customers.source, 'crm');
  assert.equal(status.setup.resources.capi.enabled, false);assert.equal(status.activationAllowed, false);
  assert(f.writes.every(path => !path.includes('campaign') && !path.includes('members')));
  assert(!JSON.stringify(status).includes('private-secret'));assert(!f.row.secrets.includes('private-secret'));
  assert.equal(decrypt(f.row.secrets, encryptionKey(f.env)).conversionsApiKey, 'capi-private-secret');
});
test('lost pixel creation response blocks duplicate creation while other resources continue', async () => {
  const f = fixture(true);await f.service.setup(f.pool);await f.service.setup(f.pool);
  assert.equal(f.writes.filter(p => p === 'conversions/pixels').length, 1);
  const status = await f.service.status();assert.equal(status.setup.operations.pixel.status, 'ambiguous');
  assert.equal(status.setup.resources.pixel, undefined);assert(status.setup.resources.feed);
});
