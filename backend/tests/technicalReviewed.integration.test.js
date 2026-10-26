'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Pool}=require('pg');
const {createTechnicalTables,createTechnicalAnalysis}=require('../technicalAnalysis');
const {hash}=require('../technicalRules');
const fixture=require('./fixtures/technical-calibration/362510.json');
test('reviewed source requirements become persisted item checklists with the paid worker paused; edited files invalidate them',
 {skip:!process.env.QUALITY_TEST_DATABASE_URL,timeout:90000},async()=>{
  const admin=new Pool({connectionString:process.env.QUALITY_TEST_DATABASE_URL}),schema=`reviewed_test_${process.pid}`;let pool;
  try{
   await admin.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:process.env.QUALITY_TEST_DATABASE_URL,options:`-c search_path=${schema},public`});
   await pool.query(`CREATE TABLE licitacao_opportunities(id BIGSERIAL PRIMARY KEY,account_id INTEGER,numero_compra TEXT,links JSONB DEFAULT '{}',metadados JSONB DEFAULT '{}');
    CREATE TABLE pncp_search_jobs(id UUID PRIMARY KEY,account_id INTEGER,filters JSONB DEFAULT '{}',terms TEXT[] DEFAULT '{}');
    CREATE TABLE pncp_search_job_results(job_id UUID,account_id INTEGER,result_key TEXT,score NUMERIC,payload JSONB);`);
   await createTechnicalTables(pool);await pool.query('INSERT INTO technical_config(account_id,enabled) VALUES(1,FALSE)');
   const s=fixture.sources[0];
   const source=(await pool.query("INSERT INTO technical_sources(account_id,sha256,name,url,content_type,pages,complete,bytes) VALUES(1,$1,$2,$3,'text/plain',$4::jsonb,TRUE,$5) RETURNING id",[hash(s.pages),s.name,s.url,JSON.stringify(s.pages),Buffer.from(s.pages.map(p=>p.text).join('\n'))])).rows[0];
   const quote='Autonomia de 40 min';
   const specSource=(await pool.query("INSERT INTO technical_sources(account_id,sha256,name,content_type,pages,complete,bytes) VALUES(1,$1,'Ficha','text/plain',$2::jsonb,TRUE,$3) RETURNING id",[hash(quote),JSON.stringify([{location:'Ficha',text:quote}]),Buffer.from(quote)])).rows[0];
   const spec={id:'flight-spec',source_id:String(specSource.id),location:'Ficha',quote,key:'flight_time',component:'',kind:'numeric',value:40,unit:'min',conditions:'',operator:'eq'};
   const product=(await pool.query("INSERT INTO technical_products(account_id,name,keywords,sale_price,unit,specs,specs_complete) VALUES(1,'Drone',ARRAY['drone'],100,'un',$1::jsonb,TRUE) RETURNING id",[JSON.stringify([spec])])).rows[0];
   await pool.query('INSERT INTO technical_product_sources(account_id,product_id,source_id) VALUES(1,$1,$2)',[product.id,specSource.id]);
   const context={notice_key:fixture.key,profile:{terms:['drone']},payload:{score:80,titulo:fixture.title}},state={source_ids:[String(source.id)],items_raw:fixture.items,items_complete:true,files:[{name:s.name,url:s.url}],file_cursor:1,initialized:true,final_manifest_verified:true,final_manifest_checked_at:new Date().toISOString()};
   const job=(await pool.query("INSERT INTO technical_jobs(account_id,kind,target,revision,context,state) VALUES(1,'notice','review-fixture','1',$1::jsonb,$2::jsonb) RETURNING *",[JSON.stringify(context),JSON.stringify(state)])).rows[0];
   let calls=0;const service=createTechnicalAnalysis({pool,ai:async()=>{calls++;throw Error('Paid AI must not run');}});
   assert.equal((await service.refreshReviewed(1)).updated,1);
   const saved=(await pool.query('SELECT * FROM technical_jobs WHERE id=$1',[job.id])).rows[0];
   assert.equal(saved.stage,'reviewed');assert.equal(saved.status,'partial');assert.equal(saved.result.items[0].requirements.length,18);assert.equal(saved.result.items[0].products[0].requirements.length,18);assert.equal(calls,0);
   const read=await service.refreshedJob(saved);assert.equal(read.result.items[0].reviewed,true);assert.match(read.result.notes[0],/Termo de Referência/);
   const changed=structuredClone(s.pages);changed[0].text+=' Nova exigência publicada.';
   await pool.query('UPDATE technical_sources SET pages=$2::jsonb WHERE id=$1',[source.id,JSON.stringify(changed)]);
   const stale=await service.refreshedJob(saved);assert.equal(stale.stage,'review_stale');assert.equal(stale.result.review.current,false);assert.equal(stale.result.items[0].products[0].evidence_current,false);assert.equal(stale.result.technical_percent,null);assert.equal(calls,0);
  }finally{if(pool)await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
 });
