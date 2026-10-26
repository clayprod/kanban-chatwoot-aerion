import React, {useState} from 'react';
const labels={ok:'Atende',nao_ok:'Não atende',verificar:'Sem comprovação'};
const colors={ok:'text-status-success',nao_ok:'text-status-danger',verificar:'text-muted'};
const money=v=>Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
function valueOf(fact){
  if(!fact)return 'Não encontrado na ficha';
  if(fact.kind==='numeric')return `${fact.value}${fact.upper!=null ? ` a ${fact.upper}`:''} ${fact.unit || ''}${fact.conditions ? ` · ${fact.conditions}`:''}`;
  return String(fact.value || fact.label || 'Não informado');
}
function Source({fact}){
  if(!fact?.quote)return null;
  if(String(fact.source_id).startsWith('package:'))return <p className="my-2 text-sm text-muted">{fact.quote} · Composição conferida do pacote e complementos.</p>;
  return <div className="my-2"><blockquote className="whitespace-pre-wrap border-l-2 border-line pl-3 text-sm text-ink">{fact.quote}</blockquote><a href={`/api/licitacoes/technical/sources/${encodeURIComponent(fact.source_id)}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-primary underline">{fact.location || 'Conferir documento'}</a></div>;
}
export default function TechnicalChecklist({item,highlightProductId,onCompareMore,pending}){
  const [chosen,setChosen]=useState(null),[open,setOpen]=useState({});
  if(!item?.in_scope)return <p className="py-3 text-sm text-muted">Nenhum item pertinente disponível para comparar.</p>;
  const products=item.products || [],product=products.find(p=>String(p.product_id)===String(chosen || highlightProductId)) || item.recommended_product || item.potential_product || products[0];
  const current=product?.evidence_current!==false;
  const rows=current ? product?.requirements || (item.requirements || []).map(requirement=>({requirement,status:'verificar',reason:'Aguardando comparação com a ficha.',evidence:[]})) : [];
  const counts=product?.counts,percent=current && counts?.total ? Math.floor(100*counts.ok/counts.total):null;
  const full=current && item.documents_complete!==false && product?.status==='full';
  const groups=new Map();
  for(const row of rows){const title=row.requirement.section || 'Especificações técnicas';if(!groups.has(title))groups.set(title,[]);groups.get(title).push(row);}
  return <section className="py-3" aria-label={`Checklist técnico do item ${item.number}`}>
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div><h5 className="text-sm font-semibold text-ink">Checklist técnico</h5><p className="mt-1 text-xs text-muted">{rows.length} exigências{counts ? ` · ${counts.ok} atendidas · ${counts.nao_ok || 0} não atendidas · ${counts.verificar || 0} sem comprovação`:''}</p></div>
      <div className="flex flex-wrap items-center gap-3">
        {products.length>0 && <label className="text-xs text-muted">Produto comparado<select aria-label="Produto comparado" className="mt-1 block max-w-full rounded-lg border border-line bg-bg2 px-3 py-2 text-sm text-ink" value={product?.product_id || ''} onChange={e=>setChosen(e.target.value)}>{products.map(p=><option key={p.product_id} value={p.product_id}>{p.product_name}</option>)}</select></label>}
        {percent!=null && <div className="text-right"><p className={`text-lg font-semibold tabular-nums ${full?'text-status-success':'text-ink'}`}>{percent}%</p><p className="text-xs text-muted">{full?'Atende integralmente':item.documents_complete===false || !product?.specs_complete?'Resultado provisório':'Atendimento comprovado'}</p></div>}
      </div>
    </div>
    {product && <p className="mb-3 text-xs text-muted">{money(product.sale_price)}{product.price_comparison ? ` · Referência: ${money(product.price_comparison.reference)}`:''}{product.configuration?.additions?.length ? ` · Inclui complementos: ${product.configuration.additions.map(a=>`${a.quantity} × ${a.name}`).join(', ')}`:''}</p>}
    {!current && <p role="status" className="py-3 text-sm text-muted">A ficha foi atualizada. A comparação está sendo refeita.</p>}
    {item.documents_complete===false && <p role="status" className="mb-3 text-xs text-muted">{item.review_invalidated ? 'Documentos alterados: a revisão anterior precisa ser refeita.' : item.reviewed ? `Exigências conferidas nos arquivos disponíveis. ${item.document_issues?.[0] || 'Há pendências documentais que impedem confirmar atendimento integral.'}` : 'Comparação provisória: conferindo as exigências restantes.'}</p>}
    {rows.length>0 ? <div className="overflow-x-auto rounded-lg border border-line"><table className="w-full min-w-[560px] border-collapse text-left text-sm">
      <thead className="bg-bg2 text-xs text-muted"><tr><th className="w-[43%] px-3 py-3 font-medium">Exigência do edital</th><th className="w-[37%] px-3 py-3 font-medium">Nosso produto oferece</th><th className="px-3 py-3 font-medium">Resultado</th></tr></thead>
      <tbody>{[...groups].map(([section,entries])=><React.Fragment key={section}><tr><th colSpan="3" className="border-t border-line bg-bg2/40 px-3 py-2 text-xs font-semibold">{section}</th></tr>{entries.map((r,index)=>{const key=r.requirement.id || `${section}-${index}`;return <React.Fragment key={key}><tr className="border-t border-line align-top"><td className="px-3 py-3"><span>{r.requirement.label}</span>{r.requirement.value!=null && <span className="mt-1 block text-xs text-muted">{r.requirement.operator==='min'?'Mínimo: ':r.requirement.operator==='max'?'Máximo: ':'Exigido: '}{valueOf(r.requirement)}</span>}<button type="button" onClick={()=>setOpen(v=>({...v,[key]:!v[key]}))} aria-expanded={!!open[key]} className="mt-1 block rounded text-xs text-primary underline focus-visible:ring-2 focus-visible:ring-primary">{open[key]?'Fechar evidências':'Ver evidências'}</button></td><td className="px-3 py-3 text-ink">{r.evidence?.length ? [...new Set(r.evidence.map(valueOf))].join('; '):'Não encontrado na ficha'}</td><td className={`px-3 py-3 font-medium ${colors[r.status] || colors.verificar}`}>{labels[r.status] || labels.verificar}</td></tr>{open[key] && <tr className="border-t border-line bg-bg2/30"><td colSpan="3" className="px-4 py-3"><p className="mb-2 text-sm text-muted">{r.reason}</p><div className="grid gap-4 sm:grid-cols-2"><div><p className="text-xs font-semibold">Edital / TR</p><Source fact={r.requirement}/></div><div><p className="text-xs font-semibold">Ficha do produto</p>{r.evidence?.map(f=><Source key={f.id} fact={f}/>)}</div></div></td></tr>}</React.Fragment>;})}</React.Fragment>)}</tbody>
    </table></div>:<p role="status" className="py-4 text-sm text-muted">{pending?'Localizando as especificações no edital e no termo de referência.':'As exigências deste item ainda não estão disponíveis.'}</p>}
    {!!item.obligations?.length && <details className="mt-4 border-t border-line pt-3"><summary className="cursor-pointer text-sm font-medium">Fornecimento e documentação · {item.obligations.length}</summary><p className="my-2 text-xs text-muted">Condições a confirmar pela empresa; não compõem o percentual técnico do equipamento.</p><ul className="divide-y divide-line">{item.obligations.map(r=><li key={r.id} className="py-2 text-sm"><span>{r.label}</span><details className="mt-1 text-xs text-primary"><summary className="cursor-pointer">Conferir exigência</summary><Source fact={r}/></details></li>)}</ul></details>}
    {item.candidate_count>products.length && onCompareMore && <button type="button" disabled={pending} onClick={()=>onCompareMore(item.number)} className="mt-3 rounded border border-line px-3 py-2 text-xs text-primary disabled:opacity-50">Comparar outros produtos</button>}
  </section>;
}
