import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axios from 'axios';
import EcommerceView from './EcommerceView';

jest.mock('axios', () => ({ get: jest.fn(), put: jest.fn(), post: jest.fn(), isCancel: jest.fn() }));
jest.mock('@nivo/line', () => ({ ResponsiveLine: () => <div>Gráfico de receita</div> }));
const report = {
  range: { from: '2026-10-01', to: '2026-10-21', previousFrom: '2026-09-10', previousTo: '2026-09-30' },
  currencies: ['BRL'], summary: { revenue: null, previousRevenue: null, orders: null, ticket: null, sessions: null, spend: null },
  products: [], orders: [], traffic: [], ads: [], daily: [], coupons: [], utms: [], links: [], couponCatalog: [],
};
beforeEach(() => {
  jest.clearAllMocks();
  axios.isCancel.mockReturnValue(false);
  axios.get.mockImplementation(url => Promise.resolve({ data: url.endsWith('/status') ? { connections: [], encryptionReady: true } : report }));
});
test('empty sources show setup guidance and unavailable metrics instead of invented results', async () => {
  render(<EcommerceView isAdmin onNavigate={jest.fn()} />);
  expect(await screen.findByRole('button', { name: 'Configurar conexões' })).toBeInTheDocument();
  expect(screen.getByText('Conecte o WooCommerce para acompanhar a evolução de vendas.')).toBeInTheDocument();
  expect(screen.getAllByText('—').length).toBeGreaterThan(3);
});
test('members can consult reports but connection configuration stays restricted', async () => {
  render(<EcommerceView section="connections" isAdmin={false} onNavigate={jest.fn()} />);
  expect(await screen.findByText('A configuração de conexões é restrita aos administradores.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Conexões' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Consumer Secret')).not.toBeInTheDocument();
});

test('chart series can be hidden, restored and switched to volume without mixing currency', async () => {
  axios.get.mockImplementation(url => Promise.resolve({ data: url.endsWith('/status') ? { connections: [], encryptionReady: true } : {
    ...report, daily: [{ date: '2026-10-21', revenue: 100, spend: 20, orders: 1, sessions: 10 }],
  } }));
  render(<EcommerceView onNavigate={jest.fn()} />);
  const revenue = await screen.findByRole('button', { name: 'Receita de produtos' });
  const spend = screen.getByRole('button', { name: 'Investimento total' });
  expect(revenue).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(revenue); fireEvent.click(spend);
  expect(screen.getByText('Selecione uma linha acima para exibir o gráfico.')).toBeInTheDocument();
  fireEvent.click(revenue);
  expect(revenue).toHaveAttribute('aria-pressed', 'true');
  fireEvent.change(screen.getByLabelText('Métrica do gráfico'), { target: { value: 'volume' } });
  expect(screen.getByRole('button', { name: 'Pedidos pagos' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('button', { name: 'Receita de produtos' })).not.toBeInTheDocument();
});

test('marketing keeps traffic and campaigns inside the same main section', async () => {
  render(<EcommerceView section="ads" onNavigate={jest.fn()} />);
  const traffic = await screen.findByRole('button', { name: 'Tráfego e conversão' });
  fireEvent.click(traffic);
  expect(await screen.findByText('Origem do tráfego')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Marketing' })).toHaveAttribute('aria-current', 'page');
});

test('Search Console stays in Marketing and shows organic totals separately from sales', async () => {
  axios.get.mockImplementation(url => Promise.resolve({ data: url.endsWith('/status') ? { connections: [], encryptionReady: true } : {
    ...report, search: { available: true, site: 'sc-domain:aerion.com.br', latestDate: '2026-10-18', summary: { clicks: 15, impressions: 1000, ctr: 1.5, position: 9 }, pages: [], queries: [], daily: [], sitemaps: [] },
  } }));
  render(<EcommerceView section="ads" onNavigate={jest.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Busca orgânica e SEO' }));
  expect(screen.getByText('Visibilidade na busca do Google')).toBeInTheDocument();
  expect(screen.getByText('sc-domain:aerion.com.br')).toBeInTheDocument();
  expect(screen.getByText('1,5%')).toBeInTheDocument();
  expect(screen.getByText(/não equivalem a sessões do GA4 ou vendas/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Marketing' })).toHaveAttribute('aria-current', 'page');
});
test('report failures show an actionable error with retry', async () => {
  axios.get.mockRejectedValue({ response: { data: { error: 'Fonte indisponível' } } });
  render(<EcommerceView onNavigate={jest.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Fonte indisponível');
  const calls = axios.get.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  await waitFor(() => expect(axios.get.mock.calls.length).toBeGreaterThan(calls));
});
test('media report keeps currency, attribution and the conversion caveat visible', async () => {
  axios.get.mockImplementation(url => Promise.resolve({ data: url.endsWith('/status') ? { connections: [], encryptionReady: true } : {
    ...report, ads: [{ provider: 'meta_ads', campaignId: '1', campaign: 'Drone outubro', spend: 20, clicks: 4, conversions: 2,
      conversionValue: 100, currency: 'USD', attribution: '7 dias após clique / 1 dia após visualização', timezone: 'America/Sao_Paulo' }], currencies: ['USD'],
  } }));
  render(<EcommerceView section="ads" onNavigate={jest.fn()} />);
  expect(await screen.findByText('Drone outubro')).toBeInTheDocument();
  expect(screen.getByText('USD')).toBeInTheDocument();
  expect(screen.getByText('5×')).toBeInTheDocument();
  expect(screen.getByText(/Cada plataforma pode atribuir a mesma venda/)).toBeInTheDocument();
});
test('connection form keeps previously saved credentials on the server', async () => {
  axios.get.mockImplementation(url => Promise.resolve({ data: url.endsWith('/status') ? {
    connections: [{ provider: 'woocommerce', config: { url: 'https://loja.aerion.com.br' }, enabled: true, status: 'connected' }], encryptionReady: true,
  } : report }));
  axios.put.mockResolvedValue({ data: { saved: true } });
  render(<EcommerceView section="connections" isAdmin onNavigate={jest.fn()} />);
  const field = await screen.findByLabelText('Consumer Secret');
  expect(field).toHaveValue('');
  const form = field.closest('form');
  fireEvent.submit(form);
  await waitFor(() => expect(axios.put).toHaveBeenCalledWith('/api/ecommerce/connections/woocommerce', expect.objectContaining({ url: 'https://loja.aerion.com.br' })));
  expect(axios.put.mock.calls[0][1].consumer_secret).toBeUndefined();
});

test('Google Ads technical identity preserves saved JSON and does not offer user OAuth', async () => {
  axios.get.mockImplementation(url => Promise.resolve({ data: url.endsWith('/status') ? {
    connections: [{ provider: 'google_ads', config: { customer_id: '1234567890', auth_type: 'google_identity' }, enabled: true, status: 'pending' }], encryptionReady: true,
  } : report }));
  axios.put.mockResolvedValue({ data: { saved: true } });
  render(<EcommerceView section="connections" isAdmin onNavigate={jest.fn()} />);
  const field = await screen.findByLabelText('Credenciais da conta técnica Google Ads (JSON)');
  expect(field).toHaveValue('');
  expect(screen.queryByLabelText('OAuth Client Secret')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Autorizar Google Ads/ })).not.toBeInTheDocument();
  fireEvent.submit(field.closest('form'));
  await waitFor(() => expect(axios.put).toHaveBeenCalledWith('/api/ecommerce/connections/google_ads', expect.objectContaining({ auth_type: 'google_identity' })));
  expect(axios.put.mock.calls[0][1].service_account).toBeUndefined();
});
