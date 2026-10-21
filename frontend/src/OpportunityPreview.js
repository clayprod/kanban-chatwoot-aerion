import React, { useEffect, useRef, useState } from 'react';
import TechnicalResult from './TechnicalResult';
const money = value => value == null ? 'Não informado' : Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export default function OpportunityPreview({ opportunity, items = [], loading, error, sectionClass }) {
  const raw = opportunity.__preview;
  const [focus, setFocus] = useState(opportunity.__focus);
  const [opened, setOpened] = useState({});
  const itemRefs = useRef({});
  const select = (number, productId) => setFocus({ number: String(number), productId: productId == null ? null : String(productId) });
  useEffect(() => { setFocus(opportunity.__focus); }, [opportunity]);
  useEffect(() => { if (focus?.number) itemRefs.current[String(focus.number)]?.scrollIntoView?.({ block: 'nearest' }); }, [focus, items]);
  return <div className="space-y-3.5">
    <p className="text-xs text-muted">Pré-visualização. A oportunidade só entra no pipeline após confirmar a importação.</p>
    <section className={sectionClass}>
      <h4 className="mb-3 border-b border-line pb-2 text-sm font-semibold">Dados do processo</h4>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">{[
        ['Órgão', opportunity.orgao_nome], ['Modalidade', opportunity.modalidade], ['Número PNCP', opportunity.numero_compra],
        ['Localidade', [raw.municipio?.nome, raw.uf].filter(Boolean).join(' · ')],
        ['Prazo', raw.prazo_info?.label], ['Valor estimado', money(opportunity.valor_oportunidade)],
      ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-words text-ink">{value || 'Não informado'}</dd></div>)}</dl>
      {raw.descricao && <p className="mt-3 whitespace-pre-wrap text-sm text-ink">{raw.descricao}</p>}
      {raw.url && <a href={raw.url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-primary underline">Edital no PNCP ↗</a>}
    </section>
    <section className={sectionClass}>
      <h4 className="text-sm font-semibold">Análise técnica e produtos</h4>
      <TechnicalResult item={raw} profile={opportunity.__profile} onOpenMatch={select} />
    </section>
    <section className={sectionClass}>
      <h4 className="mb-3 border-b border-line pb-2 text-sm font-semibold">Itens de participação</h4>
      {loading && <p role="status" className="mb-3 text-xs text-muted">Carregando os itens do PNCP…</p>}
      {error && <p role="alert" className="mb-3 text-xs text-status-warning">{error}</p>}
      <div className="space-y-2">{items.map(item => <details key={item.numero_item || item.id} ref={node => { itemRefs.current[String(item.numero_item)] = node; }} open={String(focus?.number) === String(item.numero_item) || undefined} onToggle={event => { const isOpen = event.currentTarget.open; setOpened(current => current[item.numero_item] === isOpen ? current : { ...current, [item.numero_item]: isOpen }); }} className="rounded-xl border border-line bg-bg2/30">
        <summary className="cursor-pointer px-3 py-3 text-sm font-semibold"><span className="mr-2 text-primary">Item {item.numero_item || '—'}</span>{item.descricao}</summary>
        <div className="space-y-3 border-t border-line p-3">
          <p className="text-xs text-muted">Quantidade: {item.quantidade ?? 'Não informada'} {item.unidade || ''} · Referência unitária: {money(item.valor_referencia)}</p>
          {(opened[item.numero_item] || String(focus?.number) === String(item.numero_item)) && <TechnicalResult item={raw} profile={opportunity.__profile} itemNumber={item.numero_item} highlightProductId={String(focus?.number) === String(item.numero_item) ? focus?.productId : undefined} />}
        </div>
      </details>)}</div>
      {!items.length && !loading && <p className="text-sm text-muted">Nenhum item disponível para pré-visualização.</p>}
    </section>
  </div>;
}
