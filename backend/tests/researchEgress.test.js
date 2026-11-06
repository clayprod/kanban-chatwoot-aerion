const test=require('node:test'),assert=require('node:assert/strict');
const {parseNodes,createBroker}=require('../researchEgress');
test('configuração aceita apenas proxies autenticados dos dispositivos autorizados',()=>{
 const nodes=parseNodes(JSON.stringify([
  {id:'Jasque',proxy:'http://user:secret@100.117.55.18:3128'},
  {id:'public',proxy:'http://user:secret@8.8.8.8:3128'},
  {id:'unauthenticated',proxy:'http://100.80.200.77:3128'},
 ]));assert.equal(nodes.length,1);assert.equal(nodes[0].id,'Jasque');
 assert.deepEqual(parseNodes('not json'),[]);
});
test('sem configuração retorna fallback sem consultar banco nem expor credenciais',async()=>{
 const broker=createBroker({pool:{query:async()=>{throw Error('not expected');}},readSecret:async()=>null});
 const r=await broker.acquire({url:'https://example.com'});assert.equal(r.available,false);assert.equal(r.proxy,undefined);
});
test('bloqueia tipos e destinos fora das portas públicas',async()=>{
 const broker=createBroker({pool:{},readSecret:async()=>null});
 for(const url of ['file:///etc/passwd','http://example.com:22/','https://u:p@example.com'])await assert.rejects(()=>broker.acquire({url}),/Destino inválido/);
 await assert.rejects(()=>broker.acquire({url:'https://example.com',kind:'anything'}),/Tipo inválido/);
});
