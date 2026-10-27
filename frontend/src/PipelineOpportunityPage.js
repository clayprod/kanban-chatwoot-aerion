import React from 'react';
import {ObjectionProvider,ObjectionPanel} from './ObjectionWorkflow';
import ManualTechnicalAnalysis from './ManualTechnicalAnalysis';
export default function PipelineOpportunityPage({ title, onBack, children,opportunityId,requirementsRevision }) {
  return <ObjectionProvider opportunityId={opportunityId} revision={requirementsRevision}><article className="mx-auto w-full max-w-7xl space-y-4 py-5" aria-label="Detalhes da oportunidade">
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-xs text-muted"><span>Licitações</span><span aria-hidden="true">/</span><button type="button" onClick={onBack} className="text-primary hover:underline">Pipeline</button><span aria-hidden="true">/</span><span aria-current="page" className="break-words">{title || 'Oportunidade'}</span></nav>
    <button type="button" onClick={onBack} className="text-sm font-semibold text-primary hover:underline">← Voltar ao pipeline</button>
    <ManualTechnicalAnalysis opportunityId={opportunityId}/>
    {children}
    <ObjectionPanel/>
  </article></ObjectionProvider>;
}
