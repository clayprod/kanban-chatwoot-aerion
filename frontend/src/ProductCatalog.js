import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
const endpoint = '/api/licitacoes';
const field = 'w-full rounded-lg border border-line bg-bg2 px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:ring-2 focus-visible:ring-primary';
const button = 'rounded-lg border border-line px-3 py-2 text-sm text-ink disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary';
const primary = `${button} bg-primary-strong text-white font-semibold`;
const blank = { name: '', model: '', category: '', description: '', keywords: [], sale_price: '', unit: 'un', composition: '', package_confirmed: false, active: true, price_basis: 'sale' };
const statusLabel = { queued: 'Na fila', running: 'Processando', completed: 'Concluída', partial: 'Parcial', failed: 'Falhou' };
export default function ProductCatalog() {
  const [products, setProducts] = useState([]), [selected, setSelected] = useState(null), [form, setForm] = useState(blank);
  const [config, setConfig] = useState(null), [usage, setUsage] = useState({}), [jobs, setJobs] = useState([]);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [source, setSource] = useState({ url: '', text: '' });
  const [specs, setSpecs] = useState([]), [complete, setComplete] = useState(false), [jobFilter, setJobFilter] = useState('');
  const refresh = useCallback(async () => {
    const [p, c, j] = await Promise.all([axios.get(`${endpoint}/products`), axios.get(`${endpoint}/technical/config`), axios.get(`${endpoint}/technical/jobs`)]);
    setProducts(p.data); setUsage(c.data.usage); setConfig(current => current || c.data.config); setJobs(j.data);
  }, []);
  useEffect(() => { let ignore = false; const run = () => refresh().catch(e => { if (!ignore) setError(e.response?.data?.error || 'Não foi possível carregar o catálogo.'); }); run(); const timer = setInterval(run, 30000); return () => { ignore = true; clearInterval(timer); }; }, [refresh]);
  const action = async fn => { setBusy(true); setError(''); setNotice(''); try { await fn(); await refresh(); } catch (e) { setError(e.response?.data?.error || e.message || 'Não foi possível salvar.'); } finally { setBusy(false); } };
  const choose = p => { setSelected(p?.id || null); setForm(p ? { ...p } : { ...blank }); setSpecs(p?.specs || []); setComplete(p?.specs_complete === true); setSource({ url: '', text: '' }); setError(''); setNotice(''); };
  const update = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const save = event => { event.preventDefault(); action(async () => { const { data } = await axios[selected ? 'put' : 'post'](`${endpoint}/products${selected ? `/${selected}` : ''}`, form); choose(data); setNotice('Produto salvo.'); }); };
  const attach = input => action(async () => { await axios.post(`${endpoint}/products/${selected}/sources`, input); setSource({ url: '', text: '' }); setNotice('Fonte salva. A leitura foi enfileirada.'); });
  const upload = event => { const file = event.target.files?.[0]; if (!file) return; event.target.value = ''; if (file.size > 20 * 1024 * 1024) { setError('O arquivo deve ter até 20 MB.'); return; } const reader = new FileReader(); reader.onload = () => attach({ name: file.name, content_type: file.type, base64: String(reader.result).split(',')[1] }); reader.onerror = () => setError('Não foi possível ler o arquivo.'); reader.readAsDataURL(file); };
  const current = products.find(p => String(p.id) === String(selected));
  return <div className="space-y-6 text-ink">
    <header><h2 className="text-xl font-semibold">Produtos e análise técnica</h2><p className="mt-1 max-w-3xl text-sm text-muted">Cadastre produtos e kits com suas fichas. O sistema compara as exigências dos editais pertinentes com evidências e validação de números.</p></header>
    {error && <p role="alert" className="rounded-lg border border-status-danger/30 p-3 text-sm text-status-danger">{error}</p>}
    {notice && <p role="status" className="text-sm text-ink">{notice}</p>}
    {config && <section className="space-y-3 border-b border-line pb-5" aria-label="Automação da análise técnica">
      <h3 className="font-semibold">Automação</h3>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.enabled} onChange={e => setConfig(c => ({ ...c, enabled: e.target.checked }))} />Analisar automaticamente editais qualificados, incluindo os atuais ainda abertos</label>
      <div className="grid gap-3 sm:grid-cols-3">{[['min_score', 'Nota mínima', 0, 100], ['daily_limit', 'Licitações por dia', 1, 1000], ['daily_tokens', 'Teto de tokens por dia', 10000, 100000000]].map(([key, label, min, max]) => <label key={key} className="text-sm">{label}<input type="number" min={min} max={max} className={`${field} mt-1`} value={config[key]} onChange={e => setConfig(c => ({ ...c, [key]: Number(e.target.value) }))} /></label>)}</div>
      <p className="text-xs text-muted">Hoje: {usage.notices || 0}/{config.daily_limit} licitações iniciadas · {Number(usage.tokens || 0).toLocaleString('pt-BR')}/{Number(config.daily_tokens).toLocaleString('pt-BR')} tokens reservados · {usage.calls || 0} chamadas. Reservas conservadoras também cobrem tentativas que falharam.</p>
      <button className={primary} disabled={busy} onClick={() => action(async () => { await axios.put(`${endpoint}/technical/config`, config); setNotice(config.enabled ? 'Automação ativada.' : 'Automação pausada.'); })}>Salvar automação</button>
    </section>}
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(220px,1fr)_minmax(0,3fr)]">
      <aside className="space-y-3"><button className={primary} onClick={() => choose(null)}>Cadastrar produto ou kit</button>
        <ul className="divide-y divide-line">{products.map(p => <li key={p.id}><button className={`w-full rounded-lg px-2 py-3 text-left text-sm ${String(selected) === String(p.id) ? 'bg-primary/10' : ''}`} onClick={() => choose(p)}>
          <span className="block font-semibold">{p.name}{!p.active ? ' · Inativo' : ''}</span><span className="text-xs text-muted">{Number(p.sale_price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} / {p.unit} · {p.specs_complete ? 'Ficha processada' : statusLabel[p.processing?.status] || 'Sem ficha completa'}</span>
        </button></li>)}</ul>{!products.length && <p className="text-sm text-muted">Comece com um produto, seu preço unitário e a ficha da variante correta.</p>}
      </aside>
      <div className="min-w-0 space-y-5">
        <form className="space-y-3" onSubmit={save}>
          <h3 className="font-semibold">{selected ? 'Editar produto ou kit' : 'Novo produto ou kit'}</h3>
          <div className="grid gap-3 sm:grid-cols-2">{[['name', 'Nome', true], ['model', 'Modelo / variante'], ['category', 'Categoria'], ['unit', 'Unidade comercial']].map(([key, label, required]) => <label key={key} className="text-sm">{label}<input className={`${field} mt-1`} required={required} value={form[key]} onChange={e => update(key, e.target.value)} /></label>)}
            <label className="text-sm">Preço de venda unitário (R$)<input type="number" step="0.01" min="0.01" required className={`${field} mt-1`} value={form.sale_price} onChange={e => update('sale_price', e.target.value)} /></label>
            <label className="text-sm">Origem do preço<select className={`${field} mt-1`} value={form.price_basis} onChange={e => update('price_basis', e.target.value)}><option value="sale">Preço de venda</option><option value="distribution">Preço de distribuição</option></select></label>
          </div>
          <label className="block text-sm">Termos que identificam este produto nos itens<input className={`${field} mt-1`} placeholder="Separe com ponto e vírgula" value={form.keywords.join('; ')} onChange={e => update('keywords', e.target.value.split(';').map(v => v.trim()))} /></label>
          <label className="block text-sm">Descrição<textarea className={`${field} mt-1`} rows={2} value={form.description} onChange={e => update('description', e.target.value)} /></label>
          <label className="block text-sm">Composição incluída no preço<textarea className={`${field} mt-1`} rows={3} placeholder="Produto, quantidades de baterias, acessórios, módulos e garantias incluídos" value={form.composition} onChange={e => update('composition', e.target.value)} /></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={form.package_confirmed} onChange={e => update('package_confirmed', e.target.checked)} />A composição e o preço correspondem à unidade comercial informada.</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={e => update('active', e.target.checked)} />Produto ativo nas comparações</label>
          <button className={primary} disabled={busy} type="submit">Salvar produto</button>
        </form>
        {selected && <section className="space-y-3 border-t border-line pt-4" aria-label="Fichas técnicas do produto">
          <h3 className="font-semibold">Fichas técnicas e fontes</h3><p className="text-xs text-muted">Use documentos da variante e composição cadastradas. Acessórios opcionais não contam como incluídos.</p>
          <label className="block text-sm">Enviar PDF ou Word (até 20 MB)<input type="file" accept=".pdf,.doc,.docx" className={`${field} mt-1`} onChange={upload} disabled={busy} /></label>
          <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-sm">Link público da ficha ou página<input className={`${field} mt-1`} type="url" value={source.url} onChange={e => setSource(s => ({ ...s, url: e.target.value }))} /></label><button className={button} disabled={busy || !source.url} onClick={() => attach({ url: source.url })}>Salvar link e ler</button></div>
          <label className="block text-sm">Ou colar ficha técnica<textarea className={`${field} mt-1`} rows={4} value={source.text} onChange={e => setSource(s => ({ ...s, text: e.target.value }))} /></label>
          <button className={button} disabled={busy || !source.text.trim()} onClick={() => attach({ name: `${form.name} — ficha.txt`, text: source.text })}>Salvar texto e ler</button>
          <ul className="space-y-2">{current?.sources?.map(s => <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-xs"><a href={`${endpoint}/technical/sources/${s.id}`} target="_blank" rel="noreferrer" className="text-primary underline">{s.name}</a><span className="text-muted">{s.error || (s.complete ? 'Leitura completa' : 'Pendente / parcial')}</span><button className={button} disabled={busy} onClick={() => action(async () => { await axios.delete(`${endpoint}/products/${selected}/sources/${s.id}`); setNotice('Fonte removida da versão atual. Histórico preservado.'); })}>Remover da ficha atual</button></li>)}</ul>
          {current?.processing?.error && <p className="text-xs text-status-warning">{current.processing.error}</p>}
          <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => { if (current) { setSpecs(current.specs); setComplete(current.specs_complete); } }}>Carregar especificações processadas</button><button className={button} disabled={busy} onClick={() => action(async () => { await axios.post(`${endpoint}/products/${selected}/reprocess`); setNotice('Nova extração enfileirada.'); })}>Reprocessar ficha</button></div>
          <details className="space-y-3"><summary className="cursor-pointer text-sm font-semibold">Revisar especificações ({specs.length})</summary>
            <p className="text-xs text-muted">Correções mantêm o vínculo à fonte. Para adicionar informações, cadastre uma fonte complementar.</p>
            {specs.map((s, i) => <div key={s.id || i} className="grid gap-2 border-b border-line py-3 sm:grid-cols-2">
              {['label', 'value', 'unit', 'conditions', 'quote'].map(key => <label key={key} className="text-xs">{{ label: 'Característica', value: 'Valor', unit: 'Unidade', conditions: 'Condições', quote: 'Trecho literal da fonte' }[key]}<input className={`${field} mt-1`} value={s[key] ?? ''} onChange={e => setSpecs(rows => rows.map((row, index) => index === i ? { ...row, [key]: key === 'value' && row.kind === 'numeric' ? Number(e.target.value) : e.target.value } : row))} /></label>)}
              <a href={`${endpoint}/technical/sources/${s.source_id}`} target="_blank" rel="noreferrer" className="text-xs text-primary underline">Conferir fonte · {s.location}</a>
            </div>)}
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={complete} onChange={e => setComplete(e.target.checked)} />As especificações desta variante foram revisadas e estão completas.</label>
            <button className={primary} disabled={busy || !specs.length} onClick={() => action(async () => { await axios.put(`${endpoint}/products/${selected}/specs`, { specs, complete }); setNotice('Especificações revisadas salvas.'); })}>Salvar revisão</button>
          </details>
        </section>}
      </div>
    </div>
    <section className="space-y-3 border-t border-line pt-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Fila e histórico de análises</h3><label className="text-sm">Situação<select className={`${field} mt-1`} value={jobFilter} onChange={e => setJobFilter(e.target.value)}><option value="">Todas</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      <ul className="divide-y divide-line">{jobs.filter(j => !jobFilter || j.status === jobFilter).map(j => <li key={j.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div><p className="font-medium">{j.title || (j.kind === 'product' ? `Ficha do produto #${j.target}` : 'Análise de edital')}</p><p className="text-xs text-muted">{statusLabel[j.status]} · {j.error || j.stage}</p></div>{['failed', 'partial'].includes(j.status) && <button className={button} disabled={busy} onClick={() => action(async () => { await axios.post(`${endpoint}/technical/jobs/${j.id}/retry`); setNotice('Análise reenfileirada dentro dos limites da conta.'); })}>Tentar novamente</button>}</li>)}</ul>
    </section>
  </div>;
}
