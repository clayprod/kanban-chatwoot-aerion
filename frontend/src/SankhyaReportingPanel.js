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
  const orders = streams.find(row => row.resource === 'orders' && row.company_id === 102);
  const invoices = streams.find(row => row.resource === 'invoices' && row.company_id === 102);
  const time = value => new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const detail = [orders?.error, invoices?.error].filter(Boolean).join(' ');
  const status = !data ? 'Consultando atualização da 102…' : !streams.length ? 'ERP 102 ainda não configurado.'
    : `Pedidos 102: ${orders?.last_success_at ? `atualizados em ${time(orders.last_success_at)}` : 'aguardando atualização'}. Faturamento: base anterior${!invoices?.last_success_at || invoices?.error ? ' · notas pendentes' : ''}.`;
  return <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted" aria-label="Sincronização do ERP Sankhya">
    {streams.some(row => row.enabled) && <button type="button" disabled={busy} onClick={update} aria-label="Atualizar ERP" title="Solicitar atualização da empresa 102" className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md hover:bg-bg2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"><ArrowPathIcon className={`h-4 w-4 ${busy ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" /></button>}
    <span title={detail || undefined} role={error ? 'alert' : 'status'}>{error || message || status}</span>
  </div>;
}
