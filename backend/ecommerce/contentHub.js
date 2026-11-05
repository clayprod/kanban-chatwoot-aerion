const crypto = require('node:crypto');
const { eligibleProducts, campaignPlan } = require('./marketingDomain');
const { encrypt, decrypt, encryptionKey } = require('./domain');
const { buildCampaignStrategy, mediaSafetyEvidence } = require('./campaignStrategy');
const { campaignContext } = require('./campaignContext');
const {campaignFallback}=require('./campaignFallback');

function hubOrigin(origin) {
  let base;try { base = new URL(origin); } catch { throw new Error('content_hub_connection_required'); }
  const privateService = base.origin === 'http://tenryu_hub-api:3000';
  if ((!privateService && base.protocol !== 'https:') || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('content_hub_connection_required');
  return base;
}

function createContentHub({ env = process.env, transport = global.fetch } = {}) {
  const origin = env.ECOMMERCE_CONTENT_HUB_URL || 'https://hub.tenryu.com.br';
  const token = env.ECOMMERCE_CONTENT_HUB_TOKEN;
  const brandId = env.ECOMMERCE_CONTENT_HUB_BRAND || 'aerion-technologies';
  const configured = Boolean(token);
  async function call(path, body) {
    if (!configured) throw new Error('content_hub_connection_required');
    const base = hubOrigin(origin);
    let response;
    try { response = await transport(new URL('/api/marketing/' + path, base), {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(path==='advice'?240000:90000),
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }); } catch { throw new Error('content_hub_unavailable'); }
    if (!response.ok) {let error;try{error=await response.json();}catch{}const credits=response.status===402||/OpenRouter returned HTTP 402|available credits|insufficient.*credits/i.test(error?.message||'');throw Object.assign(new Error(credits?'content_hub_advice_credits_required':'content_hub_http_'+response.status),{httpStatus:credits?402:response.status});}
    let data; try { data = await response.json(); } catch { throw new Error('content_hub_invalid_response'); }
    return data;
  }
  return { configured, brandId,
    capabilities: () => call('capabilities/' + encodeURIComponent(brandId)),
    advice: input => call('advice', { ...input, brandId }),
    generate: input => call('generations', { ...input, brandId }),
    receipt: id => { if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('content_hub_invalid_request'); return call('requests/' + id); },
    library: query => call('library/' + encodeURIComponent(brandId) + '?' + new URLSearchParams(query)),
    context: () => call('context/' + encodeURIComponent(brandId)),
    selectAsset: input => call('library/' + encodeURIComponent(brandId) + '/select', input),
  };
}
function hubProduct(product) {
  return { sku: product.sku, name: product.name, description: product.description, price: product.price, currency: product.currency,
    image: product.image, url: product.url, version: product.version, availability: product.availability, availabilityDate: product.availabilityDate || null };
}
function recommendCampaign(products, input = {}) {
  const strategy = buildCampaignStrategy(products, input);
  const selected = eligibleProducts(products).filter(p => p.eligible && p.availability !== 'out_of_stock'
    && strategy.productIds.includes(p.id))
    .sort((a, b) => Number(!['Drones', 'Kits'].includes(a.group)) - Number(!['Drones', 'Kits'].includes(b.group))
      || Number(a.availability !== 'in_stock') - Number(b.availability !== 'in_stock') || a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, 8);
  if (!selected.length) throw Object.assign(new Error('Selecione produtos elegíveis disponíveis ou em pré-venda com prazo real.'), { status: 409 });
  const budget = input.budget ? campaignPlan(input.budget, selected, []) : null;
  return { id: crypto.randomUUID(), goal: String(input.goal || 'Preparar as primeiras vendas da loja').slice(0, 3000),
    products: selected.map(p => ({ id: p.id, ...hubProduct(p) })), strategy,
    budget: budget ? { total: budget.total, google: budget.google, meta: budget.meta, period: 'monthly', automaticTransfer: false } : null,
    stages: [
      { id: 'acquisition', name: 'Encontrar novos compradores', audience: 'Prospecção; excluir compradores pagos 180d', readyToSpend: false, approach: 'demonstração', formats: ['image_4_5', 'image_9_16'], reason: 'Sem histórico comprovado, começar com poucos produtos e hipóteses. Confirmar metas de compra, destino, verba e criativos antes de ativar.' },
      { id: 'consideration', name: 'Ajudar quem está comparando', audience: 'Interesse 30d e visitantes 30d; excluir compradores 180d', readyToSpend: false, approach: 'comparação', formats: ['image_4_5', 'video_9_16'], reason: 'Confirmar população e disponibilidade dos públicos; não fragmentar verba em listas pequenas.' },
      { id: 'recovery', name: 'Recuperar intenção de compra', audience: 'Checkout 7d e carrinho 14d; excluir compradores 180d', readyToSpend: false, approach: 'recuperação', formats: ['image_4_5'], reason: 'Ativar somente quando houver público suficiente. Usar condições reais; não inventar urgência ou desconto.' },
    ],
    investment: { mode: 'recommendations_only', platformOptimization: 'within_approved_platform_budget',
      requiredForTargets: ['margem por produto', 'custo de atendimento/logística', 'taxa de conversão observada'],
      checkpoints: ['Conferir pagamentos e compras registradas antes de otimizar por conversão.', 'Analisar gasto, cliques e checkout por origem; não tratar ausência de medição como zero.', 'Avaliar CAC e retorno após haver compras suficientes e margem conhecida.'] },
    publication: 'approval_required', activationAllowed: false, createdAt: new Date().toISOString(),
    limitations: ['A seleção inicial usa elegibilidade e disponibilidade; não é uma previsão de vendas.', 'Recomendações não alteram campanhas, status ou verbas existentes.', 'Geração de mídia tem custo próprio em USD, separado da verba de anúncios.'] };
}

function createCampaignAssistant({ pool, env = process.env, enqueue, saveState, hub: providedHub }) {
  async function savedConnection(db = pool) {
    return (await db.query("SELECT * FROM ecommerce_marketing_connections WHERE name='content_hub'")).rows[0];
  }
  async function getHub(db = pool) {
    if (providedHub) return providedHub;
    const row = await savedConnection(db);
    if (!row) return createContentHub({ env });
    let secrets;try { secrets = decrypt(row.secrets, encryptionKey(env)); } catch { throw new Error('content_hub_credentials_unavailable'); }
    return createContentHub({ env: { ...env, ECOMMERCE_CONTENT_HUB_URL: row.config.url,
      ECOMMERCE_CONTENT_HUB_BRAND: row.config.brandId, ECOMMERCE_CONTENT_HUB_TOKEN: row.enabled ? secrets.token : '' } });
  }
  async function connectionStatus() {
    if (providedHub) return { configured: providedHub.configured, source: 'injected' };
    try {
      const row = await savedConnection();
      return { configured: (await getHub()).configured, source: row ? 'encrypted_database' : 'environment',
        lastVerifiedAt: row?.last_success_at || null };
    } catch { return { configured: false, source: 'unavailable', error: 'content_hub_credentials_unavailable' }; }
  }
  async function execute(db, job) {
    if (!job.kind.startsWith('hub_')) return false;
    const hub = await getHub(db);
    if (job.kind === 'hub_capabilities') { await saveState(db, 'content_hub_capabilities', { ...await hub.capabilities(), observedAt: new Date().toISOString() }); return true; }
    if (job.kind === 'hub_advice') {
      const plan = (await db.query('SELECT data FROM ecommerce_marketing_state WHERE name=$1', ['assistant_plan:' + job.resource])).rows[0]?.data;
      if (!plan) throw new Error('content_hub_plan_required');
      if(plan.status==='ready_for_review'&&plan.advice?.brandContextUsed&&plan.advice?.proposal&&!plan.advice.rulesBased)return true;
      const safety = Object.fromEntries((await db.query("SELECT name,data FROM ecommerce_marketing_state WHERE name IN ('google_media_safety','meta_media_safety')")).rows.map(row => [row.name, row.data]));
      const context = await campaignContext(db);
      let advice;try{advice = await hub.advice({ planId:plan.id,goal: plan.goal, products: plan.products.map(p=>({...hubProduct(p),description:p.description.slice(0,1200)})), proposedPlan: plan, evidence: { ...context, mediaSafety: mediaSafetyEvidence(safety) } });}
      catch(error){if(error.httpStatus!==402||typeof hub.context!=='function')throw error;advice=campaignFallback(plan,context,await hub.context());}
      const evidenceSummary={period:context.period,sources:context.sources,paidOrders:context.sales.paidOrders,revenue:context.sales.revenue,sessions:context.navigation.sessions,productsAssessed:plan.strategy?.productCount,containsPersonalIdentifiers:false};
      await saveState(db, 'assistant_plan:' + job.resource, { ...plan, advice, evidenceSummary, status: 'ready_for_review' });
      await saveState(db, 'assistant_latest', { ...plan, advice, evidenceSummary, status: 'ready_for_review' });if(advice.providerPending)throw Object.assign(Error('content_hub_advice_credits_required'),{httpStatus:402,retrySeconds:3600});return true;
    }
    const found = (await db.query(`SELECT c.*,p.data AS product FROM ecommerce_marketing_content c JOIN ecommerce_marketing_products p ON p.product_id=c.product_id WHERE c.id=$1`, [job.resource])).rows[0];
    if (!found) return true;
    if (job.kind === 'hub_generate' && (found.status !== 'draft' || found.product_version !== found.product.version)) return true;
    const settings = found.data.contentHub;
    if (!settings?.requestId) throw new Error('content_hub_invalid_request');
    if (job.kind === 'hub_generate') {
      let receipt;
      try { receipt = await hub.receipt(settings.requestId); } catch (error) { if (error.httpStatus !== 404) throw error; }
      if (receipt && !receipt.job) {
        if (receipt.state !== 'done') throw new Error('content_hub_result_uncertain');
      }
      if (!receipt) receipt = await hub.generate({ idempotencyKey: settings.requestId, contentId: found.id, product: hubProduct(found.product), prompt: found.data.copy,
        ...settings.generation });
      await db.query(`UPDATE ecommerce_marketing_content SET data=jsonb_set(data,'{contentHub}', $2::jsonb) WHERE id=$1 AND status='draft'`, [found.id, JSON.stringify({ ...settings, status: 'queued', jobId: receipt.jobId || receipt.job?.id || null, estimatedCostUsd: receipt.estimatedCostUsd ?? null })]);
      await enqueue(db, 'hub_poll', found.id); return true;
    }
    if (job.kind === 'hub_poll') {
      const receipt = await hub.receipt(settings.requestId);
      const jobState = receipt.job;
      if (!jobState) throw new Error('content_hub_result_uncertain');
      const expectedType = settings.generation.capability === 'image-to-video' ? 'video/' : 'image/';
      const assets = (jobState.artifacts || []).filter(a => (a.contentType || '').startsWith(expectedType) && /^https:\/\//.test(a.url || '')).map(a => ({ url: a.url, contentType: a.contentType, bytes: a.bytes }));
      const status = jobState.status === 'done' ? assets.length ? 'ready_for_review' : 'failed' : ['failed', 'cancelled'].includes(jobState.status) ? 'failed' : 'running';
      await db.query(`UPDATE ecommerce_marketing_content SET data=jsonb_set(data,'{contentHub}', $2::jsonb) WHERE id=$1 AND data->'contentHub'->>'requestId'=$3`, [found.id, JSON.stringify({ ...settings, jobId: jobState.id, status, assets, costUsd: jobState.costUsd, review: jobState.review || null, failure: jobState.failure || null, observedAt: new Date().toISOString() }), settings.requestId]);
      if (status === 'running') await enqueue(db, 'hub_poll', found.id);
      return true;
    }
    throw new Error('content_hub_unknown_job');
  }
  function mountAdmin(router) {
    router.get('/marketing/assistant/library', async(req,res)=>{const hub=await getHub();const offset=Math.max(0,Math.min(100000,Number(req.query.offset)||0));res.json(await hub.library({search:String(req.query.search||'').slice(0,200),type:['image','video'].includes(req.query.type)?req.query.type:'all',offset:String(offset),limit:'24'}));});
    router.get('/marketing/assistant/brand',async(req,res)=>res.json(await(await getHub()).context()));
    router.post('/marketing/content/:id/assets/library',async(req,res)=>{
      if(!/^[a-f0-9-]{36}$/i.test(req.params.id))return res.status(400).json({error:'Conteúdo inválido.'});
      const hub=await getHub(), result=await hub.selectAsset({filename:String(req.body?.filename||'').slice(0,300),dir:req.body?.dir});
      const asset=result.asset;
      if(!asset||!/^https:\/\//.test(asset.url)||! /^(image|video)\//.test(asset.contentType))return res.status(409).json({error:'Selecione um arquivo existente no acervo da marca Aerion.'});
      const found=(await pool.query(`SELECT c.*,p.data AS product FROM ecommerce_marketing_content c JOIN ecommerce_marketing_products p ON p.product_id=c.product_id WHERE c.id=$1 AND c.status='draft' AND c.kind='creative'`,[req.params.id])).rows[0];
      if(!found||found.product_version!==found.product.version)return res.status(409).json({error:'Prepare um briefing para a versão atual do produto.'});
      const settings={status:'ready_for_review',integration:'hub_library',brandId:hub.brandId,productVersion:found.product_version,assets:[asset],selectedAsset:asset,selectedAt:new Date().toISOString(),brandingReviewRequired:true};
      await pool.query(`UPDATE ecommerce_marketing_content SET data=jsonb_set(data,'{contentHub}',$2::jsonb) WHERE id=$1 AND status='draft'`,[found.id,JSON.stringify(settings)]);
      res.json({selected:true,approvalRequired:true});
    });
    router.post('/marketing/assistant/preview', async (req, res) => {
      if (req.body?.productIds && (!Array.isArray(req.body.productIds) || req.body.productIds.length > 8)) return res.status(400).json({ error: 'Selecione até oito produtos para o briefing.' });
      const products = (await pool.query('SELECT data FROM ecommerce_marketing_products ORDER BY product_id')).rows.map(row => row.data);
      res.json({ ...recommendCampaign(products, req.body || {}), status: 'rules_preview', rulesBased: true, aiRequested: false });
    });
    router.put('/marketing/assistant/connection', async (req, res) => {
      const body = req.body || {}, row = await savedConnection();
      if (body.enabled === false && row) {
        await pool.query("UPDATE ecommerce_marketing_connections SET enabled=false,updated_at=now() WHERE name='content_hub'");
        return res.json({ configured: false });
      }
      const config = { url: body.url || row?.config.url || 'https://hub.tenryu.com.br', brandId: body.brandId || row?.config.brandId || 'aerion-technologies' };
      try { hubOrigin(config.url); } catch { return res.status(400).json({ error: 'Informe HTTPS ou o serviço Docker privado autorizado do Hub.' }); }
      if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(config.brandId)) return res.status(400).json({ error: 'Marca inválida.' });
      let token = body.token;
      if (!token && row) { try { token = decrypt(row.secrets, encryptionKey(env)).token; } catch { return res.status(409).json({ error: 'Não foi possível abrir a credencial existente. Informe uma nova.' }); } }
      if (typeof token !== 'string' || token.length < 16 || token.length > 4096) return res.status(400).json({ error: 'Informe a credencial privada do Hub.' });
      const candidate = createContentHub({ env: { ...env, ECOMMERCE_CONTENT_HUB_URL: config.url, ECOMMERCE_CONTENT_HUB_BRAND: config.brandId, ECOMMERCE_CONTENT_HUB_TOKEN: token } });
      let capabilities;try { capabilities = await candidate.capabilities(); } catch { return res.status(409).json({ error: 'O Hub não confirmou acesso à marca. A configuração anterior foi preservada.' }); }
      await pool.query(`INSERT INTO ecommerce_marketing_connections(name,config,secrets,enabled,last_success_at) VALUES('content_hub',$1,$2,true,now())
        ON CONFLICT(name) DO UPDATE SET config=EXCLUDED.config,secrets=EXCLUDED.secrets,enabled=true,last_success_at=now(),updated_at=now()`, [config, encrypt({ token }, encryptionKey(env))]);
      await saveState(pool, 'content_hub_capabilities', { ...capabilities, observedAt: new Date().toISOString() });
      res.json({ configured: true, source: 'encrypted_database', brandId: config.brandId });
    });
    router.post('/marketing/assistant/capabilities', async (req, res) => {
      const hub = await getHub();
      if (!hub.configured) return res.status(409).json({ error: 'Configure a conexão privada com o Content Hub.' });
      await enqueue(pool, 'hub_capabilities', 'aerion'); res.status(202).json({ queued: true });
    });
    router.post('/marketing/assistant/plan', async (req, res) => {
      const hub = await getHub();
      if (req.body?.productIds && (!Array.isArray(req.body.productIds) || req.body.productIds.length > 8)) return res.status(400).json({ error: 'Selecione até oito produtos para a análise.' });
      const products = (await pool.query('SELECT data FROM ecommerce_marketing_products ORDER BY product_id')).rows.map(row => row.data);
      const plan = recommendCampaign(products, req.body || {});
      await saveState(pool, 'assistant_plan:' + plan.id, { ...plan, status: hub.configured ? 'queued' : 'connection_required' });
      await saveState(pool, 'assistant_latest', { ...plan, status: hub.configured ? 'queued' : 'connection_required' });
      if (hub.configured) await enqueue(pool, 'hub_advice', plan.id);
      res.status(201).json({ ...plan, ai: hub.configured ? 'queued' : 'unavailable', rulesBased: true });
    });
    router.post('/marketing/content/:id/generate', async (req, res) => {
      const hub = await getHub();
      if (!/^[a-f0-9-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: 'Conteúdo inválido.' });
      if (!hub.configured) return res.status(409).json({ error: 'Configure a conexão privada com o Content Hub.' });
      const body = req.body || {};
      if (!['text-to-image', 'image-to-video'].includes(body.capability) || !['1:1', '4:5', '9:16', '16:9'].includes(body.aspectRatio)
        || !(body.maximumCostUsd > 0 && body.maximumCostUsd <= 100) || (body.capability === 'image-to-video' && !(body.duration > 0 && body.duration <= 30))) return res.status(400).json({ error: 'Informe formato, teto de geração em USD e duração válida para vídeo.' });
      const found = (await pool.query(`SELECT c.*,p.data AS product FROM ecommerce_marketing_content c JOIN ecommerce_marketing_products p ON p.product_id=c.product_id WHERE c.id=$1`, [req.params.id])).rows[0];
      if (!found || found.kind !== 'creative' || found.status !== 'draft' || found.product_version !== found.product.version || !found.data.copy?.trim()) return res.status(409).json({ error: 'A geração exige briefing preenchido e rascunho da versão atual do produto.' });
      if (found.data.contentHub?.requestId) return res.status(409).json({ error: 'Este rascunho já possui uma solicitação. Acompanhe seu estado; crie outra versão para uma nova geração.' });
      let inputImage;
      if (body.capability === 'image-to-video') {
        if (body.sourceContentId) {
          const source = (await pool.query(`SELECT data FROM ecommerce_marketing_content WHERE id=$1 AND product_id=$2 AND product_version=$3 AND status='approved'`, [body.sourceContentId, found.product_id, found.product_version])).rows[0]?.data;
          if (!source?.contentHub?.selectedAsset?.contentType?.startsWith('image/')) return res.status(409).json({ error: 'Uma imagem gerada precisa estar aprovada para servir de origem ao vídeo.' });
          inputImage = source.contentHub.selectedAsset.url;
        } else {
          // A published catalog photograph is already the real product reference;
          // it does not require approving a newly generated still first.
          if (!eligibleProducts([found.product])[0].eligible) return res.status(409).json({ error: 'O vídeo exige uma foto real de um produto elegível da loja.' });
          inputImage = found.product.image;
        }
      }
      const settings = { status: 'queued', requestId: crypto.randomUUID(), integration: 'api', productVersion: found.product_version,
        ...(inputImage ? { sourceType: body.sourceContentId ? 'approved_creative' : 'catalog_product_photo' } : {}),
        generation: { capability: body.capability, aspectRatio: body.aspectRatio, maximumCostUsd: Number(body.maximumCostUsd), ...(inputImage ? { inputImage, duration: Number(body.duration) } : {}),
          ...(body.providerId ? { providerId: String(body.providerId).slice(0, 80) } : {}), ...(body.modelId ? { modelId: String(body.modelId).slice(0, 200) } : {}) } };
      const updated = await pool.query(`UPDATE ecommerce_marketing_content SET data=jsonb_set(data,'{contentHub}',$2::jsonb) WHERE id=$1 AND status='draft' AND NOT COALESCE(data->'contentHub' ? 'requestId',false) RETURNING id`, [found.id, JSON.stringify(settings)]);
      if (!updated.rowCount) return res.status(409).json({ error: 'Solicitação já registrada por outra sessão.' });
      await enqueue(pool, 'hub_generate', found.id); res.status(202).json({ queued: true, requestId: settings.requestId });
    });
    router.post('/marketing/content/:id/assets/select', async (req, res) => {
      if (!/^[a-f0-9-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: 'Conteúdo inválido.' });
      const found = (await pool.query("SELECT data FROM ecommerce_marketing_content WHERE id=$1 AND status='draft'", [req.params.id])).rows[0];
      const asset = found?.data.contentHub?.assets?.find(a => a.url === req.body?.url);
      if (!asset || found.data.contentHub.status !== 'ready_for_review') return res.status(409).json({ error: 'Selecione um arquivo concluído deste rascunho.' });
      await pool.query(`UPDATE ecommerce_marketing_content SET data=jsonb_set(data,'{contentHub,selectedAsset}',$2::jsonb) WHERE id=$1 AND status='draft'`, [req.params.id, JSON.stringify(asset)]);
      res.json({ selected: true, approvalRequired: true });
    });
  }
  return { execute, mountAdmin, connectionStatus };
}
module.exports = { createContentHub, hubProduct, recommendCampaign, createCampaignAssistant };
