'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Pool}=require('pg');const {createObjectionTables,createObjectionService}=require('../objectionService');
test('selection and generated drafts are account scoped, complete, cached, single-attempt and usable with the paid notice worker paused',{skip:!process.env.QUALITY_TEST_DATABASE_URL,timeout:60000},async()=>{
 const admin=new Pool({connectionString:process.env.QUALITY_TEST_DATABASE_URL}),schema=`objection_test_${process.pid}`;let pool;
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:process.env.QUALITY_TEST_DATABASE_URL,options:`-c search_path=${schema},public`});
  await pool.query(`CREATE TABLE technical_jobs(id BIGSERIAL PRIMARY KEY,account_id INTEGER,kind TEXT,context JSONB);CREATE TABLE technical_sources(id BIGSERIAL PRIMARY KEY,account_id INTEGER,name TEXT,pages JSONB,complete BOOLEAN);
   CREATE TABLE technical_ai_calls(id BIGSERIAL PRIMARY KEY,account_id INTEGER,job_id BIGINT,day DATE,reserved_tokens BIGINT,operation TEXT,request_hash TEXT,outcome TEXT,provider TEXT,model TEXT,http_status INTEGER,request_id TEXT,usage JSONB,actual_tokens BIGINT);`);
  await createObjectionTables(pool);await pool.query(`INSERT INTO technical_jobs(account_id,kind,context) VALUES(1,'notice','{"notice_key":"notice","payload":{"titulo":"Pregão 1"}}');INSERT INTO technical_sources(account_id,name,pages,complete) VALUES(1,'Edital','[{"location":"Página 1","text":"Lei nº 14.133/2021. Especificações técnicas."}]',TRUE);`);
  const requirements=Array.from({length:10},(_,i)=>({id:`r${i}`,key:'metric',value:i,label:`Critério ${i}`,quote:`Exigência ${i}`,source_id:'1',location:'Página 1'}));
  const analysis={result:{sources:[{id:'1'}],documents_complete:true,items:[{number:'1',in_scope:true,requirements,products:[]}]}};
  let calls=0;const service=createObjectionService({pool,loadJob:async()=>analysis,ai:async args=>{calls++;assert.equal(args.maxProviderAttempts,1);const input=JSON.parse(args.user);return {ok:true,provider:'test',model:'stub',usage:{total_tokens:10},data:{points:input.points.map(p=>({point_id:p.point_id,argument:'Cabe solicitar demonstração da necessidade desta restrição.',requested_change:'Admitir equivalência técnica, quando cabível.',legal_articles:['9','41']})),pending_checks:['Verificar calendário local.']}};}});
  const ctx=await service.context(1,'job',1);for(const req of requirements)await service.change(1,ctx,{item_number:'1',requirement_id:req.id,selected:true,topic:'restricao'});
  assert.equal((await service.selections(1,ctx)).length,10);await assert.rejects(service.context(2,'job',1),e=>e.status===404);
  const generated=await service.generate(1,ctx,{party:{name:'Empresa A'}});assert.equal(calls,2);assert.equal(generated.draft.sections.filter(s=>s.title.startsWith('III.')).length,10);
  const cached=await service.generate(1,ctx,{party:{name:'Empresa B'}});assert.equal(cached.cached,true);assert.equal(calls,2);assert.match(cached.draft.sections[0].paragraphs[0],/Empresa B/);assert.equal((await pool.query("SELECT count(*)::int AS n FROM technical_ai_calls WHERE operation='objection_draft'")).rows[0].n,2);
  requirements[0].value=999;await assert.rejects(service.generate(1,ctx,{}),e=>e.status===409);assert.equal(calls,2);requirements[0].value=0;
  // Route polling survives recreating the service, and polling never calls the provider.
  let release;const wait=new Promise(resolve=>{release=resolve;});let routedCalls=0;
  const routed=createObjectionService({pool,loadJob:async()=>analysis,ai:async args=>{routedCalls++;await wait;const input=JSON.parse(args.user);return {ok:true,provider:'test',model:'stub',data:{points:input.points.map(p=>({point_id:p.point_id,argument:'Verificar necessidade.',requested_change:'Admitir equivalência.',legal_articles:['41']})),pending_checks:[]}};}}),routes=new Map();routed.register((m,u,h)=>routes.set(m+u,h));
  let response,status;const res={status(n){status=n;return this;},json(v){response=v;return this;}};
  await routes.get('post/api/licitacoes/technical/jobs/:id/objection/generate')({params:{id:'1'},body:{extra:'Novo contexto para testar geração assíncrona.'}},res,1);assert.equal(status,202);const token=response.token;assert.ok(token);release();
  const reopened=new Map();createObjectionService({pool,loadJob:async()=>analysis,ai:()=>{throw Error('Polling não pode chamar IA');}}).register((m,u,h)=>reopened.set(m+u,h));
  for(let i=0;i<50;i++){await reopened.get('get/api/licitacoes/technical/jobs/:id/objection/generation/:token')({params:{id:'1',token}},res,1);if(response.status==='completed')break;await new Promise(resolve=>setTimeout(resolve,20));}
  assert.equal(response.status,'completed');assert.equal(routedCalls,2);await reopened.get('get/api/licitacoes/technical/jobs/:id/objection/generation/:token')({params:{id:'1',token}},res,2);assert.equal(status,404);
 }finally{if(pool)await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
