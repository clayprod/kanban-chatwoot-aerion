// Run only against the isolated shop. All tracking hits are intercepted locally.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{createRequire}=require('node:module');const req=createRequire(path.join(process.argv[2]||'C:/tenryu_content_hub','package.json'));const puppeteer=req('puppeteer');
const base='http://127.0.0.1:18084',delay=ms=>new Promise(r=>setTimeout(r,ms));
const output=path.resolve(__dirname,'../.tmp/checkout-validation');fs.mkdirSync(output,{recursive:true});
(async()=>{const browser=await puppeteer.launch({headless:true,channel:'chrome'});const reports=[];try{
for(const [result,accept,width] of [['paid',true,1440],['pending',true,390],['declined',true,1440],['paid',false,390]]){
 const context=await browser.createBrowserContext(),page=await context.newPage(),hits=[];await page.setViewport({width,height:1000});await page.setRequestInterception(true);
 page.on('request',request=>{const u=new URL(request.url());if(u.origin===base||u.protocol==='data:')return request.continue();
  const params=new URLSearchParams(u.search);for(const[k,v]of new URLSearchParams(request.postData()||''))params.set(k,v);
  if(params.has('en')||params.has('ev'))hits.push({host:u.hostname,event:params.get('en')||params.get('ev'),value:params.get('epn.value')||params.get('cd[value]'),transaction:params.get('ep.transaction_id')||null,destination:params.get('tid')||params.get('id'),consent:params.get('gcs')});
  const script=request.resourceType()==='script'&&((u.hostname==='www.googletagmanager.com'&&['/gtm.js','/gtag/js'].includes(u.pathname))||(u.hostname==='connect.facebook.net'&&(/fbevents\.js$/.test(u.pathname)||u.pathname.startsWith('/signals/config/'))));
  if(script)return request.continue();return request.respond({status:200,contentType:'text/plain',body:''});
 });
 const response=await page.goto(base+'/product/produto-sintetico-para-validacao/',{waitUntil:'networkidle2',timeout:60000});assert.equal(response.headers()['x-aerion-test-environment'],'isolated');
 await page.mouse.move(200,200);await page.keyboard.press('Tab');await delay(2000);
 if(accept){const button=await page.$('.moove-gdpr-infobar-allow-all');if(button&&await button.isVisible())await button.click();else await page.evaluate(()=>{if(typeof wp_set_consent==='function'){wp_set_consent('statistics','allow');wp_set_consent('marketing','allow');}});await delay(2500);await page.setCookie({name:'_ga',value:'GA1.1.1234567890.1770000000',url:base});}
 await page.goto(base+'/?add-to-cart=275',{waitUntil:'networkidle2',timeout:60000});await page.goto(base+'/checkout/',{waitUntil:'networkidle2',timeout:60000});
 assert(await page.$('form.checkout'),'Checkout form missing');
 await page.evaluate(()=>{const values={billing_first_name:'Teste',billing_last_name:'Isolado',billing_person_type:'pf',billing_document:'52998224725',billing_country:'BR',billing_postcode:'01001000',billing_address_1:'Praça da Sé',billing_number:'1',billing_neighborhood:'Sé',billing_city:'São Paulo',billing_state:'SP',billing_phone:'11999999999',billing_email:'readiness@example.invalid'};for(const[name,value]of Object.entries(values)){const el=document.querySelector('[name="'+name+'"]');if(el){el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));}}const ship=document.querySelector('[name="ship_to_different_address"]');if(ship)ship.checked=false;const create=document.querySelector('[name="createaccount"]');if(create)create.checked=false;if(window.jQuery)jQuery(document.body).trigger('update_checkout');});
 await delay(2500);const advance=await page.$('[data-aerion-avancar]');if(advance&&await advance.isVisible())await advance.click();await delay(600);
 if(!await page.$('[name="aerion_readiness_result"]')){await page.screenshot({path:path.join(output,'checkout-blocked.png'),fullPage:true});throw Error(await page.evaluate(()=>document.querySelector('form.checkout')?.innerText.slice(-2400)||document.body.innerText.slice(-1000)));}
 await page.select('[name="aerion_readiness_result"]',result);
 const consent=await page.evaluate(()=>({statistics:window.wp_has_consent?.('statistics')===true,marketing:window.wp_has_consent?.('marketing')===true}));
 const responsePromise=page.waitForResponse(r=>new URL(r.url()).searchParams.get('wc-ajax')==='checkout'&&r.request().method()==='POST'&&r.status()===200,{timeout:45000});await page.$eval('#place_order',el=>el.click());const checkoutResponse=await responsePromise;let checkout;
 try{checkout=await checkoutResponse.json();}catch{await delay(1500);if(page.url().includes('order-received'))checkout={result:'success'};else throw Error('Checkout did not provide a result');}
 if(result==='declined')assert.equal(checkout.result,'failure');else {assert.equal(checkout.result,'success',String(checkout.messages||'Checkout failed'));await page.waitForFunction(()=>location.pathname.includes('order-received'),{timeout:30000});}
 await delay(2500);const events=await page.evaluate(()=>(window.dataLayer||[]).filter(x=>x?.event).map(x=>({event:x.event,value:x.ecommerce?.value,currency:x.ecommerce?.currency,transaction:x.ecommerce?.transaction_id,sku:x.ecommerce?.items?.[0]?.item_id,eventId:x.event_id})));
 fs.writeFileSync(path.join(output,'latest-debug.json'),JSON.stringify({events,consent,hits},null,2));
 const measuredPurchase=h=>(h.event==='purchase'&&['www.google-analytics.com','analytics.google.com'].includes(h.host))||(h.event==='Purchase'&&h.host.endsWith('facebook.com'));
 const purchases=events.filter(e=>e.event==='purchase');if(result==='paid') {assert.equal(new Set(purchases.map(e=>e.transaction)).size,1,JSON.stringify({events,consent,url:new URL(page.url()).pathname}));assert.equal(purchases[0].sku,'AERION-TEST-ONLY');assert.equal(purchases[0].currency,'BRL');assert.equal(purchases[0].value,100);for(const name of ['purchase','Purchase'])assert(hits.filter(h=>measuredPurchase(h)&&h.event===name).length<=1,'Duplicate '+name+' collection hit');}else assert.equal(purchases.length,0);
 const before=hits.filter(measuredPurchase).length;
 if(result==='paid'){await page.reload({waitUntil:'networkidle2'});await delay(1000);assert.equal(hits.filter(measuredPurchase).length,before,'Reload emitted another purchase');}
 if(!accept)assert(!hits.some(h=>['Purchase','ViewContent'].includes(h.event)),'Meta event without consent');
 const screenshot=path.join(output,`${result}-${accept?'consented':'denied'}-${width}.png`);await page.screenshot({path:screenshot,fullPage:true});
 const report={result,accepted:accept,width,consent,checkout:checkout.result,purchaseDataLayer:purchases,interceptedTracking:hits,productionConversionsSent:0};reports.push(report);console.log(JSON.stringify({result,accept,checkout:checkout.result,purchases:purchases.length,consent}));await context.close();
}
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({observedAt:new Date().toISOString(),isolated:true,scenarios:reports},null,2));
}finally{await browser.close();}})().catch(error=>{console.error(error.stack);process.exitCode=1});
