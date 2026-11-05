const { encrypt, decrypt, encryptionKey, saoPauloDay, shiftDay } = require('./domain');
const crypto = require('node:crypto');
const { chatgptCatalog, uploadCatalog } = require('./chatgptCatalog');
const { paidChatgptPayload,sendChatgptConversion }=require('./chatgptMeasurement');
const {syncChatgptAudiences}=require('./chatgptAudiences');
const API = 'https://api.ads.openai.com/v1/';
function createChatgptAdsClient(token, transport = global.fetch) {
  async function request(path, method = 'GET', body, idempotencyKey) {
    if (!token) throw Object.assign(new Error('Configure a chave da conta ChatGPT Ads.'), { status: 409 });
    const target = new URL(path, API);
    if (target.origin !== 'https://api.ads.openai.com' || !target.pathname.startsWith('/v1/') || target.username || target.password) throw new Error('chatgpt_ads_invalid_destination');
    if (!['GET', 'POST', 'PATCH'].includes(method)) throw new Error('chatgpt_ads_invalid_method');
    let r;try { r = await transport(target, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(45000) }); }
    catch { throw Object.assign(new Error('Não foi possível consultar ChatGPT Ads.'), { retrySeconds: 300 }); }
    if (!r.ok) throw Object.assign(new Error(`ChatGPT Ads respondeu HTTP ${r.status}. Confira a chave da conta e a liberação do recurso no Ads Manager.`), { status: 409, httpStatus: r.status, retrySeconds: r.status === 429 ? 900 : 3600 });
    try { return await r.json(); } catch { throw Object.assign(new Error('ChatGPT Ads retornou uma resposta inválida.'), { retrySeconds: 300 }); }
  }
  const get = path => request(path);
  async function list(path) {
    const rows = [], seen = new Set();let after;
    do {
      const result = await get(path + (path.includes('?') ? '&' : '?') + 'limit=100' + (after ? '&after=' + encodeURIComponent(after) : ''));
      const data=path.split('?')[0]==='feeds/uploads'?result.uploads:result.data;
      if (!Array.isArray(data)) throw new Error('chatgpt_ads_invalid_list');
      rows.push(...data);after = result.has_more ? result.last_id : null;
      if (result.has_more && (!after || seen.has(after) || seen.size >= 20)) throw new Error('chatgpt_ads_incomplete_pagination');
      if (after) seen.add(after);
    } while (after);
    return rows;
  }
  return { get, list, request };
}
function publicAccount(account) {
  if (!account || typeof account.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(account.id)) throw Object.assign(new Error('A chave não confirmou uma conta ChatGPT Ads válida.'), { status: 409 });
  return { id: account.id, name: String(account.name || account.brand_name || '').slice(0, 300), status: account.status || 'unknown', currency: account.currency_code || account.currency || null, timezone: account.timezone || null, reviewStatus: account.review?.status || 'unknown' };
}
function createChatgptAds({ pool, env = process.env, enqueue, saveState, transport }) {
  const saved = async db => (await db.query("SELECT * FROM ecommerce_marketing_connections WHERE name='chatgpt_ads'")).rows[0];
  async function status() {
    const row = await saved(pool);
    const snapshot = row?.config?.account?.id ? (await pool.query('SELECT data FROM ecommerce_marketing_state WHERE name=$1', ['chatgpt_ads_snapshot:' + row.config.account.id])).rows[0]?.data : null;
    const setup = row?.config?.account?.id ? (await pool.query('SELECT data FROM ecommerce_marketing_state WHERE name=$1', ['chatgpt_ads_setup:' + row.config.account.id])).rows[0]?.data : null;
    return { configured: Boolean(row?.enabled), account: row?.config?.account || null, lastVerifiedAt: row?.last_success_at || null, snapshot: snapshot || null, setup: setup || null,
      measurement: setup?.resources?.capi?.enabled?'paid_server_purchase_enabled_with_consent':'requires_pixel_and_consent_validation', audiences: 'requires_eligible_identifiers_and_account_readiness', activationAllowed: false };
  }
  async function setup(db) {
    const row = await saved(db);if (!row?.enabled) throw new Error('connection_required');
    const key = encryptionKey(env), secrets = decrypt(row.secrets, key), client = createChatgptAdsClient(secrets.apiKey, transport);
    const account = publicAccount(await client.get('ad_account'));
    if (account.id !== row.config.account.id) throw new Error('chatgpt_ads_account_mismatch');
    const stateKey = 'chatgpt_ads_setup:' + account.id;
    const state = (await db.query('SELECT data FROM ecommerce_marketing_state WHERE name=$1', [stateKey])).rows[0]?.data || { resources: {}, operations: {} };
    const persist = async () => { state.observedAt = new Date().toISOString();state.accountReview = account.reviewStatus;state.activationAllowed = false;await saveState(db, stateKey, state); };
    const storeSecrets = async () => { const result = await db.query("UPDATE ecommerce_marketing_connections SET secrets=$1,updated_at=now() WHERE name='chatgpt_ads' AND secrets=$2", [encrypt(secrets, key), row.secrets]);if (result.rowCount !== 1) throw new Error('connection_changed');row.secrets = (await saved(db)).secrets; };
    const once = async (name, path, body, pick) => {
      if (state.resources[name]) return state.resources[name];
      // A lost creation response must be reconciled instead of creating duplicates.
      if (state.operations[name]?.status === 'requesting' || state.operations[name]?.status === 'ambiguous') return null;
      state.operations[name] = { status: 'requesting' };await persist();
      try {
        const result = await client.request(path, 'POST', body, crypto.createHash('sha256').update(account.id + ':' + name + ':v1').digest('hex'));
        const resource = await pick(result);if (!resource) throw new Error('invalid_creation_response');
        state.resources[name] = resource;state.operations[name] = { status: 'configured' };await persist();return resource;
      } catch (error) { state.operations[name] = { status: error.httpStatus ? 'administrator_action' : 'ambiguous', error: error.httpStatus ? `platform_http_${error.httpStatus}` : 'creation_requires_reconciliation', endpoint: path, help: 'https://developers.openai.com/ads/api-partner-setup' };await persist();return null; }
    };
    const events = await client.list('conversions/event_settings');
    // Recover a source from a previously created event definition when possible.
    const previous = events.find(e => e.name === 'Aerion · Loja · Compra paga');
    if (!state.resources.pixel && previous?.source_ids?.length === 1) state.operations.pixel = { status: 'administrator_action', error: 'existing_source_pixel_id_required', sourceId: previous.source_ids[0] };
    const pixel = state.operations.pixel?.error === 'existing_source_pixel_id_required' ? null : await once('pixel', 'conversions/pixels', { name: 'Aerion · Loja · Site', client_type: 'web' }, r => r.id && r.pixel_id ? { sourceId: r.id, pixelId: String(r.pixel_id) } : null);
    if (!secrets.conversionsApiKey) await once('capi', 'conversions/api_keys', { name: 'Aerion · Loja · Compras pagas servidor' }, async r => { if (!r.api_key) return null;secrets.conversionsApiKey = r.api_key;await storeSecrets();return { configured: true, enabled: false, validationRequired: true }; });
    if (pixel) for (const [name, type, label] of [['purchase','order_created','Compra paga'],['checkout','checkout_started','Checkout'],['cart','items_added','Carrinho'],['product','contents_viewed','Produto'],['lead','lead_created','Lead confirmado']]) {
      const found = events.find(e => e.name === 'Aerion · Loja · ' + label && e.event_type === type && e.source_ids?.includes(pixel.sourceId) && !e.archived);
      if (found) { state.resources['event_' + name] = { id: found.id, eventType: type, primary: name === 'purchase' };continue; }
      await once('event_' + name, 'conversions/event_settings', { name: 'Aerion · Loja · ' + label, event_type: type, attribution_window_days: 30, source_ids: [pixel.sourceId] }, r => r.id ? { id: r.id, eventType: type, primary: name === 'purchase' } : null);
    }
    const feeds = await client.list('feeds');
    const matchingFeed = feeds.find(f => f.name === 'Aerion · Loja · Catálogo BR');
    if (matchingFeed) state.resources.feed = { id: matchingFeed.feed_id || matchingFeed.id, countries: ['BR'] };
    const feed = await once('feed', 'feeds', { name: 'Aerion · Loja · Catálogo BR', countries: ['BR'] }, r => r.feed_id || r.id ? { id: r.feed_id || r.id, countries: ['BR'] } : null);
    if (feed && !secrets.sftp) await once('sftp', `feeds/${encodeURIComponent(feed.id)}/sftp_access`, { authentication_method: 'password' }, async r => { secrets.sftp = r;await storeSecrets();return { configured: true }; });
    const audiences = await client.list('custom_audiences');
    for (const [name, label, source, segment] of [['store_buyers','Loja · Compradores pagos 180d','store','paid_buyers'],['crm_customers','CRM · Clientes comerciais','crm','customers'],['crm_qualified','CRM · Qualificados','crm','qualified'],['crm_nurturing','CRM · Nutrição','crm','nurturing'],['crm_excluded','CRM · Descartados','crm','excluded']]) {
      const title = 'Aerion · ' + label, found = audiences.find(a => a.name === title && a.status !== 'archived');
      if (found) state.resources[name] = { id: found.id, source, segment, status: found.status, matchedUserRange: found.matched_user_count_range || null };
      else await once(name, 'custom_audiences', { name: title, description: source === 'store' ? 'Somente compras online pagas e elegíveis nos últimos 180 dias. Exclusão/recompra; CRM separado.' : 'Segmento comercial separado da loja. Somente identificadores com elegibilidade demonstrada.' }, r => r.id ? { id: r.id, source, segment, status: r.status, matchedUserRange: r.matched_user_count_range || null } : null);
    }
    state.audienceMembership ||= { enabled: false, reason: 'eligibility_and_membership_validation_required' };
    state.campaigns = { status: 'not_created', reason: 'explicit_chatgpt_budget_and_approved_assets_required', automaticBudgetTransfer: false };
    await persist();await sync(db);return state;
  }
  async function sync(db) {
    const row = await saved(db);
    if (!row?.enabled) return;
    const client = createChatgptAdsClient(decrypt(row.secrets, encryptionKey(env)).apiKey, transport);
    const account = publicAccount(await client.get('ad_account'));
    if (account.id !== row.config.account.id) throw new Error('chatgpt_ads_account_mismatch');
    const key = 'chatgpt_ads_snapshot:' + account.id;
    const old = (await db.query('SELECT data FROM ecommerce_marketing_state WHERE name=$1', [key])).rows[0]?.data;
    const datasets = {};let incomplete = false;
    for (const [name, path] of Object.entries({ campaigns: 'campaigns', feeds: 'feeds?include[]=product_count', audiences: 'custom_audiences', events: 'conversions/event_settings' })) {
      try { const raw = await client.list(path);datasets[name] = { available: true, observedAt: new Date().toISOString(), rows: raw.map(r => ({ id: r.id || r.feed_id, name: r.name || null, status: r.status || null, reviewStatus: r.review_status || null, eventType: r.event_type || null, productCount: r.product_count ?? null, matchedUsers: r.matched_user_count ?? null,matchedUserRange:r.matched_user_count_range||null,countries:r.countries||null })) }; }
      catch (error) { incomplete = true;datasets[name] = { ...(old?.datasets?.[name] || {}), available: false, preserved: Boolean(old?.datasets?.[name]?.rows), error: error.httpStatus ? `platform_http_${error.httpStatus}` : 'resource_unavailable' }; }
    }
    const to=saoPauloDay(),from=shiftDay(to,-89);
    try {
      const query=new URLSearchParams({time_granularity:'daily',aggregation_level:'campaign'});
      query.append('time_ranges[]',JSON.stringify({type:'date_range',since:from,until:to,timezone:account.timezone||'America/Sao_Paulo'}));
      for(const field of ['metadata.readable_time','campaign.id','campaign.name','campaign.impressions','campaign.clicks','campaign.spend'])query.append('fields[]',field);
      const rows=await client.list('ad_account/insights?'+query);
      datasets.performance={available:true,from,to,timezone:account.timezone,currency:account.currency,observedAt:new Date().toISOString(),rows:rows.map(r=>({date:r.readable_time,campaignId:r.campaign_id,campaign:r.campaign_name,impressions:r.impressions??null,clicks:r.clicks??null,spend:r.spend??null,conversions:null,conversionValue:null}))};
    }catch(error){incomplete=true;datasets.performance={...(old?.datasets?.performance||{}),available:false,preserved:!!old?.datasets?.performance,error:error.httpStatus?`platform_http_${error.httpStatus}`:'resource_unavailable'};}
    await saveState(db, key, { account, datasets, observedAt: new Date().toISOString(), complete: !incomplete, changesApplied: false });
    if (incomplete) throw Object.assign(new Error('chatgpt_ads_partial_access'), { retrySeconds: 3600 });
  }
  async function catalog(db) {
    const row = await saved(db);if (!row?.enabled) throw new Error('connection_required');
    const secrets = decrypt(row.secrets, encryptionKey(env)), name = 'chatgpt_ads_setup:' + row.config.account.id;
    const setup = (await db.query('SELECT data FROM ecommerce_marketing_state WHERE name=$1',[name])).rows[0]?.data;
    if (!setup?.resources?.feed?.id || !secrets.sftp) throw new Error('chatgpt_catalog_setup_required');
    const products = (await db.query('SELECT data FROM ecommerce_marketing_products ORDER BY product_id')).rows.map(r=>r.data);
    const file = chatgptCatalog(products);
    // Empty/incomplete local data never wipes a valid remote catalog.
    if (!file.count) throw new Error('chatgpt_catalog_no_eligible_products');
    const client=createChatgptAdsClient(secrets.apiKey,transport);
    if(!setup.catalogFullRefresh&&!setup.catalogFullRefreshUnavailable){
      try{await client.request(`feeds/${encodeURIComponent(setup.resources.feed.id)}/settings`,'PATCH',{is_full_refresh:true});setup.catalogFullRefresh=true;}
      catch(error){if(![403,404].includes(error.httpStatus))throw error;setup.catalogFullRefreshUnavailable={httpStatus:error.httpStatus,action:'Solicitar à OpenAI liberação de catalog replacement para este feed BR.',feedId:setup.resources.feed.id,help:'https://developers.openai.com/ads/product-feeds'};}
      await saveState(db,name,setup);
    }
    if (setup.catalog?.hash !== file.hash || setup.catalog?.status !== 'uploaded') {
      await uploadCatalog({ credentials:secrets.sftp,content:file.csv,previousHostHash:secrets.sftpHostHash,persistHostHash:async hash=>{
        secrets.sftpHostHash=hash;const changed=await db.query("UPDATE ecommerce_marketing_connections SET secrets=$1,updated_at=now() WHERE name='chatgpt_ads' AND secrets=$2",[encrypt(secrets,encryptionKey(env)),row.secrets]);if(changed.rowCount!==1)throw new Error('connection_changed');
      } });
      const removed=(setup.catalog?.skus||[]).filter(sku=>!file.skus.includes(sku));
      if(!setup.catalogFullRefresh&&removed.length)await client.request(`feeds/${encodeURIComponent(setup.resources.feed.id)}/products`,'PATCH',{products:removed.map(sku=>({id:sku,variants:[{id:sku,availability:{status:'out_of_stock'}}]}))});
      setup.catalog={status:'uploaded',hash:file.hash,count:file.count,skus:file.skus,removedMarkedUnavailable:removed.length,excluded:file.excluded,uploadedAt:new Date().toISOString(),acceptance:'awaiting_external_processing',cleanupMode:setup.catalogFullRefresh?'catalog_replacement':'removed_products_out_of_stock_delta'};
      await saveState(db,name,setup);
    }
    try { const uploads=await client.list('feeds/uploads');setup.catalog.uploads=uploads.filter(u=>u.feed_id===setup.resources.feed.id).slice(0,5).map(u=>({id:u.upload_id,status:u.status,accepted:u.rows_accepted,rejected:u.rows_rejected,adsEligible:u.rows_ads_eligible,diagnostics:(u.diagnostics||[]).map(d=>({code:d.code,field:d.field,rowsAffected:d.rows_affected}))}));setup.catalog.diagnosticsAvailable=true;if(['completed','completed_with_errors'].includes(setup.catalog.uploads[0]?.status))setup.catalog.acceptance=setup.catalog.uploads[0].status; }
    catch { setup.catalog.diagnosticsAvailable=false; }
    await saveState(db,name,setup);return setup.catalog;
  }
  async function paidPurchase(db,order,context,storeUrl){
    const row=await saved(db);if(!row?.enabled)return;
    const setup=(await db.query('SELECT data FROM ecommerce_marketing_state WHERE name=$1',['chatgpt_ads_setup:'+row.config.account.id])).rows[0]?.data;
    if(!setup?.resources?.capi?.enabled||!setup.resources.capi.validatedAt)return;
    const pixel=setup.resources.pixel?.pixelId,destination='chatgpt_ads:'+pixel;
    if((await db.query('SELECT state FROM ecommerce_marketing_conversions WHERE destination=$1 AND transaction_id=$2',[destination,String(order.id)])).rows[0]?.state==='submitted')return;
    const event=paidChatgptPayload(order,context,storeUrl);
    if(event.eligible){const secrets=decrypt(row.secrets,encryptionKey(env));await sendChatgptConversion({pixelId:pixel,apiKey:secrets.conversionsApiKey,body:event.body,transport});}
    await db.query(`INSERT INTO ecommerce_marketing_conversions(destination,transaction_id,event_id,state,reason,submitted_at) VALUES($1,$2,$3,$4,$5,CASE WHEN $4='submitted' THEN now() ELSE NULL END) ON CONFLICT(destination,transaction_id) DO UPDATE SET state=EXCLUDED.state,reason=EXCLUDED.reason,submitted_at=EXCLUDED.submitted_at,updated_at=now()`,[destination,String(order.id),'aerion_purchase_'+order.id,event.eligible?'submitted':'ineligible',event.reason||null]);
  }
  async function audiences(db,providers){
    const row=await saved(db);if(!row?.enabled)throw Error('connection_required');
    const name='chatgpt_ads_setup:'+row.config.account.id,setup=(await db.query('SELECT data FROM ecommerce_marketing_state WHERE name=$1',[name])).rows[0]?.data;
    if(!setup)throw Error('chatgpt_setup_required');
    const secrets=decrypt(row.secrets,encryptionKey(env)),client=createChatgptAdsClient(secrets.apiKey,transport);
    setup.audienceMembership=await syncChatgptAudiences({db,client,setup,accountId:row.config.account.id,providers,env});await saveState(db,name,setup);
    if(setup.audienceMembership.pending)throw Object.assign(Error('chatgpt_audiences_processing'),{retrySeconds:300});
    return setup.audienceMembership;
  }
  function mountAdmin(router) {
    router.put('/marketing/chatgpt-ads/connection', async (req, res) => {
      const old = await saved(pool);
      if (req.body?.enabled === false && old) { await pool.query("UPDATE ecommerce_marketing_connections SET enabled=false,updated_at=now() WHERE name='chatgpt_ads'");return res.json({ configured: false }); }
      const apiKey = req.body?.apiKey;
      if (typeof apiKey !== 'string' || apiKey.length < 16 || apiKey.length > 4096 || /[\r\n]/.test(apiKey)) return res.status(400).json({ error: 'Informe a Advertiser API key da conta ChatGPT Ads. A chave da API de modelos é outra credencial.' });
      const account = publicAccount(await createChatgptAdsClient(apiKey, transport).get('ad_account'));
      const secrets = old?.config?.account?.id === account.id ? decrypt(old.secrets, encryptionKey(env)) : {};
      await pool.query(`INSERT INTO ecommerce_marketing_connections(name,config,secrets,enabled,last_success_at) VALUES('chatgpt_ads',$1,$2,true,now()) ON CONFLICT(name) DO UPDATE SET config=EXCLUDED.config,secrets=EXCLUDED.secrets,enabled=true,last_success_at=now(),updated_at=now()`, [{ account }, encrypt({ ...secrets, apiKey }, encryptionKey(env))]);
      await enqueue(pool, 'chatgpt_ads_sync', 'account');res.json({ configured: true, account });
    });
    router.post('/marketing/chatgpt-ads/sync', async (req, res) => { if (!(await saved(pool))?.enabled) return res.status(409).json({ error: 'Conecte a conta ChatGPT Ads primeiro.' });await enqueue(pool, 'chatgpt_ads_sync', 'account');res.status(202).json({ queued: true }); });
    router.post('/marketing/chatgpt-ads/setup', async (req, res) => { if (!(await saved(pool))?.enabled) return res.status(409).json({ error: 'Conecte a conta ChatGPT Ads primeiro.' });await enqueue(pool, 'chatgpt_ads_setup', 'account');res.status(202).json({ queued: true, activationAllowed: false }); });
    router.post('/marketing/chatgpt-ads/catalog', async (req,res)=>{await enqueue(pool,'chatgpt_ads_catalog','account');res.status(202).json({queued:true});});
    router.post('/marketing/chatgpt-ads/audiences',async(req,res)=>{await enqueue(pool,'chatgpt_ads_audiences','account');res.status(202).json({queued:true});});
  }
  return { status, sync, setup, catalog, paidPurchase, audiences, mountAdmin };
}
module.exports = { createChatgptAdsClient, publicAccount, createChatgptAds };
