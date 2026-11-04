const { encrypt, decrypt, encryptionKey } = require('./domain');
const API = 'https://api.ads.openai.com/v1/';
function createChatgptAdsClient(token, transport = global.fetch) {
  async function get(path) {
    if (!token) throw Object.assign(new Error('Configure a chave da conta ChatGPT Ads.'), { status: 409 });
    const target = new URL(path, API);
    if (target.origin !== 'https://api.ads.openai.com' || !target.pathname.startsWith('/v1/') || target.username || target.password) throw new Error('chatgpt_ads_invalid_destination');
    let r;try { r = await transport(target, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(45000) }); }
    catch { throw Object.assign(new Error('Não foi possível consultar ChatGPT Ads.'), { retrySeconds: 300 }); }
    if (!r.ok) throw Object.assign(new Error(`ChatGPT Ads respondeu HTTP ${r.status}. Confira a chave da conta e a liberação do recurso no Ads Manager.`), { status: 409, httpStatus: r.status, retrySeconds: r.status === 429 ? 900 : 3600 });
    try { return await r.json(); } catch { throw Object.assign(new Error('ChatGPT Ads retornou uma resposta inválida.'), { retrySeconds: 300 }); }
  }
  async function list(path) {
    const rows = [], seen = new Set();let after;
    do {
      const result = await get(path + '?limit=100' + (after ? '&after=' + encodeURIComponent(after) : ''));
      if (!Array.isArray(result.data)) throw new Error('chatgpt_ads_invalid_list');
      rows.push(...result.data);after = result.has_more ? result.last_id : null;
      if (result.has_more && (!after || seen.has(after) || seen.size >= 20)) throw new Error('chatgpt_ads_incomplete_pagination');
      if (after) seen.add(after);
    } while (after);
    return rows;
  }
  return { get, list };
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
    return { configured: Boolean(row?.enabled), account: row?.config?.account || null, lastVerifiedAt: row?.last_success_at || null, snapshot: snapshot || null,
      measurement: 'requires_pixel_and_consent_validation', audiences: 'requires_eligible_identifiers_and_account_readiness', activationAllowed: false };
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
    for (const [name, path] of Object.entries({ campaigns: 'campaigns', feeds: 'feeds', audiences: 'custom_audiences', events: 'conversions/event_settings' })) {
      try { const raw = await client.list(path);datasets[name] = { available: true, observedAt: new Date().toISOString(), rows: raw.map(r => ({ id: r.id || r.feed_id, name: r.name || null, status: r.status || null, reviewStatus: r.review_status || null, eventType: r.event_type || null, productCount: r.product_count ?? null, matchedUsers: r.matched_user_count ?? null })) }; }
      catch (error) { incomplete = true;datasets[name] = { ...(old?.datasets?.[name] || {}), available: false, preserved: Boolean(old?.datasets?.[name]?.rows), error: error.httpStatus ? `platform_http_${error.httpStatus}` : 'resource_unavailable' }; }
    }
    await saveState(db, key, { account, datasets, observedAt: new Date().toISOString(), complete: !incomplete, changesApplied: false });
    if (incomplete) throw Object.assign(new Error('chatgpt_ads_partial_access'), { retrySeconds: 3600 });
  }
  function mountAdmin(router) {
    router.put('/marketing/chatgpt-ads/connection', async (req, res) => {
      const old = await saved(pool);
      if (req.body?.enabled === false && old) { await pool.query("UPDATE ecommerce_marketing_connections SET enabled=false,updated_at=now() WHERE name='chatgpt_ads'");return res.json({ configured: false }); }
      const apiKey = req.body?.apiKey;
      if (typeof apiKey !== 'string' || apiKey.length < 16 || apiKey.length > 4096 || /[\r\n]/.test(apiKey)) return res.status(400).json({ error: 'Informe a Advertiser API key da conta ChatGPT Ads. A chave da API de modelos é outra credencial.' });
      const account = publicAccount(await createChatgptAdsClient(apiKey, transport).get('ad_account'));
      await pool.query(`INSERT INTO ecommerce_marketing_connections(name,config,secrets,enabled,last_success_at) VALUES('chatgpt_ads',$1,$2,true,now()) ON CONFLICT(name) DO UPDATE SET config=EXCLUDED.config,secrets=EXCLUDED.secrets,enabled=true,last_success_at=now(),updated_at=now()`, [{ account }, encrypt({ apiKey }, encryptionKey(env))]);
      await enqueue(pool, 'chatgpt_ads_sync', 'account');res.json({ configured: true, account });
    });
    router.post('/marketing/chatgpt-ads/sync', async (req, res) => { if (!(await saved(pool))?.enabled) return res.status(409).json({ error: 'Conecte a conta ChatGPT Ads primeiro.' });await enqueue(pool, 'chatgpt_ads_sync', 'account');res.status(202).json({ queued: true }); });
  }
  return { status, sync, mountAdmin };
}
module.exports = { createChatgptAdsClient, publicAccount, createChatgptAds };
