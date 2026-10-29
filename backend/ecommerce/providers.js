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
    if (response.status === 403 && new URL(url).hostname === 'googleads.googleapis.com') {
      const failure = await response.json().catch(() => null);
      if (failure?.error?.details?.some(detail => detail.errors?.some(error => error.errorCode?.authorizationError === 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION'))) {
        throw new ProviderError('O projeto Google Cloud está restrito a contas de teste. Solicite acesso Explorer, Basic ou Standard na visão geral da Google Ads API.', 3600);
      }
    }
    if ([401, 403].includes(response.status)) throw new ProviderError('Acesso recusado pela plataforma. Revise autorização e permissões.', 3600, response.status);
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
    const scope = serviceAccount === 'merchant_center' ? 'https://www.googleapis.com/auth/content' : serviceAccount === 'search_console' ? 'https://www.googleapis.com/auth/webmasters.readonly' : serviceAccount === 'ga4_admin' ? 'https://www.googleapis.com/auth/analytics.edit' : serviceAccount ? 'https://www.googleapis.com/auth/analytics.readonly' : 'https://www.googleapis.com/auth/adwords';
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
  async function merchantList(url, key, headers, pageSize = 1000) {
    const rows = [], visited = new Set();
    let pageToken;
    do {
      const target = new URL(url);
      target.searchParams.set('pageSize', String(pageSize));
      if (pageToken) target.searchParams.set('pageToken', pageToken);
      const { data } = await json(target.toString(), { headers }, transport);
      if (data[key] != null && !Array.isArray(data[key])) throw new ProviderError('O Merchant Center retornou uma listagem inválida. Última carga preservada.');
      rows.push(...(data[key] || []));
      pageToken = data.nextPageToken;
      if (pageToken && (visited.has(pageToken) || visited.size >= 1000)) throw new ProviderError('Paginação do Merchant Center inválida. Última carga preservada.');
      visited.add(pageToken);
    } while (pageToken);
    return rows;
  }
  async function metaRequest(config, path, params = {}, method = 'GET') {
    if (!/^(?:act_)?\d+(?:\/[a-z_]+)?$/.test(path)) throw new ProviderError('Recurso Meta inválido.');
    const url = new URL(`https://graph.facebook.com/${env.ECOMMERCE_META_API_VERSION || 'v25.0'}/${path}`);
    const encoded = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value)]));
    const options = { method, headers: { Authorization: `Bearer ${config.access_token}` } };
    if (method === 'GET') url.search = encoded.toString();
    else { options.headers['Content-Type'] = 'application/x-www-form-urlencoded'; options.body = encoded.toString(); }
    return (await json(url.toString(), options, transport)).data;
  }
  async function metaList(config, path, fields) {
    const rows = [], seen = new Set(); let after;
    do {
      const data = await metaRequest(config, path, { fields, limit: 100, ...(after ? { after } : {}) });
      if (!Array.isArray(data.data)) throw new ProviderError('Listagem Meta inválida.');
      rows.push(...data.data);
      after = data.paging?.next ? data.paging?.cursors?.after : null;
      if (data.paging?.next && (!after || seen.has(after) || seen.size >= 1000)) throw new ProviderError('Paginação Meta inválida.');
      seen.add(after);
    } while (after);
    return rows;
  }
  async function adsRequest(config, suffix, body) {
    return (await json(`https://googleads.googleapis.com/${env.ECOMMERCE_GOOGLE_ADS_VERSION || 'v25'}/${suffix}`, postJson(body, {
      Authorization: `Bearer ${await googleToken(config)}`, ...(config.login_customer_id ? { 'login-customer-id': config.login_customer_id } : {}),
    }), transport)).data;
  }
  return {
    woo, bridge,
    async ensureProductWebhooks(config, deliveryUrl) {
      const target = new URL(deliveryUrl);
      if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash) throw new ProviderError('URL de webhook inválida.');
      const existing = [];
      for (let page = 1; page <= 1000; page++) {
        const { data } = await woo(config, 'webhooks', { page, per_page: 100 });
        if (!Array.isArray(data)) throw new ProviderError('Listagem de webhooks inválida.');
        existing.push(...data);
        if (data.length < 100) break;
        if (page === 1000) throw new ProviderError('Limite de paginação dos webhooks atingido.');
      }
      const hooks = [];
      for (const topic of ['product.created', 'product.updated', 'product.deleted']) {
        const found = existing.filter(h => h.topic === topic && h.delivery_url === deliveryUrl);
        if (found.length > 1 || found.some(h => h.status !== 'active')) throw new ProviderError('Há webhooks duplicados ou desativados para este destino. Revise antes de continuar.');
        const hook = found[0] || (await json(`${storeUrl(config.url)}/wp-json/wc/v3/webhooks`, {
          ...postJson({ name: `Aerion CRM · ${topic}`, topic, delivery_url: deliveryUrl, status: 'active', secret: config.webhook_secret }),
          dispatcher: publicDispatcher, headers: { 'Content-Type': 'application/json', Authorization: basic(config.consumer_key, config.consumer_secret) },
        }, transport)).data;
        if (!hook.id || hook.topic !== topic || hook.status !== 'active') throw new ProviderError('O WooCommerce não confirmou o webhook ativo.');
        hooks.push({ id: String(hook.id), topic, status: hook.status, existing: Boolean(found[0]), verifiedSecret: !found[0] || found[0].secret === config.webhook_secret });
      }
      return { observedAt: new Date().toISOString(), hooks, signature: 'HMAC-SHA256', existingSecretsRequireReview: hooks.some(h => !h.verifiedSecret) };
    },
    async stageMetaSalesCampaign(config, plan, key) {
      if (!/^[a-f0-9]{16}$/.test(key)) throw new ProviderError('Versão de planejamento inválida.');
      const name = `Aerion CRM · Loja · ${key}`;
      const existing = (await metaList(config, `act_${config.account_id}/campaigns`, 'id,name,status')).filter(c => c.name === name);
      if (existing.length > 1 || existing.some(c => c.status !== 'PAUSED')) throw new ProviderError('A estrutura Meta existente precisa de revisão. Nenhuma campanha foi alterada.');
      const found = existing[0] || await metaRequest(config, `act_${config.account_id}/campaigns`, {
        name, objective: 'OUTCOME_SALES', status: 'PAUSED', special_ad_categories: [],
        daily_budget: Math.max(1, Math.round(plan.meta / 30.4 * 100)), bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      }, 'POST');
      if (!/^\d+$/.test(found.id || '')) throw new ProviderError('A Meta não confirmou a campanha pausada.');
      const observed = await metaRequest(config, found.id, { fields: 'id,status' });
      if (observed.status !== 'PAUSED') throw new ProviderError('Não foi possível confirmar o estado pausado da nova campanha.');
      return { platform: 'meta_ads', id: found.id, status: 'PAUSED', assets: 'approved_assets_and_adsets_required', observedAt: new Date().toISOString() };
    },
    async stageGoogleSalesCampaign(config, plan, merchantId, key) {
      if (!/^[a-f0-9]{16}$/.test(key)) throw new ProviderError('Versão de planejamento inválida.');
      if (!/^\d+$/.test(merchantId)) throw new ProviderError('Conta Merchant inválida.');
      const name = `Aerion CRM Loja ${key}`;
      const result = await adsRequest(config, `customers/${config.customer_id}/googleAds:search`, { query: `SELECT campaign.resource_name, campaign.status FROM campaign WHERE campaign.name = '${name}'` });
      if ((result.results || []).length > 1 || result.results?.some(r => r.campaign.status !== 'PAUSED')) throw new ProviderError('A estrutura Google existente precisa de revisão. Nenhuma campanha foi alterada.');
      let resourceName = result.results?.[0]?.campaign.resourceName;
      if (!resourceName) {
        const budget = `customers/${config.customer_id}/campaignBudgets/-1`;
        const operations = [
          { campaignBudgetOperation: { create: { resourceName: budget, name, amountMicros: String(Math.max(1, Math.round(plan.google / 30.4 * 1e6))), deliveryMethod: 'STANDARD', explicitlyShared: false } } },
          { campaignOperation: { create: { name, status: 'PAUSED', advertisingChannelType: 'PERFORMANCE_MAX', campaignBudget: budget,
            maximizeConversionValue: {}, shoppingSetting: { merchantId, feedLabel: 'BR' }, containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING' } } },
        ];
        await adsRequest(config, `customers/${config.customer_id}/googleAds:mutate`, { mutateOperations: operations, partialFailure: false, validateOnly: true });
        const created = await adsRequest(config, `customers/${config.customer_id}/googleAds:mutate`, { mutateOperations: operations, partialFailure: false });
        resourceName = created.mutateOperationResponses?.find(r => r.campaignResult)?.campaignResult?.resourceName;
      }
      if (!new RegExp(`^customers/${config.customer_id}/campaigns/\\d+$`).test(resourceName || '')) throw new ProviderError('O Google não confirmou a campanha pausada.');
      const observed = await adsRequest(config, `customers/${config.customer_id}/googleAds:search`, { query: `SELECT campaign.status FROM campaign WHERE campaign.resource_name = '${resourceName}'` });
      if (observed.results?.[0]?.campaign.status !== 'PAUSED') throw new ProviderError('Não foi possível confirmar o estado pausado da nova campanha.');
      return { platform: 'google_ads', id: resourceName, status: 'PAUSED', assets: 'approved_asset_groups_and_exclusions_required', observedAt: new Date().toISOString() };
    },
    async publishProductSeo(config, product, content) {
      return (await json(`${storeUrl(config.url)}/wp-json/aerion-reports/v1/marketing-seo`, {
        ...postJson({ product_id: product.id, content_id: content.id, expected_modified_at: product.modifiedAt,
          title: content.data.title, description: content.data.description }), dispatcher: publicDispatcher,
        headers: { 'Content-Type': 'application/json', Authorization: basic(config.report_user, config.report_password) },
      }, transport)).data;
    },
    async ga4ServerPurchase(settings, body, { validate = false } = {}) {
      if (!/^G-[A-Z0-9]+$/.test(settings.measurementId || '') || !settings.apiSecret) throw new ProviderError('Configure a identificação e o segredo do fluxo GA4 Measurement Protocol.');
      const url = new URL(`https://www.google-analytics.com/${validate ? 'debug/' : ''}mp/collect`);
      url.search = new URLSearchParams({ measurement_id: settings.measurementId, api_secret: settings.apiSecret });
      let response;
      try { response = await transport(url.toString(), { ...postJson({ ...body, ...(validate ? { validation_behavior: 'ENFORCE_RECOMMENDATIONS' } : {}) }), redirect: 'error', signal: AbortSignal.timeout(30000) }); }
      catch { throw new ProviderError('Não foi possível enviar a medição GA4. A transação será reenviada com o mesmo ID.'); }
      if (!response.ok) throw new ProviderError(`Medição GA4 respondeu HTTP ${response.status}.`, 300, response.status);
      if (!validate) return { accepted: true, recorded: false };
      const result = await response.json();
      return { valid: Array.isArray(result.validationMessages) && !result.validationMessages.length,
        messages: (result.validationMessages || []).map(m => ({ code: String(m.validationCode || '').slice(0, 100), field: String(m.fieldPath || '').slice(0, 200) })) };
    },
    async customerAudienceBatch(config, audienceId, operation, hashes) {
      if (!/^\d+$/.test(audienceId) || !['add', 'remove'].includes(operation) || hashes.some(h => !/^[a-f0-9]{64}$/.test(h))) throw new ProviderError('Lote de público inválido.');
      const result = await metaRequest(config, `${audienceId}/users`, { payload: { schema: 'EMAIL_SHA256', data: hashes.map(h => [h]) } }, operation === 'remove' ? 'DELETE' : 'POST');
      if (Number(result.num_invalid_entries || 0) > 0) throw new ProviderError('A Meta recusou identificadores do lote. O lote não foi marcado como concluído.');
    },
    async customerAudienceGoogle(config, listId, additions, removals) {
      if (!/^\d+$/.test(listId) || [...additions, ...removals].some(h => !/^[a-f0-9]{64}$/.test(h))) throw new ProviderError('Lista Google inválida.');
      const { resourceName } = await adsRequest(config, `customers/${config.customer_id}/offlineUserDataJobs:create`, {
        job: { type: 'CUSTOMER_MATCH_USER_LIST', customerMatchUserListMetadata: { userList: `customers/${config.customer_id}/userLists/${listId}`,
          ...(additions.length ? { consent: { adUserData: 'GRANTED', adPersonalization: 'GRANTED' } } : {}) } },
      });
      if (!new RegExp(`^customers/${config.customer_id}/offlineUserDataJobs/\\d+$`).test(resourceName || '')) throw new ProviderError('Trabalho Google fora da conta configurada.');
      const operations = [...removals.map(hashedEmail => ({ remove: { userIdentifiers: [{ hashedEmail }] } })),
        ...additions.map(hashedEmail => ({ create: { userIdentifiers: [{ hashedEmail }] } }))];
      for (let offset = 0; offset < operations.length; offset += 5000) {
        const result = await adsRequest(config, `${resourceName}:addOperations`, { enablePartialFailure: false, operations: operations.slice(offset, offset + 5000) });
        if (result.partialFailureError?.code) throw new ProviderError('Falha parcial no lote Google; envio não concluído.');
      }
      await adsRequest(config, `${resourceName}:run`, {});
      return resourceName;
    },
    async customerAudienceJob(config, resourceName) {
      if (!new RegExp(`^customers/${config.customer_id}/offlineUserDataJobs/\\d+$`).test(resourceName || '')) throw new ProviderError('Trabalho Google inválido.');
      const result = await adsRequest(config, `customers/${config.customer_id}/googleAds:search`, {
        query: `SELECT offline_user_data_job.status FROM offline_user_data_job WHERE offline_user_data_job.resource_name = '${resourceName}'`,
      });
      return result.results?.[0]?.offlineUserDataJob?.status || 'PENDING';
    },
    async ensureGoogleStoreAudiences(config) {
      const headers = { Authorization: `Bearer ${await googleToken(config, 'ga4_admin')}` };
      const base = `https://analyticsadmin.googleapis.com/v1alpha/properties/${config.property_id}`;
      const audiences = await merchantList(`${base}/audiences`, 'audiences', headers, 200);
      const result = [];
      for (const definition of require('./marketingDomain').STORE_AUDIENCES) {
        const displayName = `Aerion CRM · Loja · ${definition.id} · v1`;
        const candidates = audiences.filter(a => a.displayName === displayName);
        if (candidates.length > 1) throw new ProviderError('Públicos GA4 duplicados. Revise antes de continuar.');
        let found = candidates[0];
        if (!found) {
          found = (await json(`${base}/audiences`, postJson({ displayName,
            description: `Loja: ${definition.ga4}; ${definition.days}d. Excluir paid_buyers 180d na campanha.`,
            membershipDurationDays: definition.days,
            filterClauses: [{ clauseType: 'INCLUDE', simpleFilter: { scope: 'AUDIENCE_FILTER_SCOPE_ACROSS_ALL_SESSIONS',
              filterExpression: { andGroup: { filterExpressions: [{ orGroup: { filterExpressions: [{ eventFilter: { eventName: definition.ga4 } }] } }] } } } }],
          }, headers), transport)).data;
        }
        if (!new RegExp(`^properties/${config.property_id}/audiences/\\d+$`).test(found.name || '')) throw new ProviderError('Público GA4 fora da propriedade configurada.');
        result.push({ ...definition, platformId: found.name, status: candidates.length ? 'existing_requires_rule_review' : 'awaiting_external_processing', size: null,
          adsPersonalizationEnabled: found.adsPersonalizationEnabled ?? null,
          exclusionApplied: !definition.excludePaidDays, exclusionMethod: definition.excludePaidDays ? 'exclude_paid_buyers_180d_at_campaign' : null });
      }
      const links = await merchantList(`${base}/googleAdsLinks`, 'googleAdsLinks', headers, 200);
      return { observedAt: new Date().toISOString(), store: result, googleAdsLinks: links.map(l => ({ customerId: l.customerId, adsPersonalizationEnabled: l.adsPersonalizationEnabled })),
        activationAllowed: false, note: 'A API GA4 limita filtros dinâmicos inAnyNDayPeriod a 60 dias. A exclusão móvel de compradores por 180 dias deve usar o público paid_buyers separado nas campanhas; não substituir por exclusão permanente.' };
    },
    async ensureMetaMarketing(config, settings) {
      let catalogId = settings.catalogId;
      if (!catalogId) {
        if (!/^\d+$/.test(settings.businessId || '')) throw new ProviderError('Configure o Business ID para descobrir o catálogo Aerion existente.');
        const catalogs = await metaList(config, `${settings.businessId}/owned_product_catalogs`, 'id,name');
        const matching = catalogs.filter(c => /aerion/i.test(c.name || ''));
        if (matching.length > 1) throw new ProviderError('Há mais de um catálogo Aerion. Informe o ID apropriado antes de configurar a fonte.');
        catalogId = matching[0]?.id;
        if (!catalogId) catalogId = (await metaRequest(config, `${settings.businessId}/owned_product_catalogs`, { name: 'Aerion · Loja', vertical: 'commerce' }, 'POST')).id;
      }
      if (!/^\d+$/.test(catalogId || '')) throw new ProviderError('O catálogo não retornou um ID válido.');
      const feeds = await metaList(config, `${catalogId}/product_feeds`, 'id,name');
      const owned = feeds.filter(f => f.name === 'Aerion CRM · consumidor');
      // Do not introduce a second writer or reconfigure a source owned by another integration.
      if (feeds.some(f => f.name !== 'Aerion CRM · consumidor') || owned.length > 1) throw new ProviderError('O catálogo já possui outra fonte. Revise a migração para uma fonte única antes de continuar.');
      let feedId = owned[0]?.id;
      if (!feedId) feedId = (await metaRequest(config, `${catalogId}/product_feeds`, { name: 'Aerion CRM · consumidor',
        schedule: { interval: 'HOURLY', url: settings.feedUrl, timezone: 'America/Sao_Paulo' } }, 'POST')).id;
      if (!/^\d+$/.test(feedId || '')) throw new ProviderError('A fonte Meta não retornou um ID válido.');
      if (owned.length) await metaRequest(config, feedId, { schedule: { interval: 'HOURLY', url: settings.feedUrl, timezone: 'America/Sao_Paulo' } }, 'POST');
      const sets = await metaList(config, `${catalogId}/product_sets`, 'id,name');
      const { GROUPS: groups, metaGroupLabel } = require('./marketingDomain');
      const items = await metaList(config, `${catalogId}/products`, 'id,custom_label_0');
      const presentLabels = new Set(items.map(item => item.custom_label_0));
      const pendingGroups = [];
      for (const group of groups) {
        const name = `Aerion CRM · ${group}`;
        if (sets.some(s => s.name === name)) continue;
        const label = metaGroupLabel(group);
        if (!presentLabels.has(label)) { pendingGroups.push(group); continue; }
        await metaRequest(config, `${catalogId}/product_sets`, { name, filter: { custom_label_0: { eq: label } } }, 'POST');
      }
      const sources = await metaList(config, `${catalogId}/external_event_sources`, 'id');
      if (!sources.some(s => s.id === settings.pixelId)) await metaRequest(config, `${catalogId}/external_event_sources`, { external_event_sources: [...new Set([...sources.map(s => s.id), settings.pixelId])] }, 'POST');
      const eligibleAccounts = await metaList(config, `${catalogId}/dpa_eligible_ad_accounts`, 'id');
      return { catalogId, feedId, pixelId: settings.pixelId, pixelLinked: true, adAccountLinked: eligibleAccounts.some(c => String(c.id).replace(/^act_/, '') === String(config.account_id)),
        pendingGroups, observedAt: new Date().toISOString(), status: 'awaiting_external_processing' };
    },
    async ensureMetaStoreAudiences(config, pixelId) {
      if (!/^\d+$/.test(pixelId)) throw new ProviderError('Pixel Meta inválido.');
      const definitions = require('./marketingDomain').STORE_AUDIENCES;
      const existing = await metaList(config, `act_${config.account_id}/customaudiences`, 'id,name,rule,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status,operation_status');
      const result = [];
      for (const audience of definitions) {
        const name = `Aerion CRM · Loja · ${audience.id} · v1`;
        const candidates = existing.filter(a => a.name === name);
        if (candidates.length > 1) throw new ProviderError('Públicos Aerion duplicados. Revise antes de continuar.');
        const clause = (event, days, allVisitors = false) => ({ event_sources: [{ id: pixelId, type: 'pixel' }], retention_seconds: days * 86400,
          template: allVisitors ? 'ALL_VISITORS' : 'VISITORS_BY_URL',
          filter: { operator: 'and', filters: [allVisitors ? { field: 'url', operator: 'i_contains', value: '' } : { field: 'event', operator: 'eq', value: event }] } });
        const rule = { inclusions: { operator: 'or', rules: [clause(audience.meta, audience.days, audience.id === 'visitors')] },
          ...(audience.excludePaidDays ? { exclusions: { operator: 'or', rules: [clause('Purchase', audience.excludePaidDays)] } } : {}) };
        let found = candidates[0];
        if (!found) found = await metaRequest(config, `act_${config.account_id}/customaudiences`, { name, prefill: true, rule }, 'POST');
        if (!/^\d+$/.test(found.id || '')) throw new ProviderError('A Meta não retornou um ID de público válido.');
        // Existing resources are never overwritten, even if someone edited their rules.
        result.push({ ...audience, platformId: found.id, status: candidates.length ? 'existing_requires_rule_review' : 'awaiting_external_processing',
          size: found.approximate_count_lower_bound ?? null, sizeUpper: found.approximate_count_upper_bound ?? null,
          processing: found.operation_status?.description || null, uploaded: true });
      }
      return { observedAt: new Date().toISOString(), pixelId, store: result, separateFromCrm: true };
    },
    async auditProduct(config, product) {
      const url = new URL(product.url);
      if (url.origin !== storeUrl(config.url)) throw new ProviderError('URL de produto fora da loja configurada.');
      let response;
      try { response = await transport(url.toString(), { dispatcher: publicDispatcher, redirect: 'manual', signal: AbortSignal.timeout(20000) }); }
      catch { throw new ProviderError('Não foi possível auditar a URL pública.'); }
      // Stop large pages while streaming; do not download attachments or follow arbitrary redirects.
      const type = response.headers.get('content-type') || '';
      let html = '';
      if (type.includes('text/html') && response.status === 200) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder(); let size = 0;
        try {
          for (;;) {
            const part = await reader.read(); if (part.done) break;
            size += part.value.length;
            if (size > 2e6) throw new ProviderError('Página excedeu o limite da auditoria técnica.');
            html += decoder.decode(part.value, { stream: true });
          }
        } finally { await reader.cancel().catch(() => {}); }
      }
      const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] || '';
      const tags = html.match(/<(?:meta|link)\b[^>]*>/gi) || [];
      const canonical = tags.filter(t => /\bcanonical\b/i.test(attribute(t, 'rel'))).map(t => attribute(t, 'href'));
      const robots = tags.filter(t => /^(robots|googlebot)$/i.test(attribute(t, 'name'))).map(t => attribute(t, 'content')).join(',') + ',' + (response.headers.get('x-robots-tag') || '');
      const structured = [];
      for (const script of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
        try {
          const visit = value => { if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') { if (value['@type']) structured.push(value); if (value['@graph']) visit(value['@graph']); } };
          visit(JSON.parse(script[1]));
        } catch { /* Invalid structured data is reported below. */ }
      }
      const productSchema = structured.find(o => [o['@type']].flat().includes('Product'));
      const links = [...html.matchAll(/<a\b[^>]*>/gi)].map(m => attribute(m[0], 'href')).filter(h => { try { return new URL(h, url).origin === url.origin; } catch { return false; } }).length;
      const issues = [];
      if (response.status !== 200) issues.push(`http_${response.status}`);
      if (response.status === 200 && !type.includes('text/html')) issues.push('not_html');
      if (/noindex|none/i.test(robots)) issues.push('noindex');
      if (canonical.length !== 1) issues.push('canonical_missing_or_multiple');
      if (canonical[0]) {
        try { if (new URL(canonical[0], url).origin !== url.origin) issues.push('cross_domain_canonical_review_required'); }
        catch { issues.push('invalid_canonical'); }
      }
      if (!productSchema) issues.push('product_schema_missing_or_invalid');
      if (productSchema?.sku && String(productSchema.sku) !== product.sku) issues.push('schema_sku_mismatch');
      return { observedAt: new Date().toISOString(), url: `${url.origin}${url.pathname}`, httpStatus: response.status,
        canonical, indexable: response.status === 200 && !/noindex|none/i.test(robots), internalLinks: links,
        productSchema: Boolean(productSchema), issues, sitemap: 'verify_search_console_sitemaps', coreWebVitals: 'unavailable' };
    },
    async metaCatalog(config, catalogId, feedId) {
      if (!/^\d+$/.test(catalogId) || (feedId && !/^\d+$/.test(feedId))) throw new ProviderError('IDs do catálogo e da fonte Meta devem ser numéricos.');
      const headers = { Authorization: `Bearer ${config.access_token}` };
      const base = `https://graph.facebook.com/${env.ECOMMERCE_META_API_VERSION || 'v25.0'}`;
      const list = async (path, fields) => {
        const result = [], seen = new Set(); let after;
        do {
          const params = new URLSearchParams({ fields, limit: '100', ...(after ? { after } : {}) });
          const { data } = await json(`${base}/${path}?${params}`, { headers }, transport);
          if (!Array.isArray(data.data)) throw new ProviderError('Listagem Meta inválida. Último catálogo preservado.');
          result.push(...data.data);
          after = data.paging?.next ? data.paging?.cursors?.after : null;
          if (data.paging?.next && (!after || seen.has(after) || seen.size >= 1000)) throw new ProviderError('Paginação Meta inválida.');
          seen.add(after);
        } while (after);
        return result;
      };
      const { data: catalog } = await json(`${base}/${catalogId}?fields=id,name`, { headers }, transport);
      if (String(catalog.id) !== catalogId) throw new ProviderError('Catálogo retornado não corresponde ao configurado.');
      const products = await list(`${catalogId}/products`, 'id,retailer_id,name,availability');
      const feeds = await list(`${catalogId}/product_feeds`, 'id,name,schedule');
      if (feedId && !feeds.some(f => String(f.id) === feedId)) throw new ProviderError('Fonte Meta fora do catálogo configurado.');
      const uploads = feedId ? await list(`${feedId}/uploads`, 'id,start_time,end_time,num_detected_items,num_invalid_items,num_persisted_items') : [];
      const sources = await list(`${catalogId}/external_event_sources`, 'id');
      const eligibleAccounts = await list(`${catalogId}/dpa_eligible_ad_accounts`, 'id');
      const pixelLinked = sources.some(s => String(s.id) === (env.ECOMMERCE_META_PIXEL_ID || '1668777180919759'));
      const hourlySchedule = feeds.some(f => String(f.id) === feedId && f.schedule?.interval === 'HOURLY');
      return { observedAt: new Date().toISOString(), catalogId, name: String(catalog.name || '').slice(0, 200),
        products: products.map(p => ({ id: String(p.id), sku: String(p.retailer_id || ''), name: String(p.name || '').slice(0, 500), availability: p.availability })),
        feeds: feeds.map(f => ({ id: String(f.id), name: String(f.name || '').slice(0, 200), interval: f.schedule?.interval || null })),
        uploads: uploads.map(u => ({ id: String(u.id), start: u.start_time, end: u.end_time, detected: u.num_detected_items, invalid: u.num_invalid_items, persisted: u.num_persisted_items })),
        feedId: feedId || null, connection: 'verified_read', catalogHealth: uploads[0]?.num_invalid_items ? 'issues' : 'unverified',
        pixelLink: pixelLinked ? 'verified' : 'unverified', hourlySchedule: hourlySchedule ? 'verified' : 'unverified',
        adAccountLinked: eligibleAccounts.some(c => String(c.id).replace(/^act_/, '') === String(config.account_id)), eventMatch: 'requires_platform_diagnostics' };
    },
    async merchantCatalog(config) {
      const account = `accounts/${config.account_id}`;
      const headers = { Authorization: `Bearer ${await googleToken(config, 'merchant_center')}` };
      const products = await merchantList(`https://merchantapi.googleapis.com/products/v1/${account}/products`, 'products', headers);
      const sources = await merchantList(`https://merchantapi.googleapis.com/datasources/v1/${account}/dataSources`, 'dataSources', headers);
      const normalizedSources = [];
      for (const source of sources) {
        if (!source.name?.startsWith(`${account}/dataSources/`) || !/^accounts\/\d+\/dataSources\/\d+$/.test(source.name)) throw new ProviderError('Fonte de dados fora da conta Merchant configurada.');
        let latest = null, uploadError = null;
        if (source.input === 'FILE') {
          try { latest = (await json(`https://merchantapi.googleapis.com/datasources/v1/${source.name}/fileUploads/latest`, { headers }, transport)).data; }
          catch { uploadError = 'O último processamento desta fonte não pôde ser consultado.'; }
        }
        // A fetch URL can include credentials. Only expose its public address.
        let feedUrl = null;
        try { const url = new URL(source.fileInput?.fetchSettings?.fetchUri); feedUrl = `${url.origin}${url.pathname}`; } catch { /* Not every source uses a URL. */ }
        normalizedSources.push({ id: String(source.dataSourceId || source.name.split('/').pop()), name: source.displayName || 'Fonte sem nome', input: source.input,
          scheduled: Boolean(source.fileInput?.fetchSettings?.enabled), frequency: source.fileInput?.fetchSettings?.frequency || null,
          timezone: source.fileInput?.fetchSettings?.timeZone || null, feedUrl,
          processingState: latest?.processingState || null, uploadTime: latest?.uploadTime || null,
          itemsTotal: latest?.itemsTotal == null ? null : Number(latest.itemsTotal), uploadError });
      }
      return { observedAt: new Date().toISOString(), accountId: String(config.account_id), sources: normalizedSources,
        products: products.map(product => {
          if (!product.name?.startsWith(`${account}/products/`) || !product.offerId) throw new ProviderError('Produto fora da conta Merchant configurada.');
          const attributes = product.productAttributes || {};
          return { id: product.name, offerId: String(product.offerId), title: String(attributes.title || product.offerId).slice(0, 500),
            brand: String(attributes.brand || '').slice(0, 150), availability: attributes.availability || null,
            contentLanguage: product.contentLanguage || '', feedLabel: product.feedLabel || '', dataSource: product.dataSource || '',
            destinations: (product.productStatus?.destinationStatuses || []).map(status => ({
              context: status.reportingContext, approved: status.approvedCountries || [], pending: status.pendingCountries || [], disapproved: status.disapprovedCountries || [],
            })), issues: (product.productStatus?.itemLevelIssues || []).map(issue => ({ code: String(issue.code || '').slice(0, 150),
              severity: issue.severity, resolution: issue.resolution, context: issue.reportingContext,
              countries: issue.applicableCountries || [], description: String(issue.description || '').slice(0, 500), detail: String(issue.detail || '').slice(0, 1000) })) };
        }) };
    },
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
      if (provider === 'merchant_center') {
        const headers = { Authorization: `Bearer ${await googleToken(config, 'merchant_center')}` };
        const { data } = await json(`https://merchantapi.googleapis.com/accounts/v1/accounts/${config.account_id}`, { headers }, transport);
        if (String(data.accountId) !== String(config.account_id)) throw new ProviderError('A conta retornada não corresponde ao Merchant configurado.');
        return { account_name: data.accountName || '', country: 'BR' };
      }
      if (provider === 'search_console') {
        const headers = { Authorization: `Bearer ${await googleToken(config, 'search_console')}` };
        const base = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(config.site_url)}`;
        const { data: site } = await json(base, { headers }, transport);
        if (site.permissionLevel === 'siteUnverifiedUser') throw new ProviderError('A conta técnica ainda não tem acesso verificado a esta propriedade do Search Console.', 3600);
        const { data } = await json(`${base}/sitemaps`, { headers }, transport);
        return { permission: site.permissionLevel, timezone: 'America/Los_Angeles', sitemaps: (data.sitemap || []).map(s => ({ path: s.path, lastSubmitted: s.lastSubmitted, lastDownloaded: s.lastDownloaded, isPending: s.isPending, warnings: Number(s.warnings || 0), errors: Number(s.errors || 0) })) };
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
      if (provider === 'merchant_center') {
        const headers = { Authorization: `Bearer ${await googleToken(config, 'merchant_center')}` };
        const rows = [], visited = new Set();
        let pageToken;
        do {
          const { data } = await json(`https://merchantapi.googleapis.com/reports/v1/accounts/${config.account_id}/reports:search`, postJson({
            query: `SELECT date, marketing_method, offer_id, title, clicks, impressions FROM product_performance_view WHERE date BETWEEN '${from}' AND '${to}'`,
            pageSize: 1000, ...(pageToken ? { pageToken } : {}),
          }, headers), transport);
          if (data.results != null && !Array.isArray(data.results)) throw new ProviderError('O Merchant Center retornou um relatório inválido.');
          for (const result of data.results || []) {
            const row = result.productPerformanceView, date = row?.date;
            if (!date || !row.offerId || !row.marketingMethod || !Number.isFinite(Number(row.clicks || 0)) || !Number.isFinite(Number(row.impressions || 0))) throw new ProviderError('Métricas de produto incompletas no Merchant Center.');
            const day = `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < from || day > to) throw new ProviderError('O Merchant Center retornou dados fora do período solicitado.');
            rows.push({ kind: 'merchant_performance', date: day, offerId: String(row.offerId), title: String(row.title || row.offerId).slice(0, 500),
              marketingMethod: row.marketingMethod, clicks: Number(row.clicks || 0), impressions: Number(row.impressions || 0) });
          }
          pageToken = data.nextPageToken;
          if (pageToken && (visited.has(pageToken) || visited.size >= 1000)) throw new ProviderError('Paginação do desempenho Merchant inválida.');
          visited.add(pageToken);
        } while (pageToken);
        return rows;
      }
      if (provider === 'search_console') {
        const headers = { Authorization: `Bearer ${await googleToken(config, 'search_console')}` };
        const rows = [];
        for (const [kind, dimension] of [['search_total', null], ['search_page', 'page'], ['search_query', 'query']]) {
          for (let startRow = 0; startRow < 100000; startRow += 25000) {
            const { data } = await json(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(config.site_url)}/searchAnalytics/query`, postJson({
              startDate: from, endDate: to, dimensions: dimension ? ['date', dimension] : ['date'], type: 'web', dataState: 'final', rowLimit: 25000, startRow,
            }, headers), transport);
            const batch = data.rows || [];
            rows.push(...batch.map(row => ({ kind, date: row.keys[0], clicks: Number(row.clicks || 0), impressions: Number(row.impressions || 0), position: Number(row.position || 0),
              ...(dimension === 'page' ? { landing: row.keys[1] } : dimension === 'query' ? { query: row.keys[1], content: row.keys[1] } : {}),
              truncated: startRow === 75000 && batch.length === 25000 })));
            if (batch.length < 25000) break;
          }
        }
        // A successful query with no row on a finalized day measures zero;
        // persist that coverage so SEO never confuses it with an unqueried gap.
        const totals = new Set(rows.filter(r => r.kind === 'search_total').map(r => r.date));
        const finalizedThrough = new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10);
        for (let day = from; day <= to && day <= finalizedThrough; day = new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)) {
          if (!totals.has(day)) rows.push({ kind: 'search_total', date: day, clicks: 0, impressions: 0, position: 0, measuredZero: true });
        }
        return rows;
      }
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
        if (config.purchase_conversion_action_id) {
          const purchases = new Map();
          const purchaseQuery = `SELECT segments.date, segments.conversion_action, campaign.id, metrics.all_conversions, metrics.all_conversions_value FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}' AND segments.conversion_action = 'customers/${config.customer_id}/conversionActions/${config.purchase_conversion_action_id}'`;
          let purchasePage;
          do {
            const { data } = await json(`https://googleads.googleapis.com/${env.ECOMMERCE_GOOGLE_ADS_VERSION || 'v25'}/customers/${config.customer_id}/googleAds:search`, postJson({ query: purchaseQuery, ...(purchasePage ? { pageToken: purchasePage } : {}) }, headers), transport);
            for (const row of data.results || []) {
              const key = `${row.segments.date}:${row.campaign.id}`;
              const old = purchases.get(key) || { conversions: 0, conversionValue: 0 };
              old.conversions += Number(row.metrics.allConversions || 0); old.conversionValue += Number(row.metrics.allConversionsValue || 0); purchases.set(key, old);
            }
            purchasePage = data.nextPageToken;
          } while (purchasePage);
          for (const row of rows) {
            row.allGoalsConversions = row.conversions; row.allGoalsConversionValue = row.conversionValue;
            Object.assign(row, purchases.get(`${row.date}:${row.campaignId}`) || { conversions: 0, conversionValue: 0 });
            row.attribution = `Compra Google Ads · ação ${config.purchase_conversion_action_id} · inclui ação secundária; exclui leads`;
          }
        }
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
