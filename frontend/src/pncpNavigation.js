const keys = ['pncp_job', 'pncp_result', 'pncp_item', 'pncp_product'];
export function readPncpPage(search = window.location.search) {
  const p = new URLSearchParams(search);
  return { job: p.get('pncp_job'), result: p.get('pncp_result'), item: p.get('pncp_item'), product: p.get('pncp_product') };
}
export function pncpPageUrl(page, href = window.location.href) {
  const url = new URL(href);
  keys.forEach(key => url.searchParams.delete(key));
  ['job', 'result', 'item', 'product'].forEach(key => { if (page[key] != null) url.searchParams.set(`pncp_${key}`, String(page[key])); });
  return `${url.pathname}${url.search}${url.hash}`;
}
