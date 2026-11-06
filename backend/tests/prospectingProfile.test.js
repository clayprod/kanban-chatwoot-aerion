const test=require('node:test'),assert=require('node:assert/strict');
const {resolveProspectingProfile}=require('../prospectingProfile');
const text='Nossa empresa realiza instalações elétricas e inspeção de usinas solares para clientes industriais.';
const base={empresa:{razao_social:'Francis Soluções',_discovery_id:'fixture'},contexto:{icp:'desconhecido'},achadoWeb:{titularidadeComprovada:true,fontesPerfil:[{url:'https://example.com/empresa',text}]}};
test('perfil pode ser confirmado pela operação publicada, com citação verificável',async()=>{
 const r=await resolveProspectingProfile({...base,chatCompletionJson:async()=>({ok:true,data:{icp:'energia',confianca:.95,fonte_url:'https://example.com/empresa',trecho:text,justificativa:'Serviços elétricos e solares.'}})});
 assert.equal(r.icp,'energia');assert.ok(r.profileEvidence);assert.equal(r.revendaConfirmada,false);
});
test('sem evidência de titularidade não atribui ao CNPJ a atividade de outra empresa',async()=>{
 const r=await resolveProspectingProfile({...base,empresa:{razao_social:'Empresa original'},chatCompletionJson:async()=>{throw Error('not expected');}});assert.equal(r.profilePending,true);
});
test('citação inventada ou confiança baixa mantém investigação pendente',async()=>{
 const r=await resolveProspectingProfile({...base,chatCompletionJson:async()=>({ok:true,data:{icp:'energia',confianca:.99,fonte_url:'https://example.com/empresa',trecho:'Texto que a fonte jamais publicou sobre a operação.'}})});
 assert.equal(r.profilePending,true);assert.equal(r.icp,'desconhecido');
});
