import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';

const money = value => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const labels = { full: 'Atende plenamente', uncertain: '? — Verificar', failed: 'Não atende' };
const rowLabels = { ok: 'Atende', nao_ok: 'Não atende', verificar: '?' };
const cache = new Map();
function load(key, request) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.at < 15000) return entry.promise;
  const promise = request().then(r => r.data).catch(e => { cache.delete(key); throw e; });
  cache.set(key, { at: Date.now(), promise }); return promise;
}
function Evidence({ fact }) {
  return <div className="mt-1 text-xs text-muted"><blockquote className="whitespace-pre-wrap border-l-2 border-line pl-2">{fact.quote}</blockquote>
    {String(fact.source_id).startsWith('package:') ? <span>Composição do pacote e complementos listados nesta análise.</span> : <a href={`/api/licitacoes/technical/sources/${encodeURIComponent(fact.source_id)}`} target="_blank" rel="noreferrer" className="text-primary underline">Fonte · {fact.location}</a>}</div>;
}
export function TechnicalItem({ item }) {
  if (!item) return <p className="text-xs text-muted">Este item ainda não tem análise técnica automática vinculada.</p>;
  if (!item.in_scope) return <p className="text-xs text-muted">Item fora do escopo desta busca e do catálogo.</p>;
  const product = item.recommended_product || item.potential_product;
  return <div className="space-y-2 text-sm">
    {product ? <p className={`font-semibold ${product.status === 'full' ? 'text-status-success' : 'text-ink'}`}>
      {product.product_name} · {labels[product.status]} · {money(product.sale_price)}
    </p> : <p className="text-muted">Nenhum produto com atendimento comprovado para este item.</p>}
    {item.products?.map(p => <details key={p.product_id} className="border-t border-line pt-2">
      <summary className="cursor-pointer text-xs font-semibold">{p.product_name} · {labels[p.status]} · {p.counts.ok}/{p.counts.total} exigências comprovadas · {money(p.sale_price)}</summary>
      {!!p.configuration?.additions?.length && <div className="my-2 rounded-lg bg-bg2 p-3 text-xs"><p className="font-semibold">Configuração para este edital</p><p>Pacote original: {money(p.configuration.base_price)}</p><ul>{p.configuration.additions.map(a => <li key={a.product_id}>{a.quantity} × {a.name} · {money(a.unit_price * a.quantity)}</li>)}</ul><p className="mt-1 font-semibold">Total com complementos: {money(p.sale_price)}</p></div>}
      {p.configuration?.missing?.map((note, i) => <p key={i} className="my-1 text-xs text-status-warning">{note}</p>)}
      <p className="my-2 text-xs text-muted">{p.price_comparison ? `Referência unitária: ${money(p.price_comparison.reference)} · ${p.price_comparison.relation === 'below' ? 'abaixo da referência' : p.price_comparison.relation === 'above' ? 'acima da referência' : 'igual à referência'}` : 'Preço sem comparação segura: confira unidade, composição e referência.'}</p>
      <ol className="space-y-3">{p.requirements.map(r => <li key={r.requirement.id} className="border-l-2 border-line pl-3">
        <p className="text-xs font-medium">{rowLabels[r.status]} · {r.requirement.label}</p><p className="text-xs text-muted">{r.reason}</p>
        <Evidence fact={r.requirement} />{r.evidence.map(f => <Evidence key={f.id} fact={f} />)}
      </li>)}</ol>
    </details>)}
    {!item.products?.length && <p className="text-xs text-muted">{item.requirements?.length || 0} exigências extraídas. Cadastre uma ficha de produto pertinente para comparar.</p>}
  </div>;
}
export default function TechnicalResult({ item, profile = {}, opportunityId, itemNumber, expanded = false }) {
  const [analysis, setAnalysis] = useState(null), [enabled, setEnabled] = useState(false), [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const key = opportunityId ? `opportunity:${opportunityId}` : JSON.stringify([item?.numero_controle_pncp || item?.id || item?.url, item?.technical_analysis_id, item?.score, item?.data_atualizacao_pncp, profile]);
  const currentKey = useRef(key);
  useEffect(() => {
    let ignore = false; let timer;
    currentKey.current = key;
    setAnalysis(null); setError(''); setDetailError('');
    const refresh = () => {
      load(key, () => opportunityId ? axios.get(`/api/licitacoes/opportunities/${opportunityId}/technical`) : axios.post('/api/licitacoes/technical/notice', { item, profile, summary: true }))
        .then(data => { if (ignore) return; setAnalysis(data.analysis); setEnabled(data.enabled); if (data.analysis) timer = setTimeout(refresh, ['queued', 'running'].includes(data.analysis.status) ? 20000 : 60000); })
        .catch(e => { if (!ignore) setError(e.response?.data?.error || 'Análise técnica indisponível.'); });
    };
    refresh(); return () => { ignore = true; currentKey.current = null; clearTimeout(timer); };
    // key includes the procurement identity and reviewed search profile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (error) return <p className="mt-2 text-xs text-muted">{error}</p>;
  if (!analysis) return opportunityId ? null : <p className="mt-2 text-xs text-muted">{enabled ? 'Análise automática: aguardando elegibilidade e catálogo.' : 'Análise automática configurável em Licitações → Produtos.'}</p>;
  if (!analysis.result) return <p className="mt-2 text-xs text-muted">Análise técnica · {analysis.stage_label}{analysis.error ? ` · ${analysis.error}` : ''}</p>;
  const result = analysis.result;
  const loadDetails = async () => {
    if (!analysis.summary_only) return;
    const expectedKey = key;
    setDetailError('');
    try { const { data } = await axios.get(`/api/licitacoes/technical/jobs/${analysis.id}`); if (currentKey.current === expectedKey) setAnalysis(data); }
    catch { if (currentKey.current === expectedKey) setDetailError('Não foi possível carregar as evidências. Feche e abra a análise para tentar novamente.'); }
  };
  if (itemNumber != null) return <div className="my-2 rounded-lg border border-line p-3"><TechnicalItem item={result.items.find(i => String(i.number) === String(itemNumber))} /></div>;
  const names = [...new Set(result.items.filter(i => i.in_scope && i.recommended_product).map(i => i.recommended_product.product_name))];
  return <details open={expanded || undefined} className="mt-2 text-xs text-ink" onClick={e => e.stopPropagation()} onToggle={event => { if (event.currentTarget.open) loadDetails(); }}>
    <summary className="cursor-pointer space-y-1 rounded focus-visible:ring-2 focus-visible:ring-primary">
      <span className={`inline-block rounded-md border px-2 py-1 font-semibold ${result.full_items > 0 ? 'border-status-success/40 text-status-success' : 'border-line text-muted'}`}>
        {result.full_items}/{result.relevant_items} itens pertinentes atendidos plenamente{names.length ? ` · ${names.join(', ')}` : ''}
      </span>
      <span className="block text-muted">Nota {result.score} · base {result.base_score} + técnica {result.technical_bonus} + preço {result.commercial_bonus}</span>
      {analysis.updated_at && <span className="block text-muted">Verificação: {new Date(analysis.updated_at).toLocaleString('pt-BR')}</span>}
    </summary>
    <div className="mt-2 space-y-3 border-l-2 border-line pl-3">
      {analysis.summary_only ? <p className="text-muted">{detailError || 'Carregando exigências e evidências…'}</p> : <>
      {!result.documents_complete && <p className="text-status-warning">Documentação incompleta. Atendimento pleno não confirmado.</p>}
      {result.notes?.map((note, i) => <p key={i} className="text-muted">{note}</p>)}
      {result.items.map(i => <div key={i.number} className="space-y-1"><h5 className="font-semibold">Item {i.number} · {i.description}</h5><TechnicalItem item={i} /></div>)}
      <p className="text-muted">Atendimento técnico não substitui a revisão das condições jurídicas e comerciais do edital.</p>
      </>}
    </div>
  </details>;
}
