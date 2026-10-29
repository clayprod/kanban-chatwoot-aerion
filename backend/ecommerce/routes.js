const express = require('express');
const crypto = require('node:crypto');
const { PROVIDERS, dateRange, buildReport, verifyWebhook, encryptionKey } = require('./domain');
const { createProviders, storeUrl } = require('./providers');
const { createTables, PUBLIC_FIELDS, SECRET_FIELDS, lockId, publicConnection, connectionConfig, transaction, createSync, encrypt, decrypt } = require('./store');
const { buildMerchantReport } = require('./merchant');
const { buildSearchReport } = require('./searchConsole');
const { crmAudiencePreview } = require('./audiences');
const { createMarketing, enqueueMarketing } = require('./marketing');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function validateGoogleIdentity(value) {
  let account = value;
  if (typeof account === 'string') {
    try { account = JSON.parse(account); } catch { throw new Error('JSON das credenciais Google inválido.'); }
  }
  if (!account?.client_email || !account.private_key) throw new Error('Informe as credenciais da conta técnica Google.');
  if (account.type === 'service_account') return { type: account.type, client_email: account.client_email, private_key: account.private_key };
  if (account.type !== 'workload_identity'
    || !/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(account.client_email)
    || !/^\/\/iam\.googleapis\.com\/projects\/\d+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]+\/providers\/[a-z0-9-]+$/.test(account.audience)
    || typeof account.issuer !== 'string' || !/^https:\/\/[^/?#@\s]+(?:\/[^?#\s]*)?$/.test(account.issuer)
    || !['subject', 'token_audience', 'key_id'].every(field => typeof account[field] === 'string' && account[field].length > 0 && account[field].length <= 256)) {
    throw new Error('Credenciais de identidade federada Google inválidas.');
  }
  return Object.fromEntries(['type', 'client_email', 'private_key', 'audience', 'issuer', 'subject', 'token_audience', 'key_id'].map(field => [field, account[field]]));
}
function validateConfig(provider, config) {
  const missing = fields => fields.some(name => !config[name]);
  if (provider === 'woocommerce') {
    config.url = storeUrl(config.url);
    if (missing(['consumer_key', 'consumer_secret', 'webhook_secret'])) throw new Error('Informe chave REST, segredo REST e segredo do webhook.');
    if (!/^ck_[a-f0-9]+$/i.test(config.consumer_key) || !/^cs_[a-f0-9]+$/i.test(config.consumer_secret)) throw new Error('Chaves WooCommerce inválidas.');
    if (config.webhook_secret.length < 32) throw new Error('O segredo do webhook precisa ter pelo menos 32 caracteres.');
    if (Boolean(config.report_user) !== Boolean(config.report_password)) throw new Error('Informe usuário e Application Password para os relatórios Aerion.');
  }
  if (provider === 'ga4') {
    if (!/^\d+$/.test(config.property_id || '')) throw new Error('Informe o ID numérico da propriedade GA4.');
    config.service_account = validateGoogleIdentity(config.service_account);
  }
  if (provider === 'merchant_center') {
    if (!/^[1-9]\d{0,19}$/.test(config.account_id || '')) throw new Error('Informe o ID numérico da conta Merchant Center.');
    config.identity_source = config.identity_source || 'ga4';
    if (!['ga4', 'google_ads', 'search_console', 'own'].includes(config.identity_source)) throw new Error('Selecione uma identidade Google válida.');
    if (config.identity_source === 'own') config.service_account = validateGoogleIdentity(config.service_account);
  }
  if (provider === 'search_console') {
    const site = String(config.site_url || '');
    if (/^sc-domain:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(site)) config.site_url = site.toLowerCase();
    else config.site_url = storeUrl(site) + '/';
    config.service_account = validateGoogleIdentity(config.service_account);
  }
  if (provider === 'google_ads') {
    for (const field of ['customer_id', 'login_customer_id']) {
      config[field] = String(config[field] || '').replace(/-/g, '');
      if ((field === 'customer_id' || config[field]) && !/^\d{10}$/.test(config[field])) throw new Error('IDs do Google Ads devem ter 10 dígitos.');
    }
    config.auth_type = config.auth_type || 'oauth';
    if (config.purchase_conversion_action_id && !/^\d+$/.test(config.purchase_conversion_action_id)) throw new Error('O ID da ação de compra Google Ads deve ser numérico.');
    if (!['oauth', 'google_identity'].includes(config.auth_type)) throw new Error('Tipo de autenticação Google inválido.');
    if (config.auth_type === 'google_identity') config.service_account = validateGoogleIdentity(config.service_account);
    else if (missing(['client_id', 'client_secret'])) throw new Error('Informe OAuth Client ID e Client Secret do Google Cloud.');
  }
  if (provider === 'meta_ads') {
    config.account_id = String(config.account_id || '').replace(/^act_/, '');
    if (!/^\d+$/.test(config.account_id) || !config.access_token) throw new Error('Informe o ID da conta de anúncios e o token da Meta.');
  }
  return config;
}
function createEcommerce({ pool, getUserById, env = process.env, providers = createProviders({ env }) }) {
  let ready;
  const ensure = () => {
    if (!ready) ready = createTables(pool).catch(error => { ready = null; throw error; });
    return ready;
  };
  const sync = createSync({ pool, providers, env });
  const marketing = createMarketing({ pool, providers, env });
  const seal = value => encrypt(value, encryptionKey(env));
  const unseal = value => decrypt(value, encryptionKey(env));
  const router = express.Router();
  const loadConfig = async provider => {
    const row = (await pool.query('SELECT * FROM ecommerce_connections WHERE provider=$1', [provider])).rows[0];
    if (!row) throw Object.assign(new Error('Configure esta conexão primeiro.'), { status: 400 });
    return { row, config: await connectionConfig(pool, row, env) };
  };
  const admin = async (req, res, next) => {
    try {
      const user = req.auth?.uid ? await getUserById(req.auth.uid) : req.auth;
      if (user?.role !== 'admin') return res.status(403).json({ error: 'Somente administradores podem configurar conexões.' });
      next();
    } catch { res.status(503).json({ error: 'Não foi possível validar o acesso.' }); }
  };
  router.use(async (req, res, next) => {
    try { await ensure(); next(); } catch { res.status(503).json({ error: 'Ecommerce indisponível: verifique o banco de dados.' }); }
  });
  marketing.mountPublic(router);
  // These two endpoints use their own authentication, not the CRM session cookie.
  router.post('/webhooks/woocommerce', async (req, res) => {
    const contentType = req.get('content-type') || '';
    // WooCommerce activation uses a form-encoded webhook_id ping, not an order event.
    // Acknowledge it without enqueuing data; all JSON order events require HMAC.
    if (contentType.startsWith('application/x-www-form-urlencoded') && !req.get('x-wc-webhook-topic')) return res.sendStatus(204);
    const { row, config } = await loadConfig('woocommerce');
    if (!row.enabled) return res.status(409).json({ error: 'Conexão desativada.' });
    if (!verifyWebhook(req.ecommerceRawBody, req.get('x-wc-webhook-signature'), config.webhook_secret)) return res.status(401).json({ error: 'Assinatura inválida.' });
    const delivery = String(req.get('x-wc-webhook-delivery-id') || '');
    const topic = String(req.get('x-wc-webhook-topic') || '');
    const resourceId = Number(req.body?.id);
    // The activation ping has no order ID; acknowledge it only after signature verification.
    if (req.body?.webhook_id && !req.body?.id) return res.sendStatus(204);
    if (!delivery || delivery.length > 200 || !['order.created', 'order.updated', 'order.deleted', 'order.restored', 'order.trashed', 'product.created', 'product.updated', 'product.deleted', 'product.restored', 'product.trashed'].includes(topic)
      || !Number.isSafeInteger(resourceId) || resourceId <= 0) return res.status(400).json({ error: 'Webhook inválido.' });
    const client = await pool.connect();
    try {
      await transaction(client, async () => {
        const inserted = await client.query('INSERT INTO ecommerce_webhooks(delivery_id,topic,resource_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING delivery_id', [delivery, topic, resourceId]);
        if (inserted.rowCount && topic.startsWith('product.')) await enqueueMarketing(client, 'product', resourceId);
        if (inserted.rowCount && ['order.created', 'order.updated', 'order.restored'].includes(topic)) await enqueueMarketing(client, 'paid_event', resourceId);
      });
    } finally { client.release(); }
    await pool.query("UPDATE ecommerce_connections SET next_run_at=now() WHERE provider='woocommerce'");
    res.sendStatus(202);
  });
  const publicUrl = () => {
    let url;
    try { url = new URL(env.ECOMMERCE_PUBLIC_URL); } catch { throw Object.assign(new Error('Configure ECOMMERCE_PUBLIC_URL no servidor para autorizar o Google Ads.'), { status: 400 }); }
    if (url.protocol !== 'https:' || url.username || url.password) throw Object.assign(new Error('ECOMMERCE_PUBLIC_URL precisa ser HTTPS.'), { status: 400 });
    return url.origin;
  };
  const callbackUrl = () => `${publicUrl()}/api/ecommerce/oauth/google/callback`;
  router.get('/oauth/google/callback', async (req, res) => {
    const state = String(req.query.state || '');
    const cookie = (req.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith('ecommerce_oauth='))?.slice('ecommerce_oauth='.length);
    if (!/^[a-f0-9]{64}$/.test(state) || !cookie || !verifyStateCookie(cookie, state)) return res.status(400).send('Autorização inválida ou expirada. Retorne ao painel e tente novamente.');
    const consumed = await pool.query('DELETE FROM ecommerce_oauth_states WHERE state_hash=$1 AND expires_at>now() RETURNING context', [hash(state)]);
    res.clearCookie('ecommerce_oauth', { path: '/api/ecommerce/oauth/google/callback', secure: true, httpOnly: true, sameSite: 'lax' });
    if (!consumed.rowCount || !req.query.code || req.query.error) return res.status(400).send('Autorização cancelada ou expirada. Retorne ao painel e tente novamente.');
    const { config } = await loadConfig('google_ads');
    if (config.auth_type === 'google_identity') return res.status(400).send('Esta conexão usa uma conta técnica, sem autorização OAuth de usuário.');
    if (consumed.rows[0].context !== hash(JSON.stringify([config.customer_id, config.client_id]))) return res.status(400).send('A conexão foi alterada. Retorne ao painel e autorize novamente.');
    const result = await providers.exchangeCode(config, String(req.query.code), callbackUrl());
    if (!result.refresh_token) return res.status(400).send('O Google não forneceu acesso offline. Revogue o acesso anterior e autorize novamente.');
    config.refresh_token = result.refresh_token;
    const secrets = Object.fromEntries(SECRET_FIELDS.google_ads.map(k => [k, config[k]]));
    await pool.query("UPDATE ecommerce_connections SET secrets=$1,status='pending',error=NULL,enabled=true,next_run_at=now() WHERE provider='google_ads'", [seal(secrets)]);
    res.redirect(`${publicUrl()}/?ecommerce=connections&google=connected`);
  });
  router.use(async (req, res, next) => {
    try {
      if (req.get('origin')) {
        let origin;
        try { origin = new URL(req.get('origin')); } catch { return res.status(403).json({ error: 'Origem não autorizada.' }); }
        const local = env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
          && ['localhost', '127.0.0.1', '::1'].includes(req.hostname);
        if (!local && origin.host !== req.get('host') && origin.origin !== env.ECOMMERCE_PUBLIC_URL) {
          return res.status(403).json({ error: 'Origem não autorizada.' });
        }
      }
      const user = req.auth?.uid ? await getUserById(req.auth.uid) : req.auth;
      if (user?.role === 'admin' || ['view', 'edit'].includes(user?.page_permissions?.Ecommerce)) return next();
      return res.status(403).json({ error: 'Seu usuário não tem permissão para acessar Ecommerce.' });
    } catch { return res.status(503).json({ error: 'Não foi possível validar sua permissão.' }); }
  });
  router.get('/status', async (req, res) => {
    const rows = (await pool.query('SELECT * FROM ecommerce_connections ORDER BY provider')).rows;
    let keyReady = true;
    try { encryptionKey(env); } catch { keyReady = false; }
    let oauthRedirectUri = null;
    try { if (env.ECOMMERCE_PUBLIC_URL) oauthRedirectUri = callbackUrl(); } catch { /* Other sources stay available while OAuth is unconfigured. */ }
    res.json({ connections: rows.map(publicConnection), encryptionReady: keyReady, oauthRedirectUri });
  });
  router.get('/report', async (req, res) => {
    const range = dateRange(req.query);
    const [{ rows: records }, { rows: connections }, { rows: excludedOrders }] = await Promise.all([
      pool.query(`SELECT provider,kind,data FROM ecommerce_records r
        WHERE (date BETWEEN $1 AND $2 OR (provider='woocommerce' AND kind IN ('link','product','coupon')) OR (provider='merchant_center' AND kind='merchant_catalog'))
          AND NOT (provider='woocommerce' AND kind='order' AND EXISTS (
            SELECT 1 FROM ecommerce_order_exclusions e WHERE e.order_id=r.record_id AND e.excluded))`, [range.previousFrom, range.to]),
      pool.query('SELECT * FROM ecommerce_connections ORDER BY provider'),
      pool.query(`SELECT e.order_id AS id,e.reason,e.updated_at,
        r.data->>'number' AS number,r.data->>'status' AS status,r.data->>'createdAt' AS created_at,
        (r.data->>'total')::numeric AS total
        FROM ecommerce_order_exclusions e LEFT JOIN ecommerce_records r
          ON r.provider='woocommerce' AND r.kind='order' AND r.record_id=e.order_id
        WHERE e.excluded ORDER BY e.updated_at DESC`),
    ]);
    const ofKind = kind => records.filter(r => r.kind === kind).map(r => r.data);
    const report = buildReport({ range, orders: ofKind('order'), links: ofKind('link'), visits: ofKind('visit'),
      metrics: records.filter(r => r.kind === 'metric').map(r => ({ ...r.data, provider: r.provider })), connections: connections.map(publicConnection) });
    const catalog = new Map(ofKind('product').map(p => [String(p.id), p]));
    report.products.forEach(product => { product.categories = catalog.get(product.id.split(':')[0])?.categories || []; });
    report.couponCatalog = ofKind('coupon');
    report.excludedOrders = excludedOrders;
    report.search = buildSearchReport(records.filter(r => r.provider === 'search_console' && r.kind === 'metric').map(r => r.data), range, connections.find(c => c.provider === 'search_console'));
    report.merchant = buildMerchantReport(records.find(r => r.provider === 'merchant_center' && r.kind === 'merchant_catalog')?.data,
      records.filter(r => r.provider === 'merchant_center' && r.kind === 'metric').map(r => r.data), range, connections.find(c => c.provider === 'merchant_center'));
    report.marketing = await marketing.report();
    report.marketing.observedSpend = { from: range.from, to: range.to, days: Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1,
      google: report.platforms.find(p => p.provider === 'google_ads' && p.available)?.spend ?? null,
      meta: report.platforms.find(p => p.provider === 'meta_ads' && p.available)?.spend ?? null };
    report.visibility = { search: report.search, merchant: report.merchant };
    report.diagnostics = report.marketing.diagnostics;
    report.metaCatalog = report.marketing.metaCatalog;
    report.coverage = report.marketing.coverage;
    res.json(report);
  });
  router.get('/audiences', async (req, res) => {
    try { res.json(await crmAudiencePreview(pool, Number(env.CHATWOOT_ACCOUNT_ID || 2))); }
    catch { res.status(503).json({ error: 'Não foi possível consultar as etapas do CRM. Os demais relatórios continuam disponíveis.' }); }
  });
  marketing.mountRead(router);
  router.use(admin);
  marketing.mountAdmin(router);
  router.put('/orders/:id/exclusion', async (req, res) => {
    const id = String(req.params.id || '');
    const reason = String(req.body?.reason || '').trim();
    const excluded = req.body?.excluded;
    if (!/^[1-9]\d{0,17}$/.test(id) || typeof excluded !== 'boolean' || reason.length > 300 || (excluded && !reason)) {
      return res.status(400).json({ error: 'Informe pedido, exclusão e motivo válido (até 300 caracteres).' });
    }
    const found = await pool.query("SELECT 1 FROM ecommerce_records WHERE provider='woocommerce' AND kind='order' AND record_id=$1", [id]);
    if (excluded && !found.rowCount) return res.status(404).json({ error: 'Pedido não encontrado na base sincronizada.' });
    await pool.query(`INSERT INTO ecommerce_order_exclusions(order_id,reason,excluded,updated_by) VALUES($1,$2,$3,$4)
      ON CONFLICT(order_id) DO UPDATE SET excluded=EXCLUDED.excluded,
        reason=CASE WHEN EXCLUDED.reason<>'' THEN EXCLUDED.reason ELSE ecommerce_order_exclusions.reason END,
        updated_at=now(),updated_by=EXCLUDED.updated_by`,
    [id, reason, excluded, String(req.auth?.uid || req.auth?.sub || 'admin')]);
    res.json({ id, excluded });
  });
  router.put('/connections/:provider', async (req, res) => {
    const provider = req.params.provider;
    if (!PROVIDERS.includes(provider)) return res.status(404).json({ error: 'Plataforma desconhecida.' });
    // Validate the key before accepting credentials; never fall back to plaintext.
    encryptionKey(env);
    const client = await pool.connect();
    try {
      await transaction(client, async () => {
        if (!(await client.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [lockId(provider)])).rows[0].locked) {
          throw Object.assign(new Error('Aguarde o lote de sincronização atual antes de alterar a conexão.'), { status: 409 });
        }
        const old = (await client.query('SELECT * FROM ecommerce_connections WHERE provider=$1 FOR UPDATE', [provider])).rows[0];
        const previous = old ? { ...old.config, ...unseal(old.secrets) } : {};
        const merged = { ...previous };
        for (const field of [...PUBLIC_FIELDS[provider], ...SECRET_FIELDS[provider]]) {
          if (typeof req.body?.[field] === 'string' && req.body[field].length <= 30000) {
            if (!SECRET_FIELDS[provider].includes(field) || req.body[field].trim()) merged[field] = req.body[field].trim();
          }
        }
        try { validateConfig(provider, merged); } catch (error) { throw Object.assign(error, { status: 400 }); }
        const identity = { woocommerce: 'url', ga4: 'property_id', google_ads: 'customer_id', meta_ads: 'account_id', search_console: 'site_url', merchant_center: 'account_id' }[provider];
        const changed = old && (old.config[identity] !== merged[identity] || (provider === 'google_ads' && (old.config.purchase_conversion_action_id || '') !== (merged.purchase_conversion_action_id || '')));
        const metaCredentialChanged = provider === 'meta_ads' && previous.access_token !== merged.access_token;
        if (provider === 'google_ads' && (changed || previous.client_id !== merged.client_id || (previous.auth_type || 'oauth') !== merged.auth_type)) delete merged.refresh_token;
        const config = Object.fromEntries(PUBLIC_FIELDS[provider].map(k => [k, merged[k] || '']));
        const secrets = Object.fromEntries(SECRET_FIELDS[provider].filter(k => merged[k] !== undefined).map(k => [k, merged[k]]));
        if (changed) {
          await client.query('DELETE FROM ecommerce_records WHERE provider=$1', [provider]);
          if (provider === 'woocommerce') {
            await client.query('DELETE FROM ecommerce_webhooks');
            await client.query('DELETE FROM ecommerce_order_exclusions');
            await client.query('DELETE FROM ecommerce_marketing_products');
            await client.query('DELETE FROM ecommerce_marketing_jobs');
            await client.query('DELETE FROM ecommerce_marketing_state');
            await client.query("UPDATE ecommerce_marketing_content SET status='stale'");
          }
          if (provider === 'meta_ads') {
            await client.query("DELETE FROM ecommerce_marketing_state WHERE name IN ('meta_catalog','meta_setup','meta_audiences','customer_audiences')");
            await client.query("DELETE FROM ecommerce_marketing_jobs WHERE kind IN ('meta','meta_setup','meta_audiences')");
          }
          if (provider === 'ga4') {
            await client.query("DELETE FROM ecommerce_marketing_state WHERE name='google_audiences'");
            await client.query("DELETE FROM ecommerce_marketing_jobs WHERE kind='google_audiences'");
          }
        }
        const enabled = req.body.enabled !== false && (provider !== 'google_ads' || merged.auth_type === 'google_identity' || Boolean(merged.refresh_token));
        await client.query(`INSERT INTO ecommerce_connections(provider,config,secrets,enabled) VALUES($1,$2,$3,$4)
          ON CONFLICT(provider) DO UPDATE SET config=EXCLUDED.config,secrets=EXCLUDED.secrets,enabled=EXCLUDED.enabled,
          cursor=NULL,status='pending',error=NULL,info=CASE WHEN $5 THEN '{}'::jsonb
            WHEN $6 THEN ecommerce_connections.info - 'authorization_expires_at' - 'authorization_type' - 'authorization_app_id'
            ELSE ecommerce_connections.info END,
          last_success_at=CASE WHEN $5 THEN NULL ELSE ecommerce_connections.last_success_at END,
          last_reconciled_at=CASE WHEN $5 THEN NULL ELSE ecommerce_connections.last_reconciled_at END,next_run_at=now(),updated_at=now()`,
        [provider, config, seal(secrets), enabled, Boolean(changed), metaCredentialChanged]);
      });
      res.json({ saved: true });
    } finally { client.release(); }
  });
  router.post('/connections/:provider/test', async (req, res) => {
    if (!PROVIDERS.includes(req.params.provider)) return res.sendStatus(404);
    const { config } = await loadConfig(req.params.provider);
    const info = await providers.test(req.params.provider, config);
    await pool.query('UPDATE ecommerce_connections SET info=info || $2::jsonb,error=NULL WHERE provider=$1', [req.params.provider, info]);
    res.json({ ok: true, info });
  });
  router.post('/connections/:provider/sync', async (req, res) => {
    if (!PROVIDERS.includes(req.params.provider)) return res.sendStatus(404);
    const { row } = await loadConfig(req.params.provider);
    if (!row.enabled) return res.status(400).json({ error: 'Ative e autorize a conexão antes de sincronizar.' });
    await pool.query('UPDATE ecommerce_connections SET next_run_at=now() WHERE provider=$1', [row.provider]);
    setImmediate(() => sync.run(row.provider, { force: true }).catch(() => {}));
    res.status(202).json({ queued: true });
  });
  router.post('/connections/google_ads/authorize', async (req, res) => {
    const { config } = await loadConfig('google_ads');
    if (config.auth_type === 'google_identity') return res.status(400).json({ error: 'Esta conexão usa uma conta técnica, sem autorização OAuth de usuário.' });
    const redirectUri = callbackUrl();
    const state = crypto.randomBytes(32).toString('hex');
    await pool.query("INSERT INTO ecommerce_oauth_states(state_hash,expires_at,context) VALUES($1,now()+interval '10 minutes',$2)", [hash(state), hash(JSON.stringify([config.customer_id, config.client_id]))]);
    res.cookie('ecommerce_oauth', state, { secure: true, httpOnly: true, sameSite: 'lax', path: '/api/ecommerce/oauth/google/callback', maxAge: 600000 });
    const query = new URLSearchParams({ client_id: config.client_id, redirect_uri: redirectUri, response_type: 'code',
      scope: 'https://www.googleapis.com/auth/adwords', access_type: 'offline', prompt: 'consent', state });
    res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${query}` });
  });
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || (error.retrySeconds ? 502 : 500);
    res.status(status).json({ error: error.status || error.retrySeconds ? error.message : 'Não foi possível concluir. Verifique a configuração do servidor e a chave de criptografia.' });
  });
  return { router, ensure, tick: async () => { await ensure(); await Promise.allSettled([sync.tick(), marketing.tick()]); } };
}
function verifyStateCookie(cookie, state) {
  return Buffer.byteLength(cookie) === Buffer.byteLength(state) && crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(state));
}
module.exports = { createEcommerce, validateConfig, verifyStateCookie };
