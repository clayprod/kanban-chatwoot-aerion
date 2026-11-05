const crypto=require('node:crypto');
const {encrypt,decrypt,encryptionKey,normalizeOrder,shiftDay,saoPauloDay}=require('./domain');
const {advertisingEligible,emailHash,desiredMembers}=require('./customerAudiences');
const {connectionConfig}=require('./store');
async function advanceMembership({client,id,ledger,desired,persist}){
  let current=ledger.members||[];
  if(ledger.pending){
    const pending=ledger.pending;
    if(!pending.operationId){const result=await client.request(`custom_audiences/${encodeURIComponent(id)}/${pending.operation}`,'POST',pending.body,pending.key);if(!result.operation_id)throw Error('audience_operation_not_confirmed');pending.operationId=result.operation_id;await persist(ledger);}
    const result=await client.get(`custom_audiences/${encodeURIComponent(id)}/operations/${encodeURIComponent(pending.operationId)}`);
    if(result.status==='failed')throw Error('audience_operation_failed_requires_reconciliation');
    if(result.status!=='succeeded')return {pending:true};
    ledger.members=pending.resultMembers;ledger.pending=null;await persist(ledger);current=ledger.members;
  }
  const target=new Set(desired),existing=new Set(current),remove=current.filter(h=>!target.has(h)),add=desired.filter(h=>!existing.has(h));
  const operation=remove.length?'remove':add.length?'add':null;
  if(!operation)return {pending:false,eligible:desired.length,transmitted:0};
  const audience=await client.get('custom_audiences/'+encodeURIComponent(id));
  if(audience.status!=='ready')return {pending:true};
  const batch=(operation==='remove'?remove:add).slice(0,500),next=new Set(current);batch.forEach(h=>operation==='remove'?next.delete(h):next.add(h));
  ledger.pending={operation,key:crypto.randomUUID(),body:{expected_revision:audience.membership_revision,identifiers:batch.map(identifier=>({identifier_type:'email_sha256',identifier}))},resultMembers:[...next].sort()};
  await persist(ledger); // Durable original body and key before any external write.
  const result=await client.request(`custom_audiences/${encodeURIComponent(id)}/${operation}`,'POST',ledger.pending.body,ledger.pending.key);
  if(!result.operation_id)throw Error('audience_operation_not_confirmed');ledger.pending.operationId=result.operation_id;await persist(ledger);
  return {pending:true,eligible:desired.length,transmitted:batch.length};
}
async function syncChatgptAudiences({db,client,setup,accountId,providers,env}){
  const key=encryptionKey(env),rows=(await db.query('SELECT email,custom_attributes,additional_attributes FROM contacts WHERE account_id=$1',[Number(env.CHATWOOT_ACCOUNT_ID||2)])).rows;
  const connection=(await db.query("SELECT * FROM ecommerce_connections WHERE provider='woocommerce'")).rows[0];
  const config=await connectionConfig(db,connection,env),store=[];
  for(let page=1;page<=1000;page++){const {data}=await providers.bridge(config,'marketing-audience-customers',{page,per_page:100});if(!Array.isArray(data.customers)||data.complete_page!==true)throw Error('audience_source_incomplete');store.push(...data.customers);if(data.customers.length<100)break;if(page===1000)throw Error('audience_source_incomplete');}
  const since=shiftDay(saoPauloDay(),-180),paidIds=(await db.query(`SELECT record_id FROM ecommerce_records r WHERE provider='woocommerce' AND kind='order' AND data->>'paid'='true' AND data->>'paidDay'>=$1 AND NOT EXISTS(SELECT 1 FROM ecommerce_order_exclusions e WHERE e.order_id=r.record_id AND e.excluded) LIMIT 1001`,[since])).rows;
  if(paidIds.length>1000)throw Error('audience_paid_source_limit');
  const paidHashes=new Set();for(const row of paidIds){const {data:order}=await providers.woo(config,'orders/'+encodeURIComponent(row.record_id));const paid=normalizeOrder(order);if(paid.paid&&paid.paidDay>=since){const hash=emailHash(order.billing?.email,'chatgpt_ads');if(hash)paidHashes.add(hash);}}
  const lists=[];let pending=false;
  for(const mapping of Object.values(setup.resources||{}).filter(r=>r.id&&['store','crm'].includes(r.source))){
    const old=(await db.query("SELECT * FROM ecommerce_marketing_memberships WHERE platform='chatgpt_ads' AND destination=$1",[mapping.id])).rows[0],source=mapping.source+':'+mapping.segment;
    if(old&&(old.account!==accountId||old.source!==source))throw Error('audience_destination_collision');
    const ledger=old?{members:decrypt(old.members,key).hashes,pending:old.pending?decrypt(old.pending,key):null}:{members:[],pending:null};
    const persist=async value=>db.query(`INSERT INTO ecommerce_marketing_memberships(platform,destination,account,source,members,pending,state) VALUES('chatgpt_ads',$1,$2,$3,$4,$5,$6) ON CONFLICT(platform,destination) DO UPDATE SET members=EXCLUDED.members,pending=EXCLUDED.pending,state=EXCLUDED.state,updated_at=now()`,[mapping.id,accountId,source,encrypt({hashes:value.members},key),value.pending?encrypt(value.pending,key):null,value.pending?'processing':'submitted']);
    let desired=desiredMembers(mapping.source==='crm'?rows:store,{...mapping,platform:'chatgpt_ads'});if(mapping.source==='store')desired=desired.filter(hash=>paidHashes.has(hash));
    const result=await advanceMembership({client,id:mapping.id,ledger,desired,persist});pending=pending||result.pending;
    lists.push({id:mapping.id,source:mapping.source,segment:mapping.segment,eligible:desired.length,status:result.pending?'awaiting_external_processing':desired.length?'synchronized':'no_eligible_identifiers',matchedSize:null});
  }
  return {enabled:true,observedAt:new Date().toISOString(),lists,pending,crmEligible:rows.filter(r=>advertisingEligible(r)).length,containsIdentifiers:false};
}
module.exports={advanceMembership,syncChatgptAudiences};
