import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { ArrowPathIcon } from '@heroicons/react/24/outline';

export default function SankhyaReportingPanel({ year }) {
  const [data, setData] = useState(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const load = () => axios.get(`/api/sankhya/report?ano=${year}`, { signal: controller.signal })
      .then(response => { setData(response.data); setError(''); setMessage(''); })
      .catch(() => { if (!controller.signal.aborted) setError('Não foi possível consultar a sincronização do ERP.'); });
    setData(null); load();
    const timer = setInterval(load, 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [year]);
  const update = async () => {
    setBusy(true); setMessage('');
    try { await axios.post('/api/sankhya/sync'); setMessage('Atualização solicitada.'); }
    catch { setError('Não foi possível solicitar a atualização do ERP.'); }
    finally { setBusy(false); }
  };
  const streams = data?.streams || [];
  const time = value => new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const detail = streams.filter(row => row.error).map(row => `${row.company_id}: ${row.error}`).join(' ');
  const companies = data?.revenueCompanies || [100, 102].map(company => ({ company,
    source: data?.currentRevenueSource === 'hybrid_100_database_102_invoices' && company === 102 ? 'sankhya_invoices' : 'reporting_database' }));
  const automatic = companies.some(row => row.source === 'sankhya_invoices');
  const status = !data ? 'Consultando atualização do ERP…' : !streams.length ? 'ERP ainda não configurado.'
    : automatic ? companies.map(({ company, source }) => {
      if (source !== 'sankhya_invoices') return `${company}: base atual`;
      const invoices = streams.find(row => row.resource === 'invoices' && row.company_id === company);
      return `${company}: ERP automático (notas autorizadas)${invoices?.last_success_at ? ` · ${time(invoices.last_success_at)}${invoices.error ? ' · última carga preservada; falha na atualização' : ''}` : ' · aguardando notas fiscais'}`;
    }).join(' · ') + '.'
      : streams.filter(row => row.resource === 'orders').map(row => `Pedidos ${row.company_id}: ${row.last_success_at ? `atualizados em ${time(row.last_success_at)}` : 'aguardando atualização'}.`).join(' ')
        + ` Faturamento: base anterior${streams.some(row => row.resource === 'invoices' && (!row.last_success_at || row.error)) ? ' · notas pendentes' : ''}.`;
  return <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted" aria-label="Sincronização do ERP Sankhya">
    {streams.some(row => row.enabled) && <button type="button" disabled={busy} onClick={update} aria-label="Atualizar ERP" title="Solicitar atualização das empresas habilitadas" className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md hover:bg-bg2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"><ArrowPathIcon className={`h-4 w-4 ${busy ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" /></button>}
    <span title={detail || undefined} role={error ? 'alert' : 'status'}>{error || message || status}</span>
  </div>;
}
