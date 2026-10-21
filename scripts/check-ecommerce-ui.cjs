// Local, deterministic browser check. No production accounts or services are contacted.
// Usage: node scripts/check-ecommerce-ui.cjs [path-to-a-project-with-puppeteer]
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const express = require('../backend/node_modules/express');
const { normalizeOrder, buildReport, dateRange, day, shiftDay } = require('../backend/ecommerce/domain');
const requireBrowser = process.argv[2] ? createRequire(path.join(path.resolve(process.argv[2]), 'package.json')) : require;
let puppeteer;
try { puppeteer = requireBrowser('puppeteer'); } catch { puppeteer = requireBrowser('puppeteer-core'); }
const output = path.join(__dirname, '..', '.tmp', 'ecommerce-ui');
fs.mkdirSync(output, { recursive: true });
const app = express();
app.use(express.json());
const connections = ['woocommerce', 'ga4', 'google_ads', 'meta_ads', 'search_console'].map(provider => ({ provider, config: {}, enabled: true, status: 'connected', last_success_at: new Date().toISOString(), info: {} }));
connections[0].config = { url: 'https://loja.aerion.com.br' };
const to = day();
const orders = Array.from({ length: 9 }, (_, index) => normalizeOrder({ id: index + 1, number: `10${index}`, currency: 'BRL', status: 'completed',
  date_created_gmt: `${shiftDay(to, -index)}T12:00:00`, date_paid_gmt: `${shiftDay(to, -index)}T13:00:00`,
  line_items: [{ id: 1, product_id: 15, name: 'Autel EVO Lite Enterprise', quantity: 1, total: String(15000 + index * 300), subtotal: '19000', sku: 'EVO-LITE' }],
  coupon_lines: [{ code: 'AERION10', discount: '1000' }], meta_data: [{ key: '_aerion_utm_link_id', value: 'aerion-demo-link' }],
}));
const metrics = Array.from({ length: 15 }, (_, index) => [
  { provider: 'ga4', kind: 'total', date: shiftDay(to, -index), sessions: 30 + index, activeUsers: 20 + index, purchases: 1 },
  { provider: 'ga4', kind: 'traffic', date: shiftDay(to, -index), source: 'google', medium: 'cpc', campaign: 'Drones Enterprise', sessions: 30 + index, purchases: 1 },
  { provider: 'ga4', kind: 'landing', date: shiftDay(to, -index), landing: '/produto/autel-evo-lite/', sessions: 30 + index, purchases: 1 },
  { provider: 'ga4', kind: 'funnel', date: shiftDay(to, -index), event: 'purchase', events: 1 },
  { provider: 'google_ads', date: shiftDay(to, -index), campaignId: '1', campaign: 'Drones Enterprise', currency: 'BRL', spend: 80, clicks: 25, impressions: 1000,
    conversions: 1, conversionValue: 15000, timezone: 'America/Sao_Paulo', attribution: 'Ações configuradas no Google Ads' },
]).flat();
app.get('/api/auth/status', (req, res) => res.json({ authenticated: true, role: 'admin', name: 'Teste local Ecommerce', email: 'teste@example.com', is_app_admin: true }));
app.get('/api/ecommerce/status', (req, res) => res.json({ connections, encryptionReady: true, oauthRedirectUri: 'https://crm.example.com/api/ecommerce/oauth/google/callback' }));
app.get('/api/ecommerce/report', (req, res) => res.json({ ...buildReport({ range: dateRange(req.query), orders, metrics, connections,
  links: [{ link_id: 'aerion-demo-link', utm_campaign: 'Drones Enterprise', utm_source: 'google', coupon_codes: ['AERION10'] }], visits: [] }), couponCatalog: [],
  search: { available: true, site: 'sc-domain:aerion.com.br', latestDate: shiftDay(to, -3), summary: { clicks: 42, impressions: 1800, ctr: 2.33, position: 8.5 },
    pages: [{ landing: 'https://aerion.com.br/loja/produto/autel-evo-lite-enterprise/', clicks: 12, impressions: 350, ctr: 3.43, position: 8 }],
    queries: [{ query: 'autel drones enterprise', clicks: 10, impressions: 300, ctr: 3.33, position: 9 }], daily: [], sitemaps: [{ path: 'https://aerion.com.br/wp-sitemap.xml', errors: 0, warnings: 0 }] } }));
app.use('/api', (req, res) => res.json([]));
app.use(express.static(path.join(__dirname, '..', 'frontend', 'build')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'build', 'index.html')));

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  let browser;
  const errors = [];
  try {
    browser = await puppeteer.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => request.url().startsWith('http://127.0.0.1:') || request.url().startsWith('data:')
      ? request.continue() : request.abort());
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(`http://127.0.0.1:${server.address().port}/?ecommerce=connections`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('summary');
    await page.screenshot({ path: path.join(output, 'connections-desktop.png'), fullPage: true });
    const clickSection = async label => {
      const buttons = await page.$$('button');
      for (const button of buttons) {
        const text = await button.evaluate(element => element.textContent.trim());
        if (text === label && await button.isVisible()) { await button.click(); return; }
      }
      throw new Error(`Navigation button missing: ${label}`);
    };
    const sections = [
      ['Visão geral', 'overview', 'Visão geral'], ['Vendas e produtos', 'sales', 'Vendas e produtos'], ['Cupons', 'coupons', 'Vendas e produtos'],
      ['Marketing', 'ads', 'Marketing'], ['Tráfego e conversão', 'traffic', 'Marketing'], ['Campanhas e UTMs', 'campaigns', 'Marketing'],
      ['Busca orgânica e SEO', 'seo', 'Marketing'],
    ];
    for (const [label, id, heading] of sections) {
      await clickSection(label);
      await page.waitForFunction(expected => [...document.querySelectorAll('h2')].some(h => h.textContent === expected), {}, heading);
      await page.screenshot({ path: path.join(output, `${id}-desktop.png`), fullPage: true });
    }
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('summary');
    await page.screenshot({ path: path.join(output, 'connections-mobile.png'), fullPage: true });
    await clickSection('Visão geral');
    await page.waitForSelector('table');
    await page.screenshot({ path: path.join(output, 'overview-mobile.png'), fullPage: true });
    await clickSection('Marketing'); await clickSection('Busca orgânica e SEO');
    await page.screenshot({ path: path.join(output, 'seo-mobile.png'), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, 'The mobile page must not overflow horizontally.');
    assert.deepEqual(errors, [], 'Dashboard has uncaught browser errors.');
    console.log(JSON.stringify({ checked: 7, viewports: ['1440x1000', '390x844'], errors, output }));
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
