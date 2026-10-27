'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Pool}=require('pg');
const {createProspeccaoTable}=require('../prospeccao'),{createOutboundQueueTable}=require('../outboundQueue');
const {createProspectingRuntime,startProspectingRun,finishProspectingRun,prospectingDecisionSql}=require('../prospectingRuntime');
test('prospecção exibe recibos reais, isola contas e preserva falhas de ciclos sem candidatos',{skip:!process.env.QUALITY_TEST_DATABASE_URL},async()=>{
 const admin=new Pool({connectionString:process.env.QUALITY_TEST_DATABASE_URL}),schema=`prospect_runtime_${process.pid}`;let pool;
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:process.env.QUALITY_TEST_DATABASE_URL,options:`-c search_path=${schema},public`});
  await createProspeccaoTable(pool);await createOutboundQueueTable(pool);await createProspectingRuntime(pool);
  for(const [cnpj,status,error] of [['111','sent',null],['222','failed','WhatsApp não verificado'],['333','pending',null]]){
   await pool.query("INSERT INTO prospeccao_log(account_id,cnpj,status,mensagem)VALUES(2,$1,'enfileirado','synthetic only')",[cnpj]);
   await pool.query("INSERT INTO outbound_queue(account_id,origem,texto,dedupe_key,status,last_error)VALUES(2,'prospeccao','synthetic only',$1,$2,$3)",['prospeccao:'+cnpj,status,error]);
  }
  await pool.query("INSERT INTO outbound_queue(account_id,origem,texto,dedupe_key,status)VALUES(3,'prospeccao','synthetic only','prospeccao:333','sent')");
  const rows=(await pool.query(prospectingDecisionSql+' ORDER BY p.cnpj',[2])).rows;
  assert.deepEqual(rows.map(r=>r.status),['abordado','falhou','enfileirado']);assert.equal(rows[1].error,'WhatsApp não verificado');
  // A different, later intent must not turn an old delivery into a failure.
  await pool.query("INSERT INTO outbound_queue(account_id,origem,texto,dedupe_key,status,last_error)VALUES(2,'prospeccao','another message','prospeccao:111','failed','unrelated')");
  assert.equal((await pool.query(prospectingDecisionSql+' AND p.cnpj=\'111\'',[2])).rows[0].status,'abordado');
  await startProspectingRun(pool,2);let run=(await pool.query('SELECT * FROM prospecting_runtime WHERE account_id=2')).rows[0];assert.equal(run.finished_at,null);
  const summary={avaliados:0,falhas:3,errosBusca:['verificação de WhatsApp indisponível']};
  await finishProspectingRun(pool,2,summary);run=(await pool.query('SELECT * FROM prospecting_runtime WHERE account_id=2')).rows[0];assert.deepEqual(run.summary,summary);assert.ok(run.finished_at);
  await startProspectingRun(pool,2);await finishProspectingRun(pool,2,null,'Busca indisponível');assert.equal((await pool.query('SELECT error FROM prospecting_runtime WHERE account_id=2')).rows[0].error,'Busca indisponível');
 }finally{if(pool)await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
