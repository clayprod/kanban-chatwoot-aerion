'use strict';
// Private control plane; token and proxy URLs never enter logs or public APIs.
async function call(action, body) {
  if (!process.env.EGRESS_CONTROL_URL || !process.env.EGRESS_CONTROL_TOKEN) return { available: false };
  const response = await fetch(`${process.env.EGRESS_CONTROL_URL.replace(/\/$/,'')}/${action}`, {
    method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.EGRESS_CONTROL_TOKEN}`},
    body:JSON.stringify(body), signal:AbortSignal.timeout(8000),
  });
  if(!response.ok)throw new Error('Controle de saída indisponível');
  return response.json();
}
async function acquire(url, kind='research') { try { return await call('acquire',{url,kind}); } catch { return {available:false}; } }
async function release(lease,outcome) { if(lease?.id)await call('release',{id:lease.id,outcome}).catch(()=>{}); }
function playwrightProxy(lease) {
  if(!lease?.available)return null;
  const p=new URL(lease.proxy);
  return {id:lease.node,server:`${p.protocol}//${p.host}`,username:decodeURIComponent(p.username),password:decodeURIComponent(p.password),personal:true};
}
module.exports={acquire,release,playwrightProxy,call};
