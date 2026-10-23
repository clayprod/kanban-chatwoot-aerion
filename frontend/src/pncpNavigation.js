const keys = ['pncp_job', 'pncp_result', 'pncp_item', 'pncp_product'];
export function readPncpPage(search = window.location.search) {
  const p = new URLSearchParams(search);
  return { job: p.get('pncp_job'), result: p.get('pncp_result'), item: p.get('pncp_item'), product: p.get('pncp_product') };
}
export function pncpPageUrl(page, href = window.location.href) {
  const url = new URL(href);
  url.searchParams.delete('licitacao');
  keys.forEach(key => url.searchParams.delete(key));
  ['job', 'result', 'item', 'product'].forEach(key => { if (page[key] != null) url.searchParams.set(`pncp_${key}`, String(page[key])); });
  return `${url.pathname}${url.search}${url.hash}`;
}
export function readPipelinePage(search = window.location.search) {
  const id = new URLSearchParams(search).get('licitacao');
  return /^\d+$/.test(id || '') ? id : null;
}
export function pipelinePageUrl(id, href = window.location.href) {
  const url = new URL(pncpPageUrl({}, href), href);
  if (id) url.searchParams.set('licitacao',String(id));
  return `${url.pathname}${url.search}${url.hash}`;
}
