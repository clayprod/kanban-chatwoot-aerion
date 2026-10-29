// Merchant traffic is its own measurement. Paid clicks are never added again
// to Google Ads, and current catalog state never follows the date range.
function buildMerchantReport(catalog, metrics, range, connection) {
  const available = Boolean(catalog?.observedAt);
  const coveragePartial = Boolean(connection?.info?.history_from && range.from < connection.info.history_from);
  const performanceAvailable = Boolean(connection?.last_success_at && connection?.info?.performance_last_success_at && !coveragePartial);
  const rows = metrics.filter(row => row.date >= range.from && row.date <= range.to);
  const products = catalog?.products || [];
  const statusFor = (product, context = 'FREE_LISTINGS') => {
    const destination = product.destinations.find(d => d.context === context);
    if (destination?.approved?.includes('BR')) return 'approved';
    if (destination?.pending?.includes('BR')) return 'pending';
    if (destination?.disapproved?.includes('BR')) return 'disapproved';
    return 'unknown';
  };
  const states = { approved: 0, pending: 0, disapproved: 0, unknown: 0 };
  products.forEach(product => { states[statusFor(product)]++; });
  const methods = new Map(), ranked = new Map(), days = new Map(), issues = new Map();
  const count = (map, key, base, row) => {
    if (!map.has(key)) map.set(key, { ...base, clicks: 0, impressions: 0 });
    const entry = map.get(key);
    entry.clicks += row.clicks; entry.impressions += row.impressions;
  };
  const withCtr = row => ({ ...row, ctr: row.impressions ? row.clicks / row.impressions * 100 : null });
  for (const row of rows) {
    count(methods, row.marketingMethod, { method: row.marketingMethod }, row);
    count(ranked, JSON.stringify([row.offerId, row.marketingMethod]), { offerId: row.offerId, title: row.title, method: row.marketingMethod }, row);
    count(days, JSON.stringify([row.date, row.marketingMethod]), { date: row.date, method: row.marketingMethod }, row);
  }
  // A successful query may omit every zero-activity method. Known methods still
  // show measured zero; access failures remain null rather than invented zero.
  const byMethod = ['ORGANIC', 'ADS', ...[...methods.keys()].filter(key => !['ORGANIC', 'ADS'].includes(key))].map(method =>
    performanceAvailable ? withCtr(methods.get(method) || { method, clicks: 0, impressions: 0 }) : { method, clicks: null, impressions: null, ctr: null });
  for (const product of products) {
    const seen = new Set();
    for (const issue of product.issues) {
      if (issue.countries.length && !issue.countries.includes('BR')) continue;
      const key = JSON.stringify([issue.code, issue.context]);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!issues.has(key)) issues.set(key, { ...issue, products: 0, examples: [] });
      const group = issues.get(key); group.products++;
      if (group.examples.length < 3) group.examples.push(product.title);
    }
  }
  const titleByOffer = new Map(products.map(product => [product.offerId, product.title]));
  const rankedRows = [...ranked.values()].map(row => withCtr({ ...row, title: titleByOffer.get(row.offerId) || row.title }));
  return { available, performanceAvailable, accountId: connection?.config?.account_id || null, accountName: connection?.info?.account_name || null,
    observedAt: catalog?.observedAt || null, performanceUpdatedAt: connection?.info?.performance_last_success_at || null,
    performanceError: connection?.info?.performance_error || null, catalogError: connection?.error || null, coveragePartial, syncing: Boolean(connection?.cursor), enabled: Boolean(connection?.enabled),
    historyFrom: connection?.info?.history_from || null, performanceThrough: connection?.info?.performance_through || null,
    catalog: available ? { total: products.length, ...states } : { total: null, approved: null, pending: null, disapproved: null, unknown: null },
    methods: byMethod, products: performanceAvailable ? rankedRows.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions) : [],
    daily: performanceAvailable ? [...days.values()].map(withCtr).sort((a, b) => a.date.localeCompare(b.date)) : [],
    issues: [...issues.values()].sort((a, b) => b.products - a.products),
    sources: catalog?.sources || [],
    catalogProducts: products.map(product => ({ offerId: product.offerId, title: product.title, availability: product.availability,
      status: statusFor(product), adsStatus: statusFor(product, 'SHOPPING_ADS'), issueCount: product.issues.length })),
  };
}
module.exports = { buildMerchantReport };
