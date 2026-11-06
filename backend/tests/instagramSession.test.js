const test=require('node:test'),assert=require('node:assert/strict');
const {validateState,sessionStatus,handleSession}=require('../instagramSession');
const state={username:'aerion.technologies',node:'Jasque',status:'connected',storage:{cookies:[{name:'sessionid',value:'test-only',domain:'.instagram.com',expires:Date.now()/1000+3600}],origins:[]}};
test('sessão Instagram aceita somente a conta dedicada e filtra domínios estranhos',()=>{
 assert.throws(()=>validateState({...state,username:'other'}));
 const v=validateState({...state,storage:{cookies:[...state.storage.cookies,{name:'secret',value:'fixture',domain:'.example.com'}],origins:[{origin:'https://evil.test',localStorage:[]}]}});
 assert.equal(v.storage.cookies.length,1);assert.equal(v.storage.origins.length,0);assert.equal(sessionStatus(v).status,'connected');
});
test('cookie expirado exige reautorização e status nunca expõe cookies',()=>{
 const s=sessionStatus({...state,storage:{cookies:[{...state.storage.cookies[0],expires:1}]}});assert.equal(s.status,'reauthorization_required');assert.equal(JSON.stringify(s).includes('test-only'),false);
});
test('estado é persistido pelo cofre e reutilizado sem guardar a senha',async()=>{
 let saved;const cofre={gravar:async(_key,value)=>saved=value,ler:async()=>saved};
 await handleSession(cofre,{operation:'save',state});assert.equal((await handleSession(cofre,{operation:'status'})).status,'connected');
 assert.equal((await handleSession(cofre,{operation:'read'})).state.storage.cookies[0].name,'sessionid');
});
