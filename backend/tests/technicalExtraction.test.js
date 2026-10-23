'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createExtractionRunner,sourceBlocks,literalEvidenceQuote,validateAudit,mergeFacts} = require('../technicalExtraction');
const {COVERAGE_FORMAT} = require('../technicalAiFormat');
const {requirementsForItem} = require('../technicalQuality');
const {assessProduct} = require('../technicalRules');
const fact = (quote,extra={}) => ({item_number:'1',key:'flight_time',label:'Autonomia',category:'equipment',kind:'numeric',value:41,unit:'min',operator:'min',conditions:'',quote,...extra});
function fixture(content, handler, initialCache) {
  const cache = new Map(), calls = [];
  const extract = createExtractionRunner({
    read:async(_j,_s,_k,key,index)=>cache.get(`${key}:${index}`) || initialCache,
    write:async(_j,_s,_k,key,index,data)=>cache.set(`${key}:${index}`,data),
    ask:async(_j,_c,_system,user,_tokens,format)=>{const input=JSON.parse(user);calls.push({input,format});return handler(input,format);},
    isTruncated:e=>e.code==='truncated',
  });
  const args={job:{},config:{},source:{id:'s'},chunk:{chunk:0,text:content,location:'Página 1'},kind:'notice',context:{items:[{number:'1'}]},system:'Extrair e citar.'};
  return {extract,args,cache,calls};
}
const coverage = (input,facts) => input.blocks.map(b=>({block_id:b.id,classification:facts.some(f=>b.text.includes(f.quote))?'requirements':'context',fact_indexes:facts.map((_,i)=>i),reason:'Bloco conferido integralmente.'}));

test('independent coverage pass recovers an omitted requirement and every requirement gets a comparison',async()=>{
  const input='Autonomia mínima de 41 min.\nCâmera com resolução mínima de 20 MP.';
  const time=fact('Autonomia mínima de 41 min'),camera=fact('resolução mínima de 20 MP',{key:'camera_resolution',value:20,unit:'MP'});
  const f=fixture(input,(data,format)=>({complete:true,facts:format===COVERAGE_FORMAT?[time,camera]:[time],conflicts:[],...(data.blocks?{coverage:coverage(data,[time,camera])}:{})}));
  const result=await f.extract(f.args);
  assert.equal(result.complete,true);assert.equal(result.facts.length,2);assert.equal(f.calls.length,2);
  const assessed=assessProduct({id:1,name:'Sem ficha',specs:[]},result.facts,[{id:'s',text:input}]);
  assert.equal(assessed.requirements.length,2);assert.equal(assessed.counts.verificar,2);
});
test('complete=true without an entry for every source block never certifies coverage',()=>{
  const chunk={text:'Exigência A.\n'.repeat(250),location:'Página 1'},blocks=sourceBlocks(chunk.text);
  assert.ok(blocks.length>1);
  const result=validateAudit({complete:true,facts:[],conflicts:[],coverage:[{block_id:'0',classification:'context',fact_indexes:[],reason:'Capa.'}]},{id:'s'},chunk,'notice',{items:[{number:'1'}]},blocks,'id');
  assert.equal(result.complete,false);assert.ok(result.issues.some(i=>i.reason.includes('Bloco sem')));
});
test('unverifiable citations remain explicit diagnostics and partial cache is repaired on the next pass',async()=>{
  let repaired=false;
  const f=fixture('Autonomia mínima de 41 min.',data=>{
    const facts=[fact(repaired?'Autonomia mínima de 41 min':'Autonomia mínima de 99 min')];
    return{complete:true,facts,conflicts:[],...(data.blocks?{coverage:coverage(data,facts)}:{})};
  });
  const first=await f.extract(f.args);
  assert.equal(first.complete,false);assert.equal(first.facts.length,0);assert.ok(first.issues.length);
  repaired=true;
  const second=await f.extract(f.args);assert.equal(second.complete,true);assert.equal(second.facts.length,1);
  const before=f.calls.length;const third=await f.extract(f.args);
  assert.equal(third.cache_hit,true);assert.equal(f.calls.length,before);
});
test('false administrative conflicts are rechecked instead of poisoning all other documents',async()=>{
  const f=fixture('Página de assinatura e identificação.',(data,format)=>format===COVERAGE_FORMAT
    ? {complete:true,facts:[],conflicts:[],coverage:coverage(data,[])}
    : {complete:false,facts:[],conflicts:[{item_numbers:['all'],message:'Não há exigências técnicas.'}]});
  const result=await f.extract(f.args);assert.equal(result.complete,true);assert.deepEqual(result.conflicts,[]);
});
test('a real cited contradiction is retained separately from source coverage',async()=>{
  const content='Autonomia mínima de 41 min. Autonomia máxima de 40 min.';
  const facts=[fact('Autonomia mínima de 41 min'),fact('Autonomia máxima de 40 min',{value:40,operator:'max'})];
  const f=fixture(content,data=>({complete:true,facts,conflicts:data.blocks?[{item_numbers:['1'],message:'Valores conflitantes.',quote:content}]:[],...(data.blocks?{coverage:coverage(data,facts)}:{})}));
  const result=await f.extract(f.args);assert.equal(result.complete,true);assert.equal(result.conflicts.length,1);assert.equal(result.facts.length,2);
});
test('an uncited conflict cannot be silently accepted as a real documentary contradiction',async()=>{
  const f=fixture('Página de assinatura e identificação.',data=>({complete:true,facts:[],conflicts:[{item_numbers:['all'],message:'Ambiguidade inventada.',quote:'Texto que não existe'}],...(data.blocks?{coverage:coverage(data,[])}:{})}));
  const result=await f.extract(f.args);assert.equal(result.complete,false);assert.equal(result.conflicts.length,0);
});
test('adaptive subdivision recovers truncated output without dropping item identity or requirements',async()=>{
  const content='Autonomia mínima de 41 min.\n'+'Texto informativo. '.repeat(160);
  const f=fixture(content,(data)=>{
    if(data.document.text.length>2000)throw Object.assign(new Error('length'),{code:'truncated'});
    const facts=data.document.text.includes('Autonomia mínima de 41 min')?[fact('Autonomia mínima de 41 min')]:[];
    return{complete:true,facts,conflicts:[],...(data.blocks?{coverage:coverage(data,facts)}:{})};
  });
  const result=await f.extract(f.args);assert.equal(result.complete,true);assert.equal(result.subdivided,true);assert.equal(result.facts.length,1);
});
test('TR and edital facts consolidate per numbered item, including obligations outside technical percentage',async()=>{
  const sources=[['edital','Autonomia mínima de 41 min.',fact('Autonomia mínima de 41 min')],['tr','Treinamento presencial de 4 horas.',fact('Treinamento presencial de 4 horas',{key:'training',category:'supply',value:4,unit:'h'})]];
  const extracted=[];
  for(const[id,content,row]of sources){
    const f=fixture(content,data=>({complete:true,facts:[row],conflicts:[],...(data.blocks?{coverage:coverage(data,[row])}:{})}));
    f.args.source.id=id;extracted.push(...(await f.extract(f.args)).facts);
  }
  const item=requirementsForItem(extracted,'1');assert.equal(item.requirements.length,1);assert.equal(item.obligations.length,1);
  assert.deepEqual(new Set(extracted.map(f=>f.source_id)),new Set(['edital','tr']));
});
test('identical technical facts for different quota items retain both item associations',()=>{
  const first={...fact('Autonomia mínima de 41 min'),source_id:'s'},second={...first,item_number:'2'};
  assert.equal(mergeFacts([first],[second]).length,2);
});
test('a mandatory clause cannot be dismissed as ordinary context',()=>{
  const chunk={text:'O equipamento deverá ter autonomia mínima de 41 min.',location:'Página 1'},blocks=sourceBlocks(chunk.text);
  const value={complete:true,facts:[],conflicts:[],coverage:[{block_id:'0',classification:'context',fact_indexes:[],reason:'Texto comum.'}]};
  assert.equal(validateAudit(value,{id:'s'},chunk,'notice',{items:[{number:'1'}]},blocks,'id').complete,false);
});

test('PDF line-wrapped words recover a contiguous literal quote without changing numerical evidence',()=>{
 const source='Vídeo de 100 a 12.800 (normal) / até 51.200 (no-\nturno).';
 const recovered=literalEvidenceQuote('Vídeo de 100 a 12.800 (normal) / até 51.200 (no-turno)',source);
 assert.equal(recovered,'Vídeo de 100 a 12.800 (normal) / até 51.200 (no-\nturno)');
 assert.equal(literalEvidenceQuote('até 51.200 (noturno)',source),'até 51.200 (no-\nturno)');
 assert.equal(literalEvidenceQuote('até 51.201 (noturno)',source),null);
 assert.equal(literalEvidenceQuote('até 51.200 (noturno)',`📄 ${source}`),'até 51.200 (no-\nturno)');
 assert.equal(literalEvidenceQuote('autonomia mínima de 40 min','autonomia mínima de 41 min'),null);
 assert.equal(literalEvidenceQuote('Primeira última exigência','Primeira outra condição última exigência'),null);
});
test('an invented first-pass candidate cannot force the reviewer to repeat unsupported evidence',async()=>{
 const f=fixture('Autonomia mínima de 41 min.',(data,format)=>{
  const facts=[fact(format===COVERAGE_FORMAT?'Autonomia mínima de 41 min':'Autonomia mínima de 99 min',{value:format===COVERAGE_FORMAT?41:99})];
  return{complete:true,facts,conflicts:[],...(data.blocks?{coverage:coverage(data,facts)}:{})};
 });
 const result=await f.extract(f.args);assert.equal(result.complete,true);assert.equal(result.facts.length,1);assert.equal(result.facts[0].value,41);assert.equal(result.first_pass_rejections.length,1);
});
