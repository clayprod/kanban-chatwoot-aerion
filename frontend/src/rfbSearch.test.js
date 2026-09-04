import { fetchRfbSearchPage } from './rfbSearch';

const makeRows = (start, count) => Array.from({ length: count }, (_, index) => {
  const value = start + index;
  return {
    cnpj: String(value).padStart(14, '0'),
    capital_social: String(value),
  };
});

test('carrega somente a página solicitada da busca RFB', async () => {
  const requestPage = jest.fn(async () => ({
    results: makeRows(26, 25),
    total: 235,
    page: 2,
    page_size: 25,
    progressive: false,
    has_more: true,
    order_scope: 'page',
  }));

  const { results, meta } = await fetchRfbSearchPage({
    baseParams: new URLSearchParams('nome=aerion'),
    page: 2,
    pageSize: 25,
    orderBy: 'capital_desc',
    knownTotal: 235,
    signal: new AbortController().signal,
    requestPage,
  });

  expect(requestPage).toHaveBeenCalledTimes(1);
  const [params] = requestPage.mock.calls[0];
  expect(params.get('page')).toBe('2');
  expect(params.get('page_size')).toBe('25');
  expect(params.get('order_by')).toBe('capital_desc');
  expect(params.get('known_total')).toBe('235');
  expect(params.get('known_total_progressive')).toBe('false');
  expect(results).toHaveLength(25);
  expect(results[0].capital_social).toBe('50');
  expect(results[24].capital_social).toBe('26');
  expect(meta).toMatchObject({ total: 235, page: 2, page_size: 25, has_more: true });
});

test('preserva o total progressivo ao avançar sem buscar as demais páginas', async () => {
  const requestPage = jest.fn(async () => ({
    results: makeRows(51, 10),
    total: 61,
    page: 3,
    page_size: 25,
    progressive: true,
    has_more: true,
  }));

  const { results, meta } = await fetchRfbSearchPage({
    baseParams: new URLSearchParams('uf=SP&cnae=8011101'),
    page: 3,
    pageSize: 25,
    orderBy: 'razao_social',
    knownTotal: 51,
    knownTotalProgressive: true,
    requestPage,
  });

  expect(requestPage).toHaveBeenCalledTimes(1);
  const [params] = requestPage.mock.calls[0];
  expect(params.get('known_total')).toBe('51');
  expect(params.get('known_total_progressive')).toBe('true');
  expect(results).toHaveLength(10);
  expect(meta).toMatchObject({ total: 61, progressive: true, has_more: true });
});
