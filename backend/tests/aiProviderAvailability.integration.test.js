'use strict';const test=require('node:test'),assert=require('node:assert/strict'),{Pool}=require('pg');
const {createAiFollowupTable}=require('../aiFollowups'),{createResponderTable,registrarDecisao}=require('../aiResponder');
const {createOutboundQueueTable}=require('../outboundQueue'),{syncFollowupQueue}=require('../aiQueueReceipts');
test('existing database constraints migrate, provider-only failures remain auditable and successful decisions cannot be overwritten',{skip:!process.env.QUALITY_TEST_DATABASE_URL,timeout:30000},async()=>{
 const admin=new Pool({connectionString:process.env.QUALITY_TEST_DATABASE_URL}),schema=`ai_recovery_${process.pid}`;let pool;
 try{await admin.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:process.env.QUALITY_TEST_DATABASE_URL,options:`-c search_path=${schema},public`});
  await createAiFollowupTable(pool);await createResponderTable(pool);
  await pool.query("ALTER TABLE ai_followup_log DROP CONSTRAINT ai_followup_log_status_check;ALTER TABLE ai_followup_log ADD CONSTRAINT ai_followup_log_status_check CHECK(status IN('pending','sent','skipped','failed','dry_run'))");
  const error='openai:429 no credits | groq:404 model unavailable | openrouter:402 no credits';
  await pool.query("INSERT INTO ai_followup_log(account_id,contact_id,status,error)VALUES(2,1,'failed',$1),(2,2,'failed','Chatwoot HTTP 500')",[error]);
  await pool.query("INSERT INTO ai_responder_log(account_id,last_incoming_id,status,error)VALUES(2,10,'failed',$1),(2,11,'sent',NULL)",[error]);
  await createAiFollowupTable(pool);await createResponderTable(pool);
  assert.deepEqual((await pool.query('SELECT status,error FROM ai_followup_log ORDER BY id')).rows,[{status:'provider_unavailable',error},{status:'failed',error:'Chatwoot HTTP 500'}]);
  await pool.query("INSERT INTO ai_followup_log(account_id,contact_id,status)VALUES(2,3,'queued')");
  assert.equal((await pool.query('SELECT status FROM ai_responder_log WHERE last_incoming_id=10')).rows[0].status,'provider_unavailable');
  await createOutboundQueueTable(pool);
  const queued=(await pool.query("INSERT INTO outbound_queue(account_id,origem,texto,status,enviado_em)VALUES(2,'followup','Synthetic receipt','sent',NOW()) RETURNING id")).rows[0];
  await pool.query("INSERT INTO ai_followup_log(account_id,contact_id,status,outbound_queue_id)VALUES(2,4,'queued',$1)",[queued.id]);
  await syncFollowupQueue(pool,2);const receipt=(await pool.query('SELECT status,sent_at FROM ai_followup_log WHERE contact_id=4')).rows[0];assert.equal(receipt.status,'sent');assert.ok(receipt.sent_at);
  await registrarDecisao(pool,{accountId:2,lastIncomingId:11,status:'failed',error:'must not replace delivery'});assert.equal((await pool.query('SELECT status FROM ai_responder_log WHERE last_incoming_id=11')).rows[0].status,'sent');
  await pool.query("UPDATE ai_responder_log SET status='retrying',retry_history=jsonb_build_array(jsonb_build_object('error',error,'created_at',created_at)) WHERE last_incoming_id=10");
  await registrarDecisao(pool,{accountId:2,lastIncomingId:10,status:'dry_run',mensagem:'Synthetic test only'});const restored=(await pool.query('SELECT status,retry_history FROM ai_responder_log WHERE last_incoming_id=10')).rows[0];assert.equal(restored.status,'dry_run');assert.equal(restored.retry_history[0].error,error);
 }finally{if(pool)await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
