// Storefront measurement audit. --cart uses an anonymous cart; never creates orders or sends test purchases.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const browserRequire = createRequire(path.join(path.resolve(process.argv[2]), 'package.json'));
let puppeteer;
try { puppeteer = browserRequire('puppeteer'); } catch { puppeteer = browserRequire('puppeteer-core'); }
const out = path.join(__dirname, '..', '.tmp', 'measurement');
fs.mkdirSync(out, { recursive: true });
(async () => {
  console.error('Launching measurement audit browser');
  const browser = await puppeteer.launch({ headless: true, channel: 'chrome' });
  const results = [];
  try {
    const page = await browser.newPage();
    await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome'));
    const hits = [];
    page.on('request', req => {
      const u = new URL(req.url());
      if (!/google-analytics\.com|googletagmanager\.com|facebook\.com|facebook\.net|googleadservices\.com|doubleclick\.net/.test(u.hostname) && !/\/(?:g\/)?collect/.test(u.pathname)) return;
      const params = new URLSearchParams(u.search);
      for (const [key, value] of new URLSearchParams(req.postData() || '')) params.set(key, value);
      hits.push({ host: u.hostname, path: u.pathname, params: Object.fromEntries(['id', 'tid', 'en', 'ev', 'gcs', 'gcd', 'cu', 'cd[currency]', 'cd[value]'].filter(k => params.has(k)).map(k => [k, params.get(k)])) });
    });
    await page.setViewport({ width: 1365, height: 1000 });
    const visit = async (route, accept = false) => {
      console.error(`Auditing ${route}${accept ? ' with consent' : ''}`);
      hits.length = 0;
      const response = await page.goto(`https://aerion.com.br${route}`, { waitUntil: 'networkidle2', timeout: 60000 });
      // Storefront defers secondary scripts until the first real interaction.
      await page.mouse.move(600, 300);
      await page.keyboard.press('Tab');
      await new Promise(resolve => setTimeout(resolve, 3500));
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
        ga4Diagnostics: { disabled: window['ga-disable-G-TRB0NJD7H1'] === true, gtag: typeof window.gtag, tagLoaded: !!window.google_tag_manager?.['G-TRB0NJD7H1'], consent: window.google_tag_data?.ics?.entries?.analytics_storage },
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
    if (!process.argv.includes('--cart-only')) for (const route of ['/loja/', '/loja/produto/hubsan-mini-7/', '/carrinho/']) await visit(route);
    await visit('/loja/produto/hubsan-mini-7/', true);
    if (process.argv.includes('--cart')) {
      hits.length = 0;
      console.error('Auditing anonymous add-to-cart');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => null),
        page.click('button.single_add_to_cart_button', { timeout: 10000 }),
      ]);
      await new Promise(resolve => setTimeout(resolve, 2000));
      results.push({ step: 'add-to-cart', url: new URL(page.url()).pathname, hits: [...hits], events: await page.evaluate(() => (window.dataLayer || []).filter(x => x.event).map(x => ({ event: x.event, ecommerce: x.ecommerce }))) });
      fs.writeFileSync(path.join(out, 'browser-audit.json'), JSON.stringify(results, null, 2));
      console.error('Auditing cart and checkout render');
      await visit('/carrinho/');
      const checkout = await page.$eval('a.checkout-button', el => new URL(el.href).pathname);
      await visit(checkout);
      // Only render checkout. Never enter customer data or submit the order form.
      await visit('/carrinho/');
      const remove = await page.$('a.remove');
      if (remove) {
        await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => null), remove.click()]);
      }
      results.push({ step: 'anonymous-cart-cleanup', empty: await page.evaluate(() => !!document.querySelector('.cart-empty, .wc-empty-cart-message')) });
    }
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
    if (process.argv.includes('--verify-funnel')) {
      const assert = require('node:assert/strict');
      const all = results.flatMap(result => result.hits || []);
      for (const event of ['ViewContent', 'AddToCart', 'InitiateCheckout']) assert(all.some(hit => hit.params.ev === event), `Missing Meta ${event}`);
      for (const event of ['view_item', 'view_cart', 'begin_checkout']) assert(all.some(hit => hit.params.en === event), `Missing GA4 ${event}`);
      assert(!all.some(hit => ['Lead', 'Purchase'].includes(hit.params.ev)), 'Cart-only audit must not generate leads or purchases');
      assert(!all.some(hit => hit.params.en === 'conversion'), 'Cart must not generate Google Ads form conversions');
      assert.equal(results.find(result => result.step === 'anonymous-cart-cleanup')?.empty, true);
      console.error('FUNNEL VERIFIED: product, cart, checkout; no false leads/orders; anonymous cart emptied');
    }
    console.log(JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
