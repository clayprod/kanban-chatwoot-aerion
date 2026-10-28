'use strict';const test=require('node:test'),assert=require('node:assert/strict'),{Pool}=require('pg');const {normalizeLead,enrichLeadFromRfb,resolveImportContact,repairMissingMetadata}=require('../rfbLead');
test('authoritative RFB enrichment repairs only missing business metadata and never phones or human names',{skip:!process.env.QUALITY_TEST_DATABASE_URL},async()=>{
 const admin=new Pool({connectionString:process.env.QUALITY_TEST_DATABASE_URL}),schema=`rfb_lead_${process.pid}`;let pool;
 try{await admin.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:process.env.QUALITY_TEST_DATABASE_URL,options:`-c search_path=${schema},public`});
 await pool.query(`CREATE TABLE contacts(id BIGSERIAL,account_id INTEGER,name TEXT,phone_number TEXT,custom_attributes JSONB,additional_attributes JSONB,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW());CREATE TABLE rfb_empresas(cnpj_basico TEXT,razao_social TEXT);CREATE TABLE rfb_estabelecimentos(cnpj_basico TEXT,cnpj_ordem TEXT,cnpj_dv TEXT,nome_fantasia TEXT);CREATE TABLE rfb_socios(cnpj_basico TEXT,nome_do_socio TEXT,qualificacao_do_socio TEXT)`);
 await pool.query("INSERT INTO rfb_empresas VALUES('12345678','EMPRESA REAL LTDA');INSERT INTO rfb_estabelecimentos VALUES('12345678','0001','90','Marca Real');INSERT INTO rfb_socios VALUES('12345678','MARIA SILVA','49')");
 await pool.query(`INSERT INTO contacts(account_id,name,phone_number,custom_attributes,additional_attributes)VALUES(2,'Nome mantido pelo vendedor','+5511999998888','{"CNPJ_CPF":"12345678000190"}','{}'),(3,'Outra conta','+5511999998888','{"CNPJ_CPF":"12345678000190"}','{}')`);
 const lead=await enrichLeadFromRfb(pool,normalizeLead({cnpj:'12345678000190'}),'12345678000190');assert.equal(lead.razao_social,'EMPRESA REAL LTDA');assert.equal(lead.qsa[0].nome,'MARIA SILVA');
 const preview=await repairMissingMetadata(pool,2);assert.equal(preview.changed,1);assert.equal((await pool.query('SELECT additional_attributes FROM contacts WHERE account_id=2')).rows[0].additional_attributes.company_name,undefined);
 await repairMissingMetadata(pool,2,{apply:true});const contact=(await pool.query('SELECT * FROM contacts WHERE account_id=2')).rows[0];assert.equal(contact.name,'Nome mantido pelo vendedor');assert.equal(contact.phone_number,'+5511999998888');assert.equal(contact.additional_attributes.company_name,'Marca Real');assert.equal(contact.custom_attributes.Socios,'MARIA SILVA');
 assert.equal((await pool.query('SELECT additional_attributes FROM contacts WHERE account_id=3')).rows[0].additional_attributes.company_name,undefined);
 const found=await resolveImportContact(pool,{accountId:2,cnpj:'12345678000190',phone:'+5511999998888'});assert.equal(found.id,contact.id);
 await assert.rejects(resolveImportContact(pool,{accountId:2,cnpj:'99887766000190',phone:'+5511999998888'}),e=>e.code==='PHONE_CONTACT_CONFLICT');
 assert.equal((await repairMissingMetadata(pool,2,{apply:true})).changed,0);
 }finally{if(pool)await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
