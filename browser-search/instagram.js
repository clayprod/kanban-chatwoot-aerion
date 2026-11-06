'use strict';
const egress=require('./egressClient');
const ACCOUNT='aerion.technologies';
const ownHost=h=>h==='instagram.com'||h.endsWith('.instagram.com');
let pending=null;
async function session(operation,state){return egress.call('instagram-session',{operation,state});}
function usable(state){const c=state?.storage?.cookies?.find(c=>c.name==='sessionid'&&c.value);return state?.username===ACCOUNT&&state.status==='connected'&&c&&(c.expires<0||c.expires>Date.now()/1000);}
async function createContext(browser,lease,state){
  const proxy=egress.playwrightProxy(lease);
  const context=await browser.newContext({locale:'pt-BR',timezoneId:'America/Sao_Paulo',serviceWorkers:'block',...(state?{storageState:state.storage}:{}),proxy:{server:proxy.server,username:proxy.username,password:proxy.password}});
  context._aerionNetworkingActive=true;
  await context.route('**/*',async route=>{
    if(!context._aerionNetworkingActive)return route.abort();
    let u;try{u=new URL(route.request().url());}catch{return route.abort();}
    const allowed=ownHost(u.hostname)||u.hostname.endsWith('.cdninstagram.com')||u.hostname.endsWith('.fbcdn.net')||u.hostname==='static.xx.fbcdn.net';
    if(!allowed || ['image','media','font'].includes(route.request().resourceType()))return route.abort();
    return route.continue();
  });
  return context;
}
async function persist(context,lease,status){
  return session('save',{username:ACCOUNT,node:lease.node,status,storage:await context.storageState()});
}
async function cookiesAuthenticated(context){return (await context.cookies('https://www.instagram.com')).some(c=>c.name==='sessionid'&&c.value);}
async function inspect(address,getBrowser){
  const target=new URL(address);
  if(target.protocol!=='https:'||/^\/(accounts|direct|api|challenge|settings|emails|your_activity)(\/|$)/.test(target.pathname))return{url:address,access:'blocked',title:'',content:'',links:[]};
  const {state}=await session('read');
  if(!usable(state))return null;
  const lease=await egress.acquire(address);
  if(!lease.available)return {url:address,access:'unavailable',title:'',content:'',links:[]};
  let context,outcome='transport';
  try{
    if(state.node&&state.node!==lease.node)return {url:address,access:'unavailable',title:'',content:'',links:[]};
    context=await createContext(await getBrowser(true),lease,state);
    const page=await context.newPage();
    const response=await page.goto(address,{waitUntil:'domcontentloaded',timeout:20000});
    if([403,429].includes(response?.status())){outcome='blocked';return{url:address,access:'blocked',title:'',content:'',links:[]};}
    if(/accounts\/login|challenge|two_factor/.test(page.url())||!await cookiesAuthenticated(context)){
      await persist(context,lease,'verification_required');outcome='ok';return{url:address,access:'login_required',title:'',content:'',links:[]};
    }
    const result=await page.evaluate(()=>({title:document.title.slice(0,200),content:(document.body?.innerText||'').slice(0,30000),links:[...document.querySelectorAll('a[href]')].slice(0,150).map(a=>({href:a.href,label:(a.textContent||'').slice(0,120)}))}));
    await persist(context,lease,'connected');outcome='ok';return{...result,url:page.url(),access:'authenticated'};
  }finally{await context?.close().catch(()=>{});await egress.release(lease,outcome);}
}
async function authenticate(input,getBrowser){
  if(input.operation==='status')return session('status');
  if(!['login','code','resume'].includes(input.operation))throw Error('Operação inválida');
  if(input.operation==='login'&&(input.username!==ACCOUNT||typeof input.password!=='string'))throw Error('Conta inválida');
  const lease=await egress.acquire('https://www.instagram.com');
  if(!lease.available)return{status:'egress_unavailable',reason:lease.reason||'Saída pessoal indisponível'};
  let context,page,keep=false,outcome='transport';
  try{
    if(input.operation==='login'){
      if(pending){await pending.context.close().catch(()=>{});clearTimeout(pending.timer);pending=null;}
      context=await createContext(await getBrowser(true),lease,null);page=await context.newPage();
      const response=await page.goto('https://www.instagram.com/accounts/login/',{waitUntil:'domcontentloaded',timeout:25000});
      if([403,429].includes(response?.status())){outcome='blocked';return{status:'platform_blocked'};}
      const consent=page.getByRole('button',{name:/Decline optional cookies|Recusar cookies opcionais|Allow all cookies|Permitir todos os cookies/i}).first();
      if(await consent.isVisible().catch(()=>false))await consent.click();
      const username=page.locator('input[name="username"]');
      const formReady=await username.waitFor({state:'visible',timeout:15000}).then(()=>true).catch(()=>false);
      if(formReady){
        await username.fill(input.username);
        await page.locator('input[name="password"]').fill(input.password);
        await page.locator('button[type="submit"]').click();
      }else if(!/challenge|two_factor/.test(page.url())){outcome='ok';return{status:'login_page_unavailable'};}
    }else{
      if(!pending)return{status:'login_required'};
      if(pending.node!==lease.node){outcome='ok';return{status:'egress_unavailable'};}
      context=pending.context;page=pending.page;clearTimeout(pending.timer);pending=null;
      context._aerionNetworkingActive=true;
      if(input.operation==='code'){
        if(!/^\d{4,8}$/.test(String(input.code||'')))throw Error('Código inválido');
        const field=page.locator('input[name="verificationCode"],input[name="security_code"],input[autocomplete="one-time-code"]');
        await field.first().fill(String(input.code),{timeout:10000});
        await page.getByRole('button',{name:/Confirmar|Confirm|Continuar|Continue|Verificar|Verify/i}).first().click();
      }
    }
    await page.waitForFunction(()=>!document.querySelector('input[name="password"]')||/two_factor|challenge/.test(location.href),null,{timeout:20000}).catch(()=>{});
    await page.waitForTimeout(1500);
    if(await cookiesAuthenticated(context)){
      // Confirm the dedicated account using its own profile navigation.
      await page.goto(`https://www.instagram.com/${ACCOUNT}/`,{waitUntil:'domcontentloaded',timeout:20000});
      if(!/accounts\/login|challenge/.test(page.url())){const status=await persist(context,lease,'connected');outcome='ok';return status;}
    }
    const body=(await page.locator('body').innerText()).toLowerCase();
    if(/incorrect|incorreta|incorrecta|senha.*errad/.test(body)){outcome='ok';return{status:'credentials_rejected'};}
    const codeNeeded=await page.locator('input[name="verificationCode"],input[name="security_code"],input[autocomplete="one-time-code"]').count();
    const verification=codeNeeded||/two_factor|challenge/.test(page.url())||/confirme.*identidade|check your|verifique.*aplicativo|aprovar.*login/.test(body);
    if(verification){
      keep=true;pending={context,page,node:lease.node,timer:setTimeout(()=>{context.close().catch(()=>{});pending=null;},10*60*1000)};
      await persist(context,lease,'verification_required');context._aerionNetworkingActive=false;outcome='ok';return{status:'verification_required',method:codeNeeded?'code':'device_confirmation'};
    }
    outcome='ok';return{status:'login_incomplete'};
  }finally{if(!keep)await context?.close().catch(()=>{});await egress.release(lease,outcome);}
}
module.exports={ACCOUNT,ownHost,usable,inspect,authenticate};
