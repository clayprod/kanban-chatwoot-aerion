const test=require('node:test'),assert=require('node:assert/strict');
const {publicIp,validatePublicUrl,readPublicDocument}=require('../../browser-search/publicDocument');
test('recusa loopback, rede privada, tailnet e IPv4 encapsulado',async()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','100.97.22.81','192.168.1.1','::1','::ffff:127.0.0.1','fd7a:115c:a1e0::1'])assert.equal(publicIp(ip),false,ip);
 assert.equal(publicIp('93.184.216.34'),true);
 await assert.rejects(()=>validatePublicUrl('https://example.com',async()=>[{address:'127.0.0.1',family:4}]),/não público/);
});
test('revalida redirecionamento antes de enviar ao destino seguinte',async()=>{
 let calls=0;
 await assert.rejects(()=>readPublicDocument('https://example.com',{lookup:async host=>[{address:host==='example.com'?'93.184.216.34':'127.0.0.1',family:4}],read:async()=>{calls++;return{status:302,location:'http://internal.test'};}}),/não público/);
 assert.equal(calls,1);
});
