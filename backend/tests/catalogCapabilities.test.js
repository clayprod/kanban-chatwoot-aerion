'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {capabilityRows}=require('../catalogCapabilities');
const {structuredFacts}=require('../structuredSpecifications');
const {normalizeFact}=require('../technicalQuality');
const {compareRequirement,evidenceValid}=require('../technicalRules');
const {sameMetric}=require('../technicalMetrics');
const {reviewedComparison}=require('../technicalReviewedNotices');
const fixture=require('./fixtures/technical-calibration/362510.json');
const catalog=require('../data/aerionTechnicalSpecifications.json');
function pack(rows){const source={id:'spec',text:rows.map(r=>`${r.section}\n${r.label}: ${r.value}${r.note?'\n'+r.note:''}`).join('\n\n')};return {source,facts:structuredFacts(rows,source).map(normalizeFact)};}
function compare(req,pack){const q={id:'req',source_id:'req',location:'TR',quote:req.value,component:'',kind:'categorical',operator:'eq',conditions:'',...req};return compareRequirement(q,pack.facts,[pack.source,{id:'req',text:q.quote}],{spec_ids:pack.facts.filter(f=>sameMetric(q,f)).map(f=>f.id)});}
test('every sold aircraft has source-backed RTH; not a generic assertion for all products',()=>{
 const drones=catalog.products.filter(p=>!['901030202','EVO-NEST'].includes(p.sku));assert.equal(drones.length,6);
 for(const p of drones){const data=pack(capabilityRows(p.sku));assert.equal(compare({key:'rth',value:'RTH'},data).status,'ok',p.name);assert.ok(data.facts.every(f=>evidenceValid(f,[data.source])));}
 assert.deepEqual(capabilityRows('901030202'),[]);assert.deepEqual(capabilityRows('unknown'),[]);
});
test('cached source normalization is invalidated when a source text changes',()=>{
 const source={id:'s',text:'Retorno automático RTH'},fact={source_id:'s',location:'Página 1',quote:'Retorno automático RTH'};
 assert.equal(evidenceValid(fact,[source]),true);source.text='Função removida';assert.equal(evidenceValid(fact,[source]),false);
});
test('reviewed professional/long-range descriptions match generic criteria, never numeric or specific application requirements',()=>{
 const data=pack(capabilityRows('102002996'));
 assert.equal(compare({key:'professional_use',value:'PROFISSIONAL'},data).status,'ok');
 assert.equal(compare(normalizeFact({key:'long_range',kind:'compound',value:'LONGO ALCANCE'}),data).status,'ok');
 assert.equal(compare({key:'professional_use',value:'profissional — inspeção certificada específica'},data).status,'verificar');
 assert.equal(compare({key:'long_range',value:'longo alcance de 30 km'},data).status,'verificar');
 assert.equal(compare({key:'professional_use',value:'PROFISSIONAL'},pack(capabilityRows('HUBSAN-MINI-7'))).status,'verificar');
 assert.equal(compare({key:'professional_use',value:'PROFISSIONAL'},pack([])).status,'verificar');
});
test('controller fields, sensor shorthand and gimbal model are not lost or conflated',()=>{
 for(const sku of ['HUBSAN-MINI-7','102003505','102002996']){
  const p=catalog.products.find(p=>p.sku===sku),data=pack(p.rows);
  assert.equal(compare({key:'controller_screen',component:'controller',value:'tela integrada'},data).status,'ok',p.name);
  assert.ok(data.facts.some(f=>f.key==='camera_sensor'&&f.component==='wide_camera'),p.name);
  assert.ok(!data.facts.some(f=>f.key==='gimbal_stabilization'&&/^Fusion/.test(f.value)),p.name);
 }
 const req=normalizeFact({key:'flight_time',label:'Tempo máximo de voo estacionário',value:41});assert.equal(req.key,'hover_time');
});
test('all catalog entries compete and only the best three are returned, with compatibility before price',()=>{
 const req=fixture.sources.flatMap(s=>s.pages).map(p=>p.text).join('\n');assert.ok(req.includes('RTH'));
 const data=pack(capabilityRows('102002996'));
 const products=[{id:1,name:'Sem palavras de busca',sale_price:500,specs:data.facts},{id:2,name:'Mais barato mas sem evidência',sale_price:1,specs:[]},{id:3,name:'Mesmo atendimento mais barato',sale_price:100,specs:data.facts},{id:4,name:'Outro',sale_price:600,specs:data.facts}].map(p=>({...p,specs_complete:true,unit:'un',package_confirmed:true}));
 const result=reviewedComparison({noticeKey:fixture.key,sources:fixture.sources,catalog:products,accessories:[],productSources:[data.source],items:[{number:'1',in_scope:true,unit:'un',quantity:1,reference_price:1000}],baseScore:87});
 assert.equal(result.items[0].candidate_count,4);assert.deepEqual(result.items[0].products.map(p=>p.product_id),[3,1,4]);assert.equal(result.base_score,87);assert.ok(result.score>=87);
});
