// Busca no Google com Chromium headless, em container separado do kanban.
//
// Reserva do Places/Tavily: um navegador persistente, imagens/CSS/fontes bloqueados (o
// Google devolve o texto que importa no HTML), uma consulta por lead e uma fila serial com
// pacing. Cada tentativa usa um proxy diferente do Webshare (rodízio); captcha ou falha de
// transporte põe o proxy em quarentena e tenta o próximo, no máximo MAX_ATTEMPTS vezes.
//
// Webshare: só entra com HEADLESS_PROXY_ENABLED=1 explícito + WEBSHARE_TOKEN (mesma regra de
// economia do PNCP: a franquia do free tier é pequena). Sem isso, sai pelo IP direto.

const http = require('node:http');
const { chromium } = require('playwright');
const egress = require('./egressClient');
const { readPublicDocument } = require('./publicDocument');

const PORT = Number(process.env.PORT || 3100);
const PACING_MS = Number(process.env.PACING_MS || 3000);
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS || 3);
const PROXY_ENABLED = ['1', 'true', 'yes'].includes(String(process.env.HEADLESS_PROXY_ENABLED || '').toLowerCase());
// Várias contas do Webshare: mais proxies e mais banda no mesmo rodízio.
const WEBSHARE_TOKENS = [...new Set([
  process.env.WEBSHARE_TOKEN,
  process.env.WEBSHARE_TOKEN_2,
  ...String(process.env.WEBSHARE_TOKENS || '').split(','),
].map((t) => String(t || '').trim()).filter(Boolean))];
const WEBSHARE_URL = 'https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page=1&page_size=100';

let browser = null;
let proxies = [];
let proxiesEm = 0;
let cursor = 0;
const quarentena = new Map(); // id -> até quando

const carregarProxies = async () => {
  if (!PROXY_ENABLED || !WEBSHARE_TOKENS.length) return [];
  if (proxies.length && Date.now() - proxiesEm < 30 * 60 * 1000) return proxies;
  const juntos = new Map();
  for (const token of WEBSHARE_TOKENS) {
    try {
      const r = await fetch(WEBSHARE_URL, { headers: { Authorization: `Token ${token}` } });
      if (!r.ok) throw new Error(`webshare HTTP ${r.status}`);
      const d = await r.json();
      for (const p of d.results || []) {
        if (p.valid === false || !p.proxy_address || !p.port || !p.username || !p.password) continue;
        const id = `${p.proxy_address}:${p.port}`;
        juntos.set(id, { id, server: `http://${id}`, username: p.username, password: p.password });
      }
    } catch (error) {
      // Uma conta fora do ar não derruba a outra.
      console.warn('[headless] lista de proxies indisponível:', error.message);
    }
  }
  if (juntos.size) {
    // Intercala as contas no rodízio: bytes gastos se espalham entre as duas franquias.
    proxies = [...juntos.values()];
    proxiesEm = Date.now();
  }
  return proxies;
};

// Próximo proxy vivo em rodízio; null = sem proxy (IP direto).
const proximoProxy = async () => {
  const lista = await carregarProxies();
  for (let i = 0; i < lista.length; i += 1) {
    const p = lista[cursor++ % lista.length];
    if ((quarentena.get(p.id) || 0) <= Date.now()) return p;
  }
  return null;
};

// Dois navegadores: o modo "per-context" só aceita contextos com proxy próprio (um contexto
// sem proxy tentaria o endereço fictício e daria ERR_PROXY_CONNECTION_FAILED).
let browserDireto = null;
const ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];
const obterBrowser = async (comProxy) => {
  if (comProxy) {
    if (!browser?.isConnected()) {
      browser = await chromium.launch({ headless: true, args: ARGS, proxy: { server: 'http://per-context' } });
    }
    return browser;
  }
  if (!browserDireto?.isConnected()) {
    browserDireto = await chromium.launch({ headless: true, args: ARGS });
  }
  return browserDireto;
};

const extrair = () => {
  const limpa = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  // Painel de conhecimento (telefone/endereço/site da empresa) fica em [data-attrid].
  const painel = [...document.querySelectorAll('[data-attrid]')]
    .map((e) => limpa(e.innerText)).filter(Boolean);
  const resultados = [...document.querySelectorAll('#rso a')]
    .filter((a) => a.querySelector('h3') && /^https?:/.test(a.href))
    .slice(0, 8)
    .map((a) => {
      const bloco = a.closest('div[data-hveid], div.g, div[jscontroller]') || a.parentElement;
      return { url: a.href, title: limpa(a.querySelector('h3').innerText), content: limpa(bloco?.innerText).slice(0, 700) };
    });
  return { painel: [...new Set(painel)].join(' | ').slice(0, 1500), resultados, url: location.href };
};

const buscarUma = async (query, proxy) => {
  const ctx = await (await obterBrowser(Boolean(proxy))).newContext({
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    ...(proxy ? { proxy: { server: proxy.server, username: proxy.username, password: proxy.password } } : {}),
  });
  try {
    // Só o HTML interessa: imagem, CSS, fonte e mídia economizam banda do proxy.
    await ctx.route('**/*', (route) => (
      ['image', 'stylesheet', 'font', 'media'].includes(route.request().resourceType())
        ? route.abort() : route.continue()
    ));
    const page = await ctx.newPage();
    await page.goto(
      `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=pt-BR&gl=br&num=8`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );
    if (/\/sorry\/|consent\.google/.test(page.url())) {
      const aceitar = page.locator('button:has-text("Aceitar tudo"), button:has-text("Accept all")').first();
      if (/consent/.test(page.url()) && await aceitar.count()) {
        await aceitar.click();
        await page.waitForLoadState('domcontentloaded');
      } else {
        const e = new Error('captcha');
        e.codigo = 'captcha';
        throw e;
      }
    }
    return await page.evaluate(extrair);
  } finally {
    await ctx.close().catch(() => {});
  }
};

const buscar = async (query) => {
  const falhas = [];
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    const lease = i === 0 ? await egress.acquire('https://www.google.com') : null;
    if (lease?.defer) throw Object.assign(new Error('Pesquisa adiada: domínio em pausa'), {status:503});
    const proxy = egress.playwrightProxy(lease) || await proximoProxy();
    let outcome = 'transport';
    try {
      const d = await buscarUma(query, proxy);
      const paginas = [];
      if (d.painel) paginas.push({ url: d.url, title: 'Painel do Google', content: d.painel, fonte: 'google-painel' });
      paginas.push(...d.resultados.map((r) => ({ ...r, fonte: 'google' })));
      outcome = 'ok';
      return { paginas, proxy: proxy?.personal ? 'dispositivo pessoal' : proxy?.id || 'direto' };
    } catch (error) {
      if (error.codigo === 'captcha') {
        outcome = 'blocked';
        // A challenge pauses this origin; do not hop IPs to defeat it.
        if (proxy?.personal) throw Object.assign(new Error('Pesquisa adiada: verificação exigida pela fonte'), {status:503});
      }
      falhas.push(`${proxy?.id || 'direto'}: ${error.message}`);
      // Captcha/transporte: este proxy descansa 30 min (captcha) ou 2 h (transporte).
      if (proxy) quarentena.set(proxy.id, Date.now() + (error.codigo === 'captcha' ? 30 : 120) * 60 * 1000);
      else break; // IP direto bloqueado: repetir só piora.
    } finally {
      await egress.release(lease, outcome);
    }
  }
  const e = new Error(`google indisponível: ${falhas.join('; ')}`);
  e.status = 503;
  throw e;
};

const inspect = async (address, fallbackOnly = false, directOnly = false) => {
  const lease = fallbackOnly ? {available:false} : await egress.acquire(address);
  if (lease.defer) return { url: address, access: 'blocked', title: '', content: '', links: [] };
  const fallback = !lease.available && !directOnly ? await proximoProxy() : null;
  const legacyUrl = fallback ? `http://${encodeURIComponent(fallback.username)}:${encodeURIComponent(fallback.password)}@${new URL(fallback.server).host}` : null;
  let outcome = 'transport';
  try {
    const doc = await readPublicDocument(address, { proxy: lease.available ? lease.proxy : legacyUrl });
    if ([401,403,429].includes(doc.status)) {
      outcome = doc.status===401 ? 'login_required' : 'blocked';
      return { url: doc.url, access: outcome, title: '', content: '', links: [] };
    }
    if (doc.status < 200 || doc.status >= 300) throw new Error('Fonte indisponível');
    const ctx = await (await obterBrowser(false)).newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
    try {
      // Parse HTML locally; never execute scripts or load third-party subresources.
      await ctx.route('**/*', route => route.abort());
      const page = await ctx.newPage();
      await page.setContent(doc.html, {waitUntil:'domcontentloaded', timeout:10000});
      const result = await page.evaluate(base => ({
        title: document.title.slice(0,200),
        content: (document.body?.innerText || '').slice(0,30000),
        links: [...document.querySelectorAll('a[href]')].slice(0,150).flatMap(a => {
          try { return [{href:new URL(a.getAttribute('href'),base).href,label:(a.textContent || '').trim().slice(0,120)}]; }
          catch { return []; }
        }),
      }), doc.url);
      outcome = /accounts\/login|challenge\//i.test(doc.url) || (!result.links.length && /log in|entrar|login required/i.test(result.content)) ? 'login_required' : 'ok';
      return { ...result, url: doc.url, access: outcome === 'ok' ? 'public' : outcome };
    } finally { await ctx.close(); }
  } catch (error) {
    if (lease.available && outcome === 'transport') {
      await egress.release(lease,'transport');
      lease.id=null;
      return inspect(address,true);
    }
    if (fallback && outcome === 'transport') {
      quarentena.set(fallback.id,Date.now()+120*60*1000);
      return inspect(address,true,true);
    }
    throw error;
  } finally { await egress.release(lease,outcome); }
};

// Fila serial com pacing: nunca duas buscas ao mesmo tempo, nunca em rajada.
let fila = Promise.resolve();
const enfileirar = (fn) => {
  const r = fila.then(async () => {
    const out = await fn();
    await new Promise((ok) => setTimeout(ok, PACING_MS + Math.random() * 1500));
    return out;
  });
  fila = r.catch(() => {});
  return r;
};

http.createServer(async (req, res) => {
  const enviar = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'GET' && req.url === '/health') {
    return enviar(200, { ok: true, proxies: proxies.length, emQuarentena: [...quarentena.values()].filter((t) => t > Date.now()).length });
  }
  if (req.method !== 'POST' || !['/search','/inspect'].includes(req.url)) return enviar(404, { error: 'not found' });
  let corpo = '';
  for await (const c of req) { corpo += c; if(corpo.length>4096)return enviar(413,{error:'corpo excessivo'}); }
  try {
    const { query, url } = JSON.parse(corpo || '{}');
    if (req.url === '/inspect') {
      if (typeof url!=='string' || url.length>2000) return enviar(400,{error:'URL inválida'});
      return enviar(200,await enfileirar(()=>inspect(url)));
    }
    if (!query || String(query).length > 300) return enviar(400, { error: 'query inválida' });
    return enviar(200, await enfileirar(() => buscar(String(query))));
  } catch (error) {
    return enviar(error.status || 500, { error: String(error.message || error) });
  }
}).listen(PORT, () => console.log(`[headless] ouvindo na porta ${PORT} (proxy ${PROXY_ENABLED ? 'on' : 'off'})`));
