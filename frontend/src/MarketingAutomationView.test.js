import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axios from 'axios';
import MarketingAutomationView from './MarketingAutomationView';
jest.mock('axios', () => ({ post: jest.fn(), put: jest.fn() }));
const data = { enabled: true, products: [{ id: '1', sku: 'DRONE', name: 'Drone', price: 100, group: 'Drones', url: 'https://loja.aerion.com.br/drone/', eligible: true, issues: [], warnings: [] }],
  readiness: [{ integration: 'meta_catalog', status: 'administrator_action', account: '123', action: 'Conceder acesso ao catálogo.' }],
  audiences: { store: [{ id: 'cart', days: 14, excludePaidDays: 180, status: 'administrator_action', size: null }] },
  contents: [{ id: 'draft', kind: 'creative', status: 'draft', data: { sku: 'DRONE', name: 'Drone', copy: 'Proposta revisável' } }], jobs: [], history: [] };
test('viewers see unavailable audience sizes and explicit blockers without mutation controls', () => {
  render(<MarketingAutomationView data={data} isAdmin={false} />);
  expect(screen.getByText('Conceder acesso ao catálogo.')).toBeInTheDocument();
  expect(screen.getByText('Indisponível')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Aprovar versão' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Salvar planejamento' })).not.toBeInTheDocument();
});
test('review records an explicit approval and refreshes only after the server accepts it', async () => {
  const refresh = jest.fn(); axios.post.mockResolvedValue({ data: {} });
  render(<MarketingAutomationView data={data} isAdmin onRefresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Aprovar versão' }));
  await waitFor(() => expect(axios.post).toHaveBeenCalledWith('/api/ecommerce/marketing/content/draft/review', { status: 'approved' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
});
test('failed reconciliation exposes an actionable error and retains product information', async () => {
  axios.post.mockRejectedValueOnce({ response: { data: { error: 'A conexão está desativada. Ative em Conexões.' } } });
  render(<MarketingAutomationView data={data} isAdmin onRefresh={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Conciliar produtos' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Ative em Conexões');
  expect(screen.getAllByText('DRONE').length).toBeGreaterThan(0);
});
