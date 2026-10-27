'use strict';
// Presentation metadata is kept outside requirement facts: adding a clause
// number must never invalidate a saved human review or change its evidence.
const flat=value=>String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
function mapped(value){let text='',positions=[];for(let i=0;i<value.length;i++){for(const c of value[i].normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()){if(/\s/.test(c)){if(!text||text.endsWith(' '))continue;text+=' ';}else text+=c;positions.push(i);}}return {text,positions};}
function clauseAt(text,at){
 const start=text.lastIndexOf('\n',at-1)+1,line=text.slice(start).split('\n')[0];
 const match=/^\s*(?:[•–-]\s*)?((?:\d+\.)+\d+\.?|\d+[.)]|[a-z][)])(?:\s+|$)/i.exec(line);
 if(!match||at-start>1200)return null;
 // A decimal performance value at the beginning of a table cell is not a clause.
 if(/^(?:mm|cm|m|km|g|kg|k|mp|ghz|mhz|hz|min|ms|s|fps|pixels?|mah|wh|w|v|%)(?:\b|\s)/i.test(line.slice(match[0].length)))return null;
 const number=match[1].replace(/\.$/,'');
 if(!/^[a-z]\)/i.test(number))return number;
 const before=text.slice(0,start),parents=[...before.matchAll(/^\s*((?:\d+\.)+\d+\.?|\d+\.)\s+[A-Za-zÀ-ÿ]/gm)];
 const parent=parents.at(-1)?.[1]?.replace(/\.$/,'');return parent?`${parent}, ${number}`:number;
}
function annotateRequirementOrder(result,sources=[]){
 if(!result?.items)return result;
 const docs=sources.map((s,index)=>({...s,index,pages:(s.pages || []).map((p,page)=>({...p,page}))}));
 const locate=(r,index)=>{
  const doc=docs.find(s=>String(s.id)===String(r.source_id)),needle=flat(r.quote);
  const pageNumber=Number(/p[aá]g(?:ina|\.)?s?\s*(\d+)/i.exec(r.location || '')?.[1]);
  const pages=doc?.pages || [],preferred=pageNumber?pages.filter(p=>p.page===pageNumber-1):pages;
  for(const p of preferred){const search=p.search || (p.search=mapped(String(p.text || ''))),at=needle.length>=3?search.text.indexOf(needle):-1;if(at<0)continue;const offset=search.positions[at],number=clauseAt(String(p.text || ''),offset);return {source_id:String(doc.id),source_name:doc.name,location:p.location || r.location,number,automatic:!number,document_order:doc.index,page_order:p.page,offset,original_order:index};}
  return {source_id:r.source_id,source_name:doc?.name,location:r.location,number:null,automatic:true,document_order:doc?.index ?? docs.length,page_order:pageNumber?pageNumber-1:Number.MAX_SAFE_INTEGER,offset:Number.MAX_SAFE_INTEGER,original_order:index};
 };
 return {...result,items:result.items.map(item=>{
  const facts=[...(item.requirements || []),...(item.obligations || [])];
  for(const p of item.products || [])for(const row of p.requirements || [])if(!facts.some(r=>r.id===row.requirement.id))facts.push(row.requirement);
  const references=new Map(facts.map((r,index)=>[r.id,locate(r,index)]));
  const compare=(a,b)=>{const x=references.get(a.id),y=references.get(b.id);return x.document_order-y.document_order||x.page_order-y.page_order||x.offset-y.offset||x.original_order-y.original_order;};
  const ordered=[...facts].sort(compare);ordered.forEach((r,index)=>{const ref=references.get(r.id);ref.ordinal=index+1;if(ref.automatic)ref.number=String(index+1).padStart(2,'0');});
  const products=(item.products || []).map(p=>({...p,requirements:[...(p.requirements || [])].sort((a,b)=>compare(a.requirement,b.requirement)).map(row=>({...row,document_reference:references.get(row.requirement.id)}))}));
  return {...item,requirements:[...(item.requirements || [])].sort(compare),obligations:[...(item.obligations || [])].sort(compare),requirement_references:Object.fromEntries(references),products,recommended_product:item.recommended_product?products.find(p=>String(p.product_id)===String(item.recommended_product.product_id)) || item.recommended_product:null,potential_product:item.potential_product?products.find(p=>String(p.product_id)===String(item.potential_product.product_id)) || item.potential_product:null};
 })};
}
module.exports={annotateRequirementOrder,clauseAt};
