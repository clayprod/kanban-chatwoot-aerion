import React, { useEffect, useRef } from 'react';
import OpportunityPreview from './OpportunityPreview';
import {pncpInterestTotals} from './pncpPreview';

export default function PncpNoticePage({ opportunity, jobName, items, otherItems, loading, error, onBack, onSearches, onImport, canImport, onChecklistChange }) {
  const title = useRef(null);
  const totals=pncpInterestTotals(items);
  const partial=Boolean(loading || error || totals.missing);
  useEffect(() => { title.current?.focus({ preventScroll: true }); }, [opportunity.__preview?.__result_key, opportunity.titulo]);
  return <article className="mx-auto w-full max-w-7xl space-y-5 py-5" aria-label="Detalhes do edital">
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <span>Licitações</span><span aria-hidden="true">/</span>
      <button type="button" onClick={onSearches} className="text-primary hover:underline">Buscas</button><span aria-hidden="true">/</span>
      <button type="button" onClick={onBack} className="text-primary hover:underline">{jobName || 'Resultados'}</button><span aria-hidden="true">/</span>
      <span aria-current="page">{opportunity.numero_edital || opportunity.titulo || 'Edital'}</span>
    </nav>
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
      <div className="min-w-0 flex-1 basis-full sm:basis-0"><button type="button" onClick={onBack} className="mb-3 text-sm font-semibold text-primary hover:underline">← Voltar aos resultados</button>
        <h2 ref={title} tabIndex={-1} className="break-words text-xl font-semibold text-ink outline-none">{opportunity.titulo || 'Edital'}</h2>
        <p className="mt-1 text-sm text-muted">{opportunity.orgao_nome}</p>
        <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          <span className="text-muted">{partial && totals.total!=null ? 'Subtotal dos itens de interesse' : 'Valor dos itens de interesse'}</span>
          <strong className="font-semibold text-ink">{totals.total==null ? loading ? 'Calculando…' : 'Não informado' : totals.total.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</strong>
          {partial && totals.total!=null && <span className="text-xs text-muted">{totals.missing ? `${totals.missing} ${totals.missing===1?'item sem valor informado':'itens sem valor informado'}` : error ? 'Carregamento incompleto' : 'Apuração em andamento'}</span>}
        </p>
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        {opportunity.__preview?.url && <a href={opportunity.__preview.url} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-bg2">PNCP ↗</a>}
        <button type="button" onClick={onImport} disabled={!canImport || loading} className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 sm:flex-none">{opportunity.__preview?.__visibility === 'pipeline' || opportunity.__preview?.__visibility_db === 'pipeline' ? 'Já está no pipeline' : 'Importar para o pipeline'}</button>
      </div>
    </header>
    <OpportunityPreview opportunity={opportunity} items={items} otherItems={otherItems} loading={loading} error={error} onChecklistChange={onChecklistChange} sectionClass="rounded-xl border border-line bg-surf p-4 sm:p-5" />
  </article>;
}
