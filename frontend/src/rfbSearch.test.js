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
