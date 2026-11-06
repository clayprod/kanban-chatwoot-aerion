'use strict';
const KEY='INSTAGRAM_BROWSER_STATE';
const ACCOUNT='aerion.technologies';
const instagramHost=host=>host==='instagram.com'||host.endsWith('.instagram.com');
function validateState(input){
  if(!input || input.username!==ACCOUNT || !input.storage || !Array.isArray(input.storage.cookies))throw Error('Sessão inválida');
  if(JSON.stringify(input).length>262144)throw Error('Sessão excessiva');
  const cookies=input.storage.cookies.filter(c=>typeof c.domain==='string'&&instagramHost(c.domain.replace(/^\./,'')));
  if(!cookies.length || cookies.some(c=>typeof c.name!=='string'||typeof c.value!=='string'||c.value.length>16384))throw Error('Cookies inválidos');
  const origins=(input.storage.origins||[]).filter(o=>{try{return instagramHost(new URL(o.origin).hostname);}catch{return false;}});
  return {username:ACCOUNT,node:input.node,status:input.status==='connected'?'connected':'verification_required',updated_at:new Date().toISOString(),storage:{cookies,origins}};
}
function sessionStatus(state){
  const cookie=state?.storage?.cookies?.find(c=>c.name==='sessionid'&&c.value);
  const valid=Boolean(cookie&&(cookie.expires<0||cookie.expires>Date.now()/1000));
  return {username:ACCOUNT,status:state?.status==='connected'&&valid?'connected':state?.status==='verification_required'?'verification_required':'reauthorization_required',updated_at:state?.updated_at||null};
}
async function handleSession(cofre,input={}){
  if(input.operation==='save'){
    const state=validateState(input.state);await cofre.gravar(KEY,JSON.stringify(state),'browser:instagram');return sessionStatus(state);
  }
  let state=null;try{state=JSON.parse(await cofre.ler(KEY)||'null');}catch{}
  if(input.operation==='read')return {state};
  return sessionStatus(state);
}
module.exports={KEY,ACCOUNT,instagramHost,validateState,sessionStatus,handleSession};
