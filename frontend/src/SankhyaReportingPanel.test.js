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
  expect(screen.getByText(/Faturamento: base anterior · notas pendentes/)).toHaveAttribute('title', '102: HTTP 502. Últimos dados preservados.');
  expect(axios.get.mock.calls[0][0]).toBe('/api/sankhya/report?ano=2026');
  axios.post.mockResolvedValue({ data: { queued: true } });
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar ERP' }));
  await waitFor(() => expect(axios.post).toHaveBeenCalledWith('/api/sankhya/sync'));
  expect(await screen.findByText(/Atualização solicitada/)).toBeInTheDocument();
});

test('both companies show independent invoice freshness and a preserved failed snapshot', async () => {
  axios.get.mockResolvedValue({ data: { currentRevenueSource: 'sankhya_100_102_invoices',
    revenueCompanies: [100, 102].map(company => ({ company, source: 'sankhya_invoices' })), streams: [
      { company_id: 100, resource: 'invoices', enabled: true, last_success_at: '2026-10-28T12:00:00Z', error: 'HTTP 502' },
      { company_id: 102, resource: 'invoices', enabled: true, last_success_at: null },
    ] } });
  render(<SankhyaReportingPanel year={2026} />);
  const status = await screen.findByText(/100: ERP automático/);
  expect(status).toHaveTextContent('última carga preservada; falha na atualização');
  expect(status).toHaveTextContent('102: ERP automático (notas autorizadas) · aguardando notas fiscais');
  expect(screen.getByRole('button', { name: 'Atualizar ERP' })).toHaveAttribute('title', 'Solicitar atualização das empresas habilitadas');
});
test('unavailable ERP does not fabricate a successful or empty import', async () => {
  axios.get.mockRejectedValue({ response: { data: { error: 'private upstream data' } } });
  render(<SankhyaReportingPanel year={2026} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível consultar');
  expect(screen.queryByText('private upstream data')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Atualizar ERP' })).not.toBeInTheDocument();
});

test('active hybrid source identifies company 100 database and authorized company 102 invoices', async () => {
  axios.get.mockResolvedValue({ data: { currentRevenueSource: 'hybrid_100_database_102_invoices', streams: [
    { company_id: 102, resource: 'orders', enabled: true, last_success_at: '2026-10-22T20:00:00Z' },
    { company_id: 102, resource: 'invoices', enabled: true, error: 'HTTP 502' },
  ] } });
  render(<SankhyaReportingPanel year={2026} />);
  expect(await screen.findByText(/100: base atual · 102: ERP automático \(notas autorizadas\)/)).toBeInTheDocument();
  expect(screen.queryByText(/Faturamento: base anterior/)).not.toBeInTheDocument();
});
