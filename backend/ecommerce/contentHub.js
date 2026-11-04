const crypto = require('node:crypto');
const { eligibleProducts, campaignPlan } = require('./marketingDomain');

function createContentHub({ env = process.env, transport = global.fetch } = {}) {
  const origin = env.ECOMMERCE_CONTENT_HUB_URL || 'https://hub.tenryu.com.br';
  const token = env.ECOMMERCE_CONTENT_HUB_TOKEN;
  const brandId = env.ECOMMERCE_CONTENT_HUB_BRAND || 'aerion-technologies';
  const configured = Boolean(token);
  async function call(path, body) {
    if (!configured) throw new Error('content_hub_connection_required');
    let base;try { base = new URL(origin); } catch { throw new Error('content_hub_connection_required'); }
    const privateService = base.origin === 'http://tenryu_hub-api:3000';
    if ((!privateService && base.protocol !== 'https:') || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('content_hub_connection_required');
    let response;
    try { response = await transport(new URL('/api/marketing/' + path, base), {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(90000),
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }); } catch { throw new Error('content_hub_unavailable'); }
    if (!response.ok) throw Object.assign(new Error('content_hub_http_' + response.status), { httpStatus: response.status });
    let data; try { data = await response.json(); } catch { throw new Error('content_hub_invalid_response'); }
    return data;
  }
  return { configured, brandId,
    capabilities: () => call('capabilities/' + encodeURIComponent(brandId)),
    advice: input => call('advice', { ...input, brandId }),
    generate: input => call('generations', { ...input, brandId }),
    receipt: id => { if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('content_hub_invalid_request'); return call('requests/' + id); },
  };
}
function hubProduct(product) {
  return { sku: product.sku, name: product.name, description: product.description, price: product.price, currency: product.currency,
    image: product.image, url: product.url, version: product.version };
}
function recommendCampaign(products, input = {}) {
  const selected = eligibleProducts(products).filter(p => p.eligible && p.availability !== 'out_of_stock'
    && (!input.productIds?.length || input.productIds.map(String).includes(p.id))).slice(0, 3);
  if (!selected.length) throw Object.assign(new Error('Selecione produtos elegíveis disponíveis ou em pré-venda com prazo real.'), { status: 409 });
  const budget = input.budget ? campaignPlan(input.budget, selected, []) : null;
  return { id: crypto.randomUUID(), goal: String(input.goal || 'Preparar as primeiras vendas da loja').slice(0, 3000),
    products: selected.map(p => ({ id: p.id, ...hubProduct(p) })),
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

function createCampaignAssistant({ pool, env = process.env, enqueue, saveState, hub = createContentHub({ env }) }) {
  async function execute(db, job) {
    if (!job.kind.startsWith('hub_')) return false;
    if (job.kind === 'hub_capabilities') { await saveState(db, 'content_hub_capabilities', { ...await hub.capabilities(), observedAt: new Date().toISOString() }); return true; }
    if (job.kind === 'hub_advice') {
      const plan = (await db.query('SELECT data FROM ecommerce_marketing_state WHERE name=$1', ['assistant_plan:' + job.resource])).rows[0]?.data;
      if (!plan) throw new Error('content_hub_plan_required');
      const advice = await hub.advice({ goal: plan.goal, products: plan.products.map(hubProduct), proposedPlan: plan, evidence: { salesHistory: 'not_supplied', audienceDelivery: 'not_verified' } });
      await saveState(db, 'assistant_plan:' + job.resource, { ...plan, advice, status: 'ready_for_review' });
      await saveState(db, 'assistant_latest', { ...plan, advice, status: 'ready_for_review' }); return true;
    }
    const found = (await db.query(`SELECT c.*,p.data AS product FROM ecommerce_marketing_content c JOIN ecommerce_marketing_products p ON p.product_id=c.product_id WHERE c.id=$1`, [job.resource])).rows[0];
    if (!found || found.status !== 'draft' || found.product_version !== found.product.version) throw new Error('content_hub_current_draft_required');
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
      await db.query(`UPDATE ecommerce_marketing_content SET data=jsonb_set(data,'{contentHub}', $2::jsonb) WHERE id=$1 AND status='draft'`, [found.id, JSON.stringify({ ...settings, status: 'queued', jobId: receipt.jobId || receipt.job?.id || null })]);
      await enqueue(db, 'hub_poll', found.id); return true;
    }
    if (job.kind === 'hub_poll') {
      const receipt = await hub.receipt(settings.requestId);
      const jobState = receipt.job;
      if (!jobState) throw new Error('content_hub_result_uncertain');
      const expectedType = settings.generation.capability === 'image-to-video' ? 'video/' : 'image/';
      const assets = (jobState.artifacts || []).filter(a => (a.contentType || '').startsWith(expectedType) && /^https:\/\//.test(a.url || '')).map(a => ({ url: a.url, contentType: a.contentType, bytes: a.bytes }));
      const status = jobState.status === 'done' ? assets.length ? 'ready_for_review' : 'failed' : ['failed', 'cancelled'].includes(jobState.status) ? 'failed' : 'running';
      await db.query(`UPDATE ecommerce_marketing_content SET data=jsonb_set(data,'{contentHub}', $2::jsonb) WHERE id=$1 AND status='draft'`, [found.id, JSON.stringify({ ...settings, jobId: jobState.id, status, assets, costUsd: jobState.costUsd, observedAt: new Date().toISOString() })]);
      if (status === 'running') await enqueue(db, 'hub_poll', found.id);
      return true;
    }
    throw new Error('content_hub_unknown_job');
  }
  function mountAdmin(router) {
    router.post('/marketing/assistant/capabilities', async (req, res) => {
      if (!hub.configured) return res.status(409).json({ error: 'Configure a conexão privada com o Content Hub.' });
      await enqueue(pool, 'hub_capabilities', 'aerion'); res.status(202).json({ queued: true });
    });
    router.post('/marketing/assistant/plan', async (req, res) => {
      if (req.body?.productIds && (!Array.isArray(req.body.productIds) || req.body.productIds.length > 8)) return res.status(400).json({ error: 'Selecione até oito produtos para a análise.' });
      const products = (await pool.query('SELECT data FROM ecommerce_marketing_products ORDER BY product_id')).rows.map(row => row.data);
      const plan = recommendCampaign(products, req.body || {});
      await saveState(pool, 'assistant_plan:' + plan.id, { ...plan, status: hub.configured ? 'queued' : 'connection_required' });
      await saveState(pool, 'assistant_latest', { ...plan, status: hub.configured ? 'queued' : 'connection_required' });
      if (hub.configured) await enqueue(pool, 'hub_advice', plan.id);
      res.status(201).json({ ...plan, ai: hub.configured ? 'queued' : 'unavailable', rulesBased: true });
    });
    router.post('/marketing/content/:id/generate', async (req, res) => {
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
        const source = (await pool.query(`SELECT data FROM ecommerce_marketing_content WHERE id=$1 AND product_id=$2 AND product_version=$3 AND status='approved'`, [body.sourceContentId, found.product_id, found.product_version])).rows[0]?.data;
        if (!source?.contentHub?.selectedAsset?.contentType?.startsWith('image/')) return res.status(409).json({ error: 'Escolha primeiro uma imagem aprovada deste produto para animar o vídeo com fidelidade.' });
        inputImage = source.contentHub.selectedAsset.url;
      }
      const settings = { status: 'queued', requestId: crypto.randomUUID(), integration: 'api', productVersion: found.product_version,
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
  return { execute, mountAdmin, configured: hub.configured };
}
module.exports = { createContentHub, hubProduct, recommendCampaign, createCampaignAssistant };
