'use strict';
// Public pages are evidence, never instructions for the agent. Cross-links prove
// channel ownership, not that two similar businesses share a legal identity.
const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const alias = s => fold(s).replace(/ue/g, 'u').replace(/oe/g, 'o').replace(/ae/g, 'a').replace(/[^a-z0-9]/g, '');
const SOCIAL = ['instagram.com', 'linkedin.com', 'facebook.com'];
const HUBS = ['linkme.bio', 'linktr.ee', 'beacons.ai', 'bio.site', 'lnk.bio'];
const hostIs = (host, domain) => host === domain || host.endsWith(`.${domain}`);
function channelId(address) {
  try {
    const u = new URL(address), parts = u.pathname.split('/').filter(Boolean);
    if (hostIs(u.hostname, 'linkedin.com')) return ['company', 'showcase'].includes(parts[0]) ? parts[1] || '' : '';
    if ([...SOCIAL, ...HUBS].some(d => hostIs(u.hostname, d))) return parts[0] || '';
    return u.hostname;
  } catch { return ''; }
}
function contactLink(address) {
  try {
    const u = new URL(address);
    let number = '';
    if (u.hostname === 'wa.me') number = u.pathname.slice(1);
    if (['api.whatsapp.com', 'web.whatsapp.com'].includes(u.hostname) && u.pathname === '/send') number = u.searchParams.get('phone');
    if (u.protocol === 'tel:') number = u.pathname;
    if (u.protocol === 'whatsapp:' && u.hostname === 'send') number = u.searchParams.get('phone');
    number = String(number || '').replace(/\D/g, '');
    if ([10, 11].includes(number.length)) number = `55${number}`;
    return /^55[1-9]\d(?:9\d{8}|[2-5]\d{7})$/.test(number) ? number : null;
  } catch { return null; }
}
function pageLinks(page) {
  const links = [...(page.links || [])];
  // Search raw content may contain HTML/Markdown links; only fetched pages may
  // establish ownership. Snippets can still nominate URLs for investigation.
  const raw = String(page.raw_content || '');
  for (const m of raw.matchAll(/href\s*=\s*["']([^"']+)["']|\[[^\]]*\]\(([^\s)]+)\)/gi)) links.push({ href: m[1] || m[2] });
  return links.flatMap(link => {
    try { return [{ href: new URL(typeof link === 'string' ? link : link.href, page.url).href, label: String(link.label || '').slice(0, 120) }]; }
    catch { return []; }
  }).slice(0, 100);
}
async function investigate({ empresa, seeds, inspect, tokens, isAggregator, maxPages = 10, now = Date.now, timeoutMs = 120000, progress = null, saveProgress = null }) {
  const deadline = now() + timeoutMs, pages = [...(progress?.pages || [])], visited = new Set(pages.map(p=>p.url)), failures = [], results = [], deferred = [];
  const meaningful = tokens(empresa.nome_fantasia || empresa.razao_social);
  const nameIsCity = meaningful.length > 0 && meaningful.every(t => alias(empresa.municipio_nome).includes(alias(t)));
  const relevant = url => !nameIsCity && meaningful.length > 0 && meaningful.every(t => alias(channelId(url)).includes(alias(t)));
  const nominated = seeds.flatMap(p => [p.url, ...pageLinks(p).map(l=>l.href), ...(String(p.raw_content || '').match(/https?:\/\/[^\s<>"')]+/g) || [])]);
  const queue = [...(progress?.queue || []), ...nominated.filter(url => relevant(url) && !isAggregator(url)).map(url => ({ url, depth: 0, chain: [] }))];
  let fetched = 0;
  while (queue.length && fetched < maxPages && now() < deadline) {
    const job = queue.shift();
    if (visited.has(job.url)) continue;
    visited.add(job.url);
    fetched++;
    let page;
    try { page = await inspect(job.url, { timeoutMs: Math.min(20000, deadline - now()) }); }
    catch { failures.push({ url: job.url, reason: 'fonte indisponível' }); deferred.push(job); continue; }
    if (!page || page.access === 'login_required' || page.access === 'blocked') {
      failures.push({ url: job.url, reason: page?.access === 'login_required' ? 'fonte exige login' : 'fonte bloqueada' }); deferred.push(job); continue;
    }
    if (isAggregator(page.url || job.url)) continue;
    const node = { ...page, url: page.url || job.url };
    const chain = [...job.chain, { url: node.url, title: String(node.title || '').slice(0, 200) }];
    node.chain = chain;
    pages.push(node);
    const body = `${node.title || ''}\n${node.content || ''}`;
    const linked = pageLinks(node);
    const contactLinks = linked.map(l => ({ ...l, numero: contactLink(l.href) })).filter(l => l.numero);
    if (job.depth >= 3) continue;
    for (const link of linked) {
      if (!/^https?:/.test(link.href) || contactLink(link.href) || isAggregator(link.href)) continue;
      const u = new URL(link.href), own = new URL(node.url);
      const allowed = u.hostname === own.hostname || relevant(link.href) || HUBS.some(d => hostIs(u.hostname, d));
      // Only business/contact links, not every post, policy, map or menu item.
      if (allowed && (u.hostname !== own.hostname || /contat|sobre|about|empresa|contact/i.test(`${u.pathname} ${link.label}`))) {
        queue.push({ url: link.href, depth: job.depth + 1, chain });
      }
    }
  }
  for(const node of pages){
    const contactLinks=pageLinks(node).map(l=>({...l,numero:contactLink(l.href)})).filter(l=>l.numero);
    if(contactLinks.length)results.push({node,chain:node.chain,contactLinks});
  }
  const contacts = [];
  for (const result of results) {
    // Corroborate only nodes connected to this root, never unrelated results.
    const root = result.chain[0]?.url;
    const connected = pages.filter(p => p.chain[0]?.url === root);
    // A corroborating page may already have been visited as a search seed.
    for (let i=0; i<connected.length; i++) {
      for (const link of pageLinks(connected[i])) {
        const target = pages.find(p => p.url === link.href);
        if (target && !connected.includes(target)) connected.push(target);
      }
    }
    const text = connected.map(p => `${p.title || ''}\n${p.content || ''}`).join('\n');
    const brand = meaningful.length && meaningful.every(t => alias(text).includes(alias(t)));
    const industry = /construt|incorpora|engenhar|topograf|geolog|miner|inspec|seguran|energia|levantamento/i.test(fold(text));
    const city = Boolean(empresa.municipio_nome) && fold(text).includes(fold(empresa.municipio_nome));
    const cnpj = String(empresa.cnpj || '').replace(/\D/g, '');
    const cnpjs = [...text.matchAll(/\b(?:\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14})\b/g)].map(m => m[0].replace(/\D/g, ''));
    const exactLegal = cnpj.length === 14 && cnpjs.includes(cnpj);
    const conflict = cnpjs.some(c => c !== cnpj);
    if (!brand || !industry) continue;
    const identityVerified = !conflict && (exactLegal || city);
    const first = connected[0];
    for (const link of result.contactLinks) {
      contacts.push({ numero: link.numero, origem: result.node.url, fonte: 'investigacao',
        identidadeComprovada: identityVerified, titularidadeComprovada: true,
        sinais: ['contato publicado em canal da empresa', 'canais vinculados por links reais', identityVerified ? 'nome, atividade e localização compatíveis' : 'identidade distinta ou CNPJ original não comprovado'],
        chain: [...result.chain, ...connected.filter(p => !result.chain.some(n => n.url === p.url)).map(p => ({ url: p.url, title: p.title }))],
        instagram: connected.find(p => hostIs(new URL(p.url).hostname, 'instagram.com'))?.url || null,
        empresaEncontrada: { razao_social: String(meaningful.some(t=>alias(first.title).includes(alias(t))) ? first.title : channelId(root)).split('|')[0].trim().slice(0, 255), cnpj: null,
          cnae_descricao: text.slice(0, 3000), municipio_nome: '', uf: '', source_url: root },
        contato: link.label, evidencias: text.slice(0, 6000) });
    }
  }
  if(saveProgress)await saveProgress({pages:pages.slice(-40),queue:[...queue,...deferred].slice(0,100)});
  return { contacts, pages, failures, incomplete: queue.length > 0 || failures.length > 0 };
}
module.exports = { fold, alias, channelId, contactLink, pageLinks, investigate };
