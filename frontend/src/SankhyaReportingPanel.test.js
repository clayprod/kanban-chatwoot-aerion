import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axios from 'axios';
import SankhyaReportingPanel from './SankhyaReportingPanel';

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
beforeEach(() => jest.clearAllMocks());
test('ERP orders are separate from unavailable invoices and the existing revenue source', async () => {
  axios.get.mockResolvedValue({ data: { streams: [
    { company_id: 102, resource: 'orders', enabled: true, documents: 6, last_success_at: '2026-10-22T20:00:00Z' },
    { company_id: 102, resource: 'invoices', enabled: true, authorized_documents: 0, last_success_at: null, error: 'HTTP 502. Últimos dados preservados.' },
  ] } });
  render(<SankhyaReportingPanel year={2026} />);
  expect(await screen.findByText(/Pedidos 102: atualizados em/)).toBeInTheDocument();
  expect(screen.getByText(/Faturamento: base anterior · notas pendentes/)).toHaveAttribute('title', 'HTTP 502. Últimos dados preservados.');
  expect(axios.get.mock.calls[0][0]).toBe('/api/sankhya/report?ano=2026');
  axios.post.mockResolvedValue({ data: { queued: true } });
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar ERP' }));
  await waitFor(() => expect(axios.post).toHaveBeenCalledWith('/api/sankhya/sync'));
  expect(await screen.findByText(/Atualização solicitada/)).toBeInTheDocument();
});
test('unavailable ERP does not fabricate a successful or empty import', async () => {
  axios.get.mockRejectedValue({ response: { data: { error: 'private upstream data' } } });
  render(<SankhyaReportingPanel year={2026} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível consultar');
  expect(screen.queryByText('private upstream data')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Atualizar ERP' })).not.toBeInTheDocument();
});

test('active hybrid source identifies company 100 database and live confirmed company 102 orders', async () => {
  axios.get.mockResolvedValue({ data: { currentRevenueSource: 'hybrid_100_database_102_orders', streams: [
    { company_id: 102, resource: 'orders', enabled: true, last_success_at: '2026-10-22T20:00:00Z' },
    { company_id: 102, resource: 'invoices', enabled: true, error: 'HTTP 502' },
  ] } });
  render(<SankhyaReportingPanel year={2026} />);
  expect(await screen.findByText(/100: base atual · 102: ERP automático \(pedidos confirmados\)/)).toBeInTheDocument();
  expect(screen.queryByText(/Faturamento: base anterior/)).not.toBeInTheDocument();
});
