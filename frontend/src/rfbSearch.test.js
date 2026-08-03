import { fetchAllRfbSearchResults } from './rfbSearch';

const makeRows = (start, count) => Array.from({ length: count }, (_, index) => {
  const value = start + index;
  return {
    cnpj: String(value).padStart(14, '0'),
    capital_social: String(value),
  };
});

test('carrega todos os lotes da busca RFB sem limitar o total', async () => {
  const requestPage = jest.fn(async (params) => {
    const page = Number(params.get('page'));
    const batches = {
      1: { results: makeRows(1, 100), total: 101, progressive: true, has_more: true },
      2: { results: makeRows(101, 100), total: 201, progressive: true, has_more: true },
      3: { results: makeRows(201, 35), total: 235, progressive: false, has_more: false },
    };
    return batches[page];
  });

  const onBatch = jest.fn();
  const { results } = await fetchAllRfbSearchResults({
    baseParams: new URLSearchParams('nome=aerion'),
    orderBy: 'capital_desc',
    signal: new AbortController().signal,
    onBatch,
    requestPage,
  });

  expect(requestPage).toHaveBeenCalledTimes(3);
  expect(onBatch).toHaveBeenCalledTimes(3);
  expect(results).toHaveLength(235);
  expect(results[0].capital_social).toBe('235');
  expect(results[234].capital_social).toBe('1');

  const requestedPages = requestPage.mock.calls.map(([params]) => {
    expect(params.get('page_size')).toBe('100');
    return params.get('page');
  });
  expect(requestedPages).toEqual(['1', '2', '3']);
});

test('carrega todos os resultados por stream em uma única requisição', async () => {
  const requestPage = jest.fn();
  const requestStream = jest.fn(async (params, _signal, onMessage) => {
    expect(params.get('stream')).toBe('true');
    expect(params.get('order_by')).toBe('capital_desc');
    onMessage({ type: 'batch', results: makeRows(1, 250), total: 250 });
    onMessage({ type: 'batch', results: makeRows(251, 30), total: 280 });
  });
  const onBatch = jest.fn();

  const { results } = await fetchAllRfbSearchResults({
    baseParams: new URLSearchParams('uf=SP&cnae=8011101'),
    orderBy: 'capital_desc',
    signal: new AbortController().signal,
    onBatch,
    requestPage,
    requestStream,
  });

  expect(requestStream).toHaveBeenCalledTimes(1);
  expect(requestPage).not.toHaveBeenCalled();
  expect(onBatch).toHaveBeenCalledTimes(2);
  expect(results).toHaveLength(280);
  expect(results[0].capital_social).toBe('280');
  expect(results[279].capital_social).toBe('1');
});
