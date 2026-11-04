const {test}=require('node:test'),assert=require('node:assert/strict');
const {campaignContext}=require('../ecommerce/campaignContext');
test('campaign evidence uses source-specific aggregated history without exposing customer identities or treating unavailable platforms as zero',async()=>{
  const db={query:async sql=>{
    if(sql.includes('FROM ecommerce_connections'))return {rows:[{provider:'woocommerce',last_success_at:new Date().toISOString(),config:{},info:{},status:'connected'}]};
    if(sql.includes('FROM ecommerce_marketing_state'))return {rows:[]};
    return {rows:[{provider:'woocommerce',kind:'order',data:{paid:false,currency:'BRL',email:'private@example.com',billing:{phone:'123'},items:[]}}]};
  }};
  const context=await campaignContext(db);assert.equal(context.containsPersonalIdentifiers,false);assert(!JSON.stringify(context).includes('private@example.com'));
  assert.equal(context.paidMedia.find(p=>p.provider==='google_ads').spend,null);assert.equal(context.sources[0].provider,'woocommerce');
  assert.equal(context.period.completedCalendarDays,28);assert.equal(context.sales.source,'WooCommerce');
});
