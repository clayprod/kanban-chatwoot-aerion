import React, { useEffect, useRef, useState } from 'react';
import TechnicalResult from './TechnicalResult';
import SearchEvidence from './SearchEvidence';
import {pncpItemEstimatedTotal} from './pncpPreview';
const money = value => value == null ? 'Não informado' : Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export default function OpportunityPreview({ opportunity, items = [], otherItems = [], loading, error, sectionClass, onChecklistChange }) {
  const raw = opportunity.__preview;
  const [focus, setFocus] = useState(opportunity.__focus);
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
      <SearchEvidence item={raw} />
      <p className="mt-3 text-xs text-muted">{[raw.modo_disputa?.nome, raw.amparo_legal?.nome, raw.esfera?.nome].filter(Boolean).join(' · ')}</p>
      {raw.url && <a href={raw.url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-primary underline">Edital no PNCP ↗</a>}
    </section>
    <TechnicalResult overview expanded allowedItemNumbers={items.map(i=>i.numero_item)} item={raw} profile={opportunity.__profile} onOpenMatch={select} />
    <section className={sectionClass}>
      <h4 className="mb-2 text-sm font-semibold">Itens de interesse · {items.length}</h4>
      <p className="mb-3 border-b border-line pb-3 text-xs text-muted">Selecionados pelos critérios desta busca. São os itens preparados para importação.</p>
      {loading && <p role="status" className="mb-3 text-xs text-muted">Carregando os itens do PNCP…</p>}
      {error && <p role="alert" className="mb-3 text-xs text-status-warning">{error}</p>}
      <div className="space-y-2">{items.map(item => <div key={item.numero_item || item.id} ref={node => { itemRefs.current[String(item.numero_item)] = node; }} className="rounded-xl border border-line bg-bg2/30">
        <div className="px-3 py-3"><h5 className="text-sm font-semibold"><span className="mr-2 text-primary">Item {item.numero_item || '—'}</span>{item.descricao}</h5>
          <TechnicalResult itemSummary item={raw} profile={opportunity.__profile} itemNumber={item.numero_item} />
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
            <p>Quantidade: <span className="font-medium text-ink">{item.quantidade ?? 'Não informada'} {item.unidade || ''}</span></p>
            <p>Referência unitária: <span className="font-medium text-ink">{money(item.valor_referencia)}</span></p>
            <p>Total do item: <span className="font-medium text-ink">{money(pncpItemEstimatedTotal(item))}</span></p>
          </div>
        </div>
        <details open>
          <summary className="cursor-pointer border-t border-line px-3 py-2 text-xs font-medium text-primary">Ver exigências e comparação</summary>
          <div className="space-y-3 border-t border-line p-3">
            {item.scope_pending && <p className="text-xs text-status-warning">O texto corresponde à busca; a classificação material/serviço ainda precisa ser confirmada.</p>}
            <TechnicalResult item={raw} profile={opportunity.__profile} itemNumber={item.numero_item} onChecklistChange={onChecklistChange} highlightProductId={String(focus?.number) === String(item.numero_item) ? focus?.productId : undefined} />
          </div>
        </details>
      </div>)}</div>
      {!items.length && !loading && <p className="text-sm text-muted">Nenhum item de interesse confirmado com os critérios atuais.</p>}
    </section>
    {!!otherItems.length && <details className={sectionClass}><summary className="cursor-pointer text-sm font-medium text-muted">Outros itens do edital · {otherItems.length}</summary><p className="mt-2 text-xs text-muted">Fora da seleção desta busca. Não serão incluídos automaticamente na importação.</p><ul className="mt-3 divide-y divide-line">{otherItems.map(item => <li key={item.numero_item || item.id} className="py-3 text-sm text-muted"><span className="font-medium">Item {item.numero_item} · </span>{item.descricao}</li>)}</ul></details>}
  </div>;
}
