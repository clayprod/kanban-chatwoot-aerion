// Cruza, por dia, o alcance de TODOS os canais da loja (mídia paga, busca
// orgânica, Shopping gratuito) com sessões e pedidos. Fontes ausentes ficam
// null para o gráfico mostrar lacuna, nunca zero inventado.
export function mergeStoreDaily(report) {
  const search = new Map((report.search?.daily || []).map(r => [r.date, r]));
  const shop = new Map((report.merchant?.daily || []).filter(r => r.method === 'ORGANIC').map(r => [r.date, r]));
  const searchOn = Boolean(report.search?.available), shopOn = Boolean(report.merchant?.performanceAvailable);
  return (report.daily || []).map(d => ({
    ...d,
    paidImpressions: d.impressions, paidClicks: d.clicks,
    searchImpressions: searchOn ? search.get(d.date)?.impressions ?? 0 : null, searchClicks: searchOn ? search.get(d.date)?.clicks ?? 0 : null,
    shopImpressions: shopOn ? shop.get(d.date)?.impressions ?? 0 : null, shopClicks: shopOn ? shop.get(d.date)?.clicks ?? 0 : null,
  }));
}
const isPaidMedium = m => /^(cpc|ppc|paid|cpm|paidsocial|paid_social|display)/i.test(m || '');
export function channelTable(report) {
  const sum = (rows, k) => rows.reduce((n, r) => n + (Number(r[k]) || 0), 0);
  const traffic = (report.traffic || []).filter(r => r.kind === 'traffic');
  const paidT = traffic.filter(r => isPaidMedium(r.medium)), orgT = traffic.filter(r => /^organic$/i.test(r.medium || ''));
  const media = report.summary?.media, search = report.search?.summary;
  const shop = report.merchant?.methods?.find(r => r.method === 'ORGANIC');
  const row = (id, label, imp, clk, rows, note) => ({ id, label, impressions: imp ?? null, clicks: clk ?? null,
    ctr: imp ? clk / imp * 100 : null, sessions: rows ? sum(rows, 'sessions') : null, purchases: rows ? sum(rows, 'purchases') : null, note,
    sessionsPerClick: rows && clk ? sum(rows, 'sessions') / clk : null, buyRate: rows && sum(rows, 'sessions') ? sum(rows, 'purchases') / sum(rows, 'sessions') * 100 : null });
  return [
    row('paid', report.marketing?.chatgptAds?.configured?'Mídia paga (Google Ads + Meta + ChatGPT Ads)':'Mídia paga (Google Ads + Meta)', media?.impressions, media?.clicks, paidT, 'Sessões GA4 com mídia cpc/paga'),
    row('search', 'Busca orgânica (Search Console)', search?.impressions, search?.clicks, orgT, 'Sessões GA4 com mídia organic (inclui Shopping gratuito)'),
    row('shop', 'Shopping gratuito (Merchant)', shop?.impressions, shop?.clicks, null, 'O GA4 não separa Shopping gratuito da busca orgânica'),
  ];
}
export function funnelSteps(report) {
  const s = report.summary || {}, ev = Object.fromEntries((report.traffic || []).filter(r => r.kind === 'funnel').reduce((m, r) => m.set(r.event, (m.get(r.event) || 0) + (r.events || 0)), new Map()));
  const t = channelTable(report);
  const imp = t.reduce((n, r) => n + (r.impressions || 0), 0), clk = t.reduce((n, r) => n + (r.clicks || 0), 0);
  return [['Impressões', imp || null], ['Cliques', clk || null], ['Sessões GA4', s.sessions], ['Viram produto', ev.view_item ?? null], ['Carrinho', ev.add_to_cart ?? null], ['Checkout', ev.begin_checkout ?? null], ['Pedidos pagos', s.orders]];
}
