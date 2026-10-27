'use strict';const test=require('node:test'),assert=require('node:assert/strict');const {rejectedBeforeGeneration}=require('../aiProviderAvailability');const {loadProspectingProfiles}=require('../prospectingProfiles');
test('only confirmed non-generating HTTP rejections can leave the provider cooldown; unknown charges and delivery failures never qualify',()=>{
 assert.equal(rejectedBeforeGeneration('openrouter:402 Insufficient credits'),true);assert.equal(rejectedBeforeGeneration('openai:429 no credits | groq:404 model unavailable | openrouter:402 insufficient credits',{legacy:true}),true);
 for(const error of ['openrouter:timeout','Chatwoot HTTP 500','openrouter:JSON parse fail','openrouter:402 no credits | groq:timeout','openrouter:500 upstream'])assert.equal(rejectedBeforeGeneration(error),false);
 assert.equal(rejectedBeforeGeneration('openai:429 no credits | groq:404 model unavailable',{legacy:true}),false);
});
test('active prospecting reuses sanitized recent sector profiles when nobody has opened today’s Radar; it never requests a paid refresh',async()=>{
 const profiles=[{titulo:'Energia',filters:{cnae:['1234567'],uf:'SP'}}];let reads=0,sanitized=0;
 const dependencies={readToday:async()=>null,pool:{query:async()=>{reads++;return{rows:[{intel_json:{suggestions:profiles},trends_json:[],meta_json:{source:'sector'}}]};}},sourceAllowed:source=>source==='sector',sanitize:async intel=>{sanitized++;return intel;}};
 assert.deepEqual(await loadProspectingProfiles(dependencies),[{titulo:'Energia',filtros:profiles[0].filters}]);assert.equal(reads,1);assert.equal(sanitized,1);
 assert.deepEqual(await loadProspectingProfiles({...dependencies,readToday:async()=>({intel:{suggestions:profiles}})}),[{titulo:'Energia',filtros:profiles[0].filters}]);assert.equal(reads,1);
});
