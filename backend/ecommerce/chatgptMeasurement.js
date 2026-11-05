const { paidGa4Payload }=require('./serverMeasurement');
const crypto=require('node:crypto');
function paidChatgptPayload(order,context,storeUrl,now=Date.now()){
  if(context?.marketing!==true)return {eligible:false,reason:'marketing_consent_required'};
  const paid=paidGa4Payload(order,context,now);if(!paid.eligible)return paid;
  const purchase=paid.body.events[0].params;
  if(purchase.currency!=='BRL')return {eligible:false,reason:'unsupported_account_currency'};
  const event={id:paid.eventId,type:'order_created',timestamp_ms:Math.round(paid.body.timestamp_micros/1000),action_source:'web',source_url:new URL('/checkout/',storeUrl).href,
    data:{type:'contents',amount:Math.round(purchase.value*100),currency:purchase.currency,contents:purchase.items.map(i=>({id:i.item_id,name:i.item_name,quantity:i.quantity,amount:Math.round(i.price*100),currency:purchase.currency,content_type:'product'}))}};
  const email=String(order.billing?.email||'').trim().toLowerCase();
  if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))event.user={emails_sha256:[crypto.createHash('sha256').update(email).digest('hex')]};
  if(typeof context.obref==='string'&&context.obref.trim()&&context.obref.length<=512)event.user={...event.user,obref:context.obref};
  if(typeof context.oppref==='string'&&context.oppref.length<=512)event.oppref=context.oppref;
  return {eligible:true,eventId:paid.eventId,body:{integration_source:'aerion_woocommerce',events:[event]}};
}
async function sendChatgptConversion({pixelId,apiKey,body,validateOnly=false,transport=global.fetch}){
  if(!/^[a-zA-Z0-9_-]{5,100}$/.test(pixelId)||!apiKey)throw Error('chatgpt_conversion_setup_required');
  let r;try{r=await transport('https://bzr.openai.com/v1/events?pid='+encodeURIComponent(pixelId),{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify({...body,validate_only:validateOnly}),signal:AbortSignal.timeout(45000)});}catch{throw Error('chatgpt_conversion_unavailable');}
  if(!r.ok)throw Object.assign(Error('chatgpt_conversion_rejected'),{httpStatus:r.status});
  let result;try{result=await r.json();}catch{throw Error('chatgpt_conversion_invalid_response');}
  if(result.accepted_events!==body.events.length)throw Error('chatgpt_conversion_incomplete');
  return {accepted:true,validateOnly};
}
module.exports={paidChatgptPayload,sendChatgptConversion};
