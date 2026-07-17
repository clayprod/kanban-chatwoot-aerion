const countItemsInStages = (items, stages, getStage) => {
  if (!Array.isArray(items) || typeof getStage !== 'function') return 0;

  const allowedStages = new Set(stages || []);
  return items.reduce(
    (total, item) => total + (allowedStages.has(getStage(item)) ? 1 : 0),
    0
  );
};

export const countOpenFunnelLeads = (contacts, leadStages) => (
  countItemsInStages(
    contacts,
    (leadStages || []).slice(0, 12),
    contact => contact?.custom_attributes?.Funil_Vendas
  )
);

export const countOperationalLicitacoes = (opportunities, licitacaoStages) => (
  countItemsInStages(
    opportunities,
    (licitacaoStages || []).slice(1, 12),
    opportunity => opportunity?.fase
  )
);

export const getNewEditalSignalsCount = stats => (
  Math.max(0, Number(stats?.novo) || 0)
);

/** Contagem do badge do menu Busca Editais: pesquisas correntes (jobs PNCP). */
export const getCurrentPncpSearchJobsCount = jobsOrCount => {
  if (Array.isArray(jobsOrCount)) return Math.max(0, jobsOrCount.length);
  return Math.max(0, Number(jobsOrCount) || 0);
};
