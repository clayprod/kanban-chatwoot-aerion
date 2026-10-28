'use strict';
async function createProspectingRuntime(pool){
 await pool.query(`CREATE TABLE IF NOT EXISTS prospecting_runtime(account_id INTEGER PRIMARY KEY,started_at TIMESTAMPTZ NOT NULL,finished_at TIMESTAMPTZ,summary JSONB NOT NULL DEFAULT '{}'::jsonb,error TEXT)`);
}
async function startProspectingRun(pool,account){
 await pool.query(`INSERT INTO prospecting_runtime(account_id,started_at)VALUES($1,NOW()) ON CONFLICT(account_id)DO UPDATE SET started_at=NOW(),finished_at=NULL,summary='{}'::jsonb,error=NULL`,[account]);
}
async function finishProspectingRun(pool,account,summary,error=null){
 await pool.query('UPDATE prospecting_runtime SET finished_at=NOW(),summary=$2::jsonb,error=$3 WHERE account_id=$1',[account,JSON.stringify(summary||{}),error]);
}
// A queue receipt is authoritative. Legacy logs also have a stable CNPJ dedupe
// key; match message and time so a later intent cannot rewrite an earlier one.
const prospectingDecisionSql=`SELECT p.id,p.cnpj,p.razao_social,p.telefone,p.perfil,p.icp,
 CASE WHEN p.status='enfileirado' AND q.status='sent' THEN 'abordado'
      WHEN p.status='enfileirado' AND q.status IN('failed','cancelled') THEN 'falhou'
      ELSE p.status END AS status,p.motivo,p.perfil_whatsapp,p.confirmou_empresa,p.contact_id,p.mensagem,
 COALESCE(p.error,CASE WHEN q.status IN('failed','cancelled') THEN COALESCE(q.last_error,'Envio cancelado na fila') END) AS error,
 p.created_at,q.enviado_em AS sent_at,p.razao_social AS contact_name,p.phone_evidence
 FROM prospeccao_log p LEFT JOIN LATERAL(
 SELECT status,last_error,enviado_em FROM outbound_queue q WHERE q.account_id=p.account_id
 AND q.origem='prospeccao' AND q.dedupe_key='prospeccao:'||p.cnpj AND q.texto=p.mensagem
 AND q.created_at BETWEEN p.created_at-INTERVAL '5 minutes' AND p.created_at+INTERVAL '1 minute'
 ORDER BY q.id DESC LIMIT 1)q ON TRUE WHERE p.account_id=$1`;
module.exports={createProspectingRuntime,startProspectingRun,finishProspectingRun,prospectingDecisionSql};
