import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ResponsiveLine } from '@nivo/line';
import { ArrowPathIcon, ArrowTopRightOnSquareIcon, CheckCircleIcon, ChevronDownIcon, ExclamationTriangleIcon, LinkIcon } from '@heroicons/react/24/outline';
import { btnPrimary, btnSecondarySm, input, select } from './ui';

export const ECOMMERCE_SECTIONS = [
  { id: 'overview', label: 'Visão geral' }, { id: 'sales', label: 'Vendas e produtos' },
  { id: 'traffic', label: 'Tráfego e conversão' }, { id: 'campaigns', label: 'Campanhas e UTMs' },
  { id: 'coupons', label: 'Cupons' }, { id: 'ads', label: 'Mídia paga' }, { id: 'connections', label: 'Conexões' },
];
const SOURCES = { woocommerce: 'WooCommerce', ga4: 'Google Analytics 4', google_ads: 'Google Ads', meta_ads: 'Meta Ads' };
const STATE = { pending: 'Aguardando configuração', connected: 'Conectado', syncing: 'Sincronizando', error: 'Requer atenção' };
const number = value => value == null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value);
const money = value => value == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const when = value => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value)) : 'Ainda não sincronizado';
const dateLabel = value => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)) : '—';
const today = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const previousDay = (date, days) => new Date(new Date(`${date}T12:00:00Z`).getTime() - days * 86400000).toISOString().slice(0, 10);
const panel = 'rounded-xl border border-line bg-surf p-4 sm:p-5';
const labelClass = 'text-xs text-muted';
const errorText = error => error.response?.data?.error || 'Não foi possível carregar. Tente novamente.';
function Notice({ children, error = false }) {
  return <div role={error ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${error ? 'border-red/30 bg-red/5 text-ink' : 'border-line bg-bg2 text-ink'}`}>
    <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><div>{children}</div>
  </div>;
}
function Table({ caption, columns, rows, pageSize = 20, empty = 'Nenhum registro neste período.' }) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [rows]);
  const last = Math.max(0, Math.ceil(rows.length / pageSize) - 1);
  return <section className="min-w-0 rounded-xl border border-line bg-surf">
    <div className="overflow-x-auto"><table className="w-full text-left text-sm">
      <caption className="px-4 py-4 text-left text-sm font-semibold text-ink">{caption} <span className="ml-2 font-normal text-muted">{number(rows.length)} registros</span></caption>
      <thead className="border-y border-line bg-bg2 text-xs text-muted"><tr>{columns.map(c => <th scope="col" className={`whitespace-nowrap px-4 py-3 font-medium ${c.numeric ? 'text-right' : ''}`} key={c.key}>{c.label}</th>)}</tr></thead>
      <tbody className="divide-y divide-line">{rows.slice(page * pageSize, (page + 1) * pageSize).map((row, i) => <tr key={row.id || row.code || i} className="hover:bg-bg2">
        {columns.map(c => <td key={c.key} className={`max-w-[28rem] px-4 py-3 align-top ${c.numeric ? 'text-right tabular-nums' : ''}`}>{c.render ? c.render(row) : row[c.key] || '—'}</td>)}
      </tr>)}</tbody>
    </table></div>
    {!rows.length && <p className="px-4 py-8 text-sm text-muted">{empty}</p>}
    {rows.length > pageSize && <div className="flex items-center justify-between gap-3 border-t border-line p-3 text-xs text-muted">
      <span>Página {page + 1} de {last + 1}</span><div className="flex gap-2">
        <button type="button" className={btnSecondarySm} onClick={() => setPage(p => Math.max(0, p - 1))} disabled={!page}>Anterior</button>
        <button type="button" className={btnSecondarySm} onClick={() => setPage(p => Math.min(last, p + 1))} disabled={page >= last}>Próxima</button>
      </div>
    </div>}
  </section>;
}
const numeric = (key, label, format = number) => ({ key, label, numeric: true, render: row => format(row[key]) });
function grouped(rows, keys, fields) {
  const map = new Map();
  rows.forEach(row => {
    const key = JSON.stringify(keys.map(k => row[k]));
    if (!map.has(key)) map.set(key, { ...Object.fromEntries(keys.map(k => [k, row[k]])), ...Object.fromEntries(fields.map(f => [f, 0])) });
    fields.forEach(field => { map.get(key)[field] += Number(row[field]) || 0; });
  });
  return [...map.values()];
}
function SalesChart({ rows }) {
  const data = rows.filter(row => row.revenue != null).map(row => ({ x: row.date, y: row.revenue }));
  return <section className={panel} aria-label="Receita diária de produtos">
    <h3 className="text-sm font-semibold">Receita diária de produtos</h3><p className={`${labelClass} mt-1`}>WooCommerce · BRL · data do pagamento</p>
    {!data.length ? <p className="py-12 text-sm text-muted">Conecte o WooCommerce para acompanhar a evolução de vendas.</p> : <div className="h-64" role="img" aria-label="Evolução da receita diária no período selecionado">
      <ResponsiveLine data={[{ id: 'Receita', data }]} margin={{ top: 25, right: 18, bottom: 44, left: 65 }}
        xScale={{ type: 'point' }} yScale={{ type: 'linear', min: 0, max: 'auto' }} colors={['#8b78f5']}
        axisTop={null} axisRight={null} axisBottom={{ tickValues: data.filter((_, i) => i % Math.max(1, Math.ceil(data.length / 6)) === 0).map(d => d.x), format: d => dateLabel(d).slice(0, 5), tickSize: 0, tickPadding: 12 }}
        axisLeft={{ tickSize: 0, tickPadding: 10, format: n => number(n) }} enablePoints={data.length <= 31} pointSize={4}
        enableGridX={false} enableArea={false} useMesh animate={false}
        theme={{ text: { fill: '#94a3b8', fontSize: 11 }, grid: { line: { stroke: '#334155', strokeOpacity: 0.3 } }, tooltip: { container: { background: '#172033', color: '#fff', borderRadius: 8 } } }}
        tooltip={({ point }) => <span>{dateLabel(point.data.x)}: {money(point.data.y)}</span>} />
    </div>}
  </section>;
}

const FIELDS = {
  woocommerce: [
    ['url', 'Domínio da loja', 'url', 'https://loja.aerion.com.br'],
    ['consumer_key', 'Consumer Key · leitura', 'password', 'ck_…'], ['consumer_secret', 'Consumer Secret', 'password', 'cs_…'],
    ['webhook_secret', 'Segredo dos webhooks · mínimo 32 caracteres', 'password', 'Defina o mesmo segredo no WooCommerce'],
    ['report_user', 'Usuário técnico dos relatórios Aerion · opcional', 'text', 'Usuário com permissão aerion_read_reports'],
    ['report_password', 'Application Password desse usuário · opcional', 'password', 'Senha de aplicativo do WordPress'],
  ],
  ga4: [['property_id', 'ID numérico da propriedade', 'text', '123456789'], ['service_account', 'Credenciais de leitura Google (JSON)', 'textarea', 'Conta de serviço ou identidade federada configurada para a VPS']],
  google_ads: [['customer_id', 'ID da conta anunciante', 'text', '123-456-7890'], ['login_customer_id', 'ID da conta administradora · se utilizada', 'text', 'Opcional'],
    ['client_id', 'OAuth Client ID', 'text', '…apps.googleusercontent.com'], ['client_secret', 'OAuth Client Secret', 'password', 'Segredo do aplicativo Google Cloud'],
    ['service_account', 'Credenciais da conta técnica Google Ads (JSON)', 'textarea', 'Conta de serviço ou identidade federada configurada para a VPS']],
  meta_ads: [['account_id', 'ID da conta de anúncios', 'text', 'act_123456789'], ['access_token', 'Token do usuário de sistema · ads_read', 'password', 'Token com acesso de análise à conta']],
};
const HELP = {
  woocommerce: 'No WooCommerce, gere uma chave de leitura em Configurações → Avançado → API REST. Para UTMs Aerion, instale o plugin de relatórios e configure o usuário técnico abaixo.',
  ga4: 'Habilite a Analytics Data API no Google Cloud. Conceda à conta de serviço acesso de leitor à propriedade GA4. O ID da propriedade é numérico; não use o código G- da tag.',
  google_ads: 'Habilite a Google Ads API no projeto Google Cloud e obtenha acesso de produção. Use uma conta técnica com acesso Somente leitura ao anunciante ou autorize um usuário por OAuth.',
  meta_ads: 'Use um aplicativo da Aerion no Meta Business e um usuário de sistema com acesso de análise à conta de anúncios. Gere o token com ads_read. O Pixel é conferido na loja; os resultados vêm da Insights API.',
};
function ConnectionForm({ provider, connection, status, onUpdate }) {
  const [form, setForm] = useState(() => ({ ...(connection?.config || {}), enabled: connection?.enabled !== false }));
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);
  const [failure, setFailure] = useState(false);
  const technicalAccount = provider === 'google_ads' && form.auth_type === 'google_identity';
  const fields = FIELDS[provider].filter(([key]) => provider !== 'google_ads' || (key === 'service_account' ? technicalAccount : !technicalAccount || !['client_id', 'client_secret'].includes(key)));
  const action = async (kind, event) => {
    event?.preventDefault(); setBusy(kind); setMessage(null);
    try {
      if (kind === 'save') {
        await axios.put(`/api/ecommerce/connections/${provider}`, form);
        setForm(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !FIELDS[provider].some(([field, , type]) => field === key && ['password', 'textarea'].includes(type)))));
        setMessage('Conexão salva. A sincronização inicia automaticamente quando estiver ativa e autorizada.');
      } else if (kind === 'authorize') {
        const { data } = await axios.post('/api/ecommerce/connections/google_ads/authorize');
        window.location.assign(data.url); return;
      } else {
        await axios.post(`/api/ecommerce/connections/${provider}/${kind}`);
        setMessage(kind === 'test' ? 'Acesso validado com sucesso.' : 'Sincronização solicitada. Você pode acompanhar o progresso abaixo.');
      }
      setFailure(false); onUpdate();
    } catch (error) { setFailure(true); setMessage(errorText(error)); }
    finally { setBusy(''); }
  };
  return <details className={`${panel} group`}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
      <span className="flex items-center gap-2 text-sm font-semibold"><LinkIcon className="h-4 w-4" />{SOURCES[provider]}</span>
      <span className="flex items-center gap-3 text-xs text-muted">{connection?.enabled === false ? 'Desativado' : STATE[connection?.status] || 'Não configurado'}<ChevronDownIcon className="h-4 w-4 group-open:rotate-180" aria-hidden="true" /></span>
    </summary>
    <p className="mt-4 max-w-3xl text-sm text-muted">{HELP[provider]}</p>
    <form onSubmit={event => action('save', event)} className="mt-5 space-y-4" autoComplete="off">
      {provider === 'google_ads' && <label className="block space-y-1.5"><span className="text-xs font-medium text-ink">Autenticação Google Ads</span>
        <select className={select} value={form.auth_type || 'oauth'} onChange={event => setForm(p => ({ ...p, auth_type: event.target.value }))}>
          <option value="oauth">Autorizar usuário Google (OAuth)</option><option value="google_identity">Conta técnica Google</option>
        </select></label>}
      <div className="grid gap-4 lg:grid-cols-2">{fields.map(([key, label, type, placeholder]) => <label key={key} className={`block space-y-1.5 ${type === 'textarea' ? 'lg:col-span-2' : ''}`}>
        <span className="text-xs font-medium text-ink">{label}</span>
        {type === 'textarea' ? <textarea className={`${input} min-h-32 w-full py-2 font-mono text-xs`} value={form[key] || ''}
          onChange={event => setForm(p => ({ ...p, [key]: event.target.value }))} spellCheck={false} maxLength={30000}
          placeholder={connection ? 'Credencial salva. Deixe vazio para manter.' : placeholder} aria-label={label} /> :
          <input className={`${input} w-full`} type={type} value={form[key] || ''} maxLength={30000}
            onChange={event => setForm(p => ({ ...p, [key]: event.target.value }))}
            placeholder={type === 'password' && connection ? 'Salvo · deixe vazio para manter' : placeholder} autoComplete={type === 'password' ? 'new-password' : 'off'} />}
      </label>)}</div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled !== false} onChange={event => setForm(p => ({ ...p, enabled: event.target.checked }))} />Ativar sincronização automática</label>
      {provider === 'google_ads' && !technicalAccount && <p className="break-all text-xs text-muted">URI de redirecionamento para cadastrar no Google Cloud: <span className="select-all text-ink">{status.oauthRedirectUri || 'Configure ECOMMERCE_PUBLIC_URL no servidor.'}</span></p>}
      {provider === 'woocommerce' && <p className="break-all text-xs text-muted">Configure webhooks de pedido criado, atualizado e excluído para <span className="select-all text-ink">{window.location.origin}/api/ecommerce/webhooks/woocommerce</span>, usando o segredo acima.</p>}
      <div className="flex flex-wrap gap-2">
        <button className={btnPrimary} disabled={Boolean(busy) || !status.encryptionReady} type="submit">{busy === 'save' ? 'Salvando…' : 'Salvar conexão'}</button>
        {provider === 'google_ads' && !technicalAccount && <button type="button" className={btnSecondarySm} disabled={!connection || Boolean(busy) || connection?.config?.auth_type === 'google_identity' || !status.oauthRedirectUri} onClick={() => action('authorize')}>Autorizar Google Ads <ArrowTopRightOnSquareIcon className="h-4 w-4" /></button>}
        <button type="button" className={btnSecondarySm} disabled={!connection || Boolean(busy)} onClick={() => action('test')}>{busy === 'test' ? 'Testando…' : 'Testar acesso salvo'}</button>
        <button type="button" className={btnSecondarySm} disabled={!connection?.enabled || Boolean(busy)} onClick={() => action('sync')}>Sincronizar agora</button>
      </div>
      {message && (failure ? <Notice error>{message}</Notice> : <p role="status" className="flex items-center gap-2 text-sm"><CheckCircleIcon className="h-4 w-4 text-secondary" />{message}</p>)}
      {connection?.error && <Notice error>{connection.error}</Notice>}
      {connection?.info?.tracking_error && <Notice>{connection.info.tracking_error}</Notice>}
      <div className="space-y-1 border-t border-line pt-3 text-xs text-muted">
        <p>Última atualização: {when(connection?.last_success_at)}</p>
        {provider === 'woocommerce' && connection?.info?.bridge_last_success_at && <p>Última atualização de links e visitas Aerion: {when(connection.info.bridge_last_success_at)}</p>}
        {connection?.progress && <p>Importação em andamento · {connection.progress.phase} · lote {connection.progress.page}{connection.progress.from ? ` · desde ${connection.progress.from.slice(0, 10)}` : ''}</p>}
        {connection?.info?.tracking && <p>Configuração declarada da loja: GTM {connection.info.tracking.gtm_configured ? 'configurado' : 'não configurado'} · GA4 {connection.info.tracking.ga4_configured ? 'configurado' : 'não detectado'} · Pixel Meta {connection.info.tracking.meta_pixel_configured ? 'configurado' : 'não detectado'} · consentimento {connection.info.tracking.consent_api ? 'disponível' : 'não detectado'} · UTMs Aerion {connection.info.tracking.utm_available ? 'disponível' : 'não detectado'}. Tags instaladas pelo GTM e eventos reais exigem validação no navegador, DebugView e Events Manager.</p>}
        {provider === 'woocommerce' && !connection?.info?.tracking && <p>Relatórios de links Aerion dependem do plugin e das credenciais de leitura. Vendas e cupons usam a API REST do WooCommerce.</p>}
      </div>
    </form>
  </details>;
}

export default function EcommerceView({ section = 'overview', isAdmin = false, onNavigate }) {
  const [range, setRange] = useState(() => ({ from: previousDay(today(), 29), to: today() }));
  const [draftRange, setDraftRange] = useState(range);
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState({ connections: [], encryptionReady: false });
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [source, setSource] = useState('all');
  const [query, setQuery] = useState('');
  const title = ECOMMERCE_SECTIONS.find(s => s.id === section)?.label || 'Visão geral';
  const reload = useCallback(() => setRefresh(n => n + 1), []);
  useEffect(() => { setReport(null); }, [range]);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setError('');
    Promise.all([
      axios.get('/api/ecommerce/report', { params: range, signal: abort.signal }),
      axios.get('/api/ecommerce/status', { signal: abort.signal }),
    ]).then(([result, state]) => { setReport(result.data); setStatus(state.data); setStatusLoaded(true); }).catch(e => {
      if (!axios.isCancel(e)) setError(errorText(e));
    }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [range, refresh]);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 60000);
    return () => clearInterval(timer);
  }, [reload]);
  const traffic = useMemo(() => grouped((report?.traffic || []).filter(r => r.kind === 'traffic'), ['source', 'medium', 'campaign', 'content'], ['sessions', 'purchases']).sort((a, b) => b.sessions - a.sessions), [report]);
  const landings = useMemo(() => grouped((report?.traffic || []).filter(r => r.kind === 'landing'), ['landing'], ['sessions', 'purchases']).sort((a, b) => b.sessions - a.sessions), [report]);
  const funnel = useMemo(() => grouped((report?.traffic || []).filter(r => r.kind === 'funnel'), ['event'], ['events']), [report]);
  const ads = useMemo(() => grouped((report?.ads || []).filter(r => source === 'all' || r.provider === source), ['provider', 'campaignId', 'campaign', 'currency', 'timezone', 'attribution'], ['spend', 'impressions', 'clicks', 'conversions', 'conversionValue']).sort((a, b) => b.spend - a.spend), [report, source]);
  const filter = rows => rows.filter(row => !query || JSON.stringify(row).toLowerCase().includes(query.toLowerCase()));
  const summary = report?.summary || {};
  const configured = status.connections.length;
  const pending = status.connections.filter(c => c.status !== 'connected' && c.enabled);
  const woo = status.connections.find(c => c.provider === 'woocommerce');
  const ga = status.connections.find(c => c.provider === 'ga4');
  const noSource = provider => !status.connections.some(c => c.provider === provider && c.last_success_at);
  const applyRange = event => { event.preventDefault(); setRange({ ...draftRange }); };
  return <div className="min-w-0 space-y-5 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-sm text-muted">Ecommerce</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h2><p className="mt-1 text-sm text-muted">Loja, aquisição e campanhas da Aerion.</p></div>
      <button type="button" className={btnSecondarySm} disabled={loading} onClick={reload}><ArrowPathIcon className="h-4 w-4" />Atualizar painel</button>
    </header>
    <div className="flex flex-wrap gap-2 border-b border-line pb-3" aria-label="Relatórios Ecommerce">
      {ECOMMERCE_SECTIONS.filter(s => isAdmin || s.id !== 'connections').map(s => <button key={s.id} type="button" aria-current={s.id === section ? 'page' : undefined}
        onClick={() => onNavigate(s.id)} className={`rounded-lg px-3 py-2 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${s.id === section ? 'bg-primary/15 text-primary' : 'text-muted hover:bg-surf2 hover:text-ink'}`}>{s.label}</button>)}
    </div>
    {error && <Notice error>{error} <button className="ml-2 underline" type="button" onClick={reload}>Tentar novamente</button></Notice>}
    {loading && !report && <div aria-label="Carregando Ecommerce" role="status" className="space-y-4 motion-safe:animate-pulse"><div className="h-24 rounded-xl bg-surf2" /><div className="h-64 rounded-xl bg-surf2" /><span className="sr-only">Carregando relatórios…</span></div>}
    {!loading && !configured && section !== 'connections' && <Notice>{isAdmin ? <>Conecte a loja e as plataformas para começar. <button type="button" className="underline" onClick={() => onNavigate('connections')}>Configurar conexões</button></> : 'As fontes ainda não foram conectadas. Solicite a configuração ao administrador.'}</Notice>}
    {section !== 'connections' && <>
      <form onSubmit={applyRange} className="flex flex-wrap items-end gap-3">
        <label className="space-y-1"><span className="block text-xs text-muted">De</span><input type="date" className={input} value={draftRange.from} onChange={e => setDraftRange(r => ({ ...r, from: e.target.value }))} required /></label>
        <label className="space-y-1"><span className="block text-xs text-muted">Até</span><input type="date" className={input} value={draftRange.to} onChange={e => setDraftRange(r => ({ ...r, to: e.target.value }))} min={draftRange.from} required /></label>
        <button type="submit" className={btnSecondarySm} disabled={loading}>Aplicar período</button>
        {[7, 30, 90, 365].map(days => <button key={days} type="button" className={btnSecondarySm} onClick={() => { const next = { from: previousDay(today(), days - 1), to: today() }; setDraftRange(next); setRange(next); }}>{days === 365 ? '12 meses' : `${days} dias`}</button>)}
      </form>
      {pending.length > 0 && <Notice>{pending.map(c => `${SOURCES[c.provider]}: ${STATE[c.status]}`).join(' · ')}. Os resultados podem estar incompletos durante a importação.</Notice>}
      {status.connections.some(c => c.info?.history_from && range.from < c.info.history_from) && <Notice>O período selecionado começa antes do histórico importado de uma ou mais fontes. Consulte a cobertura informada no rodapé; os resultados desse intervalo são parciais.</Notice>}
      {woo?.info?.tracking_error && section === 'campaigns' && <Notice>{woo.info.tracking_error}</Notice>}
      {report?.currencies?.some(c => c !== 'BRL') && <Notice>Há registros em {report.currencies.filter(c => c !== 'BRL').join(', ')}. Os totais consolidados incluem somente BRL; a mídia mantém sua moeda original.</Notice>}
      {summary.unallocatedRefund > 0 && <Notice>Há {money(summary.unallocatedRefund)} em reembolsos sem discriminação de produtos, frete ou impostos. A receita de produtos ainda não desconta esses valores e exige conciliação.</Notice>}
      {report && <>
        {section === 'overview' && <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-line py-5 xl:grid-cols-5">
            {[['Receita de produtos', summary.revenue, money, 'WooCommerce · após descontos e reembolsos discriminados'], ['Pedidos pagos', summary.orders, number, 'WooCommerce · BRL'], ['Ticket médio', summary.ticket, money, 'Receita de produtos / pedidos'], ['Sessões', summary.sessions, number, 'GA4 · navegação registrada'], ['Investimento em mídia', summary.spend, money, 'Google Ads + Meta · fontes conectadas em BRL']].map(([label, value, format, note]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{format(value)}</dd><p className="mt-1 text-xs text-muted">{note}</p></div>)}
          </dl>
          <p className="text-xs text-muted">Receita no período anterior ({dateLabel(report.range.previousFrom)} a {dateLabel(report.range.previousTo)}): {money(summary.previousRevenue)}. Receita exclui frete e impostos. Compras registradas no GA4: {number(summary.purchases)}.</p>
          <SalesChart rows={report.daily} />
          <Table caption="Produtos com maior receita" rows={report.products.slice(0, 10)} columns={[{ key: 'name', label: 'Produto' }, numeric('quantity', 'Unidades líquidas'), numeric('revenue', 'Receita', money)]} />
          <p className="text-xs text-muted">Vendas da loja, compras do GA4 e conversões atribuídas pelos anúncios seguem critérios diferentes. Conversões das plataformas não são somadas como pedidos únicos.</p>
        </>}
        {['sales', 'campaigns', 'coupons', 'ads'].includes(section) && <label className="block max-w-md space-y-1"><span className="block text-xs text-muted">Buscar nos resultados</span><input type="search" className={`${input} w-full`} value={query} onChange={e => setQuery(e.target.value)} placeholder="Produto, campanha, cupom ou pedido" /></label>}
        {section === 'sales' && <>
          {noSource('woocommerce') && <Notice>Conecte o WooCommerce para consultar vendas e produtos.</Notice>}
          <Table caption="Desempenho de produtos" rows={filter(report.products)} columns={[{ key: 'name', label: 'Produto' }, { key: 'sku', label: 'SKU' }, { key: 'categories', label: 'Categorias', render: r => r.categories?.join(', ') || '—' }, numeric('quantity', 'Unidades líquidas'), numeric('revenue', 'Receita', money), numeric('refunded', 'Reembolsos de produtos', money)]} />
          <Table caption="Pedidos no período" rows={filter(report.orders)} columns={[{ key: 'number', label: 'Pedido' }, { key: 'status', label: 'Situação' }, { key: 'paidAt', label: 'Pagamento', render: r => r.paidAt ? when(r.paidAt) : 'Não pago' }, { key: 'currency', label: 'Moeda' }, numeric('revenue', 'Receita de produtos', r => number(r)), numeric('refunded', 'Reembolsado'), { key: 'coupons', label: 'Cupons', render: r => r.coupons.map(c => c.code).join(', ') || '—' }]} />
        </>}
        {section === 'traffic' && <>
          {noSource('ga4') && <Notice>Conecte a propriedade GA4 para consultar visitas e aquisição.</Notice>}
          <p className="text-xs text-muted">Sessões e compras registradas no GA4. Consentimento e bloqueadores podem reduzir a cobertura. Eventos do funil são contagens de eventos, não pessoas únicas.</p>
          <Table caption="Origem do tráfego" rows={traffic} columns={[{ key: 'source', label: 'Origem' }, { key: 'medium', label: 'Mídia' }, { key: 'campaign', label: 'Campanha' }, numeric('sessions', 'Sessões'), numeric('purchases', 'Compras GA4')]} />
          <Table caption="Páginas de entrada" rows={landings} columns={[{ key: 'landing', label: 'Página' }, numeric('sessions', 'Sessões'), numeric('purchases', 'Compras GA4')]} />
          <Table caption="Eventos de compra" rows={funnel} columns={[{ key: 'event', label: 'Evento' }, numeric('events', 'Ocorrências')]} empty="Os eventos ainda não foram registrados no GA4 ou estão fora do período." />
          <Table caption="Navegação diária · GA4" rows={report.daily} columns={[{ key: 'date', label: 'Dia', render: r => dateLabel(r.date) }, numeric('sessions', 'Sessões'), numeric('activeUsers', 'Usuários ativos no dia')]} />
          <p className="text-xs text-muted">Usuários ativos são únicos em cada dia. Somá-los não representa usuários únicos no período.</p>
          {report.traffic.some(r => r.thresholded || r.otherRow) && <Notice>O GA4 informou limitação de cobertura ou agrupamento de linhas neste relatório. Os detalhamentos podem não coincidir com os totais.</Notice>}
        </>}
        {section === 'campaigns' && <>
          <Table caption="Aquisição por campanha · GA4" rows={filter(traffic)} columns={[{ key: 'source', label: 'Origem' }, { key: 'medium', label: 'Mídia' }, { key: 'campaign', label: 'Campanha' }, { key: 'content', label: 'Conteúdo' }, numeric('sessions', 'Sessões'), numeric('purchases', 'Compras GA4')]} />
          <Table caption="Atribuição registrada nos pedidos · WooCommerce" rows={filter(report.utms)} columns={[{ key: 'source', label: 'Origem', render: r => r.source || (r.linkId ? 'Link Aerion' : 'Sem atribuição') }, { key: 'medium', label: 'Mídia' }, { key: 'campaign', label: 'Campanha' }, { key: 'linkId', label: 'ID link' }, numeric('orders', 'Pedidos'), numeric('withCoupon', 'Com cupom'), numeric('revenue', 'Receita', money)]} />
          <Table caption="Links Aerion · último link em até 30 dias" rows={filter(report.links)} columns={[{ key: 'utm_campaign', label: 'Campanha' }, { key: 'utm_source', label: 'Origem' }, { key: 'link_id', label: 'ID link' }, numeric('landings', 'Acessos registrados'), numeric('visitorDays', 'Visitantes-dia'), numeric('orders', 'Pedidos pagos'), numeric('revenue', 'Receita', money), numeric('couponOutside', 'Cupom fora do link')]} />
          <p className="text-xs text-muted">Links Aerion dependem do plugin de relatórios. Visitas seguem o dia UTC do registro original. Visitantes-dia soma visitantes únicos de cada dia; não representa pessoas únicas no período. Ausência de UTM não é preenchida retroativamente. Cupons fora do link podem aparecer em mais de uma linha.</p>
        </>}
        {section === 'coupons' && <>
          <Table caption="Cupons em pedidos pagos · BRL" rows={filter(report.coupons)} columns={[{ key: 'code', label: 'Cupom' }, numeric('orders', 'Pedidos'), numeric('discount', 'Desconto concedido', money), numeric('revenue', 'Receita associada', money), numeric('withUtm', 'Com atribuição'), numeric('withoutUtm', 'Sem atribuição')]} />
          <p className="text-xs text-muted">Um pedido pode usar vários cupons. A receita associada aparece em cada cupom utilizado e não deve ser somada entre cupons. Os descontos refletem a aplicação original no pedido.</p>
          <Table caption="Cupons cadastrados na loja" rows={filter(report.couponCatalog || [])} columns={[{ key: 'code', label: 'Cupom' }, { key: 'discountType', label: 'Tipo' }, { key: 'amount', label: 'Valor configurado' }, numeric('usageCount', 'Usos na loja'), numeric('usageLimit', 'Limite'), { key: 'expiresAt', label: 'Vencimento', render: r => r.expiresAt ? when(`${r.expiresAt.replace(/Z$/, '')}Z`) : 'Sem vencimento' }]} />
        </>}
        {section === 'ads' && <>
          <label className="block max-w-xs space-y-1"><span className="block text-xs text-muted">Plataforma</span><select className={`${select} w-full`} value={source} onChange={e => setSource(e.target.value)}><option value="all">Google Ads e Meta Ads</option><option value="google_ads">Google Ads</option><option value="meta_ads">Meta Ads</option></select></label>
          <Table caption="Performance por campanha · atribuição da plataforma" rows={filter(ads)} columns={[{ key: 'provider', label: 'Fonte', render: r => SOURCES[r.provider] }, { key: 'campaign', label: 'Campanha' }, { key: 'currency', label: 'Moeda' }, numeric('spend', 'Investimento'), numeric('impressions', 'Impressões'), numeric('clicks', 'Cliques'), { key: 'cpc', label: 'CPC', numeric: true, render: r => r.clicks ? number(r.spend / r.clicks) : '—' }, numeric('conversions', 'Conversões'), { key: 'roas', label: 'ROAS informado', numeric: true, render: r => r.spend ? `${number(r.conversionValue / r.spend)}×` : '—' }, { key: 'attribution', label: 'Janela / critério' }, { key: 'timezone', label: 'Fuso da conta' }]} />
          <Notice>O Google Ads usa as ações de conversão configuradas na conta; elas podem incluir resultados além de compras. A Meta usa 7 dias após clique e 1 dia após visualização. Cada plataforma pode atribuir a mesma venda. O ROAS acima usa o valor de conversão informado pela própria plataforma.</Notice>
        </>}
        <footer className="flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-3 text-xs text-muted" aria-label="Atualização das fontes">
          {Object.entries(SOURCES).map(([key, name]) => { const connection = status.connections.find(c => c.provider === key); return <span key={key}>{name}: {when(connection?.last_success_at)}{connection?.info?.history_from ? ` · histórico solicitado desde ${dateLabel(connection.info.history_from)}` : ''}</span>; })}
          {(woo || ga) && <span>Exibição: BRL · America/Sao_Paulo. GA4: {report.traffic.find(r => r.timezone)?.timezone || 'fuso da propriedade'}; anúncios preservam o dia da conta.</span>}
        </footer>
      </>}
    </>}
    {section === 'connections' && (isAdmin ? <>
      {!status.encryptionReady && <Notice>Configure ECOMMERCE_ENCRYPTION_KEY no servidor antes de salvar credenciais. A chave deve conter 64 caracteres hexadecimais e permanecer estável entre deploys.</Notice>}
      <p className="max-w-3xl text-sm text-muted">Conecte cada fonte uma vez com as contas da Aerion. A importação busca até 12 meses de dados já existentes e continua em lotes. Credenciais salvas não são devolvidas ao navegador; campos secretos vazios mantêm o valor anterior.</p>
      {statusLoaded && Object.keys(SOURCES).map(provider => <ConnectionForm key={`${provider}:${JSON.stringify(status.connections.find(c => c.provider === provider)?.config || {})}`} provider={provider} connection={status.connections.find(c => c.provider === provider)} status={status} onUpdate={reload} />)}
    </> : <Notice>A configuração de conexões é restrita aos administradores.</Notice>)}
  </div>;
}
