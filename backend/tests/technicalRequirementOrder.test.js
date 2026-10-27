'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {annotateRequirementOrder,clauseAt}=require('../technicalRequirementOrder');const {assessProduct}=require('../technicalRules');const {fingerprint}=require('../technicalReviews');
test('original clause numbers and source order survive thematic grouping and do not invalidate manual review fingerprints',()=>{
 const source={id:'s',name:'TR.pdf',pages:[{location:'Página 1',text:'4.2 Sistema de captura\na) Sensor CMOS de 1 polegada.\nb) Vídeo 4K.\n4.3 Segurança\n4.3.1 Retorno automático.\nCondição profissional.'}]};
 const reqs=[{id:'rth',quote:'Retorno automático.',section:'Segurança'},{id:'video',quote:'Vídeo 4K.',section:'Câmeras'},{id:'sensor',quote:'Sensor CMOS de 1 polegada.',section:'Câmeras'},{id:'pro',quote:'Condição profissional.',section:'Segurança'}].map(r=>({...r,source_id:'s',location:'Página 1'}));
 const product={product_id:'p',product_specs_version:1,requirements:reqs.map(requirement=>({requirement,status:'ok'}))},result={items:[{number:'1',requirements:reqs,products:[product],recommended_product:product}]};const before=fingerprint(reqs[0],product),after=annotateRequirementOrder(result,[source]).items[0];
 assert.deepEqual(after.products[0].requirements.map(r=>r.requirement.id),['sensor','video','rth','pro']);assert.equal(after.requirement_references.sensor.number,'4.2, a)');assert.equal(after.requirement_references.rth.number,'4.3.1');assert.equal(after.requirement_references.pro.number,'04');assert.equal(after.requirement_references.pro.automatic,true);assert.equal(fingerprint(after.requirements.find(r=>r.id==='rth'),product),before);assert.equal(after.recommended_product.requirements[0].document_reference.number,'4.2, a)');assert.equal(result.items[0].requirements[0].id,'rth');
});
test('decimal specifications are not clause numbers; repeated quotes use the cited page and automatic references remain stable',()=>{
 assert.equal(clauseAt('5.1 K câmera',0),null);assert.equal(clauseAt('1.300 g de peso',0),null);
 const req={id:'r',source_id:'s',location:'Página 2',quote:'Autonomia mínima.'},result={items:[{requirements:[req],products:[{requirements:[{requirement:req,status:'verificar'}]}]}]},sources=[{id:'s',pages:[{text:'2.1 Autonomia mínima.'},{text:'8.3.2 Autonomia mínima.'}]}];assert.equal(annotateRequirementOrder(result,sources).items[0].requirement_references.r.number,'8.3.2');
});
test('Aerion new aircraft policy approves only the condition of a new/unused drone, with supplier evidence, never another tenant or unrelated specification',()=>{
 const r={id:'r',source_id:'tr',location:'Página 1',key:'equipment_condition',kind:'categorical',value:'novos, de primeiro uso',quote:'novos, de primeiro uso'},product={id:'p',account_id:2,category:'Drones',specs:[],specs_complete:true},sources=[{id:'tr',text:r.quote}];
 const row=assessProduct(product,[r],sources).requirements[0];assert.equal(row.status,'ok');assert.equal(row.evidence[0].supplier_declaration,true);assert.match(row.evidence[0].quote,/Aerion/);
 for(const p of [{...product,account_id:3},{...product,category:'Softwares'},{...product,product_type:'accessory'}])assert.notEqual(assessProduct(p,[r],sources).requirements[0].status,'ok');
 for(const req of [{...r,value:'novo e fabricado em 2026'},{...r,key:'waterproof'},{...r,conditions:'garantia de 24 meses'}])assert.notEqual(assessProduct(product,[req],sources).requirements[0].status,'ok');
 assert.notEqual(assessProduct(product,[r],[]).requirements[0].status,'ok');
});
