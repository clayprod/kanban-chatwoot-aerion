const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const net = require('node:net');
const { Agent, fetch: request } = require('undici');
const { amount } = require('./domain');

class ProviderError extends Error {
  constructor(message, retrySeconds = 300, httpStatus = null) { super(message); this.retrySeconds = retrySeconds; this.httpStatus = httpStatus; }
}
function isPublicAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0))
      || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
  }
  // Only global unicast IPv6; excludes mapped IPv4, loopback and local networks.
  return net.isIPv6(address) && /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:db8:/i.test(address);
}
const publicDispatcher = new Agent({ connect: { lookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true }).then(addresses => {
    if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
      callback(new Error('Endereço da loja precisa ser público.')); return;
    }
    const selected = options.family ? addresses.filter(item => item.family === options.family) : addresses;
    if (!selected.length) { callback(new Error('Endereço indisponível.')); return; }
    if (options.all) callback(null, selected); else callback(null, selected[0].address, selected[0].family);
  }).catch(callback);
} } });

function storeUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new ProviderError('Informe a URL HTTPS da loja.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || url.search || url.hash || url.pathname !== '/' || url.hostname === 'localhost'
    || (net.isIP(url.hostname.replace(/[\[\]]/g, '')) && !isPublicAddress(url.hostname.replace(/[\[\]]/g, '')))) {
    throw new ProviderError('Use o domínio público HTTPS da loja, sem caminho ou credenciais.');
  }
  return url.origin;
}
async function json(url, options = {}, transport = request) {
  let response;
  try {
    response = await transport(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(45000) });
  } catch { throw new ProviderError('Não foi possível consultar a plataforma. Verifique conexão, domínio e permissões.'); }
  if (!response.ok) {
    // Do not propagate upstream bodies/URLs: they may echo credentials or customer details.
    if ([401, 403].includes(response.status)) throw new ProviderError('Acesso recusado pela plataforma. Revise autorização e permissões.', 3600);
    if (response.status === 429) throw new ProviderError('Limite de consultas atingido. A sincronização será retomada.', Math.min(86400, Math.max(300, Number(response.headers.get('retry-after')) || 900)));
    throw new ProviderError(`A plataforma respondeu HTTP ${response.status}.`, 600, response.status);
  }
  try { return { data: await response.json(), headers: response.headers }; }
  catch { throw new ProviderError('A plataforma retornou uma resposta inválida.'); }
}
const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
const postJson = (body, headers = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

function createProviders({ transport = request, env = process.env } = {}) {
  const tokens = new Map();
  const cached = async (key, make) => {
    const old = tokens.get(key);
    if (old && old.until > Date.now() + 60000) return old.token;
    const result = await make();
    if (!result.access_token) throw new ProviderError('A autorização não retornou um token de acesso.');
    tokens.set(key, { token: result.access_token, until: Date.now() + Number(result.expires_in || 3600) * 1000 });
    return result.access_token;
  };
  async function googleToken(config, serviceAccount = false) {
    const scope = serviceAccount ? 'https://www.googleapis.com/auth/analytics.readonly' : 'https://www.googleapis.com/auth/adwords';
    const account = serviceAccount || config.auth_type === 'google_identity' ? config.service_account : null;
    const key = crypto.createHash('sha256').update(JSON.stringify([config, scope])).digest('hex');
    return cached(key, async () => {
      if (account?.type === 'workload_identity') {
        const now = Math.floor(Date.now() / 1000);
        const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
        const content = `${encode({ alg: 'RS256', typ: 'JWT', kid: account.key_id })}.${encode({
          iss: account.issuer, sub: account.subject, aud: account.token_audience, iat: now, exp: now + 300,
        })}`;
        let signature;
        try { signature = crypto.sign('RSA-SHA256', Buffer.from(content), account.private_key).toString('base64url'); }
        catch { throw new ProviderError('A chave da identidade federada Google é inválida.'); }
        const { data: federated } = await json('https://sts.googleapis.com/v1/token', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ audience: account.audience,
            grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
            requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
            subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
            scope: 'https://www.googleapis.com/auth/cloud-platform', subject_token: `${content}.${signature}` }).toString(),
        }, transport);
        if (!federated.access_token) throw new ProviderError('A federação Google não retornou um token de acesso.');
        const { data } = await json(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(account.client_email)}:generateAccessToken`,
          postJson({ scope: [scope], lifetime: '3600s' }, { Authorization: `Bearer ${federated.access_token}` }), transport);
        return { access_token: data.accessToken, expires_in: Math.max(0, (Date.parse(data.expireTime) - Date.now()) / 1000) };
      }
      const body = account ? serviceAccountGrant(account, scope) : {
        grant_type: 'refresh_token', client_id: config.client_id, client_secret: config.client_secret, refresh_token: config.refresh_token,
      };
      return (await json('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString(),
      }, transport)).data;
    });
  }
  async function woo(config, path, params = {}) {
    const base = storeUrl(config.url);
    const url = new URL(`${base}/wp-json/wc/v3/${path}`);
    url.search = new URLSearchParams(params).toString();
    return json(url.toString(), { dispatcher: publicDispatcher, headers: { Authorization: basic(config.consumer_key, config.consumer_secret) } }, transport);
  }
  async function bridge(config, path, params = {}) {
    const url = new URL(`${storeUrl(config.url)}/wp-json/aerion-reports/v1/${path}`);
    url.search = new URLSearchParams(params).toString();
    return json(url.toString(), { dispatcher: publicDispatcher, headers: { Authorization: basic(config.report_user, config.report_password) } }, transport);
  }
  async function gaReport(config, from, to, dimensions, metrics) {
    const token = await googleToken(config, true);
    const result = [];
    let metadata = {};
    for (let offset = 0; ; offset += 10000) {
      const { data } = await json(`https://analyticsdata.googleapis.com/v1beta/properties/${config.property_id}:runReport`, postJson({
        dateRanges: [{ startDate: from, endDate: to }], dimensions: dimensions.map(name => ({ name })),
        metrics: metrics.map(name => ({ name })), limit: 10000, offset, returnPropertyQuota: true,
      }, { Authorization: `Bearer ${token}` }), transport);
      metadata = data.metadata || {};
      result.push(...(data.rows || []).map(row => Object.fromEntries([
        ...dimensions.map((name, i) => [name, row.dimensionValues[i]?.value || '']),
        ...metrics.map((name, i) => [name, Number(row.metricValues[i]?.value) || 0]),
      ])));
      if (offset + 10000 >= Number(data.rowCount || 0)) break;
    }
    return { rows: result, metadata };
  }
  const normalizeGa = (row, kind, info) => ({
    kind, date: `${row.date.slice(0, 4)}-${row.date.slice(4, 6)}-${row.date.slice(6, 8)}`,
    source: row.sessionSource || '', medium: row.sessionMedium || '', campaign: row.sessionCampaignName || '',
    content: row.sessionManualAdContent || '', landing: row.landingPagePlusQueryString || '',
    sessions: row.sessions || 0, views: row.screenPageViews || 0, purchases: row.ecommercePurchases || 0,
    activeUsers: row.activeUsers ?? null,
    // Active users are intentionally not summed across days or traffic dimensions.
    revenue: row.purchaseRevenue || 0, ...info,
  });
  return {
    woo, bridge,
    async test(provider, config) {
      if (provider === 'woocommerce') {
        await woo(config, 'orders', { per_page: 1 });
        const { data } = await woo(config, 'settings/general');
        const find = id => data.find(item => item.id === id)?.value;
        let tracking = null;
        let tracking_error = null;
        if (config.report_user && config.report_password) {
          try { tracking = (await bridge(config, 'health')).data; }
          catch { tracking_error = 'Relatórios Aerion indisponíveis. Revise o plugin, o usuário e a Application Password. Vendas continuam sincronizando pela API WooCommerce.'; }
        }
        return { currency: find('woocommerce_currency') || 'BRL', tracking, tracking_error };
      }
      if (provider === 'ga4') {
        await gaReport(config, 'yesterday', 'yesterday', ['date'], ['sessions']);
        return {};
      }
      if (provider === 'google_ads') {
        const { data } = await json(`https://googleads.googleapis.com/${env.ECOMMERCE_GOOGLE_ADS_VERSION || 'v25'}/customers/${config.customer_id}/googleAds:search`,
          postJson({ query: 'SELECT customer.currency_code, customer.time_zone FROM customer LIMIT 1' }, {
            Authorization: `Bearer ${await googleToken(config)}`, ...(config.login_customer_id ? { 'login-customer-id': config.login_customer_id } : {}),
          }), transport);
        const account = data.results?.[0]?.customer;
        return { currency: account?.currencyCode || '', timezone: account?.timeZone || '' };
      }
      const { data } = await json(`https://graph.facebook.com/${env.ECOMMERCE_META_API_VERSION || 'v25.0'}/act_${config.account_id}?fields=currency,timezone_name`, {
        headers: { Authorization: `Bearer ${config.access_token}` },
      }, transport);
      return { currency: data.currency, timezone: data.timezone_name };
    },
    async metrics(provider, config, from, to, info = {}) {
      if (provider === 'ga4') {
        const total = await gaReport(config, from, to, ['date'], ['sessions', 'activeUsers', 'screenPageViews', 'ecommercePurchases']);
        const traffic = await gaReport(config, from, to, ['date', 'sessionSource', 'sessionMedium', 'sessionCampaignName', 'sessionManualAdContent'], ['sessions', 'ecommercePurchases']);
        const landings = await gaReport(config, from, to, ['date', 'landingPagePlusQueryString'], ['sessions', 'ecommercePurchases']);
        const funnel = await gaReport(config, from, to, ['date', 'eventName'], ['eventCount']);
        const metadata = { timezone: total.metadata.timeZone || '', thresholded: Boolean(traffic.metadata.subjectToThresholding),
          otherRow: Boolean(traffic.metadata.dataLossFromOtherRow) };
        return [
          ...total.rows.map(row => normalizeGa(row, 'total', metadata)),
          ...traffic.rows.map(row => normalizeGa(row, 'traffic', metadata)),
          ...landings.rows.map(row => normalizeGa(row, 'landing', metadata)),
          ...funnel.rows.filter(row => ['view_item', 'add_to_cart', 'begin_checkout', 'purchase'].includes(row.eventName))
            .map(row => ({ ...normalizeGa(row, 'funnel', metadata), event: row.eventName, events: row.eventCount })),
        ];
      }
      if (provider === 'google_ads') {
        const headers = { Authorization: `Bearer ${await googleToken(config)}`,
          ...(config.login_customer_id ? { 'login-customer-id': config.login_customer_id } : {}) };
        const query = `SELECT segments.date, campaign.id, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}'`;
        const rows = [];
        let pageToken;
        do {
          const { data } = await json(`https://googleads.googleapis.com/${env.ECOMMERCE_GOOGLE_ADS_VERSION || 'v25'}/customers/${config.customer_id}/googleAds:search`,
            postJson({ query, ...(pageToken ? { pageToken } : {}) }, headers), transport);
          rows.push(...(data.results || []).map(row => ({ date: row.segments.date, campaignId: String(row.campaign.id), campaign: row.campaign.name,
            impressions: Number(row.metrics.impressions || 0), clicks: Number(row.metrics.clicks || 0), spend: Number(row.metrics.costMicros || 0) / 1e6,
            conversions: Number(row.metrics.conversions || 0), conversionValue: Number(row.metrics.conversionsValue || 0),
            currency: info.currency, timezone: info.timezone, attribution: 'Configuração das ações de conversão no Google Ads' })));
          pageToken = data.nextPageToken;
        } while (pageToken);
        return rows;
      }
      const rows = [];
      const query = new URLSearchParams({ fields: 'date_start,campaign_id,campaign_name,spend,impressions,clicks,actions,action_values',
        level: 'campaign', time_increment: '1', time_range: JSON.stringify({ since: from, until: to }),
        action_attribution_windows: JSON.stringify(['7d_click', '1d_view']), limit: '500' });
      let after;
      do {
        if (after) query.set('after', after);
        const { data } = await json(`https://graph.facebook.com/${env.ECOMMERCE_META_API_VERSION || 'v25.0'}/act_${config.account_id}/insights?${query}`, {
          headers: { Authorization: `Bearer ${config.access_token}` },
        }, transport);
        const purchase = values => Number((values || []).find(a => a.action_type === 'omni_purchase')?.value
          ?? (values || []).find(a => a.action_type === 'purchase')?.value ?? 0);
        rows.push(...(data.data || []).map(row => ({ date: row.date_start, campaignId: row.campaign_id, campaign: row.campaign_name,
          spend: amount(row.spend), impressions: Number(row.impressions || 0), clicks: Number(row.clicks || 0),
          conversions: purchase(row.actions), conversionValue: purchase(row.action_values), currency: info.currency,
          timezone: info.timezone, attribution: '7 dias após clique / 1 dia após visualização' })));
        after = data.paging?.next ? data.paging?.cursors?.after : null;
        if (data.paging?.next && !after) throw new ProviderError('A plataforma não informou o cursor da próxima página.');
      } while (after);
      return rows;
    },
    async exchangeCode(config, code, redirectUri) {
      return (await json('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: config.client_id,
          client_secret: config.client_secret, code, redirect_uri: redirectUri }).toString(),
      }, transport)).data;
    },
  };
}
function serviceAccountGrant(account, scope = 'https://www.googleapis.com/auth/analytics.readonly') {
  const now = Math.floor(Date.now() / 1000);
  const encode = object => Buffer.from(JSON.stringify(object)).toString('base64url');
  const content = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: account.client_email,
    scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  let signature;
  try { signature = crypto.sign('RSA-SHA256', Buffer.from(content), account.private_key).toString('base64url'); }
  catch { throw new ProviderError('A chave privada da conta de serviço GA4 é inválida.'); }
  return { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${content}.${signature}` };
}
module.exports = { createProviders, ProviderError, storeUrl, isPublicAddress, serviceAccountGrant };
