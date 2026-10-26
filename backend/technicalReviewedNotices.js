'use strict';
const {hash,evidenceValid,assessProduct,summarize}=require('./technicalRules');
const {requirementsForItem,normalizeFact,rankMatches}=require('./technicalQuality');
const {sameMetric}=require('./technicalMetrics');
const {assembleProduct}=require('./productPackages');
const {documentCoverage,documentRole}=require('./technicalProvenance');
const {awardingMode}=require('./technicalAwarding');
function reviewedRequirements(noticeKey,sources,bundle=require('./data/aerionReviewedNotices.json')){
 const review=bundle.reviews.find(r=>r.notice_key===noticeKey);if(!review)return null;
 const binding=new Map();
 for(const expected of review.sources){
  const match=sources.find(s=>hash((s.pages || []).map(p=>p.text).join('\n'))===expected.text_hash);
  if(!match)return null;binding.set(expected.original_id,match);
 }
 const map=f=>({...f,source_id:String(binding.get(String(f.source_id)).id)});
 const facts=review.facts.map(map).map(normalizeFact),conflicts=review.conflicts.map(map);
 const proof=sources.map(s=>({...s,id:String(s.id),text:s.pages.map(p=>p.text).join('\n')}));
 if([...facts,...conflicts].some(f=>!evidenceValid(f,proof)))return null;
 for(const f of facts)if(f.quantity_header_quote&&proof.some(s=>s.id===f.source_id&&s.text.includes(f.quantity_header_quote)))f.quantity_verified=true;
 const unreviewed=sources.some(s=>!review.sources.some(e=>e.text_hash===hash((s.pages || []).map(p=>p.text).join('\n'))));
 return {review,facts,conflicts,unreviewed,proof};
}
function reviewedComparison({noticeKey,sources,catalog,accessories,productSources,items,baseScore,candidateAllowed=()=>true,manifestVerified=false}){
 const checked=reviewedRequirements(noticeKey,sources);if(!checked)return null;
 const docs=documentCoverage(sources),readComplete=!checked.unreviewed,parsedComplete=sources.every(s=>s.complete===true);
 const mode=awardingMode(sources,items),compared=items.map(item=>{
  const scoped=requirementsForItem(checked.facts,String(item.number));
  const conflicts=checked.conflicts.filter(c=>c.item_numbers.includes('all')||c.item_numbers.includes(String(item.number)));
  const complete=readComplete&&parsedComplete&&manifestVerified&&docs.complete&&!conflicts.length;
  const assessed=catalog.filter(p=>candidateAllowed(item,p)).map(base=>{
   const assembly=assembleProduct(base,scoped.requirements,accessories,[...checked.proof,...productSources]);
   const product={...assembly.product,specs:assembly.product.specs.map(normalizeFact)};
   const mappings=scoped.requirements.map(r=>({requirement_id:r.id,spec_ids:product.specs.filter(s=>sameMetric(r,s)).map(s=>s.id)}));
   return {...assessProduct(product,scoped.requirements,[...checked.proof,...productSources,...assembly.sources],mappings,complete,item),configuration:assembly.configuration};
  }).sort(rankMatches);
  return {...item,...scoped,reviewed:true,document_issues:[...docs.blockers.map(b=>b.message),...conflicts.map(c=>c.message)],awarding_mode:mode,documents_complete:complete,candidate_count:assessed.length,products:assessed.slice(0,3),obligation_checks:scoped.obligations.map(requirement=>({requirement,status:'verificar',reason:'Obrigação da proposta/fornecimento: exige confirmação da empresa.'}))};
 });
 const summary=summarize(compared,baseScore),complete=readComplete&&parsedComplete&&manifestVerified&&docs.complete&&!checked.conflicts.length;
 return {...summary,documents_complete:complete,review:{revision:checked.review.revision,reviewed_by:checked.review.reviewed_by,reviewed_at:checked.review.reviewed_at},document_coverage:docs,
  coverage:{chunks:sources.reduce((n,s)=>n+s.pages.length,0),processed:sources.reduce((n,s)=>n+s.pages.length,0),read_complete:readComplete,complete:readComplete?sources.reduce((n,s)=>n+s.pages.length,0):0,requirements:checked.facts.length,comparisons:compared.reduce((n,i)=>n+i.products.reduce((t,p)=>t+p.requirements.length,0),0)},
  sources:sources.map(s=>({id:String(s.id),name:s.name,url:s.url,pages:s.pages.length,complete:s.complete,...documentRole(s)})),conflicts:checked.conflicts,notes:[...docs.blockers.map(b=>b.message),...checked.conflicts.map(c=>c.message),...(checked.unreviewed?['Há documento adicional ainda não incluído nesta revisão.']:[]),...(!manifestVerified?['Falta confirmar se a lista de anexos continua atualizada no PNCP.']:[])]};
}
module.exports={reviewedRequirements,reviewedComparison};
