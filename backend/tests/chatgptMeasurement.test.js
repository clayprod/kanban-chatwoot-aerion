const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {chatgptBootstrap}=require('../../integrations/gtm/chatgpt.cjs');
const {paidChatgptPayload,sendChatgptConversion}=require('../ecommerce/chatgptMeasurement');
test('ChatGPT browser measurement waits for marketing consent, respects revocation and uses stable paid IDs and minor units',()=>{
  let allowed=false;const scripts=[],listeners={},w={wp_has_consent:()=>allowed,dataLayer:[]},doc={head:{appendChild:s=>scripts.push(s)},createElement:()=>({}),addEventListener:(n,f)=>{listeners[n]=f;}};
  vm.runInNewContext('('+chatgptBootstrap.toString()+')("verifiedPixel");',{window:w,document:doc,Date});
  const ecommerce={transaction_id:'paid123',currency:'BRL',value:125.50,items:[{item_id:'REAL-SKU',price:125.50,quantity:1}]};
  w.aerionChatgptSend('purchase',ecommerce);assert.equal(scripts.length,0);
  allowed=true;listeners.wp_listen_for_consent_change();w.aerionChatgptSend('purchase',ecommerce);w.aerionChatgptSend('purchase',ecommerce);
  w.aerionChatgptSend('view_item',{currency:'BRL',value:125.50,items:[{item_id:'REAL-SKU',price:125.50}]},'view_without_quantity');
  assert.equal(w.oaiq.q.find(a=>a[0]==='measure'&&a[1]==='contents_viewed')[2].contents[0].quantity,1);
  const measured=w.oaiq.q.filter(a=>a[0]==='measure'&&a[1]==='order_created');assert.equal(measured.length,1);assert.equal(measured[0][2].amount,12550);assert.equal(measured[0][3].event_id,'aerion_purchase_paid123');
  assert.equal(w.oaiq.q[0][0],'consent');assert.equal(w.oaiq.q[0][1],false);assert.equal(scripts.length,1);
  allowed=false;listeners.wp_listen_for_consent_change();w.aerionChatgptSend('add_to_cart',ecommerce);assert.equal(w.oaiq.q.filter(a=>a[0]==='measure').length,3);assert.equal(w.oaiq.q.at(-1)[1],false);
});
test('server purchase rejects pending or revoked consent and matches the browser transaction ID',async()=>{
  const now=Date.now(),order={id:123,status:'processing',currency:'BRL',date_paid_gmt:new Date(now-1000).toISOString().replace('Z',''),date_created_gmt:new Date(now-2000).toISOString().replace('Z',''),total:'125.50',line_items:[{id:1,product_id:1,sku:'REAL-SKU',name:'Product',quantity:1,total:'125.50',subtotal:'125.50'}],billing:{email:'Buyer@Example.com'}},context={marketing:true,statistics:true,clientId:'123.456',source:'wp_consent_api_classic_checkout',recordedAt:new Date(now-2000).toISOString()};
  assert.equal(paidChatgptPayload({...order,status:'pending'},context,'https://shop.test',now).eligible,false);
  assert.equal(paidChatgptPayload(order,{...context,revoked:true},'https://shop.test',now).eligible,false);
  const event=paidChatgptPayload(order,context,'https://shop.test',now);assert.equal(event.eligible,true);assert.equal(event.body.events[0].id,'aerion_purchase_123');assert.equal(event.body.events[0].data.amount,12550);assert(!JSON.stringify(event).includes('Buyer@'));
  await sendChatgptConversion({pixelId:'verifiedPixel',apiKey:'secret',body:event.body,validateOnly:true,transport:async(url,opts)=>{assert.equal(new URL(url).hostname,'bzr.openai.com');assert.equal(JSON.parse(opts.body).validate_only,true);return Response.json({accepted_events:1});}});
});
