'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {splitMappingTask,mergeMappings}=require('../technicalMapping');
const {requestExceedsCapacity}=require('../technicalAiFormat');
test('splitting large requests retains every requirement/specification pair',()=>{
 const requirements=Array.from({length:21},(_,i)=>({id:`r${i}`,quote:'A'.repeat(100)}));
 const specifications=Array.from({length:93},(_,i)=>({id:`s${i}`,quote:'B'.repeat(200)}));
 const tasks=[{requirements,specifications}],done=[];
 while(tasks.length){const task=tasks.shift();if(JSON.stringify(task).length>1500)tasks.push(...splitMappingTask(task));else done.push(task);}
 const pairs=new Set(done.flatMap(t=>t.requirements.flatMap(r=>t.specifications.map(s=>`${r.id}:${s.id}`))));
 assert.equal(pairs.size,21*93);
 assert.equal(done.reduce((n,t)=>n+t.requirements.length*t.specifications.length,0),21*93);
});
test('subrequests union valid correspondences instead of keeping only the first response',()=>{
 const r=[{id:'r'}],a=[{id:'a'}],b=[{id:'b'}];
 let result=mergeMappings([],[{requirement_id:'r',spec_ids:['a'],same_metric:true}],r,a);
 result=mergeMappings(result,[{requirement_id:'r',spec_ids:['b'],same_metric:true}],r,b);
 assert.deepEqual(result[0].spec_ids,['a','b']);
 result=mergeMappings(result,[{requirement_id:'r',spec_ids:['invented'],same_metric:true}],r,b);
 assert.deepEqual(result[0].spec_ids,['a','b']);
});
test('empty or uncertain mappings never grant metric equivalence',()=>{
 assert.deepEqual(mergeMappings([],[{requirement_id:'r',spec_ids:['a'],same_metric:false}],[{id:'r'}],[{id:'a'}]),[]);
 assert.equal(splitMappingTask({requirements:[{id:'r'}],specifications:[{id:'s'}]}),null);
});
test('oversized requests are split while a temporarily consumed rate budget is retried later',()=>{
 assert.equal(requestExceedsCapacity(413,'Request too large'),true);
 assert.equal(requestExceedsCapacity(429,'Limit 8,000, Used 1,000, Requested 9,000'),true);
 assert.equal(requestExceedsCapacity(429,'Limit 8,000, Used 7,000, Requested 3,000'),false);
 assert.equal(requestExceedsCapacity(429,'Rate limit reached'),false);
});
