import { prepareSalesChart } from './ecommerceChart';

test('small spend stays visible beside large revenue and keeps its original value', () => {
  const chart = prepareSalesChart([{ date: '2026-10-01', revenue: 10000, spend: 10 }], 'money', 'day', ['revenue', 'spend']);
  const spend = chart.data.find(s => s.id === 'Investimento total');
  expect(spend.axis).toBe('right');
  expect(spend.data[0].y).toBeGreaterThan(0.5);
  expect(spend.data[0].rawValue).toBe(10);
  expect(chart.max.left).toBeGreaterThanOrEqual(10000);
  expect(chart.max.right).toBeLessThan(20);
});

test('weekly CPC and ROAS use aggregated numerators and denominators, not daily averages', () => {
  const chart = prepareSalesChart([
    { date: '2026-10-19', spend: 10, clicks: 1, conversionValue: 0 },
    { date: '2026-10-20', spend: 90, clicks: 90, conversionValue: 500 },
  ], 'efficiency', 'week', ['cpc', 'roas']);
  expect(chart.points).toHaveLength(1);
  expect(chart.points[0].cpc).toBeCloseTo(100 / 91);
  expect(chart.points[0].roas).toBe(5);
  expect(chart.data.find(s => s.id === 'ROAS atribuído').axis).toBe('right');
});

test('unknown sources and zero denominators remain gaps, including monthly comparisons', () => {
  const chart = prepareSalesChart([{ date: '2026-10-01', spend: null, clicks: null, conversionValue: null }, { date: '2026-10-02', spend: 0, clicks: 0, conversionValue: 0 }], 'efficiency', 'month', ['cpc', 'roas']);
  expect(chart.available).toHaveLength(0);
  expect(chart.points[0].cpc).toBeNull();
  expect(chart.points[0].roas).toBeNull();
});

test('reach chart uses separate impression and percentage axes and weighted platform CTR', () => {
  const chart = prepareSalesChart([
    { date: '2026-10-19', impressions: 100, clicks: 10, googleImpressions: 100, googleClicks: 10, metaImpressions: null, metaClicks: null },
    { date: '2026-10-20', impressions: 900, clicks: 9, googleImpressions: 500, googleClicks: 5, metaImpressions: 400, metaClicks: 4 },
  ], 'reach', 'week', ['impressions', 'ctr', 'googleCtr', 'metaCtr']);
  expect(chart.points[0].ctr).toBeCloseTo(1.9);
  expect(chart.points[0].googleCtr).toBeCloseTo(2.5);
  expect(chart.points[0].metaCtr).toBeCloseTo(1);
  expect(chart.data.find(s => s.id === 'Impressões totais').axis).toBe('left');
  expect(chart.data.find(s => s.id === 'CTR total').axis).toBe('right');
  const empty = prepareSalesChart([{ date: '2026-10-19', impressions: 0, clicks: 0 }], 'reach', 'day', ['ctr']);
  expect(empty.points[0].ctr).toBeNull();
});
test('CPM uses grouped investment and impressions, keeping platforms and missing data distinct', () => {
  const { points } = prepareSalesChart([
    { date: '2026-10-19', spend: 10, impressions: 100, metaSpend: 10, metaImpressions: 100 },
    { date: '2026-10-20', spend: 20, impressions: 900, googleSpend: 20, googleImpressions: 900 },
  ], 'cpm', 'week', ['cpm', 'impressions', 'metaCpm', 'googleCpm']);
  expect(points[0].cpm).toBe(30);
  expect(points[0].metaCpm).toBe(100);
  expect(points[0].googleCpm).toBeCloseTo(20000 / 900);
  const empty = prepareSalesChart([{ date: '2026-10-19', spend: 5, impressions: 0 }], 'cpm', 'day', ['cpm']);
  expect(empty.points[0].cpm).toBeNull();
});
