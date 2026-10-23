export function createPncpOpportunityPreview(item, profile = {}, focus = null) {
  return {
    id: null, // A preview is never a persisted opportunity or a target for autosave.
    titulo: item.titulo || 'Prévia do edital', orgao_nome: item.orgao?.nome || '',
    orgao_cnpj: item.orgao?.cnpj || '', numero_edital: item.numero_sequencial || '',
    numero_compra: item.numero_controle_pncp || '', uasg_codigo: item.unidade?.codigo || '',
    modalidade: item.modalidade?.nome || '', valor_oportunidade: item.valor_itens_pertinentes ?? item.valor_total_estimado ?? item.valor_global ?? 0,
    fase: '6. Monitoramento de Edital', status: /suspens/i.test(item.situacao?.nome || '') ? 'suspenso' : 'ativo',
    __preview: item, __profile: profile, __focus: focus,
  };
}
export function mergePncpItems(items = [], known = []) {
  const merged = new Map();
  for (const item of [...known,...items]) {
    const number = item.numeroItem ?? item.numero_item;
    if (number != null) merged.set(String(number),item);
  }
  return [...merged.values()];
}
export function pncpItemEstimatedTotal(item) {
  const positive=value=>value!=null && value!=='' && Number.isFinite(Number(value)) && Number(value)>0 ? Number(value) : null;
  const declared=positive(item.valor_total ?? item.valor_total_estimado ?? item.valorTotal ?? item.valorTotalEstimado);
  if(declared!=null)return Math.round(declared*100)/100;
  const quantity=positive(item.quantidade),unitPrice=positive(item.valor_referencia ?? item.valorUnitarioEstimado ?? item.valor_unitario_estimado);
  return quantity!=null && unitPrice!=null ? Math.round(quantity*unitPrice*100)/100 : null;
}
export function pncpInterestTotals(items=[]) {
  let cents=0,known=0;
  for(const item of items){const value=pncpItemEstimatedTotal(item);if(value!=null){cents+=Math.round(value*100);known++;}}
  return {total:known ? cents/100 : null,known,missing:items.length-known};
}
