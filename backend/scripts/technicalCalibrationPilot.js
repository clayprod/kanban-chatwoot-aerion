'use strict';
// Default is offline. Paid execution is explicit, sequential, cached, and capped
// at US$1 TOTAL across restarts, not US$1 per notice or invocation.
const fs=require('fs'),path=require('path');
const {hash,text}=require('../technicalRules');
const {createExtractionRunner}=require('../technicalExtraction');
const {classifySections}=require('../technicalSections');
const {documentCoverage,documentRole,itemScopeEvidence}=require('../technicalProvenance');
const {normalizeFact,requirementsForItem}=require('../technicalQuality');
const {maximumCost,createCostGuard}=require('../technicalCostGuard');
const {chunksForSource}=require('../technicalDocuments');
const {metricKey,componentOf}=require('../technicalMetrics');
const {build}=require('../tests/fixtures/technical-calibration/golden');
const ids=['362510','362554','362729'];
const directory=path.resolve(__dirname,'../data/calibration-v2');fs.mkdirSync(directory,{recursive:true});
const read=(name,fallback)=>fs.existsSync(path.join(directory,name))?JSON.parse(fs.readFileSync(path.join(directory,name),'utf8')):fallback;
const write=(name,data)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(data,null,2)+'\n');
const legacy=require('../tests/fixtures/technical-calibration/golden');
function compareGolden(facts,golden){
 const normalized=facts.map(normalizeFact);
 return golden.map(normalizeFact).map(g=>{
  const matched=normalized.find(f=>metricKey(f.key)===metricKey(g.key)&&componentOf(f)===componentOf(g)&&(g.item_number==='all'?f.item_number==='all':f.item_number==='all'||String(f.item_number)===String(g.item_number))&&
   (typeof g.value==='number'?typeof f.value==='number'&&f.value===g.value:text(f.value).includes(text(g.value))));
  return {key:g.key,component:g.component,expected:g.value,source_id:g.source_id,location:g.location,quote:g.quote,matched:!!matched,...(matched?{actual:matched.value,actual_quote:matched.quote}:{})};
 });
}
async function main(){
 const paid=process.argv.includes('--paid');
 if(!paid){
  const results=ids.map(id=>{const g=build(id),oldPath=path.resolve(__dirname,`../data/pilot-${id}-result.json`),old=fs.existsSync(oldPath)?JSON.parse(fs.readFileSync(oldPath)):null;
   const facts=old?.items?.flatMap(i=>[...i.requirements,...i.obligations]) || [];
   const checked=compareGolden(facts,g.facts);
   return{id,title:g.notice.title,reviewed_rows:g.facts.length,source_pages:g.notice.sources.reduce((n,s)=>n+s.pages.length,0),documents:documentCoverage(g.notice.sources),legacy_match_count:checked.filter(c=>c.matched).length,legacy_misses:checked.filter(c=>!c.matched),paid_calls:0};});
  write('offline-report.json',results);console.log(JSON.stringify(results.map(r=>({id:r.id,rows:r.reviewed_rows,pages:r.source_pages,legacy_matches:r.legacy_match_count,missing_tr:!r.documents.complete,paid_calls:0}))));return;
 }
 require('dotenv').config({path:path.resolve(__dirname,'../.env'),quiet:true});
 if(!process.env.OPENROUTER_API_KEY)throw Error('OpenRouter não configurado.');
 const model=process.env.TECHNICAL_OPENROUTER_AI_MODEL || 'openai/gpt-4.1-mini';
 const response=await fetch('https://openrouter.ai/api/v1/models',{signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('Não foi possível confirmar a tarifa do modelo.');
 const pricing=(await response.json()).data.find(m=>m.id===model)?.pricing;
 if(!pricing)throw Error('Modelo sem tarifa confirmada.');write('pricing.json',{model,pricing,at:new Date().toISOString()});
 const guard=createCostGuard({limitUsd:1,state:read('budget.json',{calls:[]}),persist:s=>write('budget.json',s)});
 const cache=read('responses.json',{}),parts=read('extractions.json',{}),sectionsCache=read('sections.json',{});
 const ask=async(job,_config,system,user,maxTokens,responseFormat)=>{
  const key=hash({model,system,user,maxTokens,responseFormat});if(cache[key])return cache[key];
  const reservation=guard.reserve(key,maximumCost({system,user,maxTokens,responseFormat},pricing),{model,notice:job.id,operation:responseFormat.json_schema.name});
  const res=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENROUTER_API_KEY}`,'Content-Type':'application/json','HTTP-Referer':'https://sales.aerion.com.br','X-Title':'Aerion - Technical calibration pilot'},body:JSON.stringify({model,temperature:0,max_tokens:maxTokens,provider:{require_parameters:true},response_format:responseFormat,messages:[{role:'system',content:system},{role:'user',content:user}]}),signal:AbortSignal.timeout(120000)});
  const data=await res.json();guard.settle(reservation,{ok:res.ok,http_status:res.status,usage:data.usage,request_id:data.id});
  if(!res.ok)throw Error(`OpenRouter HTTP ${res.status}; piloto interrompido.`);
  write(`generation-${data.id.replace(/[^a-zA-Z0-9_-]/g,'')}.json`,{id:data.id,usage:data.usage,choices:data.choices});
  if(data.choices?.[0]?.finish_reason==='length')throw Object.assign(Error('Resposta truncada'),{code:'truncated'});
  const answer=JSON.parse(data.choices[0].message.content);cache[key]=answer;write('responses.json',cache);return answer;
 };
 const extract=createExtractionRunner({ask,isTruncated:e=>e.code==='truncated',read:async(_j,s,k,key,index)=>parts[`${s.id}:${k}:${key}:${index}`],write:async(_j,s,k,key,index,data)=>{parts[`${s.id}:${k}:${key}:${index}`]=data;write('extractions.json',parts);}});
 const code=fs.readFileSync(path.resolve(__dirname,'../technicalAnalysis.js'),'utf8'),start=code.indexOf('const system = `Extraia fatos'),end=code.indexOf('\n    try { return await runExtraction',start);
 if(start<0||end<=start)throw Error('Prompt de produção não localizado.');
 const systemFor=Function('kind','chunk','s',code.slice(start,end)+';return system;');
 const reports=[];
 for(const id of ids){
  const g=build(id),n=g.notice,job={id},all=n.sources.filter(s=>documentRole(s).binding).flatMap(s=>chunksForSource(s).map(c=>({s,c}))),plan=[];
  for(let i=0;i<all.length;){const batch=[];let size=0;for(const part of all.slice(i)){if(batch.length&&size+part.c.text.length>22000)break;batch.push(part);size+=part.c.text.length;if(batch.length===8)break;}
   plan.push(...await classifySections(ask,job,{},batch,{read:async(_j,s,k,index)=>sectionsCache[`${s.id}:${k}:${index}`],write:async(_j,s,k,index,data)=>{sectionsCache[`${s.id}:${k}:${index}`]=data;write('sections.json',sectionsCache);}}));i+=batch.length;
  }
  const facts=[],coverage=[];
  for(const[i,{s,c}]of all.entries()){
   if(!plan[i].technical){coverage.push({source_id:s.id,location:c.location,complete:true,classification:'administrative'});continue;}
   const context={items:n.items.map(i=>({number:String(i.numeroItem),quantity:i.quantidade,unit:i.unidadeMedida})),scope_evidence:itemScopeEvidence([s])};
   let result;do{result=await extract({job,config:{},source:s,chunk:c,kind:'notice',context,system:systemFor('notice',c,s)});}while(result.pending_subtasks);
   facts.push(...result.facts);coverage.push({source_id:s.id,location:c.location,complete:result.complete,issues:result.issues});
   write(`${id}-progress.json`,{facts,coverage});console.log(JSON.stringify({id,source:s.id,page:c.location,complete:result.complete,rows:result.facts.length,cost:guard.total()}));
  }
  const checks=compareGolden(facts,g.facts),report={id,title:n.title,coverage,document_coverage:documentCoverage(n.sources),facts,checks,matched:checks.filter(c=>c.matched).length,expected:checks.length,items:n.items.map(i=>({number:i.numeroItem,...requirementsForItem(facts,String(i.numeroItem))})),cost_total:guard.total()};
  reports.push(report);write(`${id}-report.json`,report);write('report.json',reports);
  console.log(JSON.stringify({id,matched:report.matched,expected:report.expected,cost:guard.total()}));
 }
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={compareGolden};
