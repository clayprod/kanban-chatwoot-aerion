const{test}=require('node:test'),assert=require('node:assert/strict');
const{advanceMembership}=require('../ecommerce/chatgptAudiences');
test('audience sync persists the original hashed request before sending, retries the same key and waits before adding after removals',async()=>{
 const ledger={members:['removed'],pending:null},saved=[],requests=[];let fail=true;
 const client={get:async path=>path.includes('/operations/')?{status:'succeeded'}:{status:'ready',membership_revision:2},request:async(path,method,body,key)=>{assert(saved.length>0);assert.equal(method,'POST');requests.push({path,body,key});if(fail){fail=false;throw Error('lost_response');}return{operation_id:'operation'};}};
 const persist=async value=>saved.push(structuredClone(value));
 await assert.rejects(advanceMembership({client,id:'aud',ledger,desired:['added'],persist}),/lost_response/);
 assert(requests[0].path.endsWith('/remove'));assert.equal(requests[0].body.identifiers[0].identifier_type,'email_sha256');
 await advanceMembership({client,id:'aud',ledger,desired:['added'],persist});
 assert.equal(requests[0].key,requests[1].key);assert.deepEqual(requests[0].body,requests[1].body);
 assert(requests[2].path.endsWith('/add'));assert.notEqual(requests[1].key,requests[2].key);assert.deepEqual(ledger.members,[]);
});
test('no eligible identifiers makes no external membership request and an in-flight operation cannot be replaced',async()=>{
 let writes=0;const client={request:async()=>{writes++;throw Error('unexpected mutation')},get:async()=>({status:'processing'})};
 const empty=await advanceMembership({client,id:'aud',ledger:{members:[],pending:null},desired:[],persist:async()=>{}});assert.equal(empty.pending,false);assert.equal(writes,0);
 const processing=await advanceMembership({client,id:'aud',ledger:{members:[],pending:{operationId:'inflight',resultMembers:['old']}},desired:['different'],persist:async()=>{}});assert.equal(processing.pending,true);assert.equal(writes,0);
});
