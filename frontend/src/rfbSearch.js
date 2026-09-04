const DEFAULT_RFB_PAGE_SIZE = 25;

const rfbCapitalValue = (row) => {
  const value = Number(String(row?.capital_social ?? '').replace(',', '.'));
  return Number.isFinite(value) ? value : 0;
};

export const sortRfbSearchResults = (rows, orderBy) => {
  const compareText = (left, right) => String(left || '').localeCompare(String(right || ''), 'pt-BR');
  const comparators = {
    razao_social: (a, b) => compareText(a.razao_social, b.razao_social),
    nome_fantasia: (a, b) => compareText(a.nome_fantasia, b.nome_fantasia),
    uf: (a, b) => compareText(a.uf, b.uf),
    situacao: (a, b) => compareText(a.situacao_cadastral, b.situacao_cadastral),
    capital_desc: (a, b) => rfbCapitalValue(b) - rfbCapitalValue(a),
    capital_asc: (a, b) => rfbCapitalValue(a) - rfbCapitalValue(b),
    abertura_desc: (a, b) => compareText(b.data_de_inicio_da_atividade, a.data_de_inicio_da_atividade),
    abertura_asc: (a, b) => compareText(a.data_de_inicio_da_atividade, b.data_de_inicio_da_atividade),
  };
  const compare = comparators[orderBy] || comparators.capital_desc;
  return [...rows].sort((a, b) => compare(a, b) || compareText(a.cnpj, b.cnpj));
};

/**
 * Loads exactly one server-side page. The RFB dataset has tens of millions of
 * rows, so accumulating every page in the browser makes broad searches grow
 * without bound in network traffic, memory and DOM size.
 */
export const fetchRfbSearchPage = async ({
  baseParams,
  page = 1,
  pageSize = DEFAULT_RFB_PAGE_SIZE,
  orderBy = 'capital_desc',
  knownTotal,
  knownTotalProgressive = false,
  signal,
  requestPage,
}) => {
  const normalizedPage = Math.max(1, Number.parseInt(page, 10) || 1);
  const normalizedPageSize = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || DEFAULT_RFB_PAGE_SIZE));
  const params = new URLSearchParams(baseParams);
  params.set('page', String(normalizedPage));
  params.set('page_size', String(normalizedPageSize));
  params.set('order_by', orderBy);

  const parsedKnownTotal = Number(knownTotal);
  if (knownTotal !== '' && knownTotal != null && Number.isFinite(parsedKnownTotal) && parsedKnownTotal >= 0) {
    params.set('known_total', String(parsedKnownTotal));
    params.set('known_total_progressive', knownTotalProgressive ? 'true' : 'false');
  }

  const responseData = await requestPage(params, signal);
  const results = Array.isArray(responseData?.results) ? responseData.results : [];

  return {
    results: sortRfbSearchResults(results, orderBy),
    meta: {
      ...(responseData || {}),
      page: Number(responseData?.page) || normalizedPage,
      page_size: Number(responseData?.page_size) || normalizedPageSize,
    },
  };
};
