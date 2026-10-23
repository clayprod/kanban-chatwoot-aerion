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
export function TechnicalItem({ item, highlightProductId, onCompareMore, pending }) {
  const [visibleCount, setVisibleCount] = useState(3);
  if (!item) return <p className="text-xs text-muted">Este item ainda não tem análise técnica automática vinculada.</p>;
  if (!item.in_scope) return <p className="text-xs text-muted">Item fora do escopo desta busca e do catálogo.</p>;
  const product = item.products?.find(p => String(p.product_id) === String(highlightProductId)) || item.recommended_product || item.potential_product || item.products?.[0];
  return <div className="space-y-2 text-sm">
    {product ? <p className={`font-semibold ${product.status === 'full' ? 'text-status-success' : 'text-ink'}`}>
      {product.product_name} · {labels[product.status]} · {money(product.sale_price)}
    </p> : <p className="text-muted">Nenhum produto com atendimento comprovado para este item.</p>}
    <p className="text-xs text-muted">{item.products?.length || 0} produto{item.products?.length === 1 ? '' : 's'} comparado{item.products?.length === 1 ? '' : 's'} de {item.candidate_count ?? item.products?.length ?? 0} candidatos. Maior compatibilidade primeiro; menor preço no empate.</p>
    {item.documents_complete === false && <p className="text-xs text-status-warning">Há pendências na extração deste item. Atendimento pleno ainda não confirmado.</p>}
    {item.products?.filter(p => !highlightProductId || String(p.product_id) === String(highlightProductId)).slice(0, highlightProductId ? 1 : visibleCount).map(p => <details key={p.product_id} open={String(product?.product_id) === String(p.product_id) || undefined} className="border-t border-line pt-2">
      <summary className="cursor-pointer text-xs font-semibold">{p.product_name} · {labels[p.status]} · {p.evidence_current === false ? 'Reanálise necessária' : p.counts.total ? Math.floor(p.counts.ok / p.counts.total * 100) + '% comprovado' : 'Sem percentual'} · {money(p.sale_price)}</summary>
      {p.evidence_current === false ? <p className="my-2 text-xs text-status-warning">A ficha ou as regras mudaram. Aguarde a atualização das evidências para confirmar o atendimento.</p> : <>
      {!p.specs_complete && p.specs_complete !== undefined && <p className="my-2 text-xs text-status-warning">Ficha do produto incompleta: faltas de evidência aparecem como “?”, sem confirmar incompatibilidade.</p>}
      {!!p.configuration?.additions?.length && <div className="my-2 rounded-lg bg-bg2 p-3 text-xs"><p className="font-semibold">Configuração para este edital</p><p>Pacote original: {money(p.configuration.base_price)}</p><ul>{p.configuration.additions.map(a => <li key={a.product_id}>{a.quantity} × {a.name} · {money(a.unit_price * a.quantity)}</li>)}</ul><p className="mt-1 font-semibold">Total com complementos: {money(p.sale_price)}</p></div>}
      {p.configuration?.missing?.map((note, i) => <p key={i} className="my-1 text-xs text-status-warning">{note}</p>)}
      <p className="my-2 text-xs text-muted">{p.price_comparison ? `Referência unitária: ${money(p.price_comparison.reference)} · ${p.price_comparison.relation === 'below' ? 'abaixo da referência' : p.price_comparison.relation === 'above' ? 'acima da referência' : 'igual à referência'}` : 'Preço sem comparação segura: confira unidade, composição e referência.'}</p>
      <ol className="space-y-3">{p.requirements.map(r => <li key={r.requirement.id} className="border-l-2 border-line pl-3">
        <p className="text-xs font-medium">{rowLabels[r.status]} · {r.requirement.label}</p><p className="text-xs text-muted">{r.reason}</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2"><div className="min-w-0"><p className="text-xs font-semibold">O edital exige</p><Evidence fact={r.requirement} /></div><div className="min-w-0"><p className="text-xs font-semibold">O produto oferece</p>{r.evidence.length ? r.evidence.map(f => <Evidence key={f.id} fact={f} />) : <p className="mt-1 text-xs text-muted">Especificação não comprovada nas fontes cadastradas.</p>}</div></div>
      </li>)}</ol></>}
    </details>)}
    {!highlightProductId && (item.products?.length || 0) > visibleCount && <button type="button" className="block text-xs text-primary underline" onClick={() => setVisibleCount(n => n + 3)}>Ver mais produtos já comparados</button>}
    {item.candidate_count > (item.products?.length || 0) && onCompareMore && <button type="button" disabled={pending} onClick={() => onCompareMore(item.number)} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-primary disabled:opacity-50">{pending ? 'Comparação em andamento…' : 'Comparar mais produtos'}</button>}
    {!!item.obligations?.length && <details className="border-t border-line pt-2"><summary className="cursor-pointer text-xs font-semibold">Obrigações de fornecimento e documentação · {item.obligations.length}</summary><p className="my-2 text-xs text-muted">Conferência separada, fora do percentual técnico do produto.</p>{item.obligations.map(f => <div key={f.id} className="mb-3"><p className="text-xs font-medium">{f.label}</p><Evidence fact={f} /></div>)}</details>}
    {!item.products?.length && <p className="text-xs text-muted">{item.requirements?.length || 0} exigências extraídas. Cadastre uma ficha de produto pertinente para comparar.</p>}
  </div>;
}
export default function TechnicalResult({ item, profile = {}, opportunityId, itemNumber, highlightProductId, expanded = false, onOpenMatch, compact = false, overview = false }) {
  const [analysis, setAnalysis] = useState(null), [enabled, setEnabled] = useState(false), [error, setError] = useState('');
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
  if (error) return <p className="mt-2 text-xs text-muted">{error}</p>;
  if (fetching && !analysis) return <p role="status" className="mt-2 text-xs text-muted">Carregando análise técnica…</p>;
  if (!analysis) return opportunityId ? null : <p className="mt-2 text-xs text-muted">{enabled ? 'Análise automática: aguardando elegibilidade e catálogo.' : 'Análise automática configurável em Licitações → Produtos.'}</p>;
  if (!analysis.result) return <div className="mt-3 space-y-1 rounded-lg border border-line bg-bg2/40 px-3 py-2 text-xs"><p className="font-semibold text-ink">Compatibilidade com seus produtos</p><p className="text-muted">Análise técnica · {analysis.stage_label}{analysis.error ? ` · ${analysis.error}` : ''}</p><p className="text-[11px] text-muted">Produtos e percentuais aparecerão após a comparação das fichas com o edital.</p></div>;
  const result = analysis.result;
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
  if (itemNumber != null) return <div className="my-2 rounded-lg border border-line p-3">{detailError && <p role="alert" className="text-xs text-status-warning">{detailError}</p>}<TechnicalItem item={result.items.find(i => String(i.number) === String(itemNumber))} highlightProductId={highlightProductId} onCompareMore={compareMore} pending={['queued','running'].includes(analysis.status)} /></div>;
  if (compact) return <div className="mt-3 space-y-2 rounded-lg border border-line p-3" onClick={e => e.stopPropagation()}><ProductMatchSummary compact items={result.items} onSelect={selectMatch} documentsComplete={result.documents_complete} /></div>;
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
      {!result.documents_complete && <p className="text-status-warning">Documentação incompleta. Atendimento pleno não confirmado.</p>}
      {result.coverage && <p className="text-muted">Extração: {result.coverage.processed}/{result.coverage.chunks} trechos processados · {result.coverage.complete} sem pendências.</p>}
      {!!result.sources?.length && <div className="space-y-2"><h5 className="font-semibold">Documentos utilizados</h5>{result.sources.map(s => <p key={s.id}><a href={`/api/licitacoes/technical/sources/${s.id}`} target="_blank" rel="noreferrer" className="text-primary underline">{s.name}</a> · {s.pages ?? '—'} páginas · {s.complete ? 'Leitura concluída' : 'Leitura com pendências'}{s.notes?.length ? ` · ${s.notes.join(' · ')}` : ''}</p>)}</div>}
      {!!result.notes?.length && <details><summary className="cursor-pointer text-status-warning">Pendências de leitura · {result.notes.length}</summary><div className="mt-2 space-y-2">{result.notes.map((note, i) => <p key={i} className="text-muted">{note}</p>)}</div></details>}
      {selection && <button type="button" className="rounded border border-line px-2 py-1 text-xs focus-visible:ring-2 focus-visible:ring-primary" onClick={() => setSelection(null)}>Ver todos os itens</button>}
      {!overview && result.items.filter(i => !selection || String(i.number) === selection.number).map(i => <div key={i.number} className="space-y-1"><h5 className="font-semibold">Item {i.number} · {i.description}</h5><TechnicalItem item={i} highlightProductId={selection?.productId} onCompareMore={compareMore} pending={['queued','running'].includes(analysis.status)} /></div>)}
      <p className="text-muted">Atendimento técnico não substitui a revisão das condições jurídicas e comerciais do edital.</p>
      </>}
    </div>
  </details></div>;
}
