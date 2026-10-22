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
