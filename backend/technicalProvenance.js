'use strict';
const {text}=require('./technicalRules');
function documentRole(source){
 const opening=text((source.pages || []).slice(0,1).map(p=>p.text).join('\n')).slice(0,1800);
 // Contents, not a filename alone, establish that this is market research.
 if(/^(?:relatorio de cotacao|pesquisa de precos|relatorio de pesquisa de precos)/.test(opening) || /relatorio gerado/.test(opening)&&/bancodeprecos|banco de precos|metodo matematico aplicado/.test(opening))
  return {role:'price_reference',binding:false,reason:'Pesquisa de preços: descrições de outras compras não são exigências desta contratação.'};
 return {role:'procurement',binding:true,reason:'Documento da contratação; especificações devem ser conferidas no texto.'};
}
function documentCoverage(sources){
 const binding=sources.filter(s=>documentRole(s).binding),pages=binding.flatMap(s=>(s.pages || []).map(p=>({source_id:String(s.id),location:p.location,text:p.text})));
 const references=pages.filter(p=>/termo de referencia/.test(text(p.text)));
 const actual=pages.some(p=>{
  const value=text(p.text).replace(/\s+/g,' ');
  const header=String(p.text).split('\n').some(line=>/^(?:anexo\s+[ivxlcdm0-9]+\s*[-–:]?\s*)?termo de referencia(?:\s+para\b.*)?$/i.test(text(line)));
  return header && !/termo de referencia\s*\(?documento em anexo\)?/.test(value) && value.length>350;
 }) || binding.some(s=>/termo.?de.?referencia|\btr\b/.test(text(s.name)) && (s.pages || []).some(p=>p.text.length>600 && /\b(?:objeto|especificacoes|requisitos|caracteristicas)\b/.test(text(p.text))));
 const blockers=references.length&&!actual?[{code:'referenced_tr_missing',message:'O edital cita um Termo de Referência separado, mas seu conteúdo não foi localizado nos documentos disponíveis.',source_id:references[0].source_id,location:references[0].location}]:[];
 return {complete:blockers.length===0,blockers,documents:sources.map(s=>({source_id:String(s.id),...documentRole(s)}))};
}
function itemScopeEvidence(sources){
 const result=[];
 for(const s of sources.filter(s=>documentRole(s).binding)){
  const pages=s.pages || [];
  for(let i=0;i<pages.length;i++)if(/\b(?:LOTE|GRUPO)[\s\S]{0,180}\bITEM\b/i.test(pages[i].text)){
    for(const page of pages.slice(i,i+2))if(!result.some(p=>p.source_id===String(s.id)&&p.location===page.location))
      result.push({source_id:String(s.id),location:page.location,text:page.text});
  }
 }
 return result;
}
module.exports={documentRole,documentCoverage,itemScopeEvidence};
