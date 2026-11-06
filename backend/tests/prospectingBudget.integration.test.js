const test=require('node:test'),assert=require('node:assert/strict'),{Pool}=require('pg');
const {readBudget,validDailyLimit}=require('../prospectingBudget');
const {createAiSettingsTable}=require('../aiSettings');
const {createProspeccaoTable}=require('../prospeccao');
const {createOutboundQueueTable,enfileirar,despacharTick}=require('../outboundQueue');
test('limite numérico não aceita booleanos, decimais nem coerções',()=>{
 for(const v of [true,false,null,0,101,1.5,'20x','1e1',{},[]])assert.equal(validDailyLimit(v),false);
 assert.equal(validDailyLimit(20),true);assert.equal(validDailyLimit('20'),true);
});
test('PostgreSQL reserva vagas e revalida teto reduzido antes da entrega',{skip:!process.env.QUALITY_TEST_DATABASE_URL},async()=>{
 const url=process.env.QUALITY_TEST_DATABASE_URL,admin=new Pool({connectionString:url}),schema=`prospect_budget_${process.pid}`;let pool;
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:url,options:`-c search_path=${schema},public`});
  await createAiSettingsTable(pool);await createOutboundQueueTable(pool);await createProspeccaoTable(pool);
  assert.equal((await readBudget(pool,2)).limite,20);
  await pool.query("UPDATE ai_settings SET valor='2' WHERE chave='prospeccao_max_por_dia'");
  const queue=n=>enfileirar(pool,{accountId:2,origem:'prospeccao',texto:'synthetic fixture only',inboxId:n,dedupeKey:`test:${n}`});
  const burst=await Promise.allSettled(Array.from({length:10},(_,i)=>queue(i+1)));
  assert.ok(burst.filter(r=>r.status==='fulfilled').length<=2);
  let budget=await readBudget(pool,2);
  if(budget.reservados<2)await queue(20);
  await assert.rejects(()=>queue(30),/Limite diário/);
  budget=await readBudget(pool,2);assert.equal(budget.enviados,0);assert.equal(budget.reservados,2);assert.equal(budget.saldo,0);
  await pool.query("UPDATE ai_settings SET valor='1' WHERE chave='prospeccao_max_por_dia'");
  await pool.query('CREATE TABLE conversations(id BIGINT,account_id INTEGER,inbox_id BIGINT); CREATE TABLE messages(conversation_id BIGINT,message_type INTEGER,created_at TIMESTAMPTZ)');
  let deliveries=0;
  await despacharTick(pool,{accountId:2,enviar:async()=>{deliveries++;},maxPorTick:5});
  assert.equal(deliveries,1);budget=await readBudget(pool,2);assert.equal(budget.enviados,1);assert.equal(budget.reservados,1);
  await despacharTick(pool,{accountId:2,enviar:async()=>{deliveries++;},maxPorTick:5});assert.equal(deliveries,1);
  await createAiSettingsTable(pool);assert.equal((await readBudget(pool,2)).limite,1,'migração não substitui configuração do usuário');
 }finally{if(pool)await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
