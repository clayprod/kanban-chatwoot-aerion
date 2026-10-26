'use strict';
const fs=require('fs'),path=require('path');
const {hash}=require('../technicalRules');
const {build}=require('../tests/fixtures/technical-calibration/golden');
const {literalEvidenceQuote}=require('../technicalExtraction');
const reviews=['362510','362554','362729'].map(id=>{
 const g=build(id),n=g.notice;
 const conflicts=[];
 if(id==='362729'){
  const s=n.sources.find(s=>s.id==='52'),page=s.pages[14];
  conflicts.push({item_numbers:['1','2'],source_id:'52',location:page.location,quote:literalEvidenceQuote('VELOCIDADE CRUZEIRO: ATE 21 MIN',page.text),message:'A tabela usa MIN para velocidade, enquanto a ficha técnica informa 21 m/s. Possível erro de digitação; unidade mantida como pendência, sem correção presumida.'});
 }
 return {notice_key:n.key,revision:'document-review-2026-10-26-v2',reviewed_by:'Codex — revisão das fontes, sem OpenRouter',reviewed_at:'2026-10-26',items:n.items,sources:n.sources.map(s=>({original_id:s.id,name:s.name,text_hash:hash(s.pages.map(p=>p.text).join('\n')),pages:s.pages.length})),facts:g.facts.map(({anchor,...f})=>({...f,section:['supply','administrative'].includes(f.category)?'Fornecimento e documentação':f.category==='kit'?'Kit e acessórios':f.component==='controller'?'Controle remoto':f.component==='battery'?'Bateria':/camera/.test(f.component)?'Sistema de câmeras':'Características técnicas'})),conflicts};
});
const target=path.resolve(__dirname,'../data/aerionReviewedNotices.json');fs.writeFileSync(target,JSON.stringify({reviews},null,2)+'\n');console.log(`${reviews.length} editais, ${reviews.reduce((n,r)=>n+r.facts.length,0)} exigências e obrigações conferidas`);
