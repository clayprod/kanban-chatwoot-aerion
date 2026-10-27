import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import TechnicalChecklist from './TechnicalChecklist';
import {useObjection,adjustedCompatibility} from './ObjectionContext';
import {useRequirementReviews} from './RequirementReviews';
import {technicalResultCache as cache,loadTechnicalResult as load} from './technicalResultCache';

const money = value => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const labels = { full: 'Atende plenamente', uncertain: '? — Verificar', failed: 'Não atende' };
const rowLabels = { ok: 'Atende', nao_ok: 'Não atende', verificar: '?' };

function Evidence({ fact }) {
  return <div className="mt-1 text-xs text-muted"><blockquote className="whitespace-pre-wrap border-l-2 border-line pl-2">{fact.quote}</blockquote>
    {String(fact.source_id).startsWith('package:') ? <span>Composição do pacote e complementos listados nesta análise.</span> : <a href={`/api/licitacoes/technical/sources/${encodeURIComponent(fact.source_id)}`} target="_blank" rel="noreferrer" className="text-primary underline">Fonte · {fact.location}</a>}</div>;
}
export function ProductMatchSummary({ items = [], onSelect, documentsComplete, compact = false }) {
  const relevant = items.filter(i => i.in_scope);
  return <span className="block space-y-3">
    <span className="block text-xs font-semibold text-ink">Compatibilidade com seus produtos</span>
    {relevant.slice(0, 3).map(item => {
      const matches = (item.product_matches || item.products || []).map(p => (item.documents_complete ?? documentsComplete) === false && p.status === 'full' ? { ...p, status: 'uncertain' } : p);
      const displayed = matches.slice(0, compact ? 1 : 3);
      return <span key={item.number} className="block space-y-2">
        <span className="block truncate text-xs text-muted" title={item.description}>Item {item.number}{item.description ? ` · ${item.description}` : ''}</span>
        {displayed.map(p => {
          const total = Number(p.counts?.total), ok = Number(p.counts?.ok);
          const percent = p.evidence_current !== false && total > 0 && Number.isFinite(ok) ? Math.max(0, Math.min(100, Math.floor(ok / total * 100))) : null;
          const fullMatch = p.status === 'full';
          return <button key={p.product_id} type="button" onClick={() => onSelect?.(item.number, p.product_id)} aria-label={`Comparar ${p.product_name} no item ${item.number}`} className={`block w-full rounded-lg border px-3 py-2 text-left focus-visible:ring-2 focus-visible:ring-primary ${fullMatch ? 'border-status-success/40 bg-status-success/5 hover:bg-status-success/10' : 'border-line bg-bg2/40 hover:border-primary'}`}>
            <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <span className="min-w-0 text-xs font-semibold text-ink">{p.product_name}</span>
              <span className={`text-xs font-semibold tabular-nums ${fullMatch ? 'text-status-success' : p.status === 'failed' ? 'text-status-danger' : 'text-muted'}`}>{percent === null ? 'Sem percentual' : `${percent}% comprovado`} · {labels[p.status] || 'Verificar'}</span>
            </span>
            {percent !== null && <span className="mt-2 block h-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-label={`${p.product_name}, item ${item.number}: exigências comprovadas`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <span className={`block h-full rounded-full ${fullMatch ? 'bg-status-success' : p.status === 'failed' ? 'bg-status-danger' : 'bg-primary'}`} style={{ width: `${percent}%` }} />
            </span>}
            <span className="mt-1 block text-[11px] text-muted">{p.evidence_current === false ? 'Evidências em atualização; aguarde a reanálise.' : <>{total > 0 ? `${p.counts.ok}/${p.counts.total} exigências comprovadas` : 'Exigências ainda não quantificadas'}{Number(p.counts?.verificar) > 0 ? ` · ${p.counts.verificar} a verificar` : ''}{Number(p.counts?.nao_ok) > 0 ? ` · ${p.counts.nao_ok} não atendidas` : ''}</>}</span>
            <span className="mt-1 block text-[11px] text-muted">Pacote para este item: {Number(p.sale_price) > 0 ? money(p.sale_price) : 'Preço a confirmar'}</span>
          </button>;
        })}
        {matches.length > displayed.length && !compact && <span className="block text-[11px] text-muted">+ {matches.length - displayed.length} produtos na análise detalhada</span>}
        {!compact && <span className="block text-[11px] text-muted">{matches.length} produto{matches.length === 1 ? '' : 's'} comparado{matches.length === 1 ? '' : 's'} de {item.candidate_count ?? matches.length} candidatos. Ordem: compatibilidade, depois preço.</span>}
        {!displayed.length && <span className="block text-xs text-muted">Nenhum produto comparado para este item.</span>}
      </span>;
    })}
    {relevant.length > 3 && <button type="button" className="text-xs font-semibold text-primary underline" onClick={() => onSelect?.(relevant[3].number, null)}>Ver os outros {relevant.length - 3} itens</button>}
    {documentsComplete === false && <span className="block text-xs text-status-warning">Leitura incompleta: os percentuais consideram apenas as exigências já extraídas.</span>}
    <span className="block text-[11px] font-normal text-muted">Percentual de exigências técnicas comprovadas por item. Clique no produto para comparar.</span>
  </span>;
}
export function ProductMatchChips({ items = [], onSelect, documentsComplete }) {
  const matches = items.filter(i => i.in_scope).map(i => ({ item: i, product: (i.product_matches || i.products || [])[0] })).filter(p => p.product);
  return <div className="mt-2 flex flex-wrap gap-1.5" onClick={e => e.stopPropagation()}>
    {matches.slice(0,3).map(({item,product:p}) => {
      const percent = p.evidence_current !== false && p.counts?.total > 0 ? Math.floor(p.counts.ok / p.counts.total * 100) : null;
      const full = p.status === 'full' && (item.documents_complete ?? documentsComplete) !== false;
      return <button key={item.number} type="button" aria-label={`Comparar ${p.product_name} no item ${item.number}`} title={`Item ${item.number} · ${labels[full ? 'full' : p.status === 'failed' ? 'failed' : 'uncertain']} · Ver comparação`} onClick={() => onSelect?.(item.number,p.product_id)} className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] focus-visible:ring-2 focus-visible:ring-primary ${full ? 'border-status-success/30 bg-status-success/5 text-status-success' : 'border-line bg-bg2 text-muted hover:border-primary hover:text-ink'}`}>
        <span className="shrink-0 text-muted">Item {item.number}</span><span className="truncate font-medium">{p.product_name}</span><span className="shrink-0 font-semibold tabular-nums">{percent == null ? '?' : `${percent}%`}</span>
      </button>;
    })}
  </div>;
}
export function ItemCompatibilitySummary({ item, documentsComplete,highlightProductId }) {
  const objection=useObjection();
  const manual=useRequirementReviews();
  const product = item?.products?.find(p=>String(p.product_id)===String(highlightProductId)) || item?.recommended_product || item?.potential_product || item?.products?.[0] || item?.product_matches?.[0];
  if (!product) return <span className="mt-1 block text-xs font-normal text-muted">Compatibilidade: aguardando análise</span>;
  const current = product.evidence_current !== false;
  const overrides=manual?.forProduct(item.number,product.product_id) || {},rows=(product.requirements || []).map(r=>({...r,status:overrides[r.requirement.id] || r.status}));
  const scenario=adjustedCompatibility(rows,id=>objection?.isSelected(item.number,id));
  const full = current && !scenario.excluded && (product.status === 'full'||product.specs_complete===true&&rows.length>0&&rows.every(r=>r.status==='ok')) && (item.documents_complete ?? documentsComplete) !== false;
  const status = full ? 'full' : current && (rows.length?rows.some(r=>r.status==='nao_ok'):product.status==='failed') ? 'failed' : 'uncertain';
  const percent = current && rows.length ? Math.floor(100*rows.filter(r=>r.status==='ok').length/rows.length) : current && product.counts?.total > 0 ? Math.floor(product.counts.ok / product.counts.total * 100) : null;
  const manuallyReviewed=Object.keys(overrides).length>0||product.manual_reviews>0;
  return <span className={`mt-1 inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2 py-1 text-xs ${full ? 'border-status-success/40 bg-status-success/5 text-status-success font-semibold' : 'border-line text-muted font-normal'}`}>
    <span>{product.product_name}</span><span className="font-semibold tabular-nums">{scenario.excluded?(scenario.percent==null?'Sem requisitos restantes':`${scenario.percent}% no cenário ajustado`):percent == null ? '?' : `${percent}% ${manuallyReviewed?'após revisão manual':'comprovado'}`}</span><span>{scenario.excluded?`${scenario.excluded} impugnado(s)`:labels[status]}</span>
  </span>;
}
export function ExtractionCoverage({ analysis, result }) {
  const coverage=result?.coverage;
  if(!coverage)return null;
  return <div className="space-y-2 border-b border-line pb-3">
    <p className="font-semibold text-ink">Cobertura das exigências</p>
    <dl className="flex flex-wrap gap-x-6 gap-y-2 text-muted">
      <div><dt>Trechos validados</dt><dd className="font-semibold text-ink">{coverage.complete}/{coverage.chunks}</dd></div>
      {coverage.blocks != null && <div><dt>Blocos conferidos</dt><dd className="font-semibold text-ink">{coverage.audited_blocks}/{coverage.blocks}</dd></div>}
      {coverage.requirements != null && <div><dt>Exigências identificadas</dt><dd className="font-semibold text-ink">{coverage.requirements}</dd></div>}
      {coverage.comparisons != null && <div><dt>Comparações técnicas realizadas</dt><dd className="font-semibold text-ink">{coverage.comparisons}</dd></div>}
    </dl>
    {coverage.read_complete===true ? <p className={result.documents_complete ? 'text-muted':'text-status-warning'}>{result.documents_complete ? 'Leitura e cobertura dos documentos conferidas. O atendimento depende das evidências de cada requisito.' : result.document_coverage?.blockers?.[0]?.message || 'Leitura dos documentos conferida. Há divergências que precisam de revisão; veja os trechos de origem.'}</p>
        : <p role="status" className="text-status-warning">{analysisLabel(analysis)}. Há trechos sem cobertura confirmada; as comparações disponíveis são parciais.</p>}
  </div>;
}
export function TechnicalItem(props) { return <TechnicalChecklist {...props} />; }
export function analysisLabel(analysis) {
  if (!analysis) return 'Compatibilidade ainda não analisada';
  if (analysis.execution_status === 'paused') return 'Análise pausada';
  if (analysis.execution_status === 'blocked') return 'Análise bloqueada — provedor de IA indisponível';
  if (analysis.execution_status === 'waiting') return 'Análise aguardando retomada';
  if (analysis.stage === 'review_stale') return 'Documentos alterados — revisão desatualizada';
  if (analysis.stage === 'reviewed') return analysis.result?.documents_complete ? 'Exigências conferidas' : 'Exigências conferidas — pendências identificadas';
  if (analysis.status === 'failed') return 'Falha na análise';
  if (analysis.status === 'partial') return 'Leitura parcial — revisão necessária';
  if (analysis.status === 'queued') return 'Análise na fila';
  if (analysis.status === 'running') return analysis.stage_label || 'Análise em andamento';
  return analysis.stage_label || 'Sem comparação concluída';
}
export default function TechnicalResult({ item, profile = {}, opportunityId, itemNumber, highlightProductId, expanded = false, onOpenMatch, onChecklistChange, compact = false, overview = false, allowedItemNumbers, itemSummary = false }) {
  const objection=useObjection(),registerObjectionAnalysis=objection?.registerAnalysis;
  const manualReviews=useRequirementReviews(),registerManualAnalysis=manualReviews?.registerAnalysis;
  const [analysis, setAnalysis] = useState(null), [enabled, setEnabled] = useState(false), [error, setError] = useState('');
  useEffect(()=>{if(analysis)registerObjectionAnalysis?.(analysis);},[analysis,registerObjectionAnalysis]);
  useEffect(()=>{if(analysis)registerManualAnalysis?.(analysis);},[analysis,registerManualAnalysis]);
  const [detailError, setDetailError] = useState('');
  const [fetching, setFetching] = useState(true);
  const [selection, setSelection] = useState(null);
  const detailsRef = useRef(null);
  const detailLoad = useRef(null);
  const key = opportunityId ? `opportunity:${opportunityId}` : JSON.stringify([item?.numero_controle_pncp || item?.id || item?.url, item?.technical_analysis_id, item?.score, item?.data_atualizacao_pncp, profile, itemNumber == null && !overview ? 'summary' : 'full']);
  const currentKey = useRef(key);
  useEffect(() => {
    let ignore = false; let timer;
    currentKey.current = key;
    setAnalysis(null); setError(''); setDetailError(''); setSelection(null); setFetching(true);
    const refresh = () => {
      load(key, () => opportunityId ? axios.get(`/api/licitacoes/opportunities/${opportunityId}/technical`) : axios.post('/api/licitacoes/technical/notice', { item, profile, summary: itemNumber == null && !overview }))
        .then(data => { if (ignore) return; setFetching(false); setAnalysis(data.analysis); setEnabled(data.enabled); if (data.analysis) timer = setTimeout(refresh, ['queued', 'running'].includes(data.analysis.status) ? 20000 : 60000); })
        .catch(e => { if (!ignore) { setFetching(false); setError(e.response?.data?.error || 'Análise técnica indisponível.'); } });
    };
    refresh(); return () => { ignore = true; currentKey.current = null; clearTimeout(timer); };
    // key includes the procurement identity and reviewed search profile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (error) return compact ? null : itemSummary ? <span className="mt-1 block text-xs font-normal text-muted">Comparação temporariamente indisponível</span> : <p className="mt-2 text-xs text-muted">{error}</p>;
  if (fetching && !analysis) return compact ? null : itemSummary ? <span className="mt-1 block text-xs font-normal text-muted">Consultando compatibilidade…</span> : <p role="status" className="mt-2 text-xs text-muted">Carregando análise técnica…</p>;
  if (itemSummary && !analysis?.result) return <span className="mt-1 block text-xs font-normal text-muted">{analysisLabel(analysis)}</span>;
  if (!analysis) return opportunityId || compact ? null : <p className="mt-2 text-xs text-muted">{enabled ? 'Análise automática: aguardando elegibilidade e catálogo.' : 'Análise automática configurável em Licitações → Produtos.'}</p>;
  if (compact && !analysis.result) return <span className="mt-2 inline-flex rounded-full border border-line px-2.5 py-1 text-[11px] text-muted">{analysisLabel(analysis)}</span>;
  if (!analysis.result) return <div className="mt-3 space-y-1 text-xs" role="status"><p className="font-semibold text-ink">{analysisLabel(analysis)}</p>{analysis.error && <p className="text-muted">{analysis.error}</p>}<p className="text-muted">A comparação deste item ainda não está disponível.</p></div>;
  const visibleItems = allowedItemNumbers ? analysis.result.items.filter(i => allowedItemNumbers.map(String).includes(String(i.number))) : analysis.result.items;
  const result = { ...analysis.result, items: visibleItems,
    ...(allowedItemNumbers ? { relevant_items: visibleItems.filter(i=>i.in_scope).length, full_items: visibleItems.filter(i=>i.in_scope && (i.recommended_product || i.products?.some(p=>p.status==='full'))).length } : {}) };
  if (itemSummary) return <ItemCompatibilitySummary item={result.items.find(i=>String(i.number)===String(itemNumber))} documentsComplete={result.documents_complete} highlightProductId={highlightProductId} />;
  const compareMore = async number => {
    setDetailError('');
    try {
      await axios.post(`/api/licitacoes/technical/jobs/${analysis.id}/more`, { item_number: number });
      cache.clear();
      const { data } = await axios.get(`/api/licitacoes/technical/jobs/${analysis.id}`);
      if (currentKey.current === key) setAnalysis(data);
    } catch (e) { if (currentKey.current === key) setDetailError(e.response?.data?.error || 'Não foi possível solicitar a comparação.'); }
  };
  const loadDetails = async () => {
    if (!analysis.summary_only) return;
    if (detailLoad.current?.key === key) return detailLoad.current.promise;
    const expectedKey = key;
    setDetailError('');
    const promise = (async () => {
      try { const { data } = await axios.get(`/api/licitacoes/technical/jobs/${analysis.id}`); if (currentKey.current === expectedKey) setAnalysis(data); }
      catch { if (currentKey.current === expectedKey) setDetailError('Não foi possível carregar as evidências. Feche e abra a análise para tentar novamente.'); }
      finally { if (detailLoad.current?.key === expectedKey) detailLoad.current = null; }
    })();
    detailLoad.current = { key, promise };
    return promise;
  };
  const selectMatch = async (number, productId) => {
    if (onOpenMatch) { onOpenMatch(number, productId); return; }
    const expectedKey = key;
    setSelection({ number: String(number), productId: productId == null ? null : String(productId) });
    if (detailsRef.current) detailsRef.current.open = true;
    await loadDetails();
    if (currentKey.current === expectedKey) detailsRef.current?.scrollIntoView?.({ block: 'nearest' });
  };
  if (itemNumber != null) return <div className="my-2">{detailError && <p role="alert" className="text-xs text-status-warning">{detailError}</p>}<TechnicalItem item={result.items.find(i => String(i.number) === String(itemNumber))} highlightProductId={highlightProductId} onChecklistChange={onChecklistChange?(number,choice)=>onChecklistChange(number,{...choice,analysis_id:analysis.id}):undefined} onCompareMore={result.review?undefined:compareMore} pending={['queued','running'].includes(analysis.status)} /></div>;
  if (overview) return <div role="status" className="space-y-1 text-sm text-muted"><p>{result.documents_complete ? 'Comparação disponível nos itens abaixo.' : `${analysisLabel(analysis)}. Os resultados parciais disponíveis aparecem nos itens abaixo.`}</p>{result.review && result.notes?.[0] && <p className="text-xs">{result.notes[0]}</p>}</div>;
  if (compact) return <ProductMatchChips items={result.items} onSelect={selectMatch} documentsComplete={result.documents_complete} />;
  return <div className="mt-3 space-y-3 text-xs text-ink" onClick={e => e.stopPropagation()}>
    <ProductMatchSummary items={result.items} onSelect={selectMatch} documentsComplete={result.documents_complete} />
    <details ref={detailsRef} open={expanded || undefined} onToggle={event => { if (event.currentTarget.open) loadDetails(); }}>
    <summary className="cursor-pointer space-y-1 rounded focus-visible:ring-2 focus-visible:ring-primary">
      <span className={`inline-block rounded-md border px-2 py-1 font-semibold ${result.full_items > 0 ? 'border-status-success/40 text-status-success' : 'border-line text-muted'}`}>
        Ver análise completa · {result.full_items}/{result.relevant_items} itens pertinentes atendidos plenamente
      </span>
    </summary>
    <div className="mt-2 space-y-3 border-l-2 border-line pl-3">
      <p className="text-muted">Nota {result.score} · base {result.base_score} + técnica {result.technical_bonus} + preço {result.commercial_bonus}</p>
      {analysis.updated_at && <p className="text-muted">Verificação: {new Date(analysis.updated_at).toLocaleString('pt-BR')}</p>}
      {analysis.summary_only ? <p className="text-muted">{detailError || 'Carregando exigências e evidências…'}</p> : <>
      <ExtractionCoverage analysis={analysis} result={result} />
      {!result.documents_complete && <p className="text-status-warning">Documentação incompleta. Atendimento pleno não confirmado.</p>}
      {result.coverage && <p className="text-muted">Extração: {result.coverage.processed}/{result.coverage.chunks} trechos processados · {result.coverage.complete} sem pendências.</p>}
      {!!result.sources?.length && <div className="space-y-2"><h5 className="font-semibold">Documentos utilizados</h5>{result.sources.map(s => <p key={s.id}><a href={`/api/licitacoes/technical/sources/${s.id}`} target="_blank" rel="noreferrer" className="text-primary underline">{s.name}</a> · {s.pages ?? '—'} páginas · {s.complete ? 'Leitura concluída' : 'Leitura com pendências'}{s.notes?.length ? ` · ${s.notes.join(' · ')}` : ''}</p>)}</div>}
      {!!result.notes?.length && <details><summary className="cursor-pointer text-status-warning">Pendências de leitura · {result.notes.length}</summary><div className="mt-2 space-y-2">{result.notes.map((note, i) => <p key={i} className="text-muted">{note}</p>)}</div></details>}
      {!!result.conflicts?.length && <details><summary className="cursor-pointer text-status-warning">Divergências nos documentos · {result.conflicts.length}</summary><div className="mt-2 space-y-3">{result.conflicts.map((conflict,i)=><div key={i}><p>{conflict.message}</p><Evidence fact={conflict} /></div>)}</div></details>}
      {selection && <button type="button" className="rounded border border-line px-2 py-1 text-xs focus-visible:ring-2 focus-visible:ring-primary" onClick={() => setSelection(null)}>Ver todos os itens</button>}
      {!overview && result.items.filter(i => !selection || String(i.number) === selection.number).map(i => <div key={i.number} className="space-y-1"><h5 className="font-semibold">Item {i.number} · {i.description}</h5><TechnicalItem item={i} highlightProductId={selection?.productId} onCompareMore={compareMore} pending={['queued','running'].includes(analysis.status)} /></div>)}
      <p className="text-muted">Atendimento técnico não substitui a revisão das condições jurídicas e comerciais do edital.</p>
      </>}
    </div>
  </details></div>;
}
