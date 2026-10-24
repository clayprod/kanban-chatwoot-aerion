'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {compareRequirement,compareNumeric,summarize,evidenceValid}=require('../technicalRules');
const {sameMetric}=require('../technicalMetrics');const {structuredFacts}=require('../structuredSpecifications');
const {validateSections}=require('../technicalSections');const {awardingMode,fullAwardable}=require('../technicalAwarding');
const {validateFacts}=require('../technicalExtraction');
test('a wrong line identifier cannot replace a correct literal quotation or validate an absent number',()=>{
 const chunk={text:'Câmera de 20 MP\nAutonomia =40 min',location:'Página 1'},source={id:'1'};
 const fact={item_number:'1',label:'Autonomia',key:'flight_time',component:'',kind:'numeric',value:40,unit:'min',quote:'Autonomia =40 min',evidence_line_ids:['l0']};
 const result=validateFacts([fact],source,chunk,'notice',{items:[{number:'1'}]},'p');
 assert.equal(result.facts[0].quote,'Autonomia =40 min');
 assert.equal(validateFacts([{...fact,value:45,quote:'',evidence_line_ids:['l0']}],source,chunk,'notice',{items:[{number:'1'}]},'p').rejected.length,1);
});
test('AI cannot equate motor type with radio range or certification with zoom',()=>{
 for(const [required,offered] of [['motor_type','transmission_distance_fcc'],['anatel_homologation','hybrid_zoom']]){
  const req={id:'r',key:required,kind:'categorical',value:'sim',source_id:'r',location:'p1',quote:'Exigência: sim'};
  const spec={id:'s',key:offered,kind:'categorical',value:'sim',source_id:'s',location:'p1',quote:'Oferecido: sim'};
  assert.equal(compareRequirement(req,[spec],[{id:'r',text:req.quote},{id:'s',text:spec.quote}],{spec_ids:['s'],same_metric:true}).status,'verificar');
 }
});
test('performance up to 45 min does not approve a 42 min aircraft as a maximum constraint',()=>{
 const req={key:'flight_time',kind:'numeric',value:45,unit:'min',operator:'max',quote:'Autonomia de até 45 min'};
 assert.equal(compareNumeric(req,{...req,value:42,quote:'Autonomia 42 min'}).status,'verificar');
 assert.equal(compareNumeric({...req,operator:'min',quote:'Autonomia mínima de 45 min'},{...req,value:42,quote:'Autonomia 42 min'}).status,'nao_ok');
});
test('camera components remain distinct even when both have a 48 MP sensor',()=>{
 assert.equal(sameMetric({key:'effective_resolution_tele'},{key:'camera_resolution',component:'wide_camera'}),false);
 assert.equal(sameMetric({key:'effective_resolution_tele'},{key:'camera_resolution',component:'tele_camera'}),true);
  assert.equal(sameMetric({key:'wind_resistance',component:'',label:'Drone com baterias'},{key:'wind_resistance',component:''}),true);
});
test('explicit capability lists accept all required formats but never invent a missing format',()=>{
 const req={id:'r',key:'photo_formats',kind:'categorical',value:'JPEG/RAW',source_id:'r',location:'p1',quote:'Formato JPEG/RAW'};
 const spec={...req,id:'s',source_id:'s',value:'JPG/RAW/JPG+RAW',quote:'Formatos JPG/RAW/JPG+RAW'};
 const compare=(r,s)=>compareRequirement(r,[s],[{id:'r',text:r.quote},{id:'s',text:s.quote}],{spec_ids:['s']});
 assert.equal(compare(req,spec).status,'ok');
 assert.equal(compare(req,{...spec,value:'JPG',quote:'Formato JPG'}).status,'verificar');
});
test('catalogue preserves every complex field and its exact component/source',()=>{
 const rows=[{section:'Câmera teleobjetiva',label:'Sensor de imagem',value:'CMOS 1/2 polegada; 48 MP'},{section:'Aeronave',label:'Velocidade máxima horizontal',value:'Modo normal 10 m/s; modo esportivo 20 m/s'}];
 const source={id:'s',text:rows.map(r=>`${r.section}\n${r.label}: ${r.value}`).join('\n')};const facts=structuredFacts(rows,source);
 assert.equal(facts.length,3);assert.ok(facts.every(f=>evidenceValid(f,[source])));
 assert.equal(facts.find(f=>f.key==='camera_resolution').component,'tele_camera');
 assert.equal(facts.find(f=>f.key==='flight_speed').kind,'categorical','a multi-mode speed cannot be reduced to an arbitrary first number');
});
test('administrative classification never discards missing/uncertain or obviously technical sections',()=>{
 const chunks=['Assinaturas do documento','Sensor de 20 MP e autonomia de voo','Condições especiais do objeto'].map(text=>({c:{text}}));
 const out=validateSections({sections:[{id:'0',kind:'administrative',quote:'Assinaturas do documento'},{id:'1',kind:'administrative',quote:'Sensor de 20 MP'}]},chunks);
 assert.deepEqual(out.map(s=>s.technical),[false,true,true]);
});
test('one full item qualifies individually, but a global/unknown award needs all items',()=>{
 const a={number:'1',in_scope:true,documents_complete:true,products:[{status:'full',product_id:'p',counts:{ok:1,total:1}}]};const b={number:'2',in_scope:true,documents_complete:true,products:[{status:'failed'}]};
 for(const mode of ['global','unconfirmed'])assert.equal(fullAwardable([{...a,awarding_mode:mode},b],{...a,awarding_mode:mode}),false);
 assert.equal(fullAwardable([a,b],{...a,awarding_mode:'item'}),true);
 assert.equal(awardingMode([{pages:[{text:'Critério de julgamento: menor preço por item.'}]}],[a,b]),'item');
 assert.equal(awardingMode([{pages:[{text:'Menor preço global.'}]}],[a,b]),'global');
 assert.equal(summarize([{...a,products:[{...a.products[0],status:'uncertain',evidence_current:false,technical_percent:100}]}],80).technical_percent,null);
});
