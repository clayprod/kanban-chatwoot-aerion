'use strict';
const {hash}=require('./technicalRules');
const {identity,topics,resolvePoints,generationInput,system,validateAiDraft,assembleDraft,validateExport}=require('./objectionDraft');
const {renderDocx}=require('./objectionDocument');
const law=require('./objectionLaw');
const {randomUUID}=require('node:crypto');
async function createObjectionTables(pool){
 await pool.query(`CREATE TABLE IF NOT EXISTS technical_objection_points(account_id INTEGER NOT NULL,notice_key TEXT NOT NULL,item_number TEXT NOT NULL,requirement_id TEXT NOT NULL,topic TEXT NOT NULL DEFAULT 'restricao',note TEXT NOT NULL DEFAULT '',fingerprint TEXT NOT NULL,label TEXT NOT NULL,PRIMARY KEY(account_id,notice_key,item_number,requirement_id))`);
 await pool.query(`CREATE TABLE IF NOT EXISTS technical_objection_drafts(id BIGSERIAL PRIMARY KEY,account_id INTEGER NOT NULL,request_hash TEXT NOT NULL,input JSONB NOT NULL,progress JSONB NOT NULL DEFAULT '[]',result JSONB,error TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW(),UNIQUE(account_id,request_hash))`);
 await pool.query('ALTER TABLE technical_objection_drafts ADD COLUMN IF NOT EXISTS error_http_status INTEGER');
 await pool.query(`CREATE TABLE IF NOT EXISTS technical_objection_runs(token UUID PRIMARY KEY,account_id INTEGER NOT NULL,context_key TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'running',progress JSONB,result JSONB,error TEXT,http_status INTEGER,updated_at TIMESTAMPTZ DEFAULT NOW())`);
}
function createObjectionService({pool,ai,loadJob}){
 async function context(account,kind,id){
  let job,opportunity,manual;
  if(kind==='job')job=(await pool.query("SELECT * FROM technical_jobs WHERE account_id=$1 AND id=$2 AND kind='notice'",[account,id])).rows[0];
  else{
   opportunity=(await pool.query('SELECT * FROM licitacao_opportunities WHERE account_id=$1 AND id=$2',[account,id])).rows[0];if(!opportunity)throw Object.assign(Error('Oportunidade não encontrada.'),{status:404});
   if(opportunity.technical_analysis_id)job=(await pool.query('SELECT * FROM technical_jobs WHERE account_id=$1 AND id=$2',[account,opportunity.technical_analysis_id])).rows[0];
   manual=(await pool.query(`SELECT i.numero_item,i.id AS item_id,r.* FROM licitacao_item_requirements r JOIN licitacao_items i ON i.id=r.item_id WHERE i.opportunity_id=$1 ORDER BY i.id,r.ordem,r.id`,[opportunity.id])).rows;
  }
  if(kind==='job'&&!job)throw Object.assign(Error('Análise não encontrada.'),{status:404});
  const analysis=job?await loadJob(job):null;
  let result=analysis?.result;
  if(manual){const items=new Map();for(const r of manual){const number=String(r.numero_item || r.item_id);if(!items.has(number))items.set(number,{number,in_scope:true,requirements:[],products:[]});items.get(number).requirements.push({id:`manual:${r.id}`,source_id:r.technical_reference?.requirement?.source_id || `manual:${r.id}`,location:r.technical_reference?.requirement?.location || 'Checklist informado pelo usuário',quote:r.technical_reference?.requirement?.quote || r.requisito,label:r.requisito,key:r.technical_reference?.requirement?.key || 'manual_requirement',manual_id:r.id,manual_note:r.observacao});}result={...result,items:[...items.values()]};}
  const ids=(analysis?.result?.sources || []).map(s=>String(s.id)).filter(v=>/^\d+$/.test(v));
  const sources=ids.length?(await pool.query('SELECT id,name,pages,complete FROM technical_sources WHERE account_id=$1 AND id=ANY($2::bigint[])',[account,ids])).rows:[];
  const payload=job?.context?.payload || {},n=opportunity || {};
  const opening=sources.flatMap(s=>(s.pages || []).slice(0,2).map(p=>p.text)).join('\n');
  const currentLaw=/lei[^\n\d]{0,35}14[.,]133/i.test(opening),otherLaw=/lei[^\n\d]{0,35}(?:13[.,]303|8[.,]666)/i.test(opening);const regime=currentLaw&&!otherLaw?'14133':otherLaw&&!currentLaw?'other':null;
  return {kind,id,job,analysis,result,sources,manual,notice_key:opportunity?`opportunity:${opportunity.id}`:job.context.notice_key,notice:{title:n.titulo || payload.titulo,agency:n.orgao_nome || payload.orgao?.nome,procedure:n.modalidade || payload.modalidade?.nome,regime,control_number:n.numero_compra || payload.numero_controle_pncp,session_date:n.data_sessao || payload.data_inicio_proposta,document_notes:analysis?.result?.notes || [],documents_complete:analysis?.result?.documents_complete===true}};
 }
 async function selections(account,ctx){
  if(ctx.manual)return ctx.manual.filter(r=>r.impugnar).map(r=>{const number=String(r.numero_item || r.item_id),req=ctx.result.items.find(i=>i.number===number).requirements.find(q=>q.id===`manual:${r.id}`);return {item_number:number,requirement_id:req.id,label:r.requisito,topic:r.impugnacao_tema || 'restricao',note:r.impugnacao_motivo || '',fingerprint:identity(req)};});
  return (await pool.query('SELECT * FROM technical_objection_points WHERE account_id=$1 AND notice_key=$2 ORDER BY item_number,requirement_id',[account,ctx.notice_key])).rows.map(p=>{const item=ctx.result?.items?.find(i=>String(i.number)===p.item_number),req=[...(item?.requirements || []),...(item?.obligations || [])].find(r=>String(r.id)===p.requirement_id);return {...p,stale:!req||!item.in_scope||item.review_invalidated===true||identity(req)!==p.fingerprint};});
 }
 async function change(account,ctx,b){
  const item=ctx.result?.items?.find(i=>i.in_scope&&String(i.number)===String(b.item_number)),req=[...(item?.requirements || []),...(item?.obligations || [])].find(r=>String(r.id)===String(b.requirement_id));
  if(b.selected!==false&&(!req||item.review_invalidated))throw Object.assign(Error('Exigência indisponível ou desatualizada.'),{status:409});
  const topic=Object.hasOwn(topics,b.topic)?b.topic:'restricao',note=String(b.note || '').slice(0,5000);
  if(ctx.manual){if(!req)throw Object.assign(Error('Requisito não encontrado.'),{status:404});await pool.query('UPDATE licitacao_item_requirements SET impugnar=$1,impugnacao_tema=$2,impugnacao_motivo=$3,updated_at=NOW() WHERE id=$4',[b.selected!==false,topic,note,req.manual_id]);}
  else if(b.selected===false)await pool.query('DELETE FROM technical_objection_points WHERE account_id=$1 AND notice_key=$2 AND item_number=$3 AND requirement_id=$4',[account,ctx.notice_key,String(b.item_number),String(b.requirement_id)]);
  else await pool.query(`INSERT INTO technical_objection_points(account_id,notice_key,item_number,requirement_id,topic,note,fingerprint,label) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(account_id,notice_key,item_number,requirement_id) DO UPDATE SET topic=EXCLUDED.topic,note=EXCLUDED.note,fingerprint=EXCLUDED.fingerprint,label=EXCLUDED.label`,[account,ctx.notice_key,String(b.item_number),String(req.id),topic,note,identity(req),req.label]);
 }
 async function generate(account,ctx,b,notify=()=>{}){
  if(ctx.notice.regime==='other'||ctx.notice.regime!=='14133'&&b.law!=='14133')throw Object.assign(Error('Confirme a lei aplicável no edital. Esta geração usa a Lei 14.133/2021 e não deve ser aplicada automaticamente a outro regime.'),{status:422});
  const selected=await selections(account,ctx);if(!selected.length)throw Object.assign(Error('Marque ao menos uma exigência para impugnar.'),{status:400});
  const points=resolvePoints(ctx.result,selected).map(s=>({...s,point_id:hash([s.item_number,s.requirement_id,s.fingerprint]).slice(0,20),source_name:ctx.sources.find(source=>String(source.id)===String(s.requirement.source_id))?.name || null}));
  const input=generationInput({notice:ctx.notice,points,sources:ctx.sources,party:b.party || {},extra:b.extra});
  // Company/signature edits do not trigger a new paid analysis.
  const key=hash({...input,party:undefined}),client=await pool.connect();
  try{
   const locked=await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[`${account}:objection`]);if(!locked.rows[0].locked)throw Object.assign(Error('Já há uma minuta sendo gerada nesta conta. Aguarde a conclusão.'),{status:409});
   const saved=(await client.query(`INSERT INTO technical_objection_drafts(account_id,request_hash,input) VALUES($1,$2,$3::jsonb) ON CONFLICT(account_id,request_hash) DO UPDATE SET request_hash=EXCLUDED.request_hash RETURNING *`,[account,key,JSON.stringify(input)])).rows[0];
   if(saved.error){if(b.retry===true&&[402,429].includes(saved.error_http_status))await client.query('UPDATE technical_objection_drafts SET error=NULL,error_http_status=NULL WHERE id=$1',[saved.id]);else throw Object.assign(Error(saved.error+' Nenhuma chamada automática adicional foi feita.'),{status:409});}
   if(saved.result)return {id:saved.id,draft:assembleDraft(input,saved.result),cached:true};
   // Dynamic output budget, at most 5000 tokens per group; every point is
   // included, and completed groups are persisted before another paid call.
   const groups=[];let group=[];for(const p of points){if(group.length&&(500+(group.length+1)*600>5000||JSON.stringify({...input,party:undefined,points:[...group,p]}).length>90000)){groups.push(group);group=[];}group.push(p);}if(group.length)groups.push(group);
   const progress=saved.progress || [];
   for(let index=progress.length;index<groups.length;index++){
    notify({completed:index,total:groups.length});
    const part={...input,law:law.contextFor(groups[index]),party:undefined,points:groups[index]},user=JSON.stringify(part),maxTokens=500+groups[index].length*600;
    if(user.length>100000)throw Error('Os trechos selecionados são extensos demais para uma chamada segura. Reduza as observações ou gere documentos separados.');
    if((await client.query("SELECT 1 FROM technical_ai_calls WHERE account_id=$1 AND request_hash=$2 AND operation='objection_draft' AND (outcome='started' OR COALESCE(http_status,0) NOT IN(402,429)) LIMIT 1",[account,hash(user)])).rowCount)throw Object.assign(Error('Há uma chamada anterior sem resultado reutilizável confirmado. Ela não foi repetida para evitar nova cobrança.'),{status:409});
    const audit=(await client.query("INSERT INTO technical_ai_calls(account_id,job_id,day,reserved_tokens,operation,request_hash,outcome) VALUES($1,$2,CURRENT_DATE,$3,'objection_draft',$4,'started') RETURNING id",[account,ctx.job?.id || null,Math.ceil(user.length/3)+maxTokens,hash(user)])).rows[0];
    let response;try{response=await ai({system,user,maxTokens,temperature:0.15,maxProviderAttempts:1,timeoutMs:90000});}catch(e){response={ok:false,error:e.message};}
    await client.query('UPDATE technical_ai_calls SET provider=$2,model=$3,http_status=$4,request_id=$5,usage=$6::jsonb,actual_tokens=$7,outcome=$8 WHERE id=$1',[audit.id,response.provider || null,response.model || null,response.http_status || null,response.request_id || null,JSON.stringify(response.usage || null),response.usage?.total_tokens || null,response.ok&&!response.truncated?'completed':'failed']);
    try{if(!response.ok||response.truncated)throw Error(response.error || 'A IA não concluiu a minuta.');progress.push(validateAiDraft(response.data,groups[index],part.law.articles));}catch(e){await client.query('UPDATE technical_objection_drafts SET error=$2,progress=$3::jsonb,error_http_status=$4,updated_at=NOW() WHERE id=$1',[saved.id,e.message,JSON.stringify(progress),response.http_status || null]);throw Object.assign(e,{status:502});}
    await client.query('UPDATE technical_objection_drafts SET progress=$2::jsonb,updated_at=NOW() WHERE id=$1',[saved.id,JSON.stringify(progress)]);
   }
   const result={points:progress.flatMap(p=>p.points),pending_checks:[...new Set(progress.flatMap(p=>Array.isArray(p.pending_checks)?p.pending_checks:[]))]};
   await client.query('UPDATE technical_objection_drafts SET result=$2::jsonb,updated_at=NOW() WHERE id=$1',[saved.id,JSON.stringify(result)]);notify({completed:groups.length,total:groups.length});return {id:saved.id,draft:assembleDraft(input,result),cached:false};
  }finally{try{await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`${account}:objection`]);}finally{client.release();}}
 }
 function register(route){for(const [kind,base]of [['job','/api/licitacoes/technical/jobs/:id/objection'],['opportunity','/api/licitacoes/opportunities/:id/objection']]){
  route('get',base,async(req,res,account)=>{const ctx=await context(account,kind,req.params.id);res.json({selected:await selections(account,ctx),notice:ctx.notice});});
  route('put',base,async(req,res,account)=>{const ctx=await context(account,kind,req.params.id);await change(account,ctx,req.body || {});res.json({ok:true});});
  route('post',base+'/generate',async(req,res,account)=>{
   const ctx=await context(account,kind,req.params.id),token=randomUUID(),entry={account,status:'running',progress:null};await pool.query('INSERT INTO technical_objection_runs(token,account_id,context_key) VALUES($1,$2,$3)',[token,account,`${kind}:${req.params.id}`]);
   const work=generate(account,ctx,req.body || {},p=>{entry.progress=p;pool.query("UPDATE technical_objection_runs SET progress=$2::jsonb,updated_at=NOW() WHERE token=$1 AND status='running'",[token,JSON.stringify(p)]).catch(e=>console.error('[objection-progress]',e.message));}).then(async result=>{Object.assign(entry,{status:'completed',result});await pool.query("UPDATE technical_objection_runs SET status='completed',result=$2::jsonb,updated_at=NOW() WHERE token=$1",[token,JSON.stringify(result)]);return entry;},async error=>{Object.assign(entry,{status:'failed',error:error.message,http_status:error.status || 400});await pool.query("UPDATE technical_objection_runs SET status='failed',error=$2,http_status=$3,updated_at=NOW() WHERE token=$1",[token,entry.error,entry.http_status]);return entry;});
   const ready=await Promise.race([work,new Promise(resolve=>setTimeout(()=>resolve(null),500))]);
   if(!ready)return res.status(202).json({status:'running',token});if(ready.status==='failed')return res.status(ready.http_status).json({error:ready.error});res.json(ready.result);
  });
  route('get',base+'/generation/:token',async(req,res,account)=>{const entry=(await pool.query('SELECT * FROM technical_objection_runs WHERE token=$1 AND account_id=$2 AND context_key=$3',[req.params.token,account,`${kind}:${req.params.id}`])).rows[0];if(!entry)return res.status(404).json({error:'Geração não localizada. Reabra a preparação; resultados concluídos são reaproveitados sem nova chamada.'});if(entry.status==='running'&&Date.now()-new Date(entry.updated_at).getTime()>300000)return res.status(409).json({error:'Geração interrompida ou sem progresso confirmado. Reabra a preparação; etapas concluídas são reaproveitadas, sem repetir chamadas com cobrança incerta.'});if(entry.status==='failed')return res.status(entry.http_status).json({error:entry.error});res.json({status:entry.status,progress:entry.progress,...(entry.result || {})});});
  route('post',base+'/docx',async(req,res)=>{const bytes=renderDocx(validateExport(req.body?.draft));res.set('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');res.set('Content-Disposition',"attachment; filename*=UTF-8''impugnacao-edital.docx");res.send(bytes);});
 }}
 return {register,context,selections,change,generate};
}
module.exports={createObjectionTables,createObjectionService};
