import React, { useEffect, useState } from 'react';
import axios from 'axios';

export default function SankhyaReportingPanel({ year }) {
  const [data, setData] = useState(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const load = () => axios.get(`/api/sankhya/report?ano=${year}`, { signal: controller.signal })
      .then(response => { setData(response.data); setError(''); })
      .catch(() => { if (!controller.signal.aborted) setError('Não foi possível consultar a sincronização do ERP.'); });
    setData(null); load();
    const timer = setInterval(load, 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [year]);
  const update = async () => {
    setBusy(true); setMessage('');
    try { await axios.post('/api/sankhya/sync'); setMessage('Atualização solicitada. Os dados aparecerão após o próximo ciclo.'); }
    catch { setError('Não foi possível solicitar a atualização do ERP.'); }
    finally { setBusy(false); }
  };
  const streams = data?.streams || [];
  const orders = streams.find(row => row.resource === 'orders' && row.company_id === 102);
  const invoices = streams.find(row => row.resource === 'invoices' && row.company_id === 102);
  const time = value => value ? new Date(value).toLocaleString('pt-BR') : 'Ainda não importado';
  return <section className="mb-6 rounded-xl border border-line bg-surf p-5" aria-label="Sincronização do ERP Sankhya">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-ink">ERP automático · empresa 102</h3><p className="mt-1 text-xs text-muted">Documentos disponíveis à integração de parceiro, no ano {year}. A empresa 100 permanece fora desta sincronização.</p></div>
      {streams.some(row => row.enabled) && <button type="button" disabled={busy} onClick={update} className="rounded-md border border-line px-3 py-2 text-xs font-medium text-ink disabled:opacity-50">{busy ? 'Solicitando…' : 'Atualizar ERP'}</button>}
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-ink">{error}</p>}
    {!data && !error ? <p role="status" className="mt-4 text-sm text-muted">Consultando integração…</p> : !streams.length ? <p className="mt-4 text-sm text-muted">A integração automática ainda não foi configurada.</p> : <>
      <dl className="mt-5 grid gap-5 sm:grid-cols-2"><div><dt className="text-xs text-muted">Pedidos no ERP</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-ink">{orders?.last_success_at ? orders.documents : '—'}</dd><p className="mt-1 text-xs text-muted">Última importação: {time(orders?.last_success_at)}</p></div>
        <div><dt className="text-xs text-muted">Notas com status de autorização</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-ink">{invoices?.last_success_at ? invoices.authorized_documents : '—'}</dd><p className="mt-1 text-xs text-muted">Última importação: {time(invoices?.last_success_at)}</p></div></dl>
      {[orders, invoices].filter(row => row?.error).map(row => <p key={row.resource} className="mt-3 text-xs text-muted">{row.resource === 'orders' ? 'Pedidos' : 'Notas fiscais'}: {row.error}</p>)}
      <p className="mt-4 border-t border-line pt-3 text-xs text-muted">Pedidos representam a carteira, não receita faturada. Os gráficos de metas abaixo continuam usando a base de faturamento existente até a conciliação das notas e dos valores de produtos.</p>
    </>}
    {message && <p role="status" className="mt-3 text-xs text-muted">{message}</p>}
  </section>;
}
