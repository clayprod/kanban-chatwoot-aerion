'use strict';const test=require('node:test'),assert=require('node:assert/strict'),{Pool}=require('pg');const {createReviewTables,registerReviewRoutes,applyReviews}=require('../technicalReviews');
test('manual review is durably saved before import, restored after reopening, recalculated, and isolated by account',{skip:!process.env.QUALITY_TEST_DATABASE_URL},async()=>{
 const admin=new Pool({connectionString:process.env.QUALITY_TEST_DATABASE_URL}),schema=`manual_review_test_${process.pid}`;let pool;
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:process.env.QUALITY_TEST_DATABASE_URL,options:`-c search_path=${schema},public`});await pool.query(`CREATE TABLE technical_jobs(id BIGSERIAL PRIMARY KEY,account_id INTEGER,kind TEXT,context JSONB);INSERT INTO technical_jobs(account_id,kind,context) VALUES(1,'notice','{"notice_key":"notice"}');`);await createReviewTables(pool);
  const requirement={id:'r',quote:'Critério',source_id:'s',key:'metric',value:40},product={product_id:4,product_specs_version:2,requirements:[{requirement,status:'nao_ok',evidence:[]}],counts:{ok:0,nao_ok:1,total:1}},result={base_score:80,documents_complete:false,items:[{number:'1',in_scope:true,documents_complete:false,products:[product]}]};let changed=0;
  const routes=new Map(),register=()=>registerReviewRoutes({route:(method,url,handler)=>routes.set(method+url,handler),pool,loadJob:async()=>({result}),onChange:async()=>changed++});register();
  let response;const res={json:v=>{response=v;}},request={params:{id:'1'},auth:{uid:7},body:{item_number:'1',product_id:4,requirement_id:'r',status:'ok'}};
  await routes.get('put/api/licitacoes/technical/jobs/:id/reviews')(request,res,1);assert.equal(changed,1);assert.equal(response.review.status,'ok');
  const event=(await pool.query('SELECT * FROM technical_requirement_review_events')).rows[0];assert.equal(event.status,'ok');assert.equal(event.snapshot.automatic_status,'nao_ok');assert.equal(event.snapshot.product_specs_version,2);
  // Recreate the route handlers to prove this is database state, not a local React/service cache.
  routes.clear();register();await routes.get('get/api/licitacoes/technical/jobs/:id/reviews')({params:{id:'1'}},res,1);assert.equal(response.reviews.length,1);assert.equal(response.reviews[0].status,'ok');assert.equal(String(response.reviews[0].reviewer_id),'7');const revised=applyReviews(result,response.reviews);assert.equal(revised.items[0].technical_percent,100);assert.equal(revised.items[0].products[0].requirements[0].automatic_status,'nao_ok');assert.equal(revised.full_items,0);
  await assert.rejects(routes.get('get/api/licitacoes/technical/jobs/:id/reviews')({params:{id:'1'}},res,2),e=>e.status===404);
  product.product_specs_version=3;await routes.get('get/api/licitacoes/technical/jobs/:id/reviews')({params:{id:'1'}},res,1);assert.equal(response.reviews.length,0);
 }finally{if(pool)await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
