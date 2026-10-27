'use strict';
async function syncFollowupQueue(pool,account){
 return pool.query(`UPDATE ai_followup_log l SET status=CASE WHEN q.status='sent' THEN 'sent' ELSE 'failed' END,
   sent_at=CASE WHEN q.status='sent' THEN q.enviado_em ELSE NULL END,error=CASE WHEN q.status='sent' THEN NULL ELSE COALESCE(q.last_error,'Envio cancelado na fila') END
   FROM outbound_queue q WHERE l.account_id=$1 AND q.account_id=l.account_id AND q.id=l.outbound_queue_id AND q.origem='followup' AND l.status='queued' AND q.status IN('sent','failed','cancelled')`,[account]);
}
module.exports={syncFollowupQueue};
