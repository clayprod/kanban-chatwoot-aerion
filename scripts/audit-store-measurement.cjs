// Read-only storefront measurement audit. Does not create orders or send test purchases.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const browserRequire = createRequire(path.join(path.resolve(process.argv[2]), 'package.json'));
let puppeteer;
try { puppeteer = browserRequire('puppeteer'); } catch { puppeteer = browserRequire('puppeteer-core'); }
const out = path.join(__dirname, '..', '.tmp', 'measurement');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await puppeteer.launch({ headless: true, channel: 'chrome' });
  const results = [];
  try {
    const page = await browser.newPage();
    await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome'));
    const hits = [];
    page.on('request', req => {
      const u = new URL(req.url());
      if (!/google-analytics\.com|googletagmanager\.com|facebook\.com|facebook\.net|googleadservices\.com|doubleclick\.net/.test(u.hostname)) return;
      const params = new URLSearchParams(req.postData() || u.search);
      hits.push({ host: u.hostname, path: u.pathname, params: Object.fromEntries(['id', 'tid', 'en', 'ev', 'gcs', 'gcd', 'cu', 'cd[currency]', 'cd[value]'].filter(k => params.has(k)).map(k => [k, params.get(k)])) });
    });
    await page.setViewport({ width: 1365, height: 1000 });
    const visit = async (route, accept = false) => {
      hits.length = 0;
      const response = await page.goto(`https://aerion.com.br${route}`, { waitUntil: 'networkidle2', timeout: 60000 });
      // Storefront defers secondary scripts until the first real interaction.
      await page.mouse.move(600, 300);
      await page.keyboard.press('Tab');
      await new Promise(resolve => setTimeout(resolve, 1200));
      let clicked = false;
      if (accept) {
        await page.screenshot({ path: path.join(out, 'consent-before.png'), fullPage: false });
        const buttons = await page.$$('.moove-gdpr-infobar-allow-all');
        for (const button of buttons) {
          if (await button.isVisible()) { await button.click(); clicked = true; await new Promise(resolve => setTimeout(resolve, 1500)); break; }
        }
        if (!clicked) {
          const settings = await page.$$('.gdpr-nav-tab-title, .moove-gdpr-infobar-settings-btn, .change-settings-button');
          for (const button of settings) { if (await button.isVisible()) { await button.click(); break; } }
          const modalButtons = await page.$$('.moove-gdpr-modal-allow-all');
          for (const button of modalButtons) { if (await button.isVisible()) { await button.click(); clicked = true; await new Promise(resolve => setTimeout(resolve, 1500)); break; } }
        }
      }
      const state = await page.evaluate(() => ({
        url: location.origin + location.pathname,
        consent: typeof wp_has_consent === 'function' ? { statistics: wp_has_consent('statistics'), marketing: wp_has_consent('marketing') } : null,
        consentIntegration: window.moove_frontend_gdpr_scripts ? { wpConsentApi: window.moove_frontend_gdpr_scripts.wp_consent_api, banner: window.moove_frontend_gdpr_scripts.display_cookie_banner } : null,
        consentUi: (() => { const el = document.querySelector('#moove_gdpr_cookie_info_bar'); return el ? { display: getComputedStyle(el).display, visibility: getComputedStyle(el).visibility, className: el.className } : null; })(),
        dataLayer: (window.dataLayer || []).map(x => {
          if (x.event) return { event: x.event, ecommerce: x.ecommerce ? { currency: x.ecommerce.currency, value: x.ecommerce.value, items: (x.ecommerce.items || []).map(i => ({ item_id: i.item_id, price: i.price, quantity: i.quantity })) } : undefined };
          if (x[0] === 'consent') return { command: 'consent', action: x[1], state: x[2] };
          return null;
        }).filter(Boolean),
        buttons: [...document.querySelectorAll('button')].filter(b => /aceit|rejeit|recus|cookie/i.test(b.textContent)).map(b => b.textContent.trim()).slice(0, 12),
      }));
      results.push({ route, requestedAcceptance: accept, clickedAcceptance: clicked, status: response.status(), ...state, hits: [...hits] });
    };
    for (const route of ['/loja/', '/loja/produto/hubsan-mini-7/', '/carrinho/']) await visit(route);
    await visit('/loja/produto/hubsan-mini-7/', true);
    if (process.argv.includes('--diagnose-meta')) {
      for (const value of [true, 'true']) {
        await page.evaluate(flag => window.dataLayer.push({ event: 'aerion_consent_updated', aerion_marketing_consent: flag }), value);
        await new Promise(resolve => setTimeout(resolve, 1800));
        results.push({ diagnostic: 'consent-trigger', inputType: typeof value, state: await page.evaluate(() => ({
          marketing: window.wp_has_consent?.('marketing'), helper: typeof window.aerionMetaSend, pixel: typeof window.fbq,
          layerValue: window.google_tag_manager?.['GTM-5G8QBHHC']?.dataLayer?.get('aerion_marketing_consent'),
        })), hits: [...hits].filter(h => h.host.includes('facebook')) });
      }
    }
    fs.writeFileSync(path.join(out, 'browser-audit.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
