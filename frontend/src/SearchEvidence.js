import React from 'react';

export default function SearchEvidence({ item }) {
  const quality = item?.search_quality || item?.quality_review;
  if (!quality) return null;
  const pending = quality.status?.startsWith('pending');
  return <details className="mt-2 text-xs text-muted">
    <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      {pending ? 'Classificação não confirmada · revisar evidência' : `Por que entrou: ${quality.term || 'correspondência verificada'}`}
    </summary>
    <div className="mt-1 space-y-1 border-l-2 border-line pl-2">
      {quality.snippet && <p className="whitespace-normal text-ink">{quality.snippet}</p>}
      <p>{quality.field === 'item' ? 'Encontrado no item da contratação' : 'Encontrado no objeto ou descrição'} · {quality.match_mode === 'expanded' ? 'Busca ampliada' : 'Busca literal'}</p>
      {quality.classification?.source === 'pncp' && <p>Classificação oficial PNCP: {quality.classification.kind === 'material' ? 'material' : quality.classification.kind === 'service' ? 'serviço' : 'conflitante'}</p>}
      {pending && <p>A classificação disponível não permite confirmar o tipo de item. A interpretação textual não foi usada para excluí-lo.</p>}
    </div>
  </details>;
}
