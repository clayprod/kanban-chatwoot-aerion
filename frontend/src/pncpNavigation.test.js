import { readPncpPage, pncpPageUrl, readPipelinePage, pipelinePageUrl } from './pncpNavigation';
test('notice deep link round trips identity and focus without dropping unrelated parameters', () => {
  const page={job:'job-1',result:'18715565000110-1-000030/2026',item:'2',product:'9'};
  const url=pncpPageUrl(page,'https://app.test/?other=value');
  expect(readPncpPage(new URL(url,'https://app.test').search)).toEqual(page);
  expect(url).toContain('other=value');
  expect(pncpPageUrl({},'https://app.test'+url)).toBe('/?other=value');
});
test('pipeline deep link and search preview routes cannot override each other',()=>{
  const url=pipelinePageUrl('42','https://app.test/?pncp_job=job&pncp_result=notice&other=x');
  expect(readPipelinePage(new URL(url,'https://app.test').search)).toBe('42');
  expect(readPncpPage(new URL(url,'https://app.test').search).job).toBeNull();
  expect(pncpPageUrl({job:'job'},'https://app.test'+url)).not.toContain('licitacao');
  expect(readPipelinePage('?licitacao=invalid')).toBeNull();
});
