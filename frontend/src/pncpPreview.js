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
