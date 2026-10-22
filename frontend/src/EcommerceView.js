import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ResponsiveLine } from '@nivo/line';
import { ArrowPathIcon, ArrowTopRightOnSquareIcon, CheckCircleIcon, ChevronDownIcon, ExclamationTriangleIcon, LinkIcon, Squares2X2Icon, ShoppingBagIcon, MegaphoneIcon, Cog6ToothIcon } from '@heroicons/react/24/outline';
import { btnPrimary, btnSecondarySm, input, select } from './ui';
import { prepareSalesChart, CHART_AXES, CHART_DEFAULTS } from './ecommerceChart';

export const ECOMMERCE_SECTIONS = [
  { id: 'overview', label: 'Visão geral', icon: Squares2X2Icon },
  { id: 'sales', label: 'Vendas e produtos', icon: ShoppingBagIcon },
  { id: 'ads', label: 'Marketing', icon: MegaphoneIcon },
  { id: 'connections', label: 'Conexões', icon: Cog6ToothIcon },
];
const SOURCES = { woocommerce: 'WooCommerce', ga4: 'Google Analytics 4', google_ads: 'Google Ads', meta_ads: 'Meta Ads', search_console: 'Google Search Console' };
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
  const [visible, setVisible] = useState(['revenue', 'spend']);
  const [mode, setMode] = useState('money');
  const [interval, setInterval] = useState('day');
  const { series, available, data, max, points, selected } = prepareSalesChart(rows, mode, interval, visible);
  const axisFormat = (side, value) => mode === 'efficiency' && side === 'right' ? `${number(value)}×` : new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
  const rawFormat = (side, value) => mode === 'money' || (mode === 'efficiency' && side === 'left') ? money(value) : mode === 'efficiency' ? `${number(value)}×` : number(value);
  const hasAxis = side => selected.some(([, , , axis]) => axis === side);
  return <section className={panel} aria-label="Receita diária de produtos">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-semibold">Vendas e investimento ao longo do tempo</h3><p className={`${labelClass} mt-1`}>{mode === 'money' ? 'Receita pela data de pagamento · mídia pelo dia da conta' : mode === 'efficiency' ? 'CPC ponderado por cliques · ROAS atribuído pelas plataformas' : 'Pedidos pela data de pagamento · sessões do GA4'}</p></div>
      <div className="flex flex-wrap gap-2"><label className="sr-only" htmlFor="ecommerce-chart-mode">Métrica do gráfico</label><select id="ecommerce-chart-mode" className={select} value={mode} onChange={e => { setMode(e.target.value); setVisible(CHART_DEFAULTS[e.target.value]); }}><option value="money">Valores em R$</option><option value="efficiency">CPC e ROAS</option><option value="volume">Pedidos e sessões</option></select><label className="sr-only" htmlFor="ecommerce-chart-interval">Agrupar gráfico</label><select id="ecommerce-chart-interval" className={select} value={interval} onChange={e => setInterval(e.target.value)}><option value="day">Por dia</option><option value="week">Por semana</option><option value="month">Por mês</option></select></div>
    </div>
    <div className="my-4 flex flex-wrap gap-2" aria-label="Mostrar ou ocultar linhas do gráfico">{series.map(([id, label, color, axis]) => <button key={id} type="button" disabled={!available.some(([key]) => key === id)} title={`${axis === 'right' ? 'Eixo direito' : 'Eixo esquerdo'}: ${CHART_AXES[mode][axis === 'right' ? 1 : 0]}`} aria-pressed={visible.includes(id)} onClick={() => setVisible(v => v.includes(id) ? v.filter(k => k !== id) : [...v, id])} className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40 ${visible.includes(id) ? 'border-line bg-bg2 text-ink' : 'border-transparent text-muted'}`}><span className="h-2 w-2 rounded-full" style={{ background: color }} />{label}<span className="text-muted" aria-hidden="true">{axis === 'right' ? '→' : '←'}</span></button>)}</div>
    {!available.length ? <p className="py-12 text-sm text-muted">{mode === 'efficiency' ? 'Ainda não há cliques e investimento disponíveis para calcular CPC e ROAS neste período.' : 'Conecte o WooCommerce para acompanhar a evolução de vendas.'}</p> : !data.length ? <p className="py-12 text-sm text-muted">Selecione uma linha acima para exibir o gráfico.</p> : <>
      <div className="mb-2 flex justify-between gap-5 text-xs text-muted"><span>{hasAxis('left') ? `Esquerda: ${CHART_AXES[mode][0]}` : ''}</span><span className="text-right">{hasAxis('right') ? `Direita: ${CHART_AXES[mode][1]}` : ''}</span></div>
      <div className="h-80" role="img" aria-label="Evolução das métricas selecionadas no período, com escalas independentes à esquerda e à direita">
      <ResponsiveLine data={data} margin={{ top: 16, right: hasAxis('right') ? 55 : 12, bottom: 44, left: hasAxis('left') ? 55 : 12 }}
        xScale={{ type: 'point' }} yScale={{ type: 'linear', min: 0, max: 1, nice: false }} colors={({ color }) => color}
        axisTop={null} axisRight={hasAxis('right') ? { tickValues: [0, 0.25, 0.5, 0.75, 1], tickSize: 0, tickPadding: 10, format: n => axisFormat('right', n * max.right) } : null} axisBottom={{ tickValues: data[0].data.filter((_, i) => i % Math.max(1, Math.ceil(data[0].data.length / 5)) === 0).map(d => d.x), format: d => dateLabel(d).slice(0, 5), tickSize: 0, tickPadding: 12 }}
        axisLeft={hasAxis('left') ? { tickValues: [0, 0.25, 0.5, 0.75, 1], tickSize: 0, tickPadding: 10, format: n => axisFormat('left', n * max.left) } : null} gridYValues={[0, 0.25, 0.5, 0.75, 1]} enablePoints={points.length <= 45} pointSize={4}
        enableGridX={false} enableArea={false} enableSlices="x" animate={false}
        theme={{ text: { fill: '#94a3b8', fontSize: 11 }, grid: { line: { stroke: '#334155', strokeOpacity: 0.3 } }, tooltip: { container: { background: '#172033', color: '#fff', borderRadius: 8 } } }}
        sliceTooltip={({ slice }) => <div className="rounded-lg border border-line bg-surf p-3 text-xs text-ink"><strong>{dateLabel(slice.points[0].data.x)}</strong>{slice.points.map(point => {
          const serie = data.find(s => s.id === point.serieId), raw = serie?.data.find(d => d.x === point.data.x)?.rawValue;
          return <div className="mt-2 flex justify-between gap-5" key={point.id}><span>{point.serieId} · {serie?.axis === 'right' ? 'dir.' : 'esq.'}</span><b>{rawFormat(serie?.axis, raw)}</b></div>;
        })}</div>} />
      </div></>}
    <p className={`${labelClass} mt-3`}>Escalas independentes: compare a evolução, não a altura das linhas. {mode === 'money' ? 'Pedidos pendentes incluem frete e impostos e refletem a situação atual dos pedidos criados no período; não representam abandono de carrinho.' : mode === 'efficiency' ? 'CPC e ROAS são recalculados pelos totais de cada dia, semana ou mês; dias sem cliques ou investimento ficam sem taxa.' : 'Pedidos e sessões têm escalas próprias e não representam pessoas únicas.'}</p>
  </section>;
}

const ratio = value => value == null ? '—' : `${number(value)}×`;
const percent = value => value == null ? '—' : `${number(value)}%`;
function MediaIndicators({ summary }) {
  const media = summary.media || {};
  return <section className={panel}><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-base font-semibold">Eficiência da mídia</h3><span className="text-xs text-muted">{summary.mediaPartial ? 'Cobertura parcial · fontes conectadas em BRL' : 'Fontes conectadas · BRL'}</span></div><dl className="mt-4 grid grid-cols-2 gap-5 lg:grid-cols-6">{[
    ['ROAS atribuído', media.roas, ratio, 'Valor atribuído / investimento'], ['Retorno da loja · MER', summary.revenuePerAdSpend, ratio, 'Receita WooCommerce / mídia'],
    ['CPC', media.cpc, money, 'Investimento / cliques'], ['CTR', media.ctr, percent, 'Cliques / impressões'], ['CPM', media.cpm, money, 'Custo por mil impressões'], ['CPA atribuído', media.cpa, money, 'Custo por conversão informada'],
  ].map(([label, value, format, help]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{format(value)}</dd><p className="mt-1 text-xs text-muted">{help}</p></div>)}</dl><p className="mt-4 border-t border-line pt-3 text-xs text-muted">ROAS usa a atribuição das plataformas e pode contabilizar a mesma venda em ambas. MER usa as vendas reais de produtos da loja e não mede atribuição. CPC, CTR, CPM e CPA usam totais ponderados.</p></section>;
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
    ['purchase_conversion_action_id', 'ID da ação de compra · para ROAS sem leads', 'text', 'ID numérico da ação de categoria Compra'],
    ['client_id', 'OAuth Client ID', 'text', '…apps.googleusercontent.com'], ['client_secret', 'OAuth Client Secret', 'password', 'Segredo do aplicativo Google Cloud'],
    ['service_account', 'Credenciais da conta técnica Google Ads (JSON)', 'textarea', 'Conta de serviço ou identidade federada configurada para a VPS']],
  meta_ads: [['account_id', 'ID da conta de anúncios', 'text', 'act_123456789'], ['access_token', 'Token de acesso Meta · ads_read', 'password', 'Token com acesso de análise à conta']],
  search_console: [['site_url', 'Propriedade do Search Console', 'text', 'sc-domain:aerion.com.br ou https://aerion.com.br/'], ['service_account', 'Credenciais da conta técnica Search Console (JSON)', 'textarea', 'Conta de serviço ou identidade federada configurada para a VPS']],
};
const HELP = {
  woocommerce: 'No WooCommerce, gere uma chave de leitura em Configurações → Avançado → API REST. Para UTMs Aerion, instale o plugin de relatórios e configure o usuário técnico abaixo.',
  ga4: 'Habilite a Analytics Data API no Google Cloud. Conceda à conta de serviço acesso de leitor à propriedade GA4. O ID da propriedade é numérico; não use o código G- da tag.',
  google_ads: 'Habilite a Google Ads API no projeto Google Cloud e obtenha acesso de produção. Use uma conta técnica com acesso Somente leitura ao anunciante ou autorize um usuário por OAuth.',
  meta_ads: 'Use um aplicativo da Aerion e um token com ads_read, obtido por OAuth ou por um usuário de sistema com acesso de análise à conta. O Pixel é conferido na loja; os resultados vêm da Insights API.',
  search_console: 'Habilite a Search Console API no Google Cloud e conceda acesso à propriedade para a conta técnica. Consultamos apenas dados de pesquisa e sitemaps; esta conexão não altera o site nem envia URLs para indexação.',
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
        {provider === 'meta_ads' && connection?.info?.authorization_expires_at && <p>Autorização Meta válida até: {when(connection.info.authorization_expires_at)}. Renove o acesso antes dessa data para manter a sincronização.</p>}
        {provider === 'woocommerce' && connection?.info?.bridge_last_success_at && <p>Última atualização de links e visitas Aerion: {when(connection.info.bridge_last_success_at)}</p>}
        {connection?.progress && <p>Importação em andamento · {connection.progress.phase} · lote {connection.progress.page}{connection.progress.from ? ` · desde ${connection.progress.from.slice(0, 10)}` : ''}</p>}
        {connection?.info?.tracking && <p>Configuração declarada da loja: GTM {connection.info.tracking.gtm_configured ? 'configurado' : 'não configurado'} · GA4 {connection.info.tracking.ga4_configured ? 'configurado' : 'não detectado'} · Pixel Meta {connection.info.tracking.meta_pixel_configured ? 'configurado' : 'não detectado'} · consentimento {connection.info.tracking.consent_api ? 'disponível' : 'não detectado'} · UTMs Aerion {connection.info.tracking.utm_available ? 'disponível' : 'não detectado'}. Tags instaladas pelo GTM e eventos reais exigem validação no navegador, DebugView e Events Manager.</p>}
        {provider === 'woocommerce' && !connection?.info?.tracking && <p>Relatórios de links Aerion dependem do plugin e das credenciais de leitura. Vendas e cupons usam a API REST do WooCommerce.</p>}
      </div>
    </form>
  </details>;
}

function StoreAudiencePlan() {
  const rows = [
    { name: 'Visitantes', window: '30 dias', signal: 'Visita ao site', exclusion: 'Compra nos últimos 180 dias' },
    { name: 'Interesse em produtos', window: '30 dias', signal: 'view_item / ViewContent', exclusion: 'Compra nos últimos 180 dias' },
    { name: 'Carrinho', window: '14 dias', signal: 'add_to_cart / AddToCart', exclusion: 'Compra nos últimos 180 dias' },
    { name: 'Checkout', window: '7 dias', signal: 'begin_checkout / InitiateCheckout', exclusion: 'Compra nos últimos 180 dias' },
    { name: 'Compradores da loja', window: '180 dias', signal: 'purchase / Purchase · pagamento confirmado', exclusion: 'Sem exclusão de compradores' },
  ];
  return <section className="space-y-4" aria-label="Públicos da loja">
    <div className="border-t border-line pt-5"><h3 className="text-base font-semibold">Públicos da loja · estrutura sugerida</h3><p className="mt-1 max-w-3xl text-xs text-muted">Um funil de intenção de compra para distribuidores e consumidores finais. As etapas do CRM de distribuição ficam separadas.</p></div>
    <Table caption="Mesmas regras de negócio para Meta e Google" rows={rows} columns={[{ key: 'name', label: 'Público' }, { key: 'window', label: 'Janela móvel' }, { key: 'signal', label: 'Sinal Google / Meta' }, { key: 'exclusion', label: 'Exclusão sugerida' }]} />
    <p className="text-xs text-muted">Proposta de segmentação; esta tabela não comprova criação ou sincronização nas plataformas. Públicos do site se atualizam pelos eventos após serem configurados. Listas do CRM precisam de sincronização própria. Nomes e regras podem ser equivalentes entre plataformas, mas pessoas correspondidas e tamanhos podem diferir.</p>
    <p className="text-xs text-muted">Distribuidor e consumidor final devem vir de informação declarada ou de uma origem confiável. Visitar um produto ou adicionar ao carrinho, isoladamente, não identifica esse perfil. Uma base usada como sinal não limita automaticamente a entrega a pessoas semelhantes; a configuração da campanha também determina a expansão.</p>
  </section>;
}

function CrmAudiencePreview({ refresh }) {
  const [preview, setPreview] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    axios.get('/api/ecommerce/audiences', { signal: controller.signal }).then(({ data }) => setPreview(data))
      .catch(failure => { if (!controller.signal.aborted) setError(errorText(failure)); });
    return () => controller.abort();
  }, [refresh]);
  return <section className="space-y-4" aria-label="Públicos por etapa do CRM">
    <div className="border-t border-line pt-5"><h3 className="text-base font-semibold">Distribuição · base comercial do CRM</h3><p className="mt-1 max-w-3xl text-xs text-muted">Situação atual do Kanban/Chatwoot, independente do período do gráfico. Cadastros reais do funil de distribuição; não são exemplos fictícios nem a base de referência da loja. Clientes classificados no CRM não equivalem a pagamentos confirmados na loja.</p></div>
    {error ? <Notice error>{error}</Notice> : !preview ? <p role="status" className="text-sm text-muted">Consultando as etapas do CRM…</p> : <>
      <Table caption="Base do CRM por intenção comercial" rows={preview.segments || []} columns={[{ key: 'label', label: 'Segmento' }, { key: 'stages', label: 'Etapas' }, numeric('contacts', 'Contatos'), numeric('emails', 'Emails únicos disponíveis'), numeric('suppressed', 'Não contatar'), { key: 'use', label: 'Uso recomendado' }]} />
      <p className="text-xs text-muted">Emails com formato válido, sem duplicação dentro do segmento e respeitando os bloqueios registrados no CRM. Isso não comprova correspondência nas plataformas nem autorização para publicidade. Nenhuma lista foi enviada. A classificação inclui as etapas atuais do funil, que devem ser revisadas antes de usar compradores ou qualificados como referência de público.</p>
      <details className="border-t border-line pt-4"><summary className="cursor-pointer text-sm font-medium">Conferir etapas e tipos de cliente</summary><div className="mt-4 space-y-4"><Table caption="Etapas atuais do Kanban" rows={preview.stages || []} columns={[{ key: 'name', label: 'Etapa' }, numeric('contacts', 'Contatos'), numeric('emails', 'Emails únicos disponíveis')]} /><Table caption="Tipo de cliente cadastrado" rows={preview.profiles || []} columns={[{ key: 'name', label: 'Tipo' }, numeric('contacts', 'Contatos'), numeric('emails', 'Emails únicos disponíveis')]} /></div></details>
      <p className="text-xs text-muted">Prévia atualizada em {when(preview.observedAt)}. Uma pessoa pode aparecer em segmentos diferentes por cadastros duplicados; a sincronização futura deverá reconciliar esses casos antes do envio.</p>
    </>}
  </section>;
}

export default function EcommerceView({ section: requestedSection = 'overview', isAdmin = false, onNavigate }) {
  const [section, setSection] = useState(requestedSection);
  useEffect(() => setSection(requestedSection), [requestedSection]);
  const parentSection = ['traffic', 'campaigns', 'ads', 'seo'].includes(section) ? 'ads' : section === 'coupons' ? 'sales' : section;
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
  const title = ECOMMERCE_SECTIONS.find(s => s.id === parentSection)?.label || 'Visão geral';
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
      {ECOMMERCE_SECTIONS.filter(s => isAdmin || s.id !== 'connections').map(s => <button key={s.id} type="button" aria-current={s.id === parentSection ? 'page' : undefined}
        onClick={() => { setSection(s.id); onNavigate(s.id); }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${s.id === parentSection ? 'bg-primary/15 text-primary' : 'text-muted hover:bg-surf2 hover:text-ink'}`}><s.icon className="h-4 w-4" aria-hidden="true" />{s.label}</button>)}
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
      {['ads', 'sales'].includes(parentSection) && <div className="flex flex-wrap gap-2" aria-label="Detalhamento do relatório">{(parentSection === 'ads' ? [['ads', 'Mídia paga'], ['traffic', 'Tráfego e conversão'], ['campaigns', 'Campanhas e UTMs'], ['seo', 'Busca orgânica e SEO']] : [['sales', 'Pedidos e produtos'], ['coupons', 'Cupons']]).map(([id, label]) => <button type="button" key={id} aria-pressed={section === id} onClick={() => setSection(id)} className={`${btnSecondarySm} ${section === id ? 'bg-primary/15 text-primary' : ''}`}>{label}</button>)}</div>}
      {pending.length > 0 && <Notice>{pending.map(c => `${SOURCES[c.provider]}: ${STATE[c.status]}`).join(' · ')}. Os resultados podem estar incompletos durante a importação.</Notice>}
      {status.connections.some(c => c.info?.history_from && range.from < c.info.history_from) && <Notice>O período selecionado começa antes do histórico importado de uma ou mais fontes. Consulte a cobertura informada no rodapé; os resultados desse intervalo são parciais.</Notice>}
      {woo?.info?.tracking_error && section === 'campaigns' && <Notice>{woo.info.tracking_error}</Notice>}
      {report?.currencies?.some(c => c !== 'BRL') && <Notice>Há registros em {report.currencies.filter(c => c !== 'BRL').join(', ')}. Os totais consolidados incluem somente BRL; a mídia mantém sua moeda original.</Notice>}
      {summary.unallocatedRefund > 0 && <Notice>Há {money(summary.unallocatedRefund)} em reembolsos sem discriminação de produtos, frete ou impostos. A receita de produtos ainda não desconta esses valores e exige conciliação.</Notice>}
      {report && <>
        {section === 'overview' && <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-line py-5 xl:grid-cols-4">
            {[['Receita de produtos', summary.revenue, money, 'Pagamentos confirmados · descontos e reembolsos discriminados'], ['Pedidos pagos', summary.orders, number, `Ticket médio ${money(summary.ticket)}`], ['Investimento em mídia', summary.spend, money, summary.mediaPartial ? 'Cobertura parcial · fontes conectadas em BRL' : 'Google Ads + Meta · BRL'], ['Aguardando pagamento', summary.unpaidValue, money, `${number(summary.unpaidOrders)} pedidos pendentes ou em espera · inclui frete e impostos`]].map(([label, value, format, note]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{format(value)}</dd><p className="mt-1 text-xs text-muted">{note}</p></div>)}
          </dl>
          <p className="text-xs text-muted">Receita no período anterior ({dateLabel(report.range.previousFrom)} a {dateLabel(report.range.previousTo)}): {money(summary.previousRevenue)}. Receita exclui frete e impostos. Compras registradas no GA4: {number(summary.purchases)}.</p>
          <SalesChart rows={report.daily} />
          <MediaIndicators summary={summary} />
          <section className={panel}><h3 className="text-base font-semibold">Conversão e oportunidades</h3><dl className="mt-4 grid grid-cols-2 gap-5 lg:grid-cols-4">{[['Sessões GA4', number(summary.sessions)], ['Compras GA4', number(summary.purchases)], ['Compras / sessões GA4', summary.sessions ? percent(summary.purchases / summary.sessions * 100) : '—'], ['Abandono de carrinho', percent(summary.cartAbandonmentRate)]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd></div>)}</dl><p className="mt-4 text-xs text-muted">Abandono exige um funil de usuários com carrinho e compra no mesmo intervalo. A medição está em validação; pedidos não pagos e contagens de eventos não permitem calcular essa taxa. Compras / sessões mede ocorrências por sessão, não a proporção de pessoas que compraram.</p></section>
          <Table caption="Produtos com maior receita" rows={report.products.slice(0, 10)} columns={[{ key: 'name', label: 'Produto' }, numeric('quantity', 'Unidades líquidas'), numeric('revenue', 'Receita', money)]} />
          <p className="text-xs text-muted">Vendas da loja, compras do GA4 e conversões atribuídas pelos anúncios seguem critérios diferentes. Conversões das plataformas não são somadas como pedidos únicos.</p>
        </>}
        {['sales', 'campaigns', 'coupons', 'ads'].includes(section) && <label className="block max-w-md space-y-1"><span className="block text-xs text-muted">Buscar nos resultados</span><input type="search" className={`${input} w-full`} value={query} onChange={e => setQuery(e.target.value)} placeholder="Produto, campanha, cupom ou pedido" /></label>}
        {section === 'sales' && <>
          {noSource('woocommerce') && <Notice>Conecte o WooCommerce para consultar vendas e produtos.</Notice>}
          <Table caption="Desempenho de produtos" rows={filter(report.products)} columns={[{ key: 'name', label: 'Produto' }, { key: 'sku', label: 'SKU' }, { key: 'categories', label: 'Categorias', render: r => r.categories?.join(', ') || '—' }, numeric('quantity', 'Unidades líquidas'), numeric('revenue', 'Receita', money), numeric('refunded', 'Reembolsos de produtos', money)]} />
          <Table caption="Pedidos no período" rows={filter(report.orders)} columns={[{ key: 'number', label: 'Pedido' }, { key: 'status', label: 'Situação' }, { key: 'paidAt', label: 'Pagamento', render: r => r.paidAt ? when(r.paidAt) : 'Não pago' }, { key: 'currency', label: 'Moeda' }, numeric('total', 'Valor do pedido'), numeric('revenue', 'Receita de produtos', r => number(r)), numeric('refunded', 'Reembolsado'), { key: 'coupons', label: 'Cupons', render: r => r.coupons.map(c => c.code).join(', ') || '—' }]} />
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
          <StoreAudiencePlan />
          <CrmAudiencePreview refresh={refresh} />
        </>}
        {section === 'campaigns' && <>
          <Table caption="Aquisição por campanha · GA4" rows={filter(traffic)} columns={[{ key: 'source', label: 'Origem' }, { key: 'medium', label: 'Mídia' }, { key: 'campaign', label: 'Campanha' }, { key: 'content', label: 'Conteúdo' }, numeric('sessions', 'Sessões'), numeric('purchases', 'Compras GA4')]} />
          <Table caption="Atribuição registrada nos pedidos · WooCommerce" rows={filter(report.utms)} columns={[{ key: 'source', label: 'Origem', render: r => r.source || (r.linkId ? 'Link Aerion' : 'Sem atribuição') }, { key: 'medium', label: 'Mídia' }, { key: 'campaign', label: 'Campanha' }, { key: 'linkId', label: 'ID link' }, numeric('orders', 'Pedidos'), numeric('withCoupon', 'Com cupom'), numeric('revenue', 'Receita', money)]} />
          <Table caption="Links Aerion · último link em até 30 dias" rows={filter(report.links)} columns={[{ key: 'utm_campaign', label: 'Campanha' }, { key: 'utm_source', label: 'Origem' }, { key: 'link_id', label: 'ID link' }, numeric('landings', 'Acessos registrados'), numeric('visitorDays', 'Visitantes-dia'), numeric('orders', 'Pedidos pagos'), numeric('revenue', 'Receita', money), numeric('couponOutside', 'Cupom fora do link')]} />
          <p className="text-xs text-muted">Links Aerion dependem do plugin de relatórios. Visitas seguem o dia UTC do registro original. Visitantes-dia soma visitantes únicos de cada dia; não representa pessoas únicas no período. Ausência de UTM não é preenchida retroativamente. Cupons fora do link podem aparecer em mais de uma linha.</p>
        </>}
        {section === 'seo' && <>
          {!report.search?.available && <Notice>Conecte o Search Console para consultar buscas e páginas que atraem visitas orgânicas.</Notice>}
          <section className={panel}><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-base font-semibold">Visibilidade na busca do Google</h3><p className="mt-1 break-all text-xs text-muted">{report.search?.site || 'Propriedade ainda não conectada'}</p></div><p className="text-xs text-muted">{report.search?.latestDate ? `Dados finalizados até ${dateLabel(report.search.latestDate)}` : 'Aguardando dados finalizados'}</p></div>
            <dl className="mt-5 grid grid-cols-2 gap-5 lg:grid-cols-4">{[['Cliques orgânicos', report.search?.summary?.clicks, number], ['Impressões na busca', report.search?.summary?.impressions, number], ['CTR orgânico', report.search?.summary?.ctr, percent], ['Posição média', report.search?.summary?.position, number]].map(([label, value, format]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{format(value)}</dd></div>)}</dl>
            <p className="mt-4 border-t border-line pt-3 text-xs text-muted">Pesquisa web · dias no fuso do Pacífico · dados finalizados podem ter atraso. Cliques da busca não equivalem a sessões do GA4 ou vendas. Consultas anônimas são omitidas; os detalhamentos podem não somar o total. Posição é ponderada por impressões; menor é melhor.</p>
          </section>
          {report.search?.truncated && <Notice>O limite de linhas foi atingido em parte da importação. Os detalhamentos exibem os principais resultados e podem estar incompletos.</Notice>}
          <Table caption="Páginas encontradas na busca" rows={report.search?.pages || []} columns={[{ key: 'landing', label: 'Página', render: r => <span className="break-all">{r.landing}</span> }, numeric('clicks', 'Cliques'), numeric('impressions', 'Impressões'), numeric('ctr', 'CTR', percent), numeric('position', 'Posição média')]} />
          <Table caption="Buscas que levam à Aerion" rows={report.search?.queries || []} columns={[{ key: 'query', label: 'Termo pesquisado' }, numeric('clicks', 'Cliques'), numeric('impressions', 'Impressões'), numeric('ctr', 'CTR', percent), numeric('position', 'Posição média')]} />
          <Table caption="Evolução diária · busca orgânica" rows={report.search?.daily || []} columns={[{ key: 'date', label: 'Dia', render: r => dateLabel(r.date) }, numeric('clicks', 'Cliques'), numeric('impressions', 'Impressões'), { key: 'ctr', label: 'CTR', numeric: true, render: r => r.impressions ? percent(r.clicks / r.impressions * 100) : '—' }, numeric('position', 'Posição média')]} />
          <Table caption="Sitemaps no Search Console" rows={report.search?.sitemaps || []} empty="Nenhum sitemap retornado pela propriedade. Isso não comprova ausência de páginas indexadas." columns={[{ key: 'path', label: 'Sitemap', render: r => <span className="break-all">{r.path}</span> }, { key: 'lastDownloaded', label: 'Última leitura', render: r => when(r.lastDownloaded) }, numeric('errors', 'Erros'), numeric('warnings', 'Avisos'), { key: 'isPending', label: 'Situação', render: r => r.isPending ? 'Processando' : 'Consultado' }]} />
          <p className="text-xs text-muted">Sitemap lido não comprova indexação de cada produto. Aprovação e visibilidade no Google Shopping são verificadas separadamente no Merchant Center.</p>
        </>}
        {section === 'coupons' && <>
          <Table caption="Cupons em pedidos pagos · BRL" rows={filter(report.coupons)} columns={[{ key: 'code', label: 'Cupom' }, numeric('orders', 'Pedidos'), numeric('discount', 'Desconto concedido', money), numeric('revenue', 'Receita associada', money), numeric('withUtm', 'Com atribuição'), numeric('withoutUtm', 'Sem atribuição')]} />
          <p className="text-xs text-muted">Um pedido pode usar vários cupons. A receita associada aparece em cada cupom utilizado e não deve ser somada entre cupons. Os descontos refletem a aplicação original no pedido.</p>
          <Table caption="Cupons cadastrados na loja" rows={filter(report.couponCatalog || [])} columns={[{ key: 'code', label: 'Cupom' }, { key: 'discountType', label: 'Tipo' }, { key: 'amount', label: 'Valor configurado' }, numeric('usageCount', 'Usos na loja'), numeric('usageLimit', 'Limite'), { key: 'expiresAt', label: 'Vencimento', render: r => r.expiresAt ? when(`${r.expiresAt.replace(/Z$/, '')}Z`) : 'Sem vencimento' }]} />
        </>}
        {section === 'ads' && <>
          <MediaIndicators summary={summary} />
          <SalesChart rows={report.daily} />
          <Table caption="Comparativo por plataforma · BRL" rows={report.platforms || []} columns={[{ key: 'provider', label: 'Plataforma', render: r => <button type="button" className="text-primary underline underline-offset-4" onClick={() => setSource(r.provider)}>{SOURCES[r.provider]}{!r.available ? ' · sem dados' : ''}</button> }, numeric('spend', 'Investimento', money), numeric('clicks', 'Cliques'), numeric('cpc', 'CPC', money), numeric('ctr', 'CTR', percent), numeric('cpm', 'CPM', money), numeric('conversions', 'Conversões atribuídas'), numeric('conversionValue', 'Valor atribuído', money), numeric('roas', 'ROAS atribuído', ratio)]} />
          <label className="block max-w-xs space-y-1"><span className="block text-xs text-muted">Plataforma</span><select className={`${select} w-full`} value={source} onChange={e => setSource(e.target.value)}><option value="all">Google Ads e Meta Ads</option><option value="google_ads">Google Ads</option><option value="meta_ads">Meta Ads</option></select></label>
          <Table caption="Performance por campanha · atribuição da plataforma" rows={filter(ads)} columns={[{ key: 'provider', label: 'Fonte', render: r => SOURCES[r.provider] }, { key: 'campaign', label: 'Campanha' }, { key: 'currency', label: 'Moeda' }, numeric('spend', 'Investimento'), numeric('impressions', 'Impressões'), numeric('clicks', 'Cliques'), { key: 'cpc', label: 'CPC', numeric: true, render: r => r.clicks ? number(r.spend / r.clicks) : '—' }, { key: 'ctr', label: 'CTR', numeric: true, render: r => r.impressions ? percent(r.clicks / r.impressions * 100) : '—' }, { key: 'cpm', label: 'CPM', numeric: true, render: r => r.impressions ? number(r.spend / r.impressions * 1000) : '—' }, numeric('conversions', 'Conversões'), numeric('conversionValue', 'Valor atribuído'), { key: 'roas', label: 'ROAS informado', numeric: true, render: r => r.spend ? `${number(r.conversionValue / r.spend)}×` : '—' }, { key: 'attribution', label: 'Janela / critério' }, { key: 'timezone', label: 'Fuso da conta' }]} />
          <Notice>Quando há uma ação de compra selecionada na conexão Google Ads, o painel usa apenas essa ação, incluindo compras secundárias, sem misturar leads no ROAS. Sem essa seleção, os resultados seguem as metas da conta e podem incluir outros objetivos. A Meta usa 7 dias após clique e 1 dia após visualização. Cada plataforma pode atribuir a mesma venda. O ROAS usa o valor informado pela própria plataforma.</Notice>
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
