import {clausePresentation} from './checklistPresentation';
const statusLabel={ok:'Atende',nao_ok:'Não atende',verificar:'Verificar'};
const valueOf=f=>f?.kind==='numeric'?`${f.value}${f.upper!=null?` a ${f.upper}`:''} ${f.unit || ''}`:String(f?.value ?? '');
const citation=f=>f?.quote?`${f.location || 'Fonte'}: ${f.quote}${f.source_id?` [fonte ${f.source_id}]`:''}${f.source_url?` ${f.source_url}`:''}`:'';
export function technicalChecklistProposal(item,product,overrides={},impugnations={}){
 if(!product||product.evidence_current===false||item?.review_invalidated)return null;
 const presentation=clausePresentation(product.requirements || []);
 const technical=(product.requirements || []).map((row,index)=>{
  const automatic=['ok','nao_ok'].includes(row.automatic_status || row.status)?(row.automatic_status || row.status):'verificar';
  const status=overrides[row.requirement.id] || row.status || automatic;
  return {id:`technical-${row.requirement.id}`,secao:row.requirement.section || 'Especificações técnicas',requisito:presentation.get(row.requirement.id)?.label || row.requirement.label || valueOf(row.requirement),status,ordem:index,custo_subitem:null,impugnar:!!impugnations[row.requirement.id],impugnacao_tema:impugnations[row.requirement.id]?.topic || 'restricao',impugnacao_motivo:impugnations[row.requirement.id]?.note || '',technical_reference:{requirement:row.requirement,evidence:row.evidence,automatic_status:automatic,manual_review:row.manual_review},
   observacao:[`Produto: ${product.product_name}. Oferece: ${row.evidence?.length?row.evidence.map(valueOf).join('; '):'Não comprovado na ficha'}.`,row.reason,status!==automatic?`Revisão manual: ${statusLabel[status]}. Resultado automático: ${statusLabel[automatic]}.`:null,citation(row.requirement),...(row.evidence || []).map(citation)].filter(Boolean).join('\n')};
 });
 const obligations=(item.obligations || []).map((r,index)=>({id:`technical-obligation-${r.id}`,secao:r.section || 'Fornecimento e documentação',requisito:r.label || valueOf(r),status:'verificar',ordem:technical.length+index,custo_subitem:null,impugnar:!!impugnations[r.id],impugnacao_tema:impugnations[r.id]?.topic || 'restricao',impugnacao_motivo:impugnations[r.id]?.note || '',technical_reference:{requirement:r,category:r.category || 'supply'},observacao:`Condição de fornecimento: confirmar pela empresa. Não integra o percentual técnico do produto.\n${citation(r)}`}));
 return {product_id:product.product_id,modelo_produto:product.product_name,requirements:[...technical,...obligations]};
}
export function applyTechnicalChecklistsToDraft(drafts,analysis,choices={}){
 return drafts.map(draft=>{
  const item=analysis?.result?.items?.find(i=>i.in_scope&&String(i.number)===String(draft.numero_item));
  if(!item)return draft;
  const choice=choices[String(item.number)];
  const product=item.products?.find(p=>String(p.product_id)===String(choice?.product_id)) || item.recommended_product || item.potential_product || item.products?.[0];
  // Manual adjustments apply only to the same extraction and product version.
  const current=choice&&choice.analysis_id===analysis.id&&choice.product_version===product?.product_version&&choice.requirements_signature===JSON.stringify(product?.requirements);
  const proposal=technicalChecklistProposal(item,product,current?choice.overrides:{},current?choice.impugnations:{});
  return proposal?{...draft,modelo_produto:proposal.modelo_produto,requirements:proposal.requirements}:draft;
 });
}
export function prepareReviewImportChoices(analysis,choices={},selected=[]){
 return Object.fromEntries((analysis?.result?.items || []).filter(i=>i.in_scope).map(item=>{
  const choice=choices[String(item.number)],chosen=choice?.product_id?item.products?.find(p=>String(p.product_id)===String(choice.product_id)):null;
  if(choice?.product_id&&!chosen)throw Error('O catálogo ou a recomendação mudou. Reabra a comparação para conferir o produto antes de importar.');
  const product=chosen || item.recommended_product || item.potential_product || item.products?.[0];
  return [String(item.number),{product_id:product?.product_id,analysis_id:analysis.id,product_version:product?.product_version,requirements_signature:JSON.stringify(product?.requirements),overrides:{},impugnations:Object.fromEntries(selected.filter(p=>!p.stale&&String(p.item_number)===String(item.number)).map(p=>[p.requirement_id,{topic:p.topic,note:p.note}]))}];
 }));
}
