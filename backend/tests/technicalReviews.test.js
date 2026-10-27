'use strict';const test=require('node:test'),assert=require('node:assert/strict');const {applyReviews,fingerprint}=require('../technicalReviews');
const reqs=[{id:'a',value:1,quote:'A',source_id:'s'},{id:'b',value:2,quote:'B',source_id:'s'}];
const product=(id,price)=>({product_id:id,product_specs_version:2,sale_price:price,price_rankable:true,specs_complete:true,status:'failed',counts:{ok:1,nao_ok:1,verificar:0,total:2},requirements:reqs.map((r,i)=>({requirement:r,status:i?'nao_ok':'ok',evidence:[]}))});
test('human corrections recalculate percentage, summary and ranking while retaining automatic verdict and source facts',()=>{
 const products=[product('cheap',10),product('corrected',20)],result={base_score:80,documents_complete:false,items:[{number:'1',in_scope:true,documents_complete:false,products}]},before=JSON.stringify(result);
 const review={item_number:'1',product_id:'corrected',requirement_id:'b',fingerprint:fingerprint(reqs[1],products[1]),status:'ok',reviewer_id:7,updated_at:'2026-10-27'};
 const revised=applyReviews(result,[review]);assert.equal(revised.items[0].products[0].product_id,'corrected');assert.equal(revised.items[0].technical_percent,100);assert.equal(revised.items[0].products[0].requirements[1].automatic_status,'nao_ok');assert.equal(revised.full_items,0);assert.equal(revised.items[0].products[0].requirements[1].manual_review.reviewer_id,7);assert.equal(JSON.stringify(result),before);
 const changed=structuredClone(result);changed.items[0].products[1].product_specs_version=3;assert.equal(applyReviews(changed,[review]).manual_reviewed,undefined);
});
