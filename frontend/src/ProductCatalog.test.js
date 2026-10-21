import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import axios from 'axios';
import ProductCatalog from './ProductCatalog';
import TechnicalResult, { TechnicalItem, ProductMatchSummary } from './TechnicalResult';
jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks();
  axios.get.mockImplementation(url => Promise.resolve({ data: url.endsWith('/config') ? {
    config: { enabled: false, min_score: 68, daily_limit: 30, daily_tokens: 2000000 }, usage: { notices: 0, tokens: 0, calls: 0 },
  } : [] }));
});
test('automation starts disabled and saves the chosen daily budget and score threshold', async () => {
  axios.put.mockResolvedValue({ data: {} });
  render(<ProductCatalog />);
  const enabled = await screen.findByLabelText('Analisar automaticamente editais qualificados, incluindo os atuais ainda abertos');
  expect(enabled).not.toBeChecked(); expect(screen.getByLabelText('Licitações por dia')).toHaveValue(30);
  fireEvent.click(enabled);
  fireEvent.click(screen.getByRole('button', { name: 'Salvar automação' }));
  await waitFor(() => expect(axios.put).toHaveBeenCalledWith('/api/licitacoes/technical/config', expect.objectContaining({ enabled: true, min_score: 68, daily_limit: 30 })));
});
test('product registration sends distribution price, composition and explicit package confirmation', async () => {
  axios.post.mockResolvedValue({ data: { id: '7', name: 'Produto A', model: '', category: '', description: '', keywords: ['produto'], sale_price: 34034.54, unit: 'un', composition: '2 baterias', package_confirmed: true, active: true, specs: [], price_basis: 'distribution' } });
  render(<ProductCatalog />);
  await screen.findByLabelText('Licitações por dia');
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Produto A' } });
  fireEvent.change(screen.getByLabelText('Preço de venda unitário (R$)'), { target: { value: '34034.54' } });
  fireEvent.change(screen.getByLabelText('Origem do preço'), { target: { value: 'distribution' } });
  fireEvent.change(screen.getByLabelText('Composição incluída no preço'), { target: { value: '2 baterias' } });
  fireEvent.click(screen.getByLabelText('A composição e o preço correspondem à unidade comercial informada.'));
  fireEvent.click(screen.getByRole('button', { name: 'Salvar produto' }));
  await waitFor(() => expect(axios.post).toHaveBeenCalledWith('/api/licitacoes/products', expect.objectContaining({ name: 'Produto A', sale_price: '34034.54', price_basis: 'distribution', composition: '2 baterias', package_confirmed: true })));
  expect(await screen.findByLabelText('Enviar PDF ou Word (até 20 MB)')).toBeInTheDocument();
});
test('failed products are not presented as fully compliant and show both sources', () => {
  const requirement = { id: 'r', label: 'Autonomia mínima de 41 min', quote: 'Autonomia mínima de 41 min', source_id: '1', location: 'Página 5' };
  render(<TechnicalItem item={{ in_scope: true, recommended_product: null, products: [{ product_id: '2', product_name: 'Modelo 40', status: 'failed', sale_price: 100, counts: { ok: 0, total: 1 }, requirements: [{ requirement, status: 'nao_ok', reason: '40 min não atende mínimo 41 min.', evidence: [{ id: 's', quote: 'Autonomia 40 min', source_id: '3', location: 'Página 2' }] }] }] }} />);
  expect(screen.getByText('Nenhum produto com atendimento comprovado para este item.')).toBeInTheDocument();
  expect(screen.getByText(/40 min não atende mínimo 41 min/)).toBeInTheDocument();
  expect(screen.queryByText(/Atende plenamente/)).not.toBeInTheDocument();
  expect(screen.getAllByRole('link')).toHaveLength(2);
});
test('result lists fetch only a summary until the user opens the technical evidence', async () => {
  const summary = { id: '9', status: 'completed', summary_only: true, result: { score: 100, base_score: 75, technical_bonus: 20, commercial_bonus: 5, full_items: 1, relevant_items: 1, items: [{ number: '1', description: 'Drone', in_scope: true, recommended_product: { product_id: '2', product_name: 'Modelo aprovado' } }] } };
  axios.post.mockResolvedValueOnce({ data: { analysis: summary, enabled: true } });
  render(<TechnicalResult item={{ id: 'lazy-evidence-test' }} />);
  const badge = await screen.findByText(/1\/1 itens pertinentes atendidos plenamente/);
  expect(axios.get).not.toHaveBeenCalled();
  axios.get.mockResolvedValueOnce({ data: { ...summary, summary_only: false, result: { ...summary.result, documents_complete: true, items: [{ ...summary.result.items[0], products: [], requirements: [{ label: 'Exigência 41 minutos' }] }] } } });
  const details = badge.closest('details'); details.open = true;
  fireEvent(details, new Event('toggle'));
  await waitFor(() => expect(axios.get).toHaveBeenCalledWith('/api/licitacoes/technical/jobs/9'));
});

test('catalogue separates accessories, opens original contents and exposes the credit blocker', async () => {
  axios.get.mockImplementation(url => Promise.resolve({ data: url.endsWith('/config') ? {
    config: { enabled: true, min_score: 68, daily_limit: 30, daily_tokens: 2000000 }, usage: {}, health: { ready: 0, products: 1, provider_blocked: true },
  } : url.endsWith('/products') ? [
    { id: '1', name: 'Drone original', product_type: 'product', active: true, sale_price: 100, keywords: [], included_items: [{ label: 'Baterias de voo', key: 'battery', quantity: 2 }], compatible_ids: ['2'] },
    { id: '2', name: 'Bateria avulsa', product_type: 'accessory', active: true, sale_price: 20, keywords: [] },
  ] : [] }));
  render(<ProductCatalog />);
  expect(await screen.findByText(/Análises aguardando créditos de IA/)).toBeVisible();
  await screen.findByRole('heading', { name: 'Drone original' });
  expect(screen.getByLabelText('Quantidade do componente 1')).toHaveValue(2);
  expect(screen.getByRole('tab', { name: /Produtos/ })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByLabelText(/Bateria avulsa/)).toBeChecked();
  fireEvent.click(screen.getByRole('tab', { name: /Acessórios/ }));
  expect(screen.getByRole('tab', { name: /Acessórios/ })).toHaveAttribute('aria-selected', 'true');
});
test('card percentages are proven requirements per item, and uncertainty is never labelled full', () => {
  const select = jest.fn();
  render(<ProductMatchSummary documentsComplete={false} onSelect={select} items={[{ number: '2', description: 'Drone com RTK', in_scope: true, product_matches: [{ product_id: '9', product_name: 'Modelo A', status: 'uncertain', counts: { ok: 17, total: 20, verificar: 3, nao_ok: 0 } }] }]} />);
  expect(screen.getByText('Item 2 · Drone com RTK')).toBeVisible();
  expect(screen.getByText(/85% comprovado/)).toBeVisible();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '85');
  expect(screen.getByText(/Leitura incompleta/)).toBeVisible();
  expect(screen.queryByText(/Atende plenamente/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Comparar Modelo A no item 2' }));
  expect(select).toHaveBeenCalledWith('2', '9');
});
test('a product click opens the pipeline preview callback without loading duplicate inline evidence', async () => {
  const open = jest.fn();
  axios.post.mockResolvedValue({ data: { analysis: { id: '555', status: 'completed', summary_only: true, result: { full_items: 1, relevant_items: 1, documents_complete: true, items: [{ number: '3', in_scope: true, product_matches: [{ product_id: '8', product_name: 'Modelo completo', status: 'full', counts: { ok: 20, total: 20 } }] }] } }, enabled: true } });
  render(<TechnicalResult item={{ id: 'preview-match-callback' }} onOpenMatch={open} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Comparar Modelo completo no item 3' }));
  expect(open).toHaveBeenCalledWith('3', '8');
  expect(axios.get).not.toHaveBeenCalled();
  expect(screen.getByText(/100% comprovado · Atende plenamente/)).toBeVisible();
});
