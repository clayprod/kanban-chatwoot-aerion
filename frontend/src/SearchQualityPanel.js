import React, { useEffect, useState } from 'react';
import axios from 'axios';

export default function SearchQualityPanel() {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return undefined;
    let ignore = false;
    setError('');
    axios.get('/api/licitacoes/search/quality/audit', { params: { days: 90 } }).then(r => {
      if (!ignore) setReport(r.data);
    }).catch(() => { if (!ignore) setError('Não foi possível carregar a auditoria. Feche e tente novamente.'); });
    return () => { ignore = true; };
  }, [open]);
  return <details className="rounded-xl border border-line bg-surf p-3 text-sm text-ink" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer font-semibold focus-visible:ring-2 focus-visible:ring-primary">Qualidade e cobertura · últimos 90 dias</summary>
    {open && <div className="mt-3 space-y-3">
      {error && <p role="alert">{error}</p>}
      {!report && !error && <p role="status">Carregando auditoria…</p>}
      {report && <>
        <p className="text-muted">{report.warning}</p>
        {!report.scans.length && <p>A auditoria começa a registrar as próximas coletas. Ainda não há histórico de processamento para este período.</p>}
        {report.jobs.map(job => <div key={job.id} className="border-t border-line pt-2">
          <p className="font-medium">{job.nome}</p>
          <p className="text-xs text-muted">{job.query_plan?.coverage_kind === 'completed_scan' ? 'Varredura concluída no ciclo registrado' : 'Cobertura parcial, incremental ou ainda não aferida'}</p>
          <ul className="mt-1 space-y-1 text-xs">{(job.term_runs || []).map((run, i) => <li key={i}>
            {run.term || 'Consulta complementar'} · {run.pages_completed || 0} página(s) · {run.stop_reason || 'em andamento'}
            {run.errors?.length > 0 && ' · houve falhas; consulte a continuidade da coleta'}
          </li>)}</ul>
        </div>)}
        {report.watches.map(w => <p key={w.source + w.id} className="text-xs"><strong>{w.nome}</strong> · {w.source === 'pca' ? 'PCA' : 'Editais'} · {w.scan_state?.coverage_kind === 'cycle_completed' ? 'ciclo percorrido' : 'coleta em lotes com continuidade'}</p>)}
        {report.reviews.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-xs">
          <caption className="mb-2 text-left font-semibold">Revisão do acervo · contadores de processamento</caption>
          <thead><tr><th className="p-2">Busca</th><th className="p-2">Revisões</th><th className="p-2">Rejeições registradas</th><th className="p-2">Estado</th></tr></thead>
          <tbody>{report.reviews.map(r => <tr key={r.source + r.source_id} className="border-t border-line">
            <td className="p-2">{report.jobs.find(j => j.id === r.source_id)?.nome || report.watches.find(w => w.source === r.source && String(w.id) === r.source_id)?.nome || r.source}</td>
            <td className="p-2">{r.reviewed}</td><td className="p-2">{r.rejected}</td><td className="p-2">{r.complete ? 'Concluída' : 'Em revisão; pendências serão retomadas'}</td>
          </tr>)}</tbody>
        </table></div>}
      </>}
    </div>}
  </details>;
}
