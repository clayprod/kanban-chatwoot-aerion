'use strict';
// Read the exact local site variants; never mutate the shop or its database.
const fs=require('fs');const path=require('path');
const {canonicalCatalog}=require('../aerionCatalogModel');
const {flattenSpecifications}=require('../structuredSpecifications');
const root=process.argv[2];if(!root)throw Error('Informe a pasta do site Aerion.');
const catalog=require('../data/aerionCatalog.json');
const reviewed=require('../data/aerionReviewedSpecifications.json');
const institutional=JSON.parse(fs.readFileSync(path.join(root,'wordpress/wp-content/plugins/aerion-core/data/institutional-products.json'),'utf8')).products;
const mapping={'102003505':['evo-max-v2','4t'],'901030260':['autel-alpha','alpha'],'102002996':['evo-lite-enterprise','6k'],'102002930':['evo-lite-enterprise','640t'],'EVO-NEST':['evo-nest','standard'],'901030202':['autel-mapper','autel-mapper']};
const result=canonicalCatalog(catalog).filter(p=>p.product_type!=='accessory').map(product=>{
  const selected=mapping[product.sku];const family=selected && Object.values(institutional).find(p=>p.slug===selected[0]);const variant=family?.variants.find(v=>v.id===selected[1]);
  const specifications=variant?.specs || product.specifications || {};
  const rows=flattenSpecifications(specifications);
  // Footnotes remain alongside all rows in their section, rather than being lost.
  for(const row of rows){
    if(!row.label.includes('*'))continue;
    const topic=/tempo.*voo/i.test(row.label)?'tempo voo':/pairar/i.test(row.label)?'pairar':/velocidade/i.test(row.label)?'velocidade':/altitude/i.test(row.label)?'altitude':/dist[aâ]ncia/i.test(row.label)?'distância':null;
    const notes=rows.filter(r=>r.section===row.section && /^nota\b/i.test(r.label) && (!topic || r.label.toLowerCase().includes(topic)));
    if(notes.length)row.note=notes.map(r=>`${r.label}: ${r.value}`).join('\n');
  }
  return {sku:product.sku,source_key:product.source_key,name:product.name,source_url:product.source_url,variant:variant?.name || product.name,rows,...(reviewed[product.sku] || {})};
});
fs.writeFileSync(path.join(__dirname,'../data/aerionTechnicalSpecifications.json'),JSON.stringify({verified_at:new Date().toISOString(),products:result},null,2)+'\n');
console.log(JSON.stringify(result.map(p=>({name:p.name,rows:p.rows.length}))));
