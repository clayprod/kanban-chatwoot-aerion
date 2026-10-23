'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const express=require('express');
const {createTechnicalTables,createTechnicalAnalysis}=require('../technicalAnalysis');

test('full document coverage: failed download, omitted evidence recovery, three documents and adaptive comparison',
 {skip:!process.env.QUALITY_TEST_DATABASE_URL,timeout:180000},async()=>{
 const admin=new Pool({connectionString:process.env.QUALITY_TEST_DATABASE_URL});
 const schema=`technical_coverage_${process.pid}`;let pool,server;
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool=new Pool({connectionString:process.env.QUALITY_TEST_DATABASE_URL,options:`-c search_path=${schema},public`});
  await pool.query(`CREATE TABLE licitacao_opportunities(id BIGSERIAL PRIMARY KEY,account_id INTEGER,numero_compra TEXT,links JSONB DEFAULT '{}',metadados JSONB DEFAULT '{}');
   CREATE TABLE pncp_search_jobs(id UUID PRIMARY KEY,account_id INTEGER,filters JSONB DEFAULT '{}',terms TEXT[] DEFAULT '{}');
   CREATE TABLE pncp_search_job_results(job_id UUID,account_id INTEGER,result_key TEXT,score NUMERIC,visibility TEXT,quality_hidden BOOLEAN DEFAULT FALSE,payload JSONB,updated_at TIMESTAMPTZ DEFAULT NOW());
   CREATE TABLE edital_watchlist(id BIGSERIAL PRIMARY KEY,account_id INTEGER,palavras_chave TEXT[],filtros JSONB DEFAULT '{}');
   CREATE TABLE edital_signals(id BIGSERIAL PRIMARY KEY,account_id INTEGER,watchlist_id BIGINT,payload JSONB,criado_em TIMESTAMPTZ DEFAULT NOW(),quality_hidden BOOLEAN DEFAULT FALSE,status TEXT DEFAULT 'novo');`);
  await createTechnicalTables(pool);
  let brokenEvidence=true,failDownload=true,downloads=0,oversized=0;
  const documentCalls=new Map();
  const contents={edital:'Drone com autonomia mínima de 41 min.',tr:'Câmera com resolução mínima de 20 MP.',anexo:'Treinamento presencial de 4 horas.'};
  const service=createTechnicalAnalysis({pool,workerLockKey:30000000+process.pid,getAccountId:()=>1,getIds:i=>({cnpj:i.cnpj,ano:'2026',sequencial:'1'}),
   getNotice:async()=>({open:true}),isEligible:()=>true,gate:fn=>fn(),heavy:(_name,fn)=>fn(),
   getItems:async()=>Object.assign([{numeroItem:1,descricao:'Drone',quantidade:1,unidadeMedida:'un',valorUnitarioEstimado:100}],{complete:true}),
   getFiles:async()=>Object.keys(contents).map(name=>({titulo:`${name}.txt`,url:`https://example.org/${name}`})),
   documentIO:{download:async url=>{downloads++;if(failDownload){failDownload=false;throw new Error('HTTP 503');}return{bytes:Buffer.from(contents[url.split('/').pop()]),content_type:'text/plain',url};},
    extract:async bytes=>({pages:[{location:'Página 1',text:bytes.toString()}],complete:true,notes:[]})},
   ai:async({user})=>{
    const input=JSON.parse(user);
    if(!input.document){
     if(input.specifications.length>1){oversized++;return{ok:false,requestTooLarge:true,error:'413'};}
     return{ok:true,data:{matches:input.requirements.map(r=>{const ids=input.specifications.filter(s=>r.key==='flight_time'&&s.key==='battery_endurance').map(s=>s.id);return{requirement_id:r.id,spec_ids:ids,same_metric:ids.length>0};})},usage:{total_tokens:10}};
    }
    const {document:chunk}=input,product=!input.context.items;
    documentCalls.set(chunk.source_id,(documentCalls.get(chunk.source_id)||0)+1);
    const facts=[];
    const add=(quote,key,value,unit,category='equipment')=>facts.push({item_number:product?'all':'1',label:quote,key,kind:'numeric',value,unit,operator:product?'eq':'min',conditions:'',category,quote,source_id:chunk.source_id,location:chunk.location});
    if(chunk.text.includes('Autonomia de 40 min'))add('Autonomia de 40 min','battery_endurance',40,'min');
    if(chunk.text.includes('autonomia mínima de 41 min'))add('autonomia mínima de 41 min','flight_time',41,'min');
    if(chunk.text.includes('resolução mínima de 20 MP'))add(brokenEvidence&&!product?'resolução mínima de 99 MP':'resolução mínima de 20 MP','camera_resolution',20,'MP');
    if(chunk.text.includes('Resolução de 20 MP'))add('Resolução de 20 MP','camera_resolution',20,'MP');
    if(chunk.text.includes('Treinamento presencial de 4 horas'))add('Treinamento presencial de 4 horas','training',4,'h','supply');
    return{ok:true,data:{complete:true,facts,conflicts:[],...(input.blocks?{coverage:input.blocks.map(b=>({block_id:b.id,classification:'requirements',fact_indexes:facts.map((_,i)=>i),reason:'Requisitos conferidos.'}))}:{})},usage:{total_tokens:100}};
   }});
  const app=express();app.use(express.json());service.register(app);
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const request=async(method,path,body)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/licitacoes${path}`,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.ok(r.ok,`${method} ${path}: ${r.status}`);return r.json();};
  const product=await request('POST','/products',{name:'Drone',keywords:['drone'],sale_price:80,unit:'un',package_confirmed:true});
  await request('POST',`/products/${product.id}/sources`,{text:'Autonomia de 40 min. Resolução de 20 MP.'});
  await service.tick();
  await pool.query("UPDATE technical_jobs SET next_run_at=NOW()+INTERVAL '1 hour' WHERE kind='product'");
  await request('PUT','/technical/config',{enabled:true,limit_mode:'score',min_score:68});
  const job=await service.observe(1,{cnpj:'12345678000195',score:90,titulo:'Compra de drone'},{terms:['drone']});
  for(let n=0;n<4;n++)await service.tick();
  let current=(await pool.query('SELECT * FROM technical_jobs WHERE id=$1',[job.id])).rows[0];
  assert.equal(current.stage,'recovering_documents');assert.equal(current.state.file_cursor,0);
  await pool.query('UPDATE technical_jobs SET next_run_at=NOW() WHERE id=$1',[job.id]);
  for(let n=0;n<12;n++)await service.tick();
  current=(await pool.query('SELECT * FROM technical_jobs WHERE id=$1',[job.id])).rows[0];
  assert.equal(current.state.extract_cursor,3,'all notice sources are read even while catalogue extraction is pending');
  assert.equal(current.state.requirements_ready,true);
  await pool.query("UPDATE technical_jobs SET next_run_at=NOW() WHERE kind='product' OR id=$1",[job.id]);
  for(let n=0;n<16;n++)await service.tick();
  current=(await pool.query('SELECT * FROM technical_jobs WHERE id=$1',[job.id])).rows[0];
  assert.equal(current.status,'queued');assert.equal(current.stage,'recovering');assert.equal(current.result.coverage.read_complete,false);
  assert.equal(current.state.repair_pending,true);assert.equal(current.result.sources.length,3);assert.ok(oversized>0);
  const before=new Map(documentCalls);brokenEvidence=false;
  await pool.query('UPDATE technical_jobs SET next_run_at=NOW() WHERE id=$1',[job.id]);
  for(let n=0;n<20;n++)await service.tick();
  current=(await pool.query('SELECT * FROM technical_jobs WHERE id=$1',[job.id])).rows[0];
  assert.equal(current.status,'completed',current.error);assert.equal(current.result.coverage.read_complete,true);
  assert.equal(current.result.items[0].requirements.length,2);assert.equal(current.result.items[0].obligation_checks.length,1);
  const compared=current.result.items[0].products[0];assert.equal(compared.requirements.length,2);assert.equal(compared.counts.nao_ok,1);assert.equal(compared.counts.ok,1);
  assert.equal(downloads,4,'valid downloaded files are reused');
  const tr=current.result.sources.find(s=>s.name==='tr.txt');
  for(const[id,calls]of documentCalls)if(id!==tr.id.toString())assert.equal(calls,before.get(id),'only unresolved source uses IA again');
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));if(pool)await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();
 }
});
