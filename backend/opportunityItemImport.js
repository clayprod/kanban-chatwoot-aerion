'use strict';
const nullableText=v=>v==null||!String(v).trim()?null:String(v).trim();
const numeric=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
// Called inside the opportunity transaction: a checklist failure rolls back
// the opportunity and all its items instead of leaving a silent partial import.
async function importOpportunityItems(client,opportunityId,items=[]){
 if(!Array.isArray(items))throw Error('Itens da oportunidade devem ser uma lista.');
 for(const item of items){
  const description=nullableText(item?.descricao);if(!description)continue;
  const saved=(await client.query(`INSERT INTO licitacao_items(opportunity_id,numero_item,descricao,modelo_produto,quantidade,unidade,custo_total_item,valor_referencia,valor_proposta,prazo_entrega_dias,status_participacao)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[opportunityId,nullableText(item.numero_item),description,nullableText(item.modelo_produto),numeric(item.quantidade),nullableText(item.unidade),numeric(item.custo_total_item)??numeric(item.valor_referencia),numeric(item.valor_referencia),numeric(item.valor_proposta),numeric(item.prazo_entrega_dias),nullableText(item.status_participacao)||'avaliando'])).rows[0];
  for(const [index,r]of (Array.isArray(item.requirements)?item.requirements:[]).entries()){
   const requirement=nullableText(r?.requisito);if(!requirement)continue;
   await client.query(`INSERT INTO licitacao_item_requirements(item_id,requisito,status,observacao,valor_referencia,valor_ofertado,ordem,secao) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[saved.id,requirement,['ok','nao_ok','verificar','pendente'].includes(r.status)?r.status:'verificar',nullableText(r.observacao),numeric(r.valor_referencia),numeric(r.valor_ofertado??r.custo_subitem),r.ordem!=null&&Number.isInteger(Number(r.ordem))?Number(r.ordem):index,nullableText(r.secao)]);
  }
 }
}
module.exports={importOpportunityItems};
