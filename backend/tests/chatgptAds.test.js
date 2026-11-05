const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createChatgptAds } = require('../ecommerce/chatgptAds');
const { encrypt, decrypt, encryptionKey } = require('../ecommerce/domain');
const {chatgptCatalog,uploadCatalog}=require('../ecommerce/chatgptCatalog');
const {chatgptReport}=require('../ecommerce/chatgptReport');
const {includeChatgptMedia}=require('../ecommerce/chatgptReport');
test('unified media includes ChatGPT spend and weighted rates without inventing attributed conversions',()=>{
  const report={summary:{revenue:400,mediaPartial:false},platforms:[{provider:'google_ads',available:true,currency:'BRL',spend:100,clicks:10,impressions:1000,conversions:2,conversionValue:400}],ads:[],daily:[{date:'2026-11-05',spend:100,clicks:10,impressions:1000}]};
  includeChatgptMedia(report,{configured:true,performance:{available:true,currency:'BRL',spend:300,clicks:90,impressions:9000,rows:[{date:'2026-11-05',spend:300,clicks:90,impressions:9000}]}});
  assert.equal(report.summary.spend,400);assert.equal(report.summary.media.cpc,4);assert.equal(report.summary.media.ctr,1);assert.equal(report.summary.media.cpm,40);assert.equal(report.summary.revenuePerAdSpend,1);
  assert.equal(report.summary.media.roas,null);assert.equal(report.summary.media.conversions,null);assert.equal(report.platforms[0].conversions,2);assert.equal(report.daily[0].spend,400);assert.equal(report.ads[0].provider,'chatgpt_ads');assert.equal(report.ads[0].conversions,null);
});
test('unavailable or foreign-currency ChatGPT data does not become zero or contaminate BRL totals',()=>{
  for(const performance of [{available:false,currency:'BRL',spend:null,clicks:null,impressions:null,rows:[]},{available:true,currency:'USD',spend:500,clicks:10,impressions:50,rows:[]}]){
    const report={summary:{revenue:200},platforms:[{provider:'meta_ads',available:true,currency:'BRL',spend:50,clicks:5,impressions:100}],ads:[],daily:[{date:'2026-11-05',spend:50}]};
    includeChatgptMedia(report,{configured:true,performance});assert.equal(report.summary.spend,50);assert.equal(report.summary.mediaPartial,true);assert.equal(report.platforms[1].available,false);assert.equal(report.platforms[1].spend,null);assert.equal(report.daily[0].chatgptSpend,null);assert.equal(report.daily[0].spend,50);
  }
});
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
test('catalog uses only the public projection, refuses duplicate SKUs and verifies the SFTP host key before upload',async()=>{
  const p={id:'1',parentId:'1',sku:'PUBLIC',published:true,name:'Product',description:'Real description',brand:'Real brand',image:'https://shop.test/a.jpg',url:'https://shop.test/p',price:100,regularPrice:120,currency:'BRL',availability:'in_stock',group:'Drones',wholesale_price:12};
  const file=chatgptCatalog([p]);assert.equal(file.count,1);assert(file.csv.includes('100.00 BRL'));assert(!file.csv.includes('wholesale_price'));assert.equal(chatgptCatalog([p,{...p,id:'2'}]).count,0);
  let pinned=false,uploaded=false;class Client{async connect(o){assert(o.hostVerifier('verified-hash'));}async put(buffer,path){assert(pinned);assert(Buffer.isBuffer(buffer));assert.equal(path,'catalog.csv');uploaded=true;}async end(){}}
  await uploadCatalog({credentials:{connection_uri:'sftp://user@sftp-prod3.commerce.openai.com',password:'private'},content:file.csv,Client,persistHostHash:async h=>{assert.equal(h,'verified-hash');pinned=true;}});assert(uploaded);
  await assert.rejects(uploadCatalog({credentials:{connection_uri:'sftp://user@evil.invalid',password:'private'},content:file.csv,Client}),/connection_invalid/);
});
test('ChatGPT reporting recalculates weighted rates and keeps missing coverage and conversions unavailable',()=>{
  const connection={configured:true,snapshot:{datasets:{performance:{available:true,from:'2026-11-01',to:'2026-11-04',currency:'BRL',rows:[{date:'2026-11-01',spend:10,clicks:2,impressions:10},{date:'2026-11-02',spend:20,clicks:2,impressions:90}]}}}};
  const r=chatgptReport(connection,{from:'2026-11-01',to:'2026-11-02'});assert.equal(r.spend,30);assert.equal(r.ctr,4);assert.equal(r.cpc,7.5);assert.equal(r.conversions,null);
  assert.equal(chatgptReport(connection,{from:'2026-10-01',to:'2026-11-02'}).spend,null);
});
