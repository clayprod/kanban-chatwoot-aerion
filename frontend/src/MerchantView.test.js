import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import MerchantView from './MerchantView';

jest.mock('@nivo/line', () => ({ ResponsiveLine: ({ data }) => <div aria-label="Séries do gráfico">{data.map(row => row.id).join(' · ')}</div> }));
const range = { from: '2026-10-01', to: '2026-10-02' };
const data = { available: true, performanceAvailable: true, accountId: '5890381416', accountName: 'Aerion Technologies',
  observedAt: '2026-10-28T19:30:00Z', performanceUpdatedAt: '2026-10-28T19:30:00Z',
  catalog: { total: 29, approved: 0, pending: 29, disapproved: 0, unknown: 0 },
  methods: [{ method: 'ORGANIC', clicks: 30, impressions: 200 }, { method: 'ADS', clicks: 100, impressions: 1000 }],
  products: [{ offerId: 'A', title: 'Drone Alpha', method: 'ORGANIC', clicks: 30, impressions: 200, ctr: 15 },
    { offerId: 'B', title: 'Drone Lite', method: 'ADS', clicks: 100, impressions: 1000, ctr: 10 }],
  daily: [{ date: '2026-10-01', method: 'ORGANIC', clicks: 30, impressions: 200 }, { date: '2026-10-01', method: 'ADS', clicks: 100, impressions: 1000 }],
  sources: [{ name: 'PRODUCTS SOURCE 1', scheduled: true, frequency: 'FREQUENCY_DAILY', processingState: 'SUCCEEDED', itemsTotal: 29 }],
  issues: [{ code: 'pending_initial_policy_review_free_listings', description: 'Pending initial review', context: 'FREE_LISTINGS', resolution: 'pending_processing', products: 29 }],
  catalogProducts: [{ offerId: 'A', title: 'Drone Alpha', status: 'pending', availability: 'PREORDER' }],
};

test('Merchant prioritizes performance and switches organic and ads without blending other platforms', () => {
  render(<MerchantView data={data} range={range} />);
  const performance = screen.getByRole('region', { name: 'Desempenho dos produtos no Merchant Center' });
  expect(within(performance).getByText('15%')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cliques' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.change(screen.getByLabelText('Origem no Merchant'), { target: { value: 'ADS' } });
  expect(within(performance).getByText('10%')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Origem no Merchant'), { target: { value: 'all' } });
  expect(within(performance).getByText('10,83%')).toBeInTheDocument();
  expect(screen.getByLabelText('Séries do gráfico')).toHaveTextContent('Listagens gratuitas · Anúncios');
  fireEvent.click(screen.getByRole('button', { name: 'Impressões' }));
  expect(screen.getByLabelText('Evolução de impressões dos produtos')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Buscar produto no Merchant'), { target: { value: 'Lite' } });
  const table = screen.getByRole('table', { name: 'Produtos com mais cliques' });
  expect(within(table).getByText('Drone Lite')).toBeInTheDocument();
  expect(within(table).queryByText('Drone Alpha')).not.toBeInTheDocument();
});

test('pending first review is separate from successful feed processing and historical performance', () => {
  render(<MerchantView data={data} range={range} />);
  const details = screen.getByLabelText('Situação do catálogo e do feed');
  expect(details).not.toHaveAttribute('open');
  fireEvent.click(within(details).getByText(/Catálogo e feed/));
  expect(screen.getByText('Aguardando análise do Google')).toBeVisible();
  expect(screen.getByText('Processado com sucesso')).toBeVisible();
  expect(screen.getByText(/Este retrato não muda com o período/)).toBeVisible();
  expect(screen.getByText('Pré-venda')).toBeVisible();
});

test('unavailable performance stays unavailable while its catalog remains usable', () => {
  render(<MerchantView data={{ ...data, performanceAvailable: false, performanceError: 'Revise o acesso aos relatórios.' }} range={range} />);
  const performance = screen.getByRole('region', { name: 'Desempenho dos produtos no Merchant Center' });
  expect(within(performance).getAllByText('—')).toHaveLength(3);
  expect(within(performance).getByText('Revise o acesso aos relatórios.')).toBeInTheDocument();
  expect(screen.getByText(/29 ofertas · 29 em análise/)).toBeInTheDocument();
});

test('successfully imported empty performance reports zero activity with an undefined CTR', () => {
  render(<MerchantView data={{ ...data, methods: [{ method: 'ORGANIC', clicks: 0, impressions: 0 }], products: [], daily: [] }} range={range} />);
  expect(screen.getByText(/ainda não registrou cliques ou impressões/)).toBeInTheDocument();
  expect(screen.getByText(/ainda não retornou desempenho por produto/)).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Desempenho dos produtos no Merchant Center' })).getAllByText('0')).toHaveLength(2);
});

test('unconfigured Merchant provides connection guidance', () => {
  render(<MerchantView range={range} />);
  expect(screen.getByText(/Conecte o Google Merchant Center em Conexões/)).toBeInTheDocument();
});
