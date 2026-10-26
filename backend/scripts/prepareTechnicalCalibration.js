'use strict';
// Copies public procurement text only; never credentials, provider caches or usage.
const fs=require('fs'),path=require('path');
const input=process.argv[2] || 'backend/data/real-pilot-sources.json';
const selected=new Set(['18715565000110/2026/30','07954480000179/2026/26588','08079402000135/2026/63']);
const output=path.resolve(__dirname,'../tests/fixtures/technical-calibration');fs.mkdirSync(output,{recursive:true});
for(const n of JSON.parse(fs.readFileSync(input)).filter(n=>selected.has(n.key))){
 const data={id:String(n.id),key:n.key,title:n.title,items:n.items.map(i=>({numeroItem:i.numeroItem,descricao:i.descricao,quantidade:i.quantidade,unidadeMedida:i.unidadeMedida,valorUnitarioEstimado:i.valorUnitarioEstimado})),sources:n.sources.map(s=>({id:String(s.id),name:s.name,url:s.url,sha256:s.sha256,complete:s.complete,pages:s.pages.map(p=>({location:p.location,text:p.text}))}))};
 fs.writeFileSync(path.join(output,`${n.id}.json`),JSON.stringify(data,null,2)+'\n');console.log(`${n.id}: ${data.sources.reduce((n,s)=>n+s.pages.length,0)} páginas`);
}
