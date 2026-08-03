const RFB_SEARCH_BATCH_SIZE = 100;

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

export const fetchAllRfbSearchResults = async ({ baseParams, orderBy, signal, onBatch, requestPage, requestStream }) => {
  const allResults = [];
  const seenCnpjs = new Set();
  const pageSignatures = new Set();
  let page = 1;
  let knownTotal = null;
  let knownTotalProgressive = false;
  let lastMeta = {};

  const addBatch = (responseData) => {
    const pageResults = Array.isArray(responseData?.results) ? responseData.results : [];
    pageResults.forEach((row) => {
      const key = row?.cnpj || `${row?.cnpj_basico || ''}:${row?.cnpj_ordem || ''}`;
      if (key && seenCnpjs.has(key)) return;
      if (key) seenCnpjs.add(key);
      allResults.push(row);
    });
    lastMeta = responseData || {};
    onBatch?.([...allResults], lastMeta);
    return pageResults;
  };

  if (requestStream) {
    const params = new URLSearchParams(baseParams);
    params.set('order_by', orderBy);
    params.set('stream', 'true');
    await requestStream(params, signal, addBatch);
    return {
      results: sortRfbSearchResults(allResults, orderBy),
      meta: lastMeta,
    };
  }

  while (true) {
    const params = new URLSearchParams(baseParams);
    params.set('page', page);
    params.set('page_size', RFB_SEARCH_BATCH_SIZE);
    params.set('order_by', orderBy);
    if (knownTotal != null) {
      params.set('known_total', knownTotal);
      params.set('known_total_progressive', knownTotalProgressive ? 'true' : 'false');
    }

    const responseData = await requestPage(params, signal);
    const pageResults = Array.isArray(responseData?.results) ? responseData.results : [];
    const hasMore = Boolean(responseData?.has_more);
    const signature = pageResults.length > 0
      ? `${pageResults.length}:${pageResults[0]?.cnpj || ''}:${pageResults[pageResults.length - 1]?.cnpj || ''}`
      : `empty:${page}`;

    if (hasMore && pageSignatures.has(signature)) {
      throw new Error('A busca repetiu o mesmo lote e foi interrompida para evitar resultados duplicados. Tente novamente.');
    }
    pageSignatures.add(signature);

    addBatch(responseData);
    knownTotal = Number(responseData?.total) || allResults.length;
    knownTotalProgressive = Boolean(responseData?.progressive);

    if (!hasMore || pageResults.length === 0) break;
    page += 1;
  }

  return {
    results: sortRfbSearchResults(allResults, orderBy),
    meta: lastMeta,
  };
};
