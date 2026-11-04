import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axios from 'axios';
import CampaignAssistantView, { suggestedRoute } from './CampaignAssistantView';
jest.mock('axios', () => ({ post: jest.fn() }));
const route = { provider: 'openrouter-image', model: 'bytedance-seed/seedream-5-0-pro', durations: [] };
const data = { products: [{ id: '1', name: 'Mini 7', sku: 'MINI', eligible: true, availability: 'in_stock' }], contents: [],
  assistant: { configured: true, capabilities: { capabilities: { capabilities: [{ capability: 'text-to-image', routes: [route] }, { capability: 'image-to-video', routes: [{ provider: 'openrouter-video', model: 'bytedance/seedance-2.0-fast', durations: [4, 5] }] }] } } } };
beforeEach(() => jest.clearAllMocks());
test('viewers can read the assistant without controls that create or approve work', () => {
  render(<CampaignAssistantView data={data} isAdmin={false} />);
  expect(screen.queryByRole('button', { name: 'Preparar plano com IA' })).not.toBeInTheDocument();
  expect(screen.getByText(/Seu primeiro arquivo aparecerá aqui/)).toBeInTheDocument();
});
test('plan requests use the selected real product and do not invent an advertising budget', async () => {
  axios.post.mockResolvedValue({ data: {} });const refresh = jest.fn();
  render(<CampaignAssistantView data={data} isAdmin onRefresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Preparar plano com IA' }));
  await waitFor(() => expect(axios.post).toHaveBeenCalledWith('/api/ecommerce/marketing/assistant/plan', expect.objectContaining({ productIds: ['1'] })));
  expect(axios.post.mock.calls[0][1].budget).toBeUndefined();
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
});
test('a generation creates a draft then sends its cost ceiling and never approves or activates it', async () => {
  axios.post.mockResolvedValueOnce({ data: { id: 'draft' } }).mockResolvedValueOnce({ data: { queued: true } });
  render(<CampaignAssistantView data={data} isAdmin onRefresh={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Gerar rascunho de imagem' }));
  await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(2));
  expect(axios.post.mock.calls[0][0]).toBe('/api/ecommerce/marketing/content');
  expect(axios.post.mock.calls[1]).toEqual(['/api/ecommerce/marketing/content/draft/generate', expect.objectContaining({ capability: 'text-to-image', maximumCostUsd: 1, providerId: route.provider })]);
});
test('a failed generation keeps an actionable error and does not retry automatically', async () => {
  axios.post.mockResolvedValueOnce({ data: { id: 'draft' } }).mockRejectedValueOnce({ response: { data: { error: 'A estimativa excede o teto autorizado.' } } });
  render(<CampaignAssistantView data={data} isAdmin onRefresh={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Gerar rascunho de imagem' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('A estimativa excede o teto autorizado.');
  expect(axios.post).toHaveBeenCalledTimes(2);
});
test('an unselected or unfinished file cannot be approved and the provider failure is visible', () => {
  const contents = [{ id: 'c', kind: 'creative', status: 'draft', data: { name: 'Mini 7', contentHub: { requestId: 'r', status: 'failed', generation: { providerId: 'modelark-imagens' }, failure: { code: 'provider_balance_overdue', message: 'Regularize o saldo do provedor.' }, assets: [] } } }];
  render(<CampaignAssistantView data={{ ...data, contents }} isAdmin />);
  expect(screen.getByText('Regularize o saldo do provedor.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Aprovar criativo selecionado' })).toBeDisabled();
  expect(suggestedRoute({ ...data, contents }, 'image')).toEqual(route);
});
