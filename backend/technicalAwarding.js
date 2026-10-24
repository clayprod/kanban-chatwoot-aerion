'use strict';
const text=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[ \t]+/g,' ');
function awardingMode(sources,items){
  if(items.length===1)return 'item';
  const content=text(sources.map(s=>(s.pages || []).map(p=>p.text).join('\n')).join('\n'));
  const modes=[];
  if(/(?:criterio de julgamento|julgamento|menor preco)[^.;\n]{0,75}\bpor item\b/.test(content))modes.push('item');
  if(/(?:criterio de julgamento|julgamento|menor preco)[^.;\n]{0,75}\b(?:global|lote unico)\b/.test(content))modes.push('global');
  if(/(?:criterio de julgamento|julgamento|menor preco)[^.;\n]{0,75}\bpor lote\b/.test(content))modes.push('lot');
  return new Set(modes).size===1?modes[0]:'unconfirmed';
}
function fullAwardable(items,item){
  const full=i=>i.documents_complete!==false && i.products?.some(p=>p.status==='full' && p.evidence_current!==false);
  if(!full(item))return false;
  if(!item.awarding_mode || item.awarding_mode==='item')return true;
  if(item.awarding_mode==='lot' && item.lot_number!=null)return items.filter(i=>String(i.lot_number)===String(item.lot_number)).every(full);
  return items.every(full);
}
module.exports={awardingMode,fullAwardable};
