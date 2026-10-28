'use strict';const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeLead,attributesFor,resolveImportContact,enrichLeadFromRfb}=require('../rfbLead');
test('import preserves verified phone, company identity and all available partners',()=>{
 const lead=normalizeLead({cnpj:'12345678000190',razao_social:'EMPRESA REAL LTDA',nome_fantasia:'Marca Real',ddd1:'11',telefone1:'33334444',telefone_verificado:'5511999998888',socios_nomes:'MARIA SILVA (Administrador) · JOAO SOUZA (Sócio)',municipio_nome:'São Paulo',cnae_descricao:'Engenharia'});
 assert.equal(lead.ddd_telefone_1,'5511999998888');assert.equal(lead.municipio,'São Paulo');assert.equal(lead.qsa.length,2);assert.equal(lead.qsa[0].nome,'MARIA SILVA');
 const attrs=attributesFor(lead);assert.equal(attrs.company_name,'Marca Real');assert.equal(attrs.rfb_company.razao_social,'EMPRESA REAL LTDA');assert.equal(attrs.rfb_company.qsa.length,2);
});
test('RFB QSA enrichment merges partners without impersonating a partner as the phone owner',async()=>{
 const lead=normalizeLead({cnpj:'12345678000190',razao_social:'EMPRESA REAL',nome_fantasia:'Marca Real',qsa:[{nome:'MARIA SILVA'}]});
 await enrichLeadFromRfb({query:async()=>({rows:[{nome_do_socio:'MARIA SILVA',qualificacao_do_socio:'49'},{nome_do_socio:'JOAO SOUZA',qualificacao_do_socio:'22'}]})},lead,lead.cnpj);
 assert.equal(lead.qsa.length,2);assert.equal(lead.primeiro_nome,undefined);
});
test('a phone already owned by another CRM contact is never reassigned based on name similarity',async()=>{
 const pool={query:async sql=>({rows:sql.includes('phone_number')?[{id:2}]:[{id:1}]})};
 await assert.rejects(resolveImportContact(pool,{accountId:2,cnpj:'12345678000190',phone:'+5511999998888'}),e=>e.code==='PHONE_CONTACT_CONFLICT');
});
