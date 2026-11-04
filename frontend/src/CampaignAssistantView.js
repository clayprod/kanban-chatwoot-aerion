import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { btnPrimarySm, btnSecondarySm, input, select } from './ui';

const stageNames = { acquisition: 'Encontrar novos compradores', consideration: 'Ajudar quem está comparando', recovery: 'Recuperar intenção de compra' };
const states = { queued: 'Na fila do Hub', running: 'Gerando arquivo', ready_for_review: 'Pronto para sua revisão', failed: 'A geração falhou' };
const usd = value => value == null ? 'Ainda não informado' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', maximumFractionDigits: 3 }).format(value);
const cleanAdvice = text => String(text || '').replace(/^#{1,6}\s+/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/^---$/gm, '');
export function suggestedRoute(data, medium) {
  const capability = medium === 'video' ? 'image-to-video' : 'text-to-image';
  const routes = data.assistant?.capabilities?.capabilities?.capabilities?.find(c => c.capability === capability)?.routes || [];
  const blocked = new Set((data.contents || []).filter(c => c.data?.contentHub?.failure?.code === 'provider_balance_overdue').map(c => c.data.contentHub.generation?.providerId));
  const available = routes.filter(route => !blocked.has(route.provider));
  const preferred = available.find(route => medium === 'video' ? route.provider === 'openrouter-video' && /seedance.*fast/.test(route.model) : route.provider === 'openrouter-image' && /seedream-5/.test(route.model));
  return preferred || available[0] || null;
}
export default function CampaignAssistantView({ data, isAdmin, onRefresh }) {
  const assistant = data.assistant || {}, plan = assistant.latestPlan;
  const [productId, setProductId] = useState(''), [goal, setGoal] = useState('Conseguir as primeiras vendas da loja com um teste pequeno e mensurável.');
  const [stage, setStage] = useState('acquisition'), [medium, setMedium] = useState('image'), [limit, setLimit] = useState('1'), [direction, setDirection] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const lock = useRef(false);
  const products = (data.products || []).filter(p => p.eligible && p.availability !== 'out_of_stock');
  const product = products.find(p => p.id === productId) || products.find(p => p.id === plan?.products?.[0]?.id) || products[0];
  const drafts = (data.contents || []).filter(c => c.kind === 'creative' && c.data?.contentHub?.requestId).slice(0, 12);
  const route = suggestedRoute(data, medium);
  const pending = plan?.status === 'queued' || drafts.some(c => c.status === 'draft' && ['queued', 'running'].includes(c.data.contentHub.status));
  useEffect(() => {
    if (!pending || !onRefresh) return undefined;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') onRefresh(); }, 10000);
    return () => clearInterval(timer);
  }, [pending, onRefresh]);
  async function act(work, success) {
    if (lock.current) return;
    lock.current = true;setBusy(true);setError('');setMessage('');
    try { await work();setMessage(success);onRefresh?.(); }
    catch (failure) { setError(typeof failure.response?.data?.error === 'string' ? failure.response.data.error : 'Não foi possível concluir. Seu rascunho foi preservado; confira o histórico antes de tentar novamente.'); }
    finally { lock.current = false;setBusy(false); }
  }
  function preparePlan(event) {
    event.preventDefault();
    if (!product || !assistant.configured || !goal.trim()) return;
    act(() => axios.post('/api/ecommerce/marketing/assistant/plan', { goal, productIds: [product.id],
      ...(data.campaign ? { budget: { total: data.campaign.total, google: data.campaign.google, meta: data.campaign.meta } } : {}) }), 'Plano inicial salvo. A IA está preparando a recomendação para revisão.');
  }
  function generate(event) {
    event.preventDefault();
    if (!product || !route || !assistant.configured) return;
    act(async () => {
      const copy = `${stageNames[stage]}. Produto ${product.name} (SKU ${product.sku}). ${medium === 'video' ? 'Crie um take curto e fiel a partir da foto real do catálogo, com movimento suave de câmera. Sem narração ou textos inventados.' : 'Crie uma imagem publicitária de demonstração fiel ao produto. Título: ' + product.name + '. CTA: Conheça na loja.'} Preserve geometria, câmera, cores e proporções da fotografia. Não invente recursos, acessórios, preço, desconto, garantia ou prazo. Use a identidade Aerion já cadastrada no Hub. ${direction.trim() ? 'Direção adicional: ' + direction.trim() : ''} Rascunho para revisão; não publicar.`;
      const draft = await axios.post('/api/ecommerce/marketing/content', { productId: product.id, kind: 'creative', approach: stage === 'recovery' ? 'recuperação' : stage === 'consideration' ? 'comparação' : 'demonstração', copy });
      await axios.post(`/api/ecommerce/marketing/content/${draft.data.id}/generate`, { capability: medium === 'video' ? 'image-to-video' : 'text-to-image',
        aspectRatio: medium === 'video' ? '9:16' : '4:5', maximumCostUsd: Number(limit), providerId: route.provider, modelId: route.model,
        ...(medium === 'video' ? { duration: route.durations?.includes(4) ? 4 : route.durations?.[0] } : {}) });
    }, 'Solicitação enviada ao Hub. O arquivo aparecerá abaixo para você revisar.');
  }
  if (!data.assistant) return null;
  return <section className="min-w-0 rounded-xl border border-line bg-surf p-4 sm:p-5" aria-label="Assistente de campanhas">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-base font-semibold">Prepare sua campanha com a IA</h3><span className="text-xs text-muted">{assistant.configured ? 'Content Hub conectado' : 'Conexão do Hub pendente'}</span></div>
    <p className="mt-2 max-w-3xl text-sm text-muted">Escolha um produto e seu objetivo. A IA ajuda a direcionar público, etapas e criativos. Você revisa os arquivos antes de publicar; as campanhas continuam pausadas.</p>
    {!assistant.configured && <p className="mt-3 text-sm">Um administrador precisa testar e salvar a conexão privada com o Hub. Os rascunhos existentes continuam disponíveis.</p>}
    {error && <p role="alert" className="mt-4 rounded-lg border border-red/30 p-3 text-sm">{error}</p>}
    {message && <p role="status" className="mt-4 rounded-lg border border-line p-3 text-sm">{message}</p>}
    {isAdmin && <form onSubmit={preparePlan} className="mt-5 space-y-3">
      <div className="grid gap-3 md:grid-cols-2"><label className="min-w-0"><span className="mb-1 block text-xs text-muted">Produto principal</span><select className={`${select} w-full max-w-full`} value={product?.id || ''} onChange={e => setProductId(e.target.value)} disabled={busy || !products.length}>{!products.length && <option value="">Nenhum produto disponível e elegível</option>}{products.map(p => <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}</select></label>
        <label className="min-w-0"><span className="mb-1 block text-xs text-muted">Seu objetivo</span><input className={`${input} w-full`} required maxLength={3000} value={goal} onChange={e => setGoal(e.target.value)} disabled={busy} /></label></div>
      <button type="submit" className={btnPrimarySm} disabled={busy || !assistant.configured || !product || !goal.trim()}>{busy ? 'Processando…' : 'Preparar plano com IA'}</button>
    </form>}
    {plan && <div className="mt-5 border-t border-line pt-4">
      <h4 className="text-sm font-semibold">Estratégia para revisar</h4>
      <p className="mt-1 text-xs text-muted">{plan.status === 'queued' ? 'A IA está analisando. O plano inicial abaixo usa regras e dados da loja.' : plan.advice?.text ? 'Recomendação da IA disponível, junto do plano inicial.' : 'Plano inicial por regras; orientação da IA ainda indisponível.'} {plan.budget ? 'Parcelas Google e Meta preservadas.' : 'Verba de anúncios ainda não definida.'}</p>
      <dl className="mt-3 divide-y divide-line">{(plan.stages || []).map(row => <div key={row.id} className="grid gap-1 py-3 text-sm md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"><dt className="font-medium">{row.name}</dt><dd className="min-w-0"><p>{row.audience}</p><p className="mt-1 text-xs text-muted">{row.reason}</p></dd></div>)}</dl>
      {plan.advice?.text && <details className="mt-3"><summary className="cursor-pointer py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Ler a recomendação completa da IA</summary><p className="mt-2 max-w-3xl whitespace-pre-wrap break-words text-sm leading-relaxed">{cleanAdvice(plan.advice.text)}</p></details>}
    </div>}
    {isAdmin && <form onSubmit={generate} className="mt-5 space-y-3 border-t border-line pt-4">
      <h4 className="text-sm font-semibold">Produzir um criativo para revisão</h4>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <label className="min-w-0"><span className="mb-1 block text-xs text-muted">Etapa da jornada</span><select className={`${select} w-full max-w-full`} value={stage} onChange={e => setStage(e.target.value)} disabled={busy}>{Object.entries(stageNames).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
        <label><span className="mb-1 block text-xs text-muted">Tipo de arquivo</span><select className={`${select} w-full`} value={medium} onChange={e => setMedium(e.target.value)} disabled={busy}><option value="image">Imagem vertical</option><option value="video">Vídeo curto vertical</option></select></label>
        <label><span className="mb-1 block text-xs text-muted">Limite de estimativa por peça (US$)</span><input className={`${input} w-full`} type="number" min="0.01" max="100" step="0.01" required value={limit} onChange={e => setLimit(e.target.value)} disabled={busy} /></label>
      </div>
      <label className="block"><span className="mb-1 block text-xs text-muted">Direção do criativo (opcional)</span><textarea className={`${input} min-h-20 w-full`} maxLength={6000} value={direction} onChange={e => setDirection(e.target.value)} placeholder="Ex.: mostrar o produto em uma viagem, com foco em quem está escolhendo o primeiro drone." disabled={busy} /></label>
      <p className="max-w-3xl text-xs text-muted">{medium === 'video' ? 'O vídeo começa pela foto real do produto da loja. ' : 'A foto real da loja será usada como referência. '}Os créditos de produção do Hub são separados da verba de anúncios. Cada clique solicita uma peça nova; atualizar o acompanhamento não inicia outra geração.</p>
      {!route && assistant.configured && <p className="text-sm">Os formatos do Hub ainda não foram confirmados. <button type="button" className="underline underline-offset-2" disabled={busy} onClick={() => act(() => axios.post('/api/ecommerce/marketing/assistant/capabilities', {}), 'Consultando os formatos disponíveis no Hub.')}>Consultar formatos</button></p>}
      <button type="submit" className={btnPrimarySm} disabled={busy || !assistant.configured || !product || !route || !(Number(limit) > 0) || (medium === 'video' && !route.durations?.length)}>{medium === 'video' ? 'Gerar rascunho de vídeo' : 'Gerar rascunho de imagem'}</button>
    </form>}
    <div className="mt-5 border-t border-line pt-4"><h4 className="text-sm font-semibold">Arquivos e aprovações</h4>
      {!drafts.length ? <p className="mt-2 text-sm text-muted">Seu primeiro arquivo aparecerá aqui quando o Hub concluir a produção. Você poderá comparar, selecionar e aprovar a versão.</p> : <ul className="mt-3 grid gap-4 lg:grid-cols-2">{drafts.map(c => { const hub = c.data.contentHub, selected = hub.selectedAsset;return <li key={c.id} className="min-w-0 border-t border-line py-4">
        <div className="flex flex-wrap justify-between gap-2 text-sm"><strong>{c.data.name} · {hub.generation?.capability === 'image-to-video' ? 'Vídeo' : 'Imagem'}</strong><span>{c.status === 'approved' ? 'Aprovado' : c.status === 'rejected' ? 'Rejeitado' : c.status === 'stale' ? 'Produto alterado · revisar nova versão' : states[hub.status] || 'Aguardando processamento'}</span></div>
        {hub.failure && <p className="mt-2 text-sm">{hub.failure.message}</p>}
        {hub.review?.reviews?.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer py-2 font-medium">Conferir análise visual da IA antes de aprovar</summary><p className="mt-1 text-xs text-muted">A análise automática não substitui sua aprovação. Confira especialmente a fidelidade do produto e a identidade Aerion.</p>{hub.review.reviews.map((review, i) => <div key={i} className="mt-2"><p>{review.summary}</p>{Object.entries(review.categories || {}).filter(([, category]) => category.score < 85).map(([key, category]) => <p key={key} className="mt-2 text-xs">Ponto de atenção ({category.score}/100): {category.note}</p>)}</div>)}</details>}
        {hub.status === 'failed' && !hub.failure && <p className="mt-2 text-sm">Nenhum arquivo está pronto para aprovação. Confira o trabalho no Hub antes de uma nova tentativa.</p>}
        {(hub.assets || []).map(asset => <div key={asset.url} className="mt-3 space-y-2">{asset.contentType.startsWith('video/') ? <video src={asset.url} controls muted playsInline preload="metadata" className="max-h-96 w-full bg-bg2 object-contain" aria-label={`Rascunho de vídeo ${c.data.name}`} /> : <img src={asset.url} alt={`Rascunho de campanha ${c.data.name}`} loading="lazy" className="max-h-96 w-full bg-bg2 object-contain" />}
          <div className="flex flex-wrap items-center gap-3"><a href={asset.url} target="_blank" rel="noreferrer" className="text-sm text-primary underline underline-offset-2">Abrir arquivo</a>{isAdmin && c.status === 'draft' && hub.status === 'ready_for_review' && <button type="button" className={btnSecondarySm} disabled={busy || selected?.url === asset.url} onClick={() => act(() => axios.post(`/api/ecommerce/marketing/content/${c.id}/assets/select`, { url: asset.url }), 'Arquivo selecionado. Revise antes de aprovar.')}>{selected?.url === asset.url ? 'Arquivo selecionado' : 'Selecionar este arquivo'}</button>}</div>
        </div>)}
        <p className="mt-3 text-xs text-muted">Estimativa: {usd(hub.estimatedCostUsd)} · Custo informado: {usd(hub.costUsd)}</p>
        {isAdmin && c.status === 'draft' && <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={btnPrimarySm} disabled={busy || hub.status !== 'ready_for_review' || !selected} onClick={() => act(() => axios.post(`/api/ecommerce/marketing/content/${c.id}/review`, { status: 'approved' }), 'Criativo aprovado. A aprovação não publica nem ativa anúncios.')}>Aprovar criativo selecionado</button><button type="button" className={btnSecondarySm} disabled={busy} onClick={() => act(() => axios.post(`/api/ecommerce/marketing/content/${c.id}/review`, { status: 'rejected' }), 'Rascunho rejeitado; o histórico foi preservado.')}>Rejeitar rascunho</button></div>}
      </li>; })}</ul>}
    </div>
  </section>;
}
