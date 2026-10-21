import React, { useEffect, useId, useRef, useState } from 'react';
import axios from 'axios';

const split = value => [...new Set(String(value || '').split(/[;\n,]/).map(v => v.trim()).filter(Boolean))];
const list = values => (values || []).join('; ');

export default function SearchGuide({ source = 'edital', filters = {}, initialProfile = null, onActivate, activating = false, onCancel, onRestoreFilters, onCriteriaChange }) {
  const [description, setDescription] = useState(initialProfile?.description || '');
  const [profile, setProfile] = useState(initialProfile);
  const [itemKind, setItemKind] = useState(initialProfile?.item_kind || 'all');
  const itemKindHelpId = useId();
  const [products, setProducts] = useState([]);
  const [productIds, setProductIds] = useState(initialProfile?.product_ids || []);
  const itemKindChosen = useRef(Boolean(initialProfile?.item_kind));
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [suggestions, setSuggestions] = useState([]);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState([]);
  const [feedback, setFeedback] = useState({});
  const [exclusion, setExclusion] = useState('');
  const revision = useRef(0);
  const controller = useRef(null);
  const summaryRef = useRef(null);
  const onCriteriaChangeRef = useRef(onCriteriaChange);
  onCriteriaChangeRef.current = onCriteriaChange;
  const filterKey = JSON.stringify(filters);
  const fieldClass = 'w-full min-w-0 rounded-lg border border-line bg-bg2 px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary';
  const secondary = 'rounded-lg border border-line px-3 py-2 text-sm text-ink hover:border-primary focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50';
  const primary = 'rounded-lg bg-primary-strong px-4 py-2 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50';

  useEffect(() => {
    let ignore = false;
    axios.get('/api/licitacoes/search/guide/drafts').then(r => {
      if (!ignore) setDrafts((r.data || []).filter(d => d.source === source));
    }).catch(() => {});
    axios.get('/api/licitacoes/products').then(r => { if (!ignore) setProducts((r.data || []).filter(p => p.active && p.product_type !== 'accessory')); }).catch(() => {});
    return () => { ignore = true; revision.current++; controller.current?.abort(); };
  }, [source]);
  useEffect(() => {
    revision.current++;
    controller.current?.abort();
    setBusy('');
    setPreview(null);
    setFeedback({});
    onCriteriaChangeRef.current?.();
  }, [filterKey]);

  const invalidate = () => {
    revision.current++;
    controller.current?.abort();
    setBusy('');
    setPreview(null);
    setFeedback({});
    setError('');
    onCriteriaChangeRef.current?.();
  };
  const patchProfile = change => { invalidate(); setProfile(p => ({ ...p, ...change, confirmed_at: null })); };
  const request = async (kind, path, body, success) => {
    controller.current?.abort();
    controller.current = new AbortController();
    const current = ++revision.current;
    setBusy(kind); setError(''); setNotice('');
    try {
      const { data } = await axios.post(path, body, { signal: controller.current.signal });
      if (current === revision.current) success(data);
    } catch (e) {
      if (current === revision.current && e.code !== 'ERR_CANCELED') setError(e.response?.data?.error || 'Não foi possível concluir. Tente novamente.');
    } finally { if (current === revision.current) setBusy(''); }
  };
  const interpret = () => request('interpret', '/api/licitacoes/search/guide/interpret', { description }, data => {
    const kind = itemKindChosen.current ? itemKind : data.profile.item_kind || 'all';
    setItemKind(kind);
    setProfile({ ...data.profile, item_kind: kind, product_ids: productIds });
    setQuestions((data.questions || []).filter(q => q.id !== 'item_kind')); setAnswers({});
    setSuggestions(data.suggested_terms || []); setPreview(null); setFeedback({});
    setNotice(data.warning || 'Confira o entendimento antes de consultar a amostra.');
  });
  const pendingQuestions = questions.some(q => !answers[q.id]);
  const canPreview = profile?.terms?.length > 0 && !pendingQuestions;
  const cleanProfile = () => ({ ...profile, product_ids: productIds, terms: split(list(profile?.terms)),
    related_terms: profile?.match_mode === 'expanded' ? split(list(profile.related_terms)) : [],
    excluded_terms: split(list(profile?.excluded_terms)) });
  const getPreview = () => request('preview', '/api/licitacoes/search/guide/preview', { source, profile: cleanProfile(), filters }, data => {
    if (data.profile) setProfile(data.profile);
    setPreview(data); setFeedback({});
  });
  const saveDraft = () => request('draft', '/api/licitacoes/search/guide/drafts', {
    source, profile: profile ? cleanProfile() : { description, objective: description, terms: [description], match_mode: 'literal', item_kind: itemKind, product_ids: productIds }, filters,
  }, () => setNotice('Rascunho salvo. Nenhuma busca ou notificação foi ativada.'));
  const loadDraft = draft => {
    invalidate(); setDescription(draft.profile.description); setProfile(draft.profile);
    setItemKind(draft.profile.item_kind || 'all'); itemKindChosen.current = true;
    setProductIds(draft.profile.product_ids || []);
    setQuestions([]); setAnswers({}); setSuggestions([]);
    onRestoreFilters?.(draft.filters || {});
    setNotice('Rascunho recuperado. Confira os critérios e gere uma nova amostra.');
  };

  return <section className="space-y-4 text-ink" aria-label="Criar busca guiada">
    <div className="flex flex-wrap items-start justify-between gap-3">
      {initialProfile && <h3 className="text-base font-semibold">Revisar critérios</h3>}
      {onCancel && <button type="button" className={secondary} onClick={onCancel}>Fechar</button>}
    </div>
    {drafts.length > 0 && <label className="block text-sm">Continuar um rascunho
      <select className={`${fieldClass} mt-1`} value="" onChange={e => { const draft = drafts.find(d => String(d.id) === e.target.value); if (draft) loadDraft(draft); }}>
        <option value="">Selecione um rascunho</option>{drafts.map(d => <option key={d.id} value={d.id}>{d.profile.objective || d.profile.description}</option>)}
      </select></label>}
    <label className="block text-sm font-medium">Que oportunidades você procura?
      <textarea rows={3} className={`${fieldClass} mt-1 font-normal`} value={description}
        placeholder="Descreva produtos, serviços, marcas ou necessidades. Diga também o que não interessa."
        onChange={e => { invalidate(); setDescription(e.target.value); setProfile(null); setQuestions([]); }} />
    </label>
    <div className="space-y-2">
      <label className="block text-sm font-medium">Tipo de item<select className={`${fieldClass} mt-1 font-normal`} value={itemKind} aria-describedby={itemKindHelpId} onChange={e => {
        const kind = e.target.value;
        invalidate(); setItemKind(kind); itemKindChosen.current = true;
        setProfile(p => p ? { ...p, item_kind: kind, confirmed_at: null } : p);
      }}><option value="all">Materiais e serviços</option><option value="material">Somente materiais — excluir serviços</option><option value="service">Somente serviços</option></select></label>
      <p id={itemKindHelpId} className="text-xs text-muted">Classificação oficial do PNCP. Itens sem classificação ficam para revisão.</p>
    </div>
    {products.length > 0 && <div className="space-y-1">
      <p className="text-xs text-muted">Seleção opcional: sem marcar, todos os produtos ativos pertinentes serão comparados. Marque apenas para restringir a análise aos escolhidos.</p>
      <details className="text-sm"><summary className="cursor-pointer">Produtos para comparar · {productIds.length ? `${productIds.length} selecionados` : 'Todos os pertinentes'}</summary><fieldset className="mt-2 space-y-2"><legend className="sr-only">Produtos para análise técnica (opcional)</legend>
      <div className="flex max-h-36 flex-wrap gap-3 overflow-auto">{products.map(p => <label key={p.id} className="flex items-center gap-2"><input type="checkbox" checked={productIds.map(String).includes(String(p.id))} onChange={e => { invalidate(); setProductIds(ids => e.target.checked ? [...ids, String(p.id)] : ids.filter(id => String(id) !== String(p.id))); }} />{p.name}</label>)}</div>
    </fieldset></details></div>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={primary} disabled={!!busy || !description.trim()} onClick={interpret}>{busy === 'interpret' ? 'Interpretando…' : 'Definir minha busca'}</button>
      {!profile && <button type="button" className={secondary} disabled={!description.trim() || !!busy} onClick={() => {
        setProfile({ description, objective: description, terms: [description], related_terms: [], excluded_terms: [], match_mode: 'literal', item_kind: itemKind, product_ids: productIds });
        setNotice('Defina os termos pesquisáveis e a abrangência manualmente.');
      }}>Definir manualmente</button>}
      <button type="button" className={secondary} disabled={!description.trim() || !!busy} onClick={saveDraft}>{busy === 'draft' ? 'Salvando…' : 'Salvar rascunho'}</button>
    </div>
    {error && <p role="alert" className="text-sm text-status-danger">{error}</p>}
    {notice && <p role="status" className="text-sm text-muted">{notice}</p>}
    {profile && <>
      {questions.length > 0 && <div className="grid gap-3 sm:grid-cols-2">{questions.map(q => <label key={q.id} className="block text-sm">{q.question}
        <select className={`${fieldClass} mt-1`} value={answers[q.id] || ''} onChange={e => {
          const option = q.options.find(o => o.value === e.target.value);
          patchProfile(option?.criteria || { [q.id]: e.target.value }); setAnswers(a => ({ ...a, [q.id]: e.target.value }));
        }}><option value="">Escolha para continuar</option>{q.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      </label>)}</div>}
      <div ref={summaryRef} className="space-y-3 border-t border-line pt-4">
        <h4 className="text-sm font-semibold">O que vamos procurar</h4>
        <label className="block text-sm">Objetivo<input className={`${fieldClass} mt-1`} value={profile.objective || ''} onChange={e => patchProfile({ objective: e.target.value })} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">Abrangência<select className={`${fieldClass} mt-1`} value={profile.match_mode} onChange={e => {
            patchProfile({ match_mode: e.target.value }); setAnswers(a => ({ ...a, match_mode: e.target.value }));
          }}><option value="literal">Termos específicos</option><option value="expanded">Termos e correlatos aprovados</option></select></label>
        </div>
        <label className="block text-sm">Termos e modelos que devem entrar <span className="text-muted">(separe com ponto e vírgula)</span>
          <textarea rows={2} className={`${fieldClass} mt-1`} value={list(profile.terms)} onChange={e => patchProfile({ terms: e.target.value.split(';') })} onBlur={() => setProfile(p => ({ ...p, terms: split(list(p.terms)) }))} /></label>
        {profile.match_mode === 'expanded' && <>
          <label className="block text-sm">Correlatos autorizados<textarea rows={2} className={`${fieldClass} mt-1`} value={list(profile.related_terms)} onChange={e => patchProfile({ related_terms: e.target.value.split(';') })} /></label>
          {suggestions.filter(t => !profile.related_terms?.includes(t) && !profile.terms.includes(t)).length > 0 && <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Sugestões — adicione apenas as pertinentes:</span>{suggestions.filter(t => !profile.related_terms?.includes(t) && !profile.terms.includes(t)).map(t =>
              <button key={t} type="button" className={secondary} onClick={() => patchProfile({ related_terms: [...(profile.related_terms || []), t] })}>+ {t}</button>)}
          </div>}
        </>}
        <label className="block text-sm">O que deve ficar de fora<textarea rows={2} className={`${fieldClass} mt-1`} value={list(profile.excluded_terms)} onChange={e => patchProfile({ excluded_terms: e.target.value.split(';') })} /></label>
        <button type="button" className={primary} disabled={!canPreview || !!busy} onClick={getPreview}>{busy === 'preview' ? 'Consultando amostra…' : 'Conferir amostra real'}</button>
      </div>
      {preview && <div className="space-y-3 border-t border-line pt-4" aria-label="Amostra da busca">
        <h4 className="text-sm font-semibold">Amostra real · {preview.items.length} resultado(s)</h4>
        <p role="status" className="text-sm text-muted">{preview.warning}</p>
        {!preview.items.length && <p className="text-sm">Nenhum resultado pertinente nesta amostra. Isso não comprova ausência de oportunidades. Revise os termos ou continue para uma coleta mais ampla.</p>}
        <ul className="divide-y divide-line">{preview.items.map((item, index) => {
          const key = String(item.id || item.item_id || item.numero_controle_pncp || index);
          return <li key={key} className="space-y-2 py-3">
            <p className="text-sm font-medium">{item.titulo || item.descricao}</p>
            <p className="text-xs text-muted">{item.orgao?.nome || item.orgao_razao_social} · {source === 'pca' ? 'Planejamento (PCA)' : 'PNCP'}</p>
            <p className="text-sm"><strong>Encontrado: {item.search_quality?.term}</strong> — {item.search_quality?.snippet}</p>
            {item.search_quality?.status === 'pending_classification' && <p className="text-sm text-amber">Classificação do item não confirmada</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" aria-pressed={feedback[key] === true} className={`${secondary} ${feedback[key] === true ? 'border-primary' : ''}`} onClick={() => setFeedback(f => ({ ...f, [key]: true }))}>É o que procuro</button>
              <button type="button" aria-pressed={feedback[key] === false} className={`${secondary} ${feedback[key] === false ? 'border-amber' : ''}`} onClick={() => setFeedback(f => ({ ...f, [key]: false }))}>Fora do interesse</button>
            </div>
            {feedback[key] === false && <p className="text-sm text-muted">Defina abaixo uma expressão que diferencia esse resultado, ou revise os termos do resumo. Nenhuma exclusão será criada por suposição.</p>}
          </li>;
        })}</ul>
        {Object.values(feedback).includes(false) && <div className="space-y-2">
          <label className="block text-sm">Expressão a excluir<input className={`${fieldClass} mt-1`} value={exclusion} onChange={e => setExclusion(e.target.value)} /></label>
          <button type="button" className={secondary} disabled={!exclusion.trim()} onClick={() => {
            patchProfile({ excluded_terms: [...(profile.excluded_terms || []), exclusion.trim()] }); setExclusion(''); summaryRef.current?.scrollIntoView?.({ block: 'nearest' });
          }}>Adicionar ao resumo e refazer a amostra</button>
        </div>}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={preview.confirmed === true} onChange={e => setPreview(p => ({ ...p, confirmed: e.target.checked }))} className="mt-1" />Os critérios acima representam o que procuro.</label>
        <button type="button" className={primary} disabled={!preview.confirmed || activating || !!busy || Object.values(feedback).includes(false)} onClick={() => onActivate({ ...(preview.profile || cleanProfile()), confirmed_at: new Date().toISOString() })}>
          {activating ? 'Ativando…' : initialProfile ? 'Salvar critérios confirmados' : source === 'pca' ? 'Aplicar busca de PCA' : 'Ativar busca de editais'}
        </button>
      </div>}
    </>}
  </section>;
}
