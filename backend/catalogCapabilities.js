'use strict';
const reviews=require('./data/aerionCapabilityReviews.json');
function capabilityRows(sku){
 const p=reviews.products.find(p=>p.sku===sku);if(!p)return [];
 const section='Capacidades conferidas · revisão documental';
 const rows=[
  {section,label:'Uso profissional',value:p.professional_supported===false?p.application:`Uso profissional — ${p.application}`,source_url:p.application_source,note:`${p.application_note || 'Classificação qualitativa revisada a partir das aplicações documentadas.'} Fonte: ${p.application_source}. Não constitui certificação nem aprovação de aplicação específica.`},
  {section,label:'Longo alcance',value:`Longo alcance — ${p.range}`,source_url:p.range_source,note:`Classificação qualitativa revisada do enlace publicado. Fonte: ${p.range_source}. O edital não define distância mínima neste rótulo; qualquer distância especificada é comparada separadamente.`},
 ];
 if(p.rth_source)rows.push({section,label:'Retorno automático (RTH)',value:'Return to Home (RTH)',source_url:p.rth_source,note:`Conferência: ${p.rth_location}. Trecho: ${p.rth_quote}. Fonte: ${p.rth_source}`});
 return rows;
}
module.exports={capabilityRows};
