'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {isCreditError,measuredTokens,executionState}=require('../technicalExecutionPolicy');
test('OpenRouter insufficient funding and OpenAI credits are recognized without confusing capacity limits',()=>{
  assert.equal(isCreditError('openrouter:402 This request requires more credits, or fewer max_tokens'),true);
  assert.equal(isCreditError('openai:429 You have no credits remaining'),true);
  assert.equal(isCreditError('groq:429 rate limit reached'),false);
});
test('HTTP rejections release estimates, but uncertain transport outcomes do not pretend to have zero cost',()=>{
  for(const http_status of [400,401,402,403,404,413,422,429]) assert.equal(measuredTokens({ok:false,http_status}),0);
  assert.equal(measuredTokens({ok:false,error:'timeout'}),null);
  assert.equal(measuredTokens({ok:false,http_status:500}),null);
  assert.equal(measuredTokens({ok:false,http_status:200,usage:{total_tokens:42}}),42);
  assert.equal(measuredTokens({ok:true,usage:{total_tokens:123}}),123);
});
test('paused, blocked and waiting analyses cannot be presented as running; completed results survive pause',()=>{
  const queued={kind:'notice',status:'queued'};
  assert.equal(executionState(queued,{enabled:false}).execution_status,'paused');
  assert.equal(executionState(queued,{enabled:true,provider_error:'openrouter:402 insufficient credits'}).execution_status,'blocked');
  assert.equal(executionState({...queued,error:'Documento indisponível'},{enabled:true}).execution_status,'waiting');
  assert.equal(executionState(queued,{enabled:true}).execution_status,'queued');
  assert.deepEqual(executionState({...queued,status:'completed'},{enabled:false}),{});
});
