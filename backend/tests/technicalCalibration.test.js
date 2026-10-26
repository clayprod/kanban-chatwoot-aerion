'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {build}=require('./fixtures/technical-calibration/golden');
const {documentRole,documentCoverage}=require('../technicalProvenance');
const {quotedNumber,compareNumeric,assessProduct,commercialUnit,compareRequirement}=require('../technicalRules');
const {normalizeFact,uniqueFacts}=require('../technicalQuality');
const {createExtractionRunner,extractionKey,sourceBlocks}=require('../technicalExtraction');
const {numberMentions}=require('../technicalNumbers');
const {maximumCost,createCostGuard}=require('../technicalCostGuard');
const {structuredFacts}=require('../structuredSpecifications');
const {assembleProduct}=require('../productPackages');
const {reviewedRequirements,reviewedComparison}=require('../technicalReviewedNotices');
for(const id of ['362510','362554','362729'])test(`real document ${id}: reviewed requirements have literal sources and correct document coverage`,()=>{
 const {notice,facts,expected_document_complete,expected_reference_sources}=build(id);
 assert.ok(facts.length>0);
 assert.equal(documentCoverage(notice.sources).complete,expected_document_complete);
 assert.deepEqual(notice.sources.filter(s=>!documentRole(s).binding).map(s=>s.id),expected_reference_sources);
 for(const f of facts){const source=notice.sources.find(s=>s.id===f.source_id),page=source.pages.find(p=>p.location===f.location);assert.ok(page.text.includes(f.quote),f.key);if(typeof f.value==='number')assert.ok(quotedNumber(f,f.value),f.key);}
 if(id==='362554')assert.equal(facts.find(f=>f.key==='battery_quantity').value,3);
 if(id==='362510')assert.equal(normalizeFact(facts.find(f=>f.key==='zoom_unspecified')).key,'zoom_unspecified');
});
test('Portuguese quantities and thousands retain their original evidence and strict boundaries',()=>{
 assert.ok(numberMentions('três baterias, seis mil metros e quarenta e um minutos').some(n=>n.value===6000));
 const req={key:'battery_quantity',kind:'numeric',value:3,unit:'baterias',operator:'eq',quote:'três baterias',conditions:''};
 assert.equal(compareNumeric(req,{...req,quote:'2 baterias',value:2}).status,'nao_ok');
 assert.equal(compareNumeric(req,{...req,quote:'3 baterias',value:3}).status,'ok');
 assert.equal(quotedNumber({quote:'três baterias'},4),false);
 assert.equal(quotedNumber({quote:'−135 graus'},135),false);assert.equal(quotedNumber({quote:'−135 graus'},-135),true);
});
test('reviewed results rebind exact source content and disappear after a document change',()=>{
 const g=build('362729'),sources=g.notice.sources.map(s=>({...s,id:'new-'+s.id}));
 const checked=reviewedRequirements(g.notice.key,sources);assert.ok(checked);assert.equal(checked.facts.length,100);
 assert.ok(checked.facts.every(f=>f.source_id.startsWith('new-')));
 assert.equal(checked.facts.find(f=>f.key==='hover_time').key,'hover_time');
 assert.equal(checked.facts.find(f=>f.key==='descent_speed').key,'descent_speed');
 assert.ok(checked.facts.find(f=>f.key==='battery_quantity').quantity_verified);
 const changed=structuredClone(sources);changed[0].pages[0].text+=' Documento alterado.';
 assert.equal(reviewedRequirements(g.notice.key,changed),null);
});
test('reviewed comparison publishes item checklists without any AI dependency and retains missing-document reasons',()=>{
 const g=build('362510'),items=g.notice.items.map(i=>({number:String(i.numeroItem),quantity:i.quantidade,unit:i.unidadeMedida,reference_price:i.valorUnitarioEstimado,in_scope:true}));
 const result=reviewedComparison({noticeKey:g.notice.key,sources:g.notice.sources,catalog:[],accessories:[],productSources:[],items,baseScore:80});
 assert.equal(result.items[0].requirements.length,18);assert.equal(result.items[0].reviewed,true);
 assert.equal(result.documents_complete,false);assert.match(result.items[0].document_issues[0],/Termo de Referência/);
 assert.equal(result.coverage.read_complete,true);assert.ok(result.review);
});
test('price research cannot become a technical requirement, even when it contains another drone specification',()=>{
 assert.equal(documentRole({name:'TR.pdf',pages:[{text:'Relatório de Cotação: mercado. Drone com autonomia mínima de 90 min.'}]}).binding,false);
 assert.equal(documentRole({name:'PESQUISA.pdf',pages:[{text:'TERMO DE REFERÊNCIA\nO equipamento deverá ter autonomia mínima de 41 min.'}]}).binding,true);
});
test('single-pass extraction validates every block in one paid call and reuses it across section titles and item order',async()=>{
 const cache=new Map();let calls=0;
 const source={id:'s'},chunk={chunk:0,text:'Autonomia mínima de 41 min.',location:'Página 1'},context={section:'Título antigo',items:[{number:'2'},{number:'1'}]};
 const fact={...build('362729').facts.find(f=>f.key==='flight_time'),item_number:'all',value:41,unit:'min',operator:'min',quote:chunk.text,key:'flight_time'};
 const extract=createExtractionRunner({read:async(_j,_s,_k,k,i)=>cache.get(k+':'+i),write:async(_j,_s,_k,k,i,d)=>cache.set(k+':'+i,d),isTruncated:()=>false,ask:async()=>{calls++;return{complete:true,facts:[fact],conflicts:[],coverage:{'0':{classification:'requirements',fact_indexes:[0],reason:'Conferido.'}}};}});
 const args={job:{},config:{},source,chunk,context,kind:'notice',system:'Extrair.'};
 assert.equal((await extract(args)).complete,true);
 assert.equal((await extract({...args,context:{...context,section:'Outro título',items:[...context.items].reverse()}})).cache_hit,true);
 assert.equal(calls,1);assert.equal(extractionKey('notice',context,chunk.text),extractionKey('notice',{...context,section:'Outro'},chunk.text));
});
test('duplicate citations do not inflate a checklist or change the item scope',()=>{
 const facts=build('362510').facts;
 const doubled=facts.flatMap(f=>[f,{...f,id:f.id+'copy',source_id:'copy',label:'Rótulo diferente',location:'Página 99'}]);
 assert.equal(uniqueFacts(doubled).length,uniqueFacts(facts).length);
});
test('an absent TR never permits full compliance even if all available technical rows match',()=>{
 const {notice,facts}=build('362510'),requirements=facts.filter(f=>f.key==='flight_time');
 const s={id:'spec',text:'40 min'},spec={...requirements[0],id:'s',source_id:'spec',location:'Ficha',quote:'40 min'};
 const result=assessProduct({id:1,name:'Drone',specs:[spec],specs_complete:true},requirements,[...notice.sources.map(s=>({...s,text:s.pages.map(p=>p.text).join('\n')})),s],[{requirement_id:requirements[0].id,spec_ids:['s']}],documentCoverage(notice.sources).complete);
 assert.notEqual(result.status,'full');
});
test('money is reserved before a request and unknown billing stops further paid work',()=>{
 const guard=createCostGuard({limitUsd:1});
 const call=guard.reserve('one',0.8);assert.throws(()=>guard.reserve('two',0.3),/sem custo reconciliado/);
 guard.settle(call,{ok:true,usage:{cost:0.05},request_id:'gen-real'});assert.equal(guard.total(),0.05);
 assert.throws(()=>guard.reserve('over',0.96),/Teto/);
 const next=guard.reserve('two',0.5);assert.throws(()=>guard.settle(next,{ok:true}),/não confirmou/);
 assert.throws(()=>guard.reserve('two',0.01),/sem custo reconciliado/);
 assert.ok(maximumCost({system:'s',user:'u',responseFormat:{},maxTokens:7000},{prompt:'0.0000004',completion:'0.0000016'})>0.01);
});
test('real catalogue flight durations with parentheses remain numeric without taking unrelated battery or speed values',()=>{
 for(const [sku,expected]of [['901030260',40],['HUBSAN-MINI-7',28],['102003505',42]]){
  const p=require('../data/aerionTechnicalSpecifications.json').products.find(p=>p.sku===sku);
  const row=p.rows.find(r=>/Tempo máximo de voo/.test(r.label));
  const fact=structuredFacts([row],{id:'source'})[0];assert.equal(fact.kind,'numeric');assert.equal(fact.value,expected);
  const req={key:'flight_time',kind:'numeric',value:41,unit:'min',operator:'min',quote:'Autonomia mínima de 41 min',conditions:''};
  assert.equal(compareNumeric(req,fact).status,expected<41?'nao_ok':'ok');
 }
});
test('three spare batteries are additional to operating batteries; unknown operating quantity blocks automatic approval',()=>{
 const req={...build('362510').facts.find(f=>f.key==='battery_quantity_reserve'),id:'r'};
 const sources=[{id:req.source_id,text:req.quote}],p={id:1,sale_price:100,package_confirmed:true,specs_complete:true,specs:[],included_items:[{key:'battery',label:'Baterias de voo',quantity:2,operating_quantity:1}],compatible_ids:[2]};
 const accessory={id:2,active:true,product_type:'accessory',accessory_key:'battery',units_per_sale:1,package_confirmed:true,sale_price:10,specs_complete:true};
 const assembled=assembleProduct(p,[req],[accessory],sources);
 assert.equal(assembled.configuration.additions[0].quantity,2);assert.equal(assembled.product.sale_price,120);
 assert.equal(assembled.product.specs[0].value,3);
 const unknown=assembleProduct({...p,included_items:[{key:'battery',label:'Baterias',quantity:2}]},[req],[accessory],sources);
 assert.equal(unknown.product.specs_complete,false);assert.equal(unknown.product.specs.length,0);
});
test('official one-unit descriptions allow comparable prices while multi-unit boxes do not',()=>{
 assert.equal(commercialUnit('1 UNIDADE'),'unit');assert.equal(commercialUnit('EMBALAGEM 1.0 UNIDADE'),'unit');
 assert.notEqual(commercialUnit('EMBALAGEM 2 UNIDADES'),'unit');assert.notEqual(commercialUnit('kit'),'unit');
});
test('explicit absence of a thermal camera fails thermal requirements instead of hiding behind a missing metric',()=>{
 const req={id:'r',source_id:'r',location:'p1',quote:'Câmera térmica 640x512',key:'thermal_resolution',component:'thermal_camera',kind:'compound',value:'640x512',operator:'eq'};
 const spec={id:'s',source_id:'s',location:'Ficha',quote:'Possui câmera térmica: Não',key:'component_presence',component:'thermal_camera',kind:'categorical',value:'Não'};
 const result=compareRequirement(req,[spec],[{id:'r',text:req.quote},{id:'s',text:spec.quote}],{});
 assert.equal(result.status,'nao_ok');assert.equal(result.evidence[0].id,'s');
});
test('a half-inch CMOS does not satisfy a one-inch CMOS requirement, independently of megapixels',()=>{
 const r={id:'r',key:'camera_sensor',component:'wide_camera',kind:'categorical',value:'1 polegada',quote:'Sensor CMOS de 1 polegada',source_id:'r',location:'p1',operator:'eq'};
 const s={...r,id:'s',value:'1/2" CMOS, 48MP efetivos',quote:'Sensor de imagem: 1/2" CMOS, 48MP efetivos',source_id:'s'};
 assert.equal(compareRequirement(r,[s],[{id:'r',text:r.quote},{id:'s',text:s.quote}],{spec_ids:['s']}).status,'nao_ok');
});
test('lens properties are split only at their explicit labels; a zoom range is never its first focal length',()=>{
 const facts=structuredFacts([{section:'Câmera grande angular',label:'Lente',value:'DFOV: 83.4°, Distância focal equivalente: 24 mm, Abertura: f/2.8'}],{id:'s'});
 assert.equal(facts.find(f=>f.key==='focal_length').value,24);
 const variable=structuredFacts([{section:'Câmera tele',label:'Lente',value:'DFOV: 40°-10.3°, Distância focal equivalente: 64-234 mm'}],{id:'s'});
 assert.equal(variable.some(f=>f.key==='focal_length'||f.key==='lens_fov'),false);
});
test('all alternative capacities must agree, without picking gross storage over usable storage',()=>{
 const r={id:'r',key:'internal_storage',component:'',kind:'numeric',value:42,unit:'GB',operator:'min',quote:'Capacidade mínima de 42 GB',source_id:'r',location:'p1'};
 const s={id:'s',key:r.key,component:'',kind:'categorical',value:'128GB interno, 64GB disponível',quote:'Armazenamento interno: 128GB interno, 64GB disponível',source_id:'s',location:'Ficha',conditions:''};
 const proof=[{id:'r',text:r.quote},{id:'s',text:s.quote}];
 assert.equal(compareRequirement(r,[s],proof,{spec_ids:['s']}).status,'ok');
 const harder={...r,value:100,quote:'Capacidade mínima de 100 GB'};proof[0].text=harder.quote;
 assert.equal(compareRequirement(harder,[s],proof,{spec_ids:['s']}).status,'verificar');
});
test('temperature capabilities must cover the required interval in every declared load condition',()=>{
 const r={id:'r',key:'operating_temperature',component:'',kind:'compound',value:'-10 °C a 40 °C',operator:'eq',quote:'Temperatura de funcionamento: -10 °C a 40 °C',source_id:'r',location:'p1',conditions:''};
 const s={...r,id:'s',source_id:'s',value:'-20℃ a +50℃ (sem carga) / -20℃ a +40℃ (carga completa)',quote:'Temperatura: -20℃ a +50℃ (sem carga) / -20℃ a +40℃ (carga completa)'};
 assert.equal(compareRequirement(r,[s],[{id:'r',text:r.quote},{id:'s',text:s.quote}],{spec_ids:['s']}).status,'ok');
});
test('a controller screen marked none or not applicable cannot become positive evidence from its field name',()=>{
 const r={id:'r',key:'controller_screen',component:'controller',kind:'categorical',value:'tela integrada',quote:'Controle remoto com tela integrada',source_id:'r',location:'p1',conditions:''};
 for(const value of ['Nenhuma','N/A','Não','Sem tela']){
  const s={...r,id:'s',source_id:'s',label:'Tela',value,quote:`Tela: ${value}`};
  assert.notEqual(compareRequirement(r,[s],[{id:'r',text:r.quote},{id:'s',text:s.quote}],{spec_ids:['s']}).status,'ok');
 }
});
test('controller display and radio frequencies retain their controller component and distinct meanings',()=>{
 const facts=structuredFacts([{section:'CONTROLE HT55',label:'Tela',value:'5,5 polegadas Full HD'},{section:'COMUNICAÇÃO E CONTROLE',label:'Frequência operacional',value:'900MHz / 2.4 / 5.2 / 5.8 GHz'}],{id:'s'});
 assert.ok(facts.every(f=>f.component==='controller'));
 const f=facts.find(f=>f.key==='control_frequency'),r={id:'r',key:'control_frequency',component:'controller',kind:'numeric',value:5.8,unit:'GHz',operator:'eq',quote:'5.8 GHz',source_id:'r',location:'p1',conditions:''};
 assert.equal(compareRequirement(r,[f],[{id:'r',text:r.quote},{id:'s',text:f.quote}],{spec_ids:[f.id]}).status,'ok');
});
test('declared video formats compare independently of product names and never approve unverified frame rates',()=>{
 const r={id:'r',key:'video_resolution',component:'wide_camera',kind:'compound',value:'5.1K',quote:'Câmera 5.1K ou superior',operator:'min',source_id:'r',location:'p1',conditions:''};
 const s={...r,id:'s',source_id:'s',value:'6K a 30fps',quote:'Resolução de vídeo: 6K a 30fps'};
 const compare=(req,spec)=>compareRequirement(req,[spec],[{id:'r',text:req.quote},{id:'s',text:spec.quote}],{spec_ids:['s']}).status;
 assert.equal(compare(r,s),'ok');
 assert.equal(compare(r,{...s,value:'Até 4K a 30fps',quote:'Resolução de vídeo: Até 4K a 30fps'}),'nao_ok');
 assert.equal(compare({...r,quote:'Câmera 5.1K ou superior a 60 fps'},s),'verificar');
});
