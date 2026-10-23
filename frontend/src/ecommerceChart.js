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
};
export const CHART_AXES = {
  money: ['Receita e pendentes · R$', 'Investimento · R$'],
  efficiency: ['CPC · R$/clique', 'ROAS · vezes'],
  reach: ['Impressões', 'CTR · %'],
  cpm: ['CPM · R$/mil impressões', 'Impressões'],
  volume: ['Pedidos pagos', 'Sessões GA4'],
};
export const CHART_DEFAULTS = { money: ['revenue', 'spend'], efficiency: ['cpc', 'roas'], reach: ['impressions', 'ctr'], cpm: ['cpm', 'impressions'], volume: ['orders', 'sessions'] };

function axisMaximum(values) {
  const max = values.reduce((n, value) => Math.max(n, value || 0), 0);
  if (!max) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max / 4));
  const step = Math.ceil(max / 4 / magnitude) * magnitude;
  return step * 4;
}
export function prepareSalesChart(rows, mode, interval, visible) {
  const series = CHART_SERIES[mode], buckets = new Map();
  const fields = ['revenue', 'unpaidValue', 'orders', 'sessions', 'spend', 'googleSpend', 'metaSpend', 'clicks', 'googleClicks', 'metaClicks', 'impressions', 'googleImpressions', 'metaImpressions', 'conversionValue'];
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
