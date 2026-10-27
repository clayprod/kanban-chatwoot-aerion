'use strict';
// Explicit declaration by Aerion's owner, 2026-10-27. This is a supplier
// commitment, not a claim extracted from a manufacturer's technical manual.
const normalize=v=>String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
function newAircraftEvidence(product,requirement){
 if(Number(product.account_id)!==2||product.product_type==='accessory')return null;
 const aircraft=normalize(product.category)==='drones'||(product.specs || []).some(s=>['flight_time','hover_time','takeoff_weight'].includes(s.key));
 if(!aircraft||!['equipment_condition','product_condition','new_equipment'].includes(requirement.key))return null;
 const simple=v=>normalize(v).replace(/[,.;]/g,' ').replace(/\b(?:novos?|novas?|sem uso(?: anterior)?|de primeiro uso|primeiro uso|e)\b/g,'').trim();
 if(!requirement.value||simple(requirement.value)||simple(requirement.conditions))return null;
 return {id:'aerion-new-aircraft',source_id:'policy:aerion:new-aircraft:2026-10-27',location:'Política de fornecimento Aerion · declaração de 27/10/2026',key:'equipment_condition',kind:'categorical',value:'Novo, sem uso',quote:'A Aerion fornece seus drones sempre novos, sem uso. Condição declarada pelo responsável em 27/10/2026.',supplier_declaration:true};
}
module.exports={newAircraftEvidence};
