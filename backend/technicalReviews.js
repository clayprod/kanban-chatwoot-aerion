'use strict';
const {hash,summarize,rankMatches}=require('./technicalRules');
const fingerprint=(requirement,product)=>hash({requirement,specs_version:product.product_specs_version ?? product.product_version});
async function createReviewTables(pool){await pool.query(`CREATE TABLE IF NOT EXISTS technical_requirement_reviews(account_id INTEGER NOT NULL,notice_key TEXT NOT NULL,item_number TEXT NOT NULL,product_id TEXT NOT NULL,requirement_id TEXT NOT NULL,fingerprint TEXT NOT NULL,status TEXT NOT NULL,reviewer_id BIGINT,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(account_id,notice_key,item_number,product_id,requirement_id))`);await pool.query(`CREATE TABLE IF NOT EXISTS technical_requirement_review_events(id BIGSERIAL PRIMARY KEY,account_id INTEGER NOT NULL,notice_key TEXT NOT NULL,item_number TEXT NOT NULL,product_id TEXT NOT NULL,requirement_id TEXT NOT NULL,fingerprint TEXT NOT NULL,status TEXT NOT NULL,reviewer_id BIGINT,snapshot JSONB,created_at TIMESTAMPTZ DEFAULT NOW())`);}
function applyReviews(result,reviews){
 if(!result?.items)return result;
 let changed=false;const items=result.items.map(item=>({...item,products:(item.products || []).map(product=>{
  let count=0;const requirements=(product.requirements || []).map(row=>{
   const review=reviews.find(r=>String(r.item_number)===String(item.number)&&String(r.product_id)===String(product.product_id)&&String(r.requirement_id)===String(row.requirement.id)&&r.fingerprint===fingerprint(row.requirement,product));
   if(!review||product.evidence_current===false||item.review_invalidated)return row;
   count++;changed=true;return {...row,automatic_status:row.automatic_status || row.status,status:review.status,manual_review:{status:review.status,reviewer_id:review.reviewer_id,updated_at:review.updated_at}};
  });
  if(!count)return product;
  const counts={ok:requirements.filter(r=>r.status==='ok').length,nao_ok:requirements.filter(r=>r.status==='nao_ok').length,verificar:requirements.filter(r=>!['ok','nao_ok'].includes(r.status)).length,total:requirements.length};
  const complete=(item.documents_complete ?? result.documents_complete)===true;
  const full=complete&&product.specs_complete&&counts.total>0&&counts.ok===counts.total,status=full?'full':counts.nao_ok?'failed':'uncertain';
  return {...product,requirements,counts,automatic_counts:product.automatic_counts || product.counts,manual_reviews:count,status,technical_percent:counts.total?Math.floor(100*counts.ok/counts.total):null,technical_bonus:!complete?0:full?20:counts.nao_ok?0:8*counts.ok/Math.max(1,counts.total),commercial_bonus:full&&product.price_comparison?product.price_comparison.relation==='below'?5:product.price_comparison.relation==='equal'?3:1:0};
 }).sort(rankMatches)}));
 return changed?{...result,...summarize(items,result.base_score),manual_reviewed:true}:result;
}
function registerReviewRoutes({route,pool,loadJob,onChange}){
 const context=async(account,id)=>{const job=(await pool.query("SELECT * FROM technical_jobs WHERE account_id=$1 AND id=$2 AND kind='notice'",[account,id])).rows[0];if(!job)throw Object.assign(Error('Análise não encontrada.'),{status:404});return {job,analysis:await loadJob(job)};};
 route('get','/api/licitacoes/technical/jobs/:id/reviews',async(req,res,account)=>{const {job,analysis}=await context(account,req.params.id),rows=(await pool.query('SELECT * FROM technical_requirement_reviews WHERE account_id=$1 AND notice_key=$2',[account,job.context.notice_key])).rows;
  res.json({reviews:rows.filter(r=>{const item=analysis.result?.items?.find(i=>String(i.number)===String(r.item_number)),p=item?.products?.find(p=>String(p.product_id)===String(r.product_id)),row=p?.requirements?.find(q=>String(q.requirement.id)===String(r.requirement_id));return row&&p.evidence_current!==false&&!item.review_invalidated&&r.fingerprint===fingerprint(row.requirement,p);})});
 });
 route('put','/api/licitacoes/technical/jobs/:id/reviews',async(req,res,account)=>{
  const {job,analysis}=await context(account,req.params.id),b=req.body || {},item=analysis.result?.items?.find(i=>i.in_scope&&String(i.number)===String(b.item_number)),product=item?.products?.find(p=>String(p.product_id)===String(b.product_id)),row=product?.requirements?.find(r=>String(r.requirement.id)===String(b.requirement_id));
  if(!row||item.review_invalidated||product.evidence_current===false)throw Object.assign(Error('A exigência ou a ficha mudou. Reabra a análise antes de ajustar.'),{status:409});
  if(!['ok','nao_ok','verificar'].includes(b.status))throw Object.assign(Error('Resultado manual inválido.'),{status:400});
  const review=(await pool.query(`WITH saved AS (INSERT INTO technical_requirement_reviews(account_id,notice_key,item_number,product_id,requirement_id,fingerprint,status,reviewer_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(account_id,notice_key,item_number,product_id,requirement_id) DO UPDATE SET status=EXCLUDED.status,fingerprint=EXCLUDED.fingerprint,reviewer_id=EXCLUDED.reviewer_id,updated_at=NOW() RETURNING *),event AS (INSERT INTO technical_requirement_review_events(account_id,notice_key,item_number,product_id,requirement_id,fingerprint,status,reviewer_id,snapshot) SELECT account_id,notice_key,item_number,product_id,requirement_id,fingerprint,status,reviewer_id,$9::jsonb FROM saved RETURNING id) SELECT saved.* FROM saved,event`,[account,job.context.notice_key,String(item.number),String(product.product_id),String(row.requirement.id),fingerprint(row.requirement,product),b.status,req.auth?.uid || null,JSON.stringify({requirement:row.requirement,automatic_status:row.automatic_status || row.status,product_specs_version:product.product_specs_version})])).rows[0];
  if(onChange)await onChange(job);res.json({review});
 });
}
module.exports={createReviewTables,applyReviews,registerReviewRoutes,fingerprint};
