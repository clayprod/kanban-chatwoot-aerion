'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {Pool}=require('pg');const {importOpportunityItems}=require('../opportunityItemImport');
test('import saves model, item, all checklist verdicts/sections/evidence atomically; a failure rolls everything back',{skip:!process.env.QUALITY_TEST_DATABASE_URL},async()=>{
 const admin=new Pool({connectionString:process.env.QUALITY_TEST_DATABASE_URL}),schema=`item_import_test_${process.pid}`;let db;
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);db=new Pool({connectionString:process.env.QUALITY_TEST_DATABASE_URL,options:`-c search_path=${schema},public`});
  await db.query(`CREATE TABLE licitacao_items(id BIGSERIAL PRIMARY KEY,opportunity_id BIGINT,numero_item TEXT,descricao TEXT,modelo_produto TEXT,quantidade NUMERIC,unidade TEXT,custo_total_item NUMERIC,valor_referencia NUMERIC,valor_proposta NUMERIC,prazo_entrega_dias INTEGER,status_participacao TEXT);
   CREATE TABLE licitacao_item_requirements(item_id BIGINT REFERENCES licitacao_items(id),requisito TEXT CHECK(requisito<>'FAIL'),status TEXT,observacao TEXT,valor_referencia NUMERIC,valor_ofertado NUMERIC,ordem INTEGER,secao TEXT);`);
  const client=await db.connect();
  try{
   await client.query('BEGIN');await importOpportunityItems(client,1,[{numero_item:'17',descricao:'Equipamento',modelo_produto:'Modelo escolhido',quantidade:3,unidade:'un',requirements:['ok','nao_ok','verificar'].map((status,i)=>({requisito:`Exigência ${i}`,status,secao:'Segurança',observacao:'Produto oferece 40 min; mínimo 41. Fonte edital: pág. 2; ficha: pág. 4.',ordem:i}))}]);await client.query('COMMIT');
   assert.equal((await db.query('SELECT * FROM licitacao_items')).rows[0].modelo_produto,'Modelo escolhido');
   const rows=(await db.query('SELECT * FROM licitacao_item_requirements ORDER BY ordem')).rows;assert.deepEqual(rows.map(r=>r.status),['ok','nao_ok','verificar']);assert.ok(rows.every(r=>r.secao==='Segurança'&&r.observacao.includes('mínimo 41')));
   await client.query('BEGIN');await assert.rejects(importOpportunityItems(client,2,[{descricao:'Não pode ficar pela metade',requirements:[{requisito:'OK',status:'ok'},{requisito:'FAIL'}]}]));await client.query('ROLLBACK');assert.equal((await db.query('SELECT 1 FROM licitacao_items WHERE opportunity_id=2')).rowCount,0);
  }finally{client.release();}
 }finally{if(db)await db.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
