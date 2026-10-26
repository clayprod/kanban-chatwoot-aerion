'use strict';
function maximumCost({system,user,responseFormat,maxTokens},pricing){
 const input=Number(pricing.prompt),output=Number(pricing.completion),fixed=Number(pricing.request || 0);
 if(!Number.isFinite(input)||!Number.isFinite(output)||!Number.isFinite(fixed)||input<0||output<0||fixed<0)throw Error('Tarifa do modelo não confirmada.');
 // Byte count is a deliberately conservative token bound, including the schema.
 const tokens=Math.ceil(Buffer.byteLength(JSON.stringify({system,user,responseFormat}),'utf8')*1.2)+2000;
 return tokens*input+maxTokens*output+fixed;
}
function createCostGuard({limitUsd=1,state={calls:[]},persist=()=>{}}={}){
 if(!(limitUsd>0&&limitUsd<=1))throw Error('O piloto tem teto total de até US$ 1.');
 state.calls ||= [];
 const total=()=>state.calls.reduce((sum,c)=>sum+(c.actualUsd ?? c.reservedUsd),0);
 return {
  state,total,
  reserve(key,reservedUsd,metadata={}){
   if(!Number.isFinite(reservedUsd)||reservedUsd<0)throw Error('Reserva de custo inválida.');
   if(state.calls.some(c=>['pending','unreconciled'].includes(c.status)))throw Error('Chamada anterior sem custo reconciliado; piloto interrompido.');
   if(total()+reservedUsd>limitUsd)throw Object.assign(Error('Teto total do piloto atingido; nenhuma nova chamada foi enviada.'),{code:'TECHNICAL_COST_LIMIT'});
   const call={...metadata,key,reservedUsd,status:'pending',at:new Date().toISOString()};state.calls.push(call);persist(state);return call;
  },
  settle(call,{usage,http_status,request_id,ok}){
   const cost=usage?.cost;
   if(cost!=null&&Number.isFinite(Number(cost))&&Number(cost)>=0)call.actualUsd=Number(cost);
   else if(!ok&&[400,401,402,403,404,413,422,429].includes(http_status))call.actualUsd=0;
   call.request_id=request_id || null;call.usage=usage || null;call.status=call.actualUsd==null?'unreconciled':'settled';persist(state);
   if(call.actualUsd==null)throw Error('Provedor não confirmou o custo; piloto interrompido para reconciliação.');
   if(call.actualUsd>call.reservedUsd || total()>limitUsd)throw Error('Custo superior à reserva; piloto interrompido.');
  },
 };
}
module.exports={maximumCost,createCostGuard};
