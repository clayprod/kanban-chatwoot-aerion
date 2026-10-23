import { readPncpPage, pncpPageUrl } from './pncpNavigation';
test('notice deep link round trips identity and focus without dropping unrelated parameters', () => {
  const page={job:'job-1',result:'18715565000110-1-000030/2026',item:'2',product:'9'};
  const url=pncpPageUrl(page,'https://app.test/?other=value');
  expect(readPncpPage(new URL(url,'https://app.test').search)).toEqual(page);
  expect(url).toContain('other=value');
  expect(pncpPageUrl({},'https://app.test'+url)).toBe('/?other=value');
});
