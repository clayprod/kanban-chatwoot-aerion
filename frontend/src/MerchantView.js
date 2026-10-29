import React, { useMemo, useState } from 'react';
import { ResponsiveLine } from '@nivo/line';
import { btnSecondarySm, input, select } from './ui';

const number = value => value == null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value);
const percent = value => value == null ? '—' : `${number(value)}%`;
const when = value => value ? new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : 'Ainda não consultado';
const methods = { ORGANIC: 'Listagens gratuitas', ADS: 'Anúncios' };
const states = { approved: 'Aprovado', pending: 'Em análise', disapproved: 'Reprovado', unknown: 'Não informado' };
const stock = { IN_STOCK: 'Em estoque', OUT_OF_STOCK: 'Sem estoque', PREORDER: 'Pré-venda', BACKORDER: 'Sob encomenda' };
const destinations = { FREE_LISTINGS: 'Listagens gratuitas', SHOPPING_ADS: 'Anúncios Shopping', DEMAND_GEN_ADS: 'Geração de demanda', VIDEO_ADS: 'Anúncios em vídeo', DEMAND_GEN_ADS_DISCOVER_SURFACE: 'Discover', YOUTUBE_SHOPPING: 'YouTube Shopping' };
const issueTitle = issue => issue.code === 'image_too_small_for_high_resolution' ? 'Imagem abaixo da resolução recomendada'
  : issue.code === 'attribute_pending_review' ? 'Imagem em análise pelo Google'
    : issue.resolution === 'pending_processing' ? 'Aguardando análise do Google' : issue.description || 'Pendência informada pelo Google';
const issueDetail = issue => issue.code === 'image_too_small_for_high_resolution' ? 'Use uma imagem com pelo menos 500 × 500 pixels.'
  : issue.code === 'attribute_pending_review' ? 'O Google informa que a análise da imagem pode levar até cinco dias.'
    : issue.code?.startsWith('pending_initial_policy_review') ? 'A análise inicial pode levar até três dias úteis.' : issue.detail;
const panel = 'rounded-xl border border-line bg-surf p-4 sm:p-5';

function DataTable({ title, headers, rows, empty }) {
  return <section className="min-w-0 space-y-3"><h3 className="text-base font-semibold">{title}</h3>
    {!rows.length ? <p className="py-5 text-sm text-muted">{empty}</p> : <div className="max-w-full overflow-x-auto rounded-lg border border-line"><table className="w-full text-left text-sm">
      <caption className="sr-only">{title}</caption><thead className="bg-surf2 text-xs text-muted"><tr>{headers.map((header, index) => <th key={header} scope="col" className={`px-4 py-3 font-medium ${index ? 'text-right' : ''}`}>{header}</th>)}</tr></thead>
      <tbody className="divide-y divide-line">{rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column} className={`px-4 py-3 align-top ${column ? 'text-right tabular-nums' : 'min-w-48 break-words'}`}>{cell}</td>)}</tr>)}</tbody>
    </table></div>}
  </section>;
}

export default function MerchantView({ data, range }) {
  const [method, setMethod] = useState('ORGANIC');
  const [metric, setMetric] = useState('clicks');
  const [query, setQuery] = useState('');
  const selected = data?.methods?.filter(row => method === 'all' || row.method === method) || [];
  const available = Boolean(data?.performanceAvailable);
  const clicks = available ? selected.reduce((sum, row) => sum + row.clicks, 0) : null;
  const impressions = available ? selected.reduce((sum, row) => sum + row.impressions, 0) : null;
  const ctr = impressions ? clicks / impressions * 100 : null;
  const products = (data?.products || []).filter(row => (method === 'all' || row.method === method)
    && (!query || `${row.title} ${row.offerId}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const chart = useMemo(() => {
    if (!data?.performanceAvailable || !range?.from || !range?.to) return [];
    const keys = method === 'all' ? data.methods.map(row => row.method) : [method];
    const dates = [];
    for (let date = range.from; date <= range.to; date = new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)) {
      if (!data.historyFrom || date >= data.historyFrom) dates.push(date);
    }
    return keys.map(key => ({ id: methods[key] || key, color: key === 'ADS' ? '#ffb24d' : '#38d6e6', data: dates.map(date => {
      const row = data.daily?.find(item => item.date === date && item.method === key);
      return { x: date, y: metric === 'ctr' ? (row?.impressions ? row.clicks / row.impressions * 100 : null) : row?.[metric] || 0 };
    }) }));
  }, [data, range, method, metric]);
  if (!data?.available && !data?.performanceAvailable) return <section className={panel} aria-label="Produtos no Google"><h3 className="text-base font-semibold">Produtos no Google</h3>
    <p className="mt-2 text-sm text-muted">{data?.catalogError || (data?.enabled ? 'A primeira sincronização do Merchant Center está em andamento. O desempenho aparecerá depois da importação.' : 'Conecte o Google Merchant Center em Conexões para acompanhar cliques, impressões e a aprovação dos produtos.')}</p>
    {data?.performanceError && <p role="status" className="mt-3 text-sm">{data.performanceError}</p>}
  </section>;
  return <div className="min-w-0 space-y-6" aria-label="Produtos no Google">
    {data.catalogError && <p role="status" className="text-sm">Últimos dados preservados. {data.catalogError}</p>}
    <section className={panel} aria-label="Desempenho dos produtos no Merchant Center">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-base font-semibold">Cliques e impressões dos produtos</h3><p className="mt-1 text-xs text-muted">{data.accountName || 'Merchant Center'} · conta {data.accountId}</p></div>
        <label className="space-y-1"><span className="block text-xs text-muted">Origem no Merchant</span><select className={select} value={method} onChange={event => setMethod(event.target.value)}>
          <option value="ORGANIC">Listagens gratuitas</option><option value="ADS">Anúncios</option><option value="all">Comparar as duas origens</option>
        </select></label></div>
      <dl className="mt-5 grid grid-cols-3 gap-3 border-y border-line py-4">{[['Cliques', clicks, number], ['Impressões', impressions, number], ['CTR', ctr, percent]].map(([label, value, format]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-words text-xl font-semibold tabular-nums sm:text-2xl">{format(value)}</dd></div>)}</dl>
      {available ? <>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Métrica do Merchant">{[['clicks', 'Cliques'], ['impressions', 'Impressões'], ['ctr', 'CTR']].map(([key, label]) => <button key={key} type="button" aria-pressed={metric === key} onClick={() => setMetric(key)} className={`${btnSecondarySm} ${metric === key ? 'bg-primary/15 text-primary' : ''}`}>{label}</button>)}</div>
        {method === 'all' && <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted" aria-label="Origens do gráfico">{chart.map(row => <span key={row.id} className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: row.color }} aria-hidden="true" />{row.id}</span>)}</div>}
        {!impressions && !clicks ? <p className="py-8 text-sm text-muted">O Merchant Center ainda não registrou cliques ou impressões nesta origem e neste período. Produtos em análise podem ainda não estar sendo exibidos.</p>
          : <div className="mt-3 h-64" role="img" aria-label={`Evolução de ${metric === 'ctr' ? 'CTR' : metric === 'clicks' ? 'cliques' : 'impressões'} dos produtos`}><ResponsiveLine data={chart} colors={line => line.color}
            margin={{ top: 12, right: 20, bottom: 45, left: 55 }} xScale={{ type: 'point' }} yScale={{ type: 'linear', min: 0, max: 'auto' }}
            axisBottom={{ tickRotation: -35, tickValues: chart[0]?.data.filter((_, index) => index % Math.max(1, Math.ceil(chart[0].data.length / 8)) === 0).map(point => point.x), format: value => `${value.slice(8, 10)}/${value.slice(5, 7)}` }}
            axisLeft={{ format: value => metric === 'ctr' ? `${number(value)}%` : number(value) }} yFormat={value => metric === 'ctr' ? percent(value) : number(value)} enablePoints={false} enableGridX={false} enableSlices="x" animate={false}
            theme={{ text: { fill: '#8b95ad', fontSize: 11 }, grid: { line: { stroke: '#232c40' } }, tooltip: { container: { background: '#141a28', color: '#eef1f8', borderRadius: 8 } } }} />
          </div>}
      </> : <p className="py-6 text-sm text-muted">{data.performanceError || (data.coveragePartial ? `O período começa antes do histórico importado. Selecione datas a partir de ${data.historyFrom.split('-').reverse().join('/')}.` : 'Importando o histórico de desempenho. As métricas ficam indisponíveis até a primeira carga completa.')}</p>}
      {data.performanceError && available && <p role="status" className="mt-3 text-sm">Últimos dados preservados. {data.performanceError}</p>}
      <p className="mt-3 max-w-3xl text-xs text-muted">Dados do Merchant Center · atualização {when(data.performanceUpdatedAt)}. As métricas podem chegar com atraso e ser revisadas pelo Google. Cliques de anúncios também podem constar no Google Ads; estas medidas não são somadas ao investimento ou às métricas das outras fontes.</p>
    </section>
    <label className="block max-w-md space-y-1"><span className="block text-xs text-muted">Buscar produto no Merchant</span><input className={`${input} w-full`} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nome ou código da oferta" /></label>
    <DataTable title="Produtos com mais cliques" headers={['Produto / oferta', 'Origem', 'Cliques', 'Impressões', 'CTR']} empty={query ? 'Nenhum produto encontrado com esse filtro.' : available ? 'O Google ainda não retornou desempenho por produto neste período.' : 'Aguardando a importação do desempenho.'}
      rows={products.map(row => [<span><span className="block">{row.title}</span><span className="text-xs text-muted">{row.offerId}</span></span>, methods[row.method] || row.method, number(row.clicks), number(row.impressions), percent(row.ctr)])} />
    <details className="border-t border-line pt-3" aria-label="Situação do catálogo e do feed"><summary className="cursor-pointer py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Catálogo e feed · {number(data.catalog?.total)} ofertas · {number(data.catalog?.pending)} em análise</summary>
      <div className="mt-4 space-y-6">
        <p className="text-xs text-muted">Situação atual das listagens gratuitas no Brasil, consultada em {when(data.observedAt)}. Este retrato não muda com o período do desempenho.</p>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">{[['Aprovadas', data.catalog?.approved], ['Em análise', data.catalog?.pending], ['Reprovadas', data.catalog?.disapproved], ['Não informado', data.catalog?.unknown]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{number(value)}</dd></div>)}</dl>
        <DataTable title="Pendências dos produtos" headers={['Motivo', 'Destinos', 'Ofertas afetadas']} empty="Nenhuma pendência retornada pelo Merchant nesta consulta." rows={(data.issues || []).map(issue => [<span><span className="block">{issueTitle(issue)}</span><span className="text-xs text-muted">{issueDetail(issue)}</span>{issue.examples?.length > 0 && <span className="mt-1 block text-xs text-muted">Exemplos: {issue.examples.join(' · ')}</span>}</span>, (issue.contexts || [issue.context]).map(context => destinations[context] || 'Outras exibições').join(' · '), number(issue.products)])} />
        <DataTable title="Fontes do catálogo" headers={['Fonte', 'Programação', 'Último processamento', 'Itens']} empty="Nenhuma fonte retornada pelo Merchant." rows={(data.sources || []).map(source => [<span><span className="block">{source.name}</span><span className="block break-all text-xs text-muted">{source.feedUrl || source.input}</span>{source.uploadError && <span className="block text-xs">{source.uploadError}</span>}</span>, source.scheduled ? (source.frequency === 'FREQUENCY_DAILY' ? 'Diária' : source.frequency) : 'Sem busca programada', <span><span className="block">{source.processingState === 'SUCCEEDED' ? 'Processado com sucesso' : source.processingState || 'Não informado'}</span><span className="text-xs text-muted">{when(source.uploadTime)}</span></span>, number(source.itemsTotal)])} />
        <DataTable title="Ofertas no catálogo" headers={['Produto / oferta', 'Listagens gratuitas', 'Disponibilidade']} empty="Nenhuma oferta retornada na última consulta completa." rows={(data.catalogProducts || []).filter(row => !query || `${row.title} ${row.offerId}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(row => [<span><span className="block">{row.title}</span><span className="text-xs text-muted">{row.offerId}</span></span>, states[row.status] || 'Não informado', stock[row.availability] || 'Não informado'])} />
      </div>
    </details>
  </div>;
}
