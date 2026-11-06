const test = require('node:test'), assert = require('node:assert/strict');
const { investigate, channelId, contactLink } = require('../contactInvestigation');
const { termosSignificativos, ehAgregador, buscarContatoWeb } = require('../contatoWeb');
const profile='https://www.instagram.com/kruger.construtora/', bio='https://linkme.bio/kruger.construtora', linkedin='https://www.linkedin.com/company/kruger-construtora/';
const empresa={cnpj:'11222333000181',razao_social:'INCORPORADORA KRUEGER LTDA',municipio_nome:'Mafra',uf:'SC',cnae_descricao:'Construção de edifícios'};
const pages={
 [profile]:{url:profile,title:'KRÜGER Construtora, Incorporadora e Engenharia',content:'Sistema construtivo. Projetos BIM.',links:[{href:bio,label:'Link da bio'}]},
 [bio]:{url:bio,title:'kruger.construtora',content:'Contatos da construtora',links:[{href:'https://wa.me/5547998765432',label:'WhatsApp - Edson'},{href:linkedin,label:'LinkedIn'}]},
 [linkedin]:{url:linkedin,title:'Krüger Construtora',content:'Construção e incorporação. Mafra, SC.',links:[]},
};
const run=(over={})=>investigate({empresa,seeds:[{url:profile},{url:linkedin}],inspect:async u=>pages[u],tokens:termosSignificativos,isAggregator:ehAgregador,...over});
test('segue perfil → bio → WhatsApp e cruza LinkedIn mesmo visitado antes',async()=>{
 const r=await run();assert.equal(r.contacts[0].numero,'5547998765432');assert.equal(r.contacts[0].identidadeComprovada,true);
 assert.ok(r.contacts[0].chain.some(p=>p.url===linkedin));assert.equal(r.contacts[0].contato,'WhatsApp - Edson');
});
test('empresa compatível de outra cidade fica separada, sem herdar CNPJ original',async()=>{
 const r=await run({empresa:{...empresa,municipio_nome:'Florianópolis'}});assert.equal(r.contacts[0].identidadeComprovada,false);
 assert.equal(r.contacts[0].titularidadeComprovada,true);assert.equal(r.contacts[0].empresaEncontrada.cnpj,null);
});
test('CNPJ conflitante não pode ser sobrescrito por nome e cidade iguais',async()=>{
 const r=await run({inspect:async u=>u===linkedin?{...pages[u],content:pages[u].content+' CNPJ 22.333.444/0001-81'}:pages[u]});
 assert.equal(r.contacts[0].identidadeComprovada,false);
});
test('login necessário vira limitação e não rejeição definitiva',async()=>{
 const r=await run({inspect:async()=>({access:'login_required'})});assert.equal(r.contacts.length,0);assert.equal(r.incomplete,true);assert.equal(r.failures[0].reason,'fonte exige login');
});
test('não coleta telefone de homônima sem atividade compatível',async()=>{
 const r=await run({seeds:[{url:profile}],inspect:async()=>({url:profile,title:'Kruger Advocacia',content:'Advogado em Mafra',links:[{href:'https://wa.me/5547998765432'}]})});assert.equal(r.contacts.length,0);
});
test('identifica slug LinkedIn e destinos reais de WhatsApp',()=>{
 assert.equal(channelId(linkedin),'kruger-construtora');assert.equal(contactLink('https://api.whatsapp.com/send?phone=%2B5547998765432'),'5547998765432');
 assert.equal(contactLink('https://wa.me.evil.test/5547998765432'),null);assert.equal(contactLink('https://example.com/?phone=5547998765432'),null);
});
test('integra cadeia de evidências à busca existente sem depender da IA para inventar identidade',async()=>{
 const r=await buscarContatoWeb(empresa,{buscarPaginas:async()=>({paginas:[{url:profile}]}),inspecionarPagina:async u=>pages[u]});
 assert.equal(r.numero,'5547998765432');assert.equal(r.decidido,'cadeia de evidências');
});
