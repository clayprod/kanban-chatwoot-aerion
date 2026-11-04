export const CHART_SERIES = {
  money: [
    ['revenue', 'Receita de produtos', '#0d9488', 'left'], ['spend', 'Investimento total', '#8b78f5', 'right'],
    ['metaSpend', 'Meta Ads', '#3b82f6', 'right'], ['googleSpend', 'Google Ads', '#d97706', 'right'], ['unpaidValue', 'Aguardando pagamento', '#e56767', 'left'],
  ],
  efficiency: [
    ['cpc', 'CPC total', '#8b78f5', 'left'], ['metaCpc', 'CPC Meta', '#3b82f6', 'left'], ['googleCpc', 'CPC Google', '#d97706', 'left'], ['roas', 'ROAS atribuído', '#0d9488', 'right'],
  ],
  reach: [
    ['impressions', 'Impressões totais', '#8b78f5', 'left'], ['metaImpressions', 'Impressões Meta', '#3b82f6', 'left'], ['googleImpressions', 'Impressões Google', '#d97706', 'left'],
    ['ctr', 'CTR total', '#0d9488', 'right'], ['metaCtr', 'CTR Meta', '#60a5fa', 'right'], ['googleCtr', 'CTR Google', '#fbbf24', 'right'],
  ],
  cpm: [
    ['cpm', 'CPM total', '#8b78f5', 'left'], ['metaCpm', 'CPM Meta', '#3b82f6', 'left'], ['googleCpm', 'CPM Google', '#d97706', 'left'],
    ['impressions', 'Impressões totais', '#0d9488', 'right'], ['metaImpressions', 'Impressões Meta', '#60a5fa', 'right'], ['googleImpressions', 'Impressões Google', '#fbbf24', 'right'],
  ],
  volume: [['orders', 'Pedidos pagos', '#0d9488', 'left'], ['sessions', 'Sessões GA4', '#3b82f6', 'right']],
  store: [
    ['paidImpressions', 'Mídia paga · impressões', '#8b78f5', 'left'], ['searchImpressions', 'Busca orgânica · impressões', '#3b82f6', 'left'], ['shopImpressions', 'Shopping gratuito · impressões', '#d97706', 'left'],
    ['paidClicks', 'Mídia paga · cliques', '#8b78f5', 'left'], ['searchClicks', 'Busca orgânica · cliques', '#3b82f6', 'left'], ['shopClicks', 'Shopping gratuito · cliques', '#d97706', 'left'],
    ['sessions', 'Sessões GA4', '#0d9488', 'left'], ['orders', 'Pedidos pagos', '#e56767', 'left'],
  ],
  traffic: [['sessions', 'Sessões GA4', '#3b82f6', 'left'], ['purchases', 'Compras GA4', '#0d9488', 'right']],
};
export const CHART_AXES = {
  money: ['Receita e pendentes · R$', 'Investimento · R$'],
  efficiency: ['CPC · R$/clique', 'ROAS · vezes'],
  reach: ['Impressões', 'CTR · %'],
  cpm: ['CPM · R$/mil impressões', 'Impressões'],
  volume: ['Pedidos pagos', 'Sessões GA4'],
  traffic: ['Sessões GA4', 'Compras GA4'],
  store: ['Contagem', 'Contagem'],
};
export const CHART_DEFAULTS = { money: ['revenue', 'spend'], efficiency: ['cpc', 'roas'], reach: ['impressions', 'ctr'], cpm: ['cpm', 'impressions'], volume: ['orders', 'sessions'], traffic: ['sessions', 'purchases'], store: ['paidImpressions', 'searchImpressions', 'shopImpressions', 'sessions'] };

function axisMaximum(values) {
  const max = values.reduce((n, value) => Math.max(n, value || 0), 0);
  if (!max) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max / 4));
  const step = Math.ceil(max / 4 / magnitude) * magnitude;
  return step * 4;
}
export function prepareSalesChart(rows, mode, interval, visible) {
  const series = CHART_SERIES[mode], buckets = new Map();
  const fields = ['revenue', 'unpaidValue', 'orders', 'sessions', 'purchases', 'spend', 'googleSpend', 'metaSpend', 'clicks', 'googleClicks', 'metaClicks', 'impressions', 'googleImpressions', 'metaImpressions', 'conversionValue', 'paidImpressions', 'paidClicks', 'searchImpressions', 'searchClicks', 'shopImpressions', 'shopClicks'];
  for (const row of rows) {
    const date = new Date(`${row.date}T12:00:00Z`);
    if (interval === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    const key = interval === 'month' ? `${row.date.slice(0, 7)}-01` : interval === 'week' ? date.toISOString().slice(0, 10) : row.date;
    if (!buckets.has(key)) buckets.set(key, { date: key });
    for (const field of fields) if (row[field] != null && Number.isFinite(row[field])) buckets.get(key)[field] = (buckets.get(key)[field] || 0) + row[field];
  }
  const points = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const point of points) {
    point.cpc = point.clicks > 0 && point.spend != null ? point.spend / point.clicks : null;
    point.metaCpc = point.metaClicks > 0 && point.metaSpend != null ? point.metaSpend / point.metaClicks : null;
    point.googleCpc = point.googleClicks > 0 && point.googleSpend != null ? point.googleSpend / point.googleClicks : null;
    point.roas = point.spend > 0 && point.conversionValue != null ? point.conversionValue / point.spend : null;
    for (const prefix of ['', 'meta', 'google']) {
      const impressions = point[prefix ? `${prefix}Impressions` : 'impressions'];
      const clicks = point[prefix ? `${prefix}Clicks` : 'clicks'];
      const spend = point[prefix ? `${prefix}Spend` : 'spend'];
      point[prefix ? `${prefix}Cpm` : 'cpm'] = impressions > 0 && spend != null ? 1000 * spend / impressions : null;
      point[prefix ? `${prefix}Ctr` : 'ctr'] = impressions > 0 && clicks != null ? 100 * clicks / impressions : null;
    }
  }
  const available = series.filter(([id]) => points.some(point => point[id] != null));
  const selected = available.filter(([id]) => visible.includes(id));
  const max = Object.fromEntries(['left', 'right'].map(side => [side, axisMaximum(selected.filter(([, , , axis]) => axis === side).flatMap(([id]) => points.map(point => point[id])))]));
  // Each side has its own linear scale. A shared 0..1 pixel domain lets Nivo
  // render slices once; axes and tooltips always show the original units.
  const data = selected.map(([key, id, color, axis]) => ({ id, color, axis, data: points.map(point => ({ x: point.date, y: point[key] == null ? null : point[key] / max[axis], rawValue: point[key] ?? null })) }));
  return { series, available, data, max, points, selected };
}

// Média móvel que ignora lacunas: janela de até `size` pontos medidos terminando no ponto atual.
export function movingAverage(values, size = 7) {
  return values.map((value, i) => {
    if (value == null) return null;
    const window = values.slice(Math.max(0, i - size + 1), i + 1).filter(v => v != null);
    return window.length >= Math.min(3, size) ? window.reduce((n, v) => n + v, 0) / window.length : null;
  });
}
// Volume pequeno: poucas unidades no período ou poucos dias com medição.
export function isSmallSample(values, additive = true) {
  const measured = values.filter(v => v != null);
  if (!measured.length) return false;
  const total = measured.reduce((n, v) => n + v, 0);
  return additive ? total < 30 || measured.length < 5 : measured.length < 5;
}
// Estado de uma plataforma de anúncio a partir do último dia com entrega real.
export function adStatus(lastDay, today, connected = true) {
  if (!connected) return { tone: 'off', label: 'Não conectado' };
  if (!lastDay) return { tone: 'idle', label: 'Conectado · nunca teve entrega' };
  const days = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${lastDay}T12:00:00Z`)) / 86400000);
  if (days <= 2) return { tone: 'live', label: 'Ativa', lastDay, days };
  return { tone: 'paused', label: 'Sem entrega', lastDay, days };
}
