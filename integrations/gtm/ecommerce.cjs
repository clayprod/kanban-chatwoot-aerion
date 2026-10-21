const PIXEL = '1668777180919759';
const MEASUREMENT = 'G-TRB0NJD7H1';
const parameter = (key, value, type = 'template') => ({ key, type, value: String(value) });
const eventFilter = (value, regex = false) => ({ type: regex ? 'matchRegex' : 'equals', parameter: [parameter('arg0', '{{_event}}'), parameter('arg1', value)] });
const marketingConsent = { consentStatus: 'needed', consentType: { type: 'list', list: [{ type: 'template', value: 'ad_storage' }] } };

// This function is serialized into a GTM custom HTML tag. Keep it ES5-compatible.
function metaBootstrap(pixel) {
  var w = window;
  function allowed() { return typeof w.wp_has_consent === 'function' && w.wp_has_consent('marketing') === true; }
  if (!allowed() || w.aerionMetaSend) return;
  if (!w.fbq) {
    var n = w.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    w._fbq = w._fbq || n; n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
    var script = document.createElement('script'); script.async = true; script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(script);
  }
  var sent = {}, views = {};
  w.fbq('consent', 'grant');
  w.fbq('init', pixel);
  w.fbq('trackSingle', pixel, 'PageView');
  w.aerionMetaSend = function (event, ecommerce, eventId) {
    if (!allowed()) return;
    var names = { view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', add_payment_info: 'AddPaymentInfo', purchase: 'Purchase' };
    if (!names[event] || !ecommerce || !Array.isArray(ecommerce.items)) return;
    var value = Number(ecommerce.value), currency = ecommerce.currency;
    if (!isFinite(value) || value < 0 || !/^[A-Z]{3}$/.test(currency || '')) return;
    var items = ecommerce.items.filter(function (item) { return item.item_id != null && String(item.item_id) !== ''; }).map(function (item) {
      return { id: String(item.item_id), quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1, item_price: Number(item.price) || 0 };
    });
    if (!items.length) return;
    if (event === 'purchase') {
      if (!ecommerce.transaction_id) return;
      eventId = eventId || 'aerion_purchase_' + ecommerce.transaction_id;
    }
    eventId = String(eventId || 'aerion_' + event + '_' + Date.now());
    if (sent[eventId]) return;
    if (event === 'view_item' || event === 'begin_checkout') {
      var view = event + ':' + items.map(function (i) { return i.id; }).join('|');
      if (views[view]) return;
      views[view] = true;
    }
    sent[eventId] = true;
    w.fbq('trackSingle', pixel, names[event], { value: value, currency: currency, content_type: 'product', content_ids: items.map(function (item) { return item.id; }), contents: items, num_items: items.reduce(function (sum, item) { return sum + item.quantity; }, 0) }, { eventID: eventId });
  };
  function syncConsent() { if (w.fbq) w.fbq('consent', allowed() ? 'grant' : 'revoke'); }
  document.addEventListener('wp_listen_for_consent_change', syncConsent);
  document.addEventListener('wp_consent_api_status_change_service', syncConsent);
  // Recover the current product/paid receipt when consent is established after page data.
  // Do not replay earlier cart actions; those start being measured after consent.
  var layer = w.dataLayer || [], latestView = null, receipt = null, checkout = null;
  for (var i = 0; i < layer.length; i++) {
    if (layer[i].event === 'view_item') latestView = layer[i];
    if (layer[i].event === 'purchase') receipt = layer[i];
    if (layer[i].event === 'begin_checkout') checkout = layer[i];
  }
  if (latestView) w.aerionMetaSend('view_item', latestView.ecommerce, 'aerion_view_' + (latestView['gtm.uniqueEventId'] || 'current'));
  if (receipt) w.aerionMetaSend('purchase', receipt.ecommerce, receipt.event_id);
  if (checkout) w.aerionMetaSend('begin_checkout', checkout.ecommerce, 'aerion_checkout_' + (checkout['gtm.uniqueEventId'] || 'current'));
}

// Page data precedes the storefront's restored consent. Replay only page state,
// once, after statistics is allowed; never replay earlier shopping interactions.
function replayGaPage() {
  var w = window;
  if (w.aerionGaPageReplayed || typeof w.wp_has_consent !== 'function' || w.wp_has_consent('statistics') !== true) return;
  w.aerionGaPageReplayed = true;
  var layer = w.dataLayer || [], pending = {}, names = ['view_item_list', 'view_item', 'view_cart', 'begin_checkout', 'purchase'];
  for (var i = 0, length = layer.length; i < length; i++) {
    var row = layer[i];
    if (row.event === 'aerion_consent_updated' && row.aerion_statistics_consent === true) break;
    if (names.indexOf(row.event) >= 0 && row.ecommerce) pending[row.event] = row;
  }
  for (var j = 0; j < names.length; j++) {
    var data = pending[names[j]];
    if (data) layer.push({ event: data.event, ecommerce: data.ecommerce, event_id: data.event_id, aerion_consent_replay: true });
  }
}

function buildPlan(live) {
  const base = (live.tag || []).find(t => t.name === 'Meta - Pixel Base');
  const lead = (live.tag || []).find(t => t.name === 'Meta Pixel - Conversão Lead');
  if (!base || base.type !== 'html' || !base.parameter.some(p => p.key === 'html' && p.value.includes(PIXEL))) throw new Error('Existing Meta base differs from the audited configuration.');
  if (!(live.tag || []).some(t => t.type === 'googtag' && t.parameter.some(p => p.value === MEASUREMENT))) throw new Error('Audited GA4 Google tag not found.');
  const variables = [['Aerion · Ecommerce', 'ecommerce'], ['Aerion · Event ID', 'event_id'], ['Aerion · GTM Event ID', 'gtm.uniqueEventId'], ['Aerion · Marketing consent', 'aerion_marketing_consent'], ['Aerion · Statistics consent', 'aerion_statistics_consent']].map(([name, key]) => ({ name, type: 'v', parameter: [parameter('name', key), parameter('dataLayerVersion', 2, 'integer')] }));
  const consentFilter = name => ({ type: 'equals', parameter: [parameter('arg0', '{{' + name + '}}'), parameter('arg1', 'true')] });
  const triggers = [
    { name: 'Aerion · Ecommerce GA4', type: 'customEvent', customEventFilter: [eventFilter('^(view_item_list|select_item|view_item|add_to_cart|remove_from_cart|view_cart|begin_checkout|add_shipping_info|add_payment_info|purchase|refund)$', true)], filter: [consentFilter('Aerion · Statistics consent')] },
    { name: 'Aerion · Ecommerce Meta', type: 'customEvent', customEventFilter: [eventFilter('^(view_item|add_to_cart|begin_checkout|add_payment_info|purchase)$', true)] },
    { name: 'Aerion · Marketing permitido', type: 'customEvent', customEventFilter: [eventFilter('aerion_consent_updated')], filter: [{ type: 'equals', parameter: [parameter('arg0', '{{Aerion · Marketing consent}}'), parameter('arg1', 'true')] }] },
    { name: 'Aerion · Statistics permitido', type: 'customEvent', customEventFilter: [eventFilter('aerion_consent_updated')], filter: [consentFilter('Aerion · Statistics consent')] },
    { name: 'Aerion · Lead confirmado', type: 'customEvent', customEventFilter: [eventFilter('generate_lead')] },
    { name: 'Aerion · Lead home confirmado', type: 'customEvent', customEventFilter: [eventFilter('generate_lead')], filter: [{ type: 'matchRegex', parameter: [parameter('arg0', '{{Page Path}}'), parameter('arg1', '^/$')] }] },
    { name: 'Aerion · Lead contato confirmado', type: 'customEvent', customEventFilter: [eventFilter('generate_lead')], filter: [{ type: 'matchRegex', parameter: [parameter('arg0', '{{Page Path}}'), parameter('arg1', '^/contato/?$')] }] },
  ];
  const html = body => [parameter('html', `<script>${body}</script>`), parameter('supportDocumentWrite', false, 'boolean')];
  const tags = [
    { name: 'Aerion · GA4 consent replay', type: 'html', tagFiringOption: 'oncePerEvent', triggers: ['Aerion · Statistics permitido'], parameter: html(`(${replayGaPage.toString()})();`) },
    { name: 'Aerion · GA4 ecommerce', type: 'gaawe', tagFiringOption: 'oncePerEvent', triggers: ['Aerion · Ecommerce GA4'], parameter: [parameter('measurementIdOverride', MEASUREMENT), parameter('eventName', '{{Event}}'), parameter('sendEcommerceData', true, 'boolean'), parameter('getEcommerceDataFrom', 'dataLayer')] },
    // A denied setup attempt must be allowed to retry after consent. The bootstrap
    // guards initialization/PageView itself, so repeated allowed attempts are safe.
    { ...base, triggers: ['Aerion · Marketing permitido'], firingTriggerId: undefined, parameter: html(`(${metaBootstrap.toString()})('${PIXEL}');`), consentSettings: marketingConsent, tagFiringOption: 'oncePerEvent' },
    { name: 'Aerion · Meta ecommerce', type: 'html', tagFiringOption: 'oncePerEvent', triggers: ['Aerion · Ecommerce Meta'], setupTag: [{ tagName: base.name, stopOnSetupFailure: true }], consentSettings: marketingConsent,
      parameter: html("if(window.aerionMetaSend){window.aerionMetaSend({{Event}},{{Aerion · Ecommerce}},{{Aerion · Event ID}} || 'aerion_' + {{Event}} + '_' + {{Aerion · GTM Event ID}});}") },
  ];
  if (lead) tags.push({ ...lead, firingTriggerId: undefined, triggers: ['Aerion · Lead confirmado'], setupTag: [{ tagName: base.name, stopOnSetupFailure: true }], consentSettings: marketingConsent,
    parameter: html(`if(typeof window.wp_has_consent==='function'&&window.wp_has_consent('marketing')===true&&window.fbq){window.fbq('trackSingle','${PIXEL}','Lead',{}, {eventID:'aerion_lead_'+{{Aerion · GTM Event ID}}});}`) });
  // Preserve the Ads conversion action/label and direct contact clicks, replacing
  // only the generic form_submit trigger that also fires on WooCommerce cart forms.
  for (const tag of live.tag || []) {
    if (tag.type === 'awct' && (tag.firingTriggerId || []).includes('7')) tags.push({ ...tag, firingTriggerId: undefined, triggers: ['Aerion · Lead confirmado'], retainedTriggerIds: tag.firingTriggerId.filter(id => id !== '7') });
    if (tag.name === 'lead_home' || tag.name === 'lead_contato') tags.push({ ...tag, firingTriggerId: undefined, triggers: [tag.name === 'lead_home' ? 'Aerion · Lead home confirmado' : 'Aerion · Lead contato confirmado'] });
  }
  // No Google Ads purchase tag is generated: the existing conversion label belongs to leads.
  return { variables, triggers, tags };
}
module.exports = { buildPlan, metaBootstrap, replayGaPage, PIXEL, MEASUREMENT };
