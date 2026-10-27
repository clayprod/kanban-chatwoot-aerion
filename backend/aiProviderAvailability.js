'use strict';
// Only explicit HTTP rejections before generation may be retried automatically.
// A timeout, malformed generated JSON or send failure may already have cost or
// delivery consequences and must retain its ordinary failure handling.
function rejectedBeforeGeneration(error,{legacy=false}={}){
 const parts=String(error || '').split(' | ').map(s=>s.trim()).filter(Boolean);
 if(!parts.length||parts.some(s=>!/^(?:openai|groq|openrouter):(400|401|402|403|404|413|422|429)\b/.test(s)))return false;
 // Historic logs truncated the error to 500 characters. Require the old final
 // fallback's explicit rejection rather than assuming omitted calls failed free.
 return !legacy||/^openrouter:(402|429)\b/.test(parts.at(-1));
}
async function restoreProviderFailures(pool,table,messageColumn){
 if(!['ai_responder_log','ai_followup_log'].includes(table)||!['mensagem','message'].includes(messageColumn))throw Error('Invalid AI retry table');
 const rows=(await pool.query(`SELECT id,error FROM ${table} WHERE status='failed' AND ${messageColumn} IS NULL AND created_at>NOW()-INTERVAL '7 days' AND error LIKE '%openrouter:%'`)).rows;
 const ids=rows.filter(row=>rejectedBeforeGeneration(row.error,{legacy:true})).map(row=>row.id);
 if(ids.length)await pool.query(`UPDATE ${table} SET status='provider_unavailable' WHERE id=ANY($1::bigint[]) AND status='failed'`,[ids]);
}
module.exports={rejectedBeforeGeneration,restoreProviderFailures};
