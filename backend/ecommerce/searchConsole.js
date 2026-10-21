// Search Console totals are independent of page/query breakdowns: anonymized
// queries and aggregation differences prevent adding the breakdowns as totals.
function buildSearchReport(records, range, connection) {
  const rows = records.filter(r => r.date >= range.from && r.date <= range.to);
  const aggregate = list => {
    const clicks = list.reduce((sum, r) => sum + r.clicks, 0);
    const impressions = list.reduce((sum, r) => sum + r.impressions, 0);
    return { clicks, impressions, ctr: impressions ? clicks / impressions * 100 : null,
      position: impressions ? list.reduce((sum, r) => sum + r.position * r.impressions, 0) / impressions : null };
  };
  const groups = (kind, field) => {
    const grouped = new Map();
    rows.filter(r => r.kind === kind).forEach(row => { if (!grouped.has(row[field])) grouped.set(row[field], []); grouped.get(row[field]).push(row); });
    return [...grouped].map(([value, list]) => ({ [field]: value, ...aggregate(list) })).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
  };
  const daily = rows.filter(r => r.kind === 'search_total').sort((a, b) => a.date.localeCompare(b.date));
  return { available: Boolean(connection?.last_success_at), site: connection?.config?.site_url || null,
    summary: connection?.last_success_at ? aggregate(daily) : null, latestDate: daily.at(-1)?.date || null,
    daily, pages: groups('search_page', 'landing'), queries: groups('search_query', 'query'),
    truncated: rows.some(r => r.truncated), sitemaps: connection?.info?.sitemaps || [], timezone: 'America/Los_Angeles' };
}
module.exports = { buildSearchReport };
