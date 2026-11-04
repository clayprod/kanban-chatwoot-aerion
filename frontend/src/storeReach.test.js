import { mergeStoreDaily, channelTable, funnelSteps } from './storeReach';
const report = { daily: [{ date: '2026-10-20', impressions: 100, clicks: 5, sessions: 40, orders: 1 }],
  search: { available: true, daily: [{ date: '2026-10-20', impressions: 300, clicks: 12 }], summary: { impressions: 300, clicks: 12 } },
  merchant: { performanceAvailable: true, daily: [{ date: '2026-10-20', method: 'ORGANIC', impressions: 50, clicks: 2 }, { date: '2026-10-20', method: 'ADS', impressions: 999, clicks: 9 }], methods: [{ method: 'ORGANIC', impressions: 50, clicks: 2 }] },
  summary: { media: { impressions: 100, clicks: 5 }, sessions: 40, orders: 1 },
  traffic: [{ kind: 'traffic', medium: 'cpc', sessions: 10, purchases: 1 }, { kind: 'traffic', medium: 'organic', sessions: 20, purchases: 0 }, { kind: 'funnel', event: 'add_to_cart', events: 7 }] };
test('merges channels per day and ignores Merchant ads to avoid double counting', () => {
  const [d] = mergeStoreDaily(report);
  expect([d.paidImpressions, d.searchImpressions, d.shopImpressions]).toEqual([100, 300, 50]);
});
test('disconnected sources stay null, not zero', () => {
  const [d] = mergeStoreDaily({ daily: report.daily });
  expect(d.searchImpressions).toBeNull(); expect(d.shopImpressions).toBeNull();
});
test('channel table crosses reach with GA4 sessions and funnel totals', () => {
  const t = channelTable(report);
  expect(t[0].sessions).toBe(10); expect(t[0].ctr).toBe(5); expect(t[1].sessionsPerClick).toBeCloseTo(20 / 12); expect(t[2].sessions).toBeNull();
  expect(funnelSteps(report).find(([l]) => l === 'Carrinho')[1]).toBe(7);
});
