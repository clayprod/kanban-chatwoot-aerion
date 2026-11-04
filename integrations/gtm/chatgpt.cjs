// Serialized into GTM. No credentials or customer identifiers enter this tag.
function chatgptBootstrap(pixel) {
  var w = window;
  function allowed() { return typeof w.wp_has_consent === 'function' && w.wp_has_consent('marketing') === true; }
  if (w.aerionChatgptSend) return;
  if (!w.oaiq) { var q = function () { q.q.push(arguments); };q.q = [];w.oaiq = q; }
  w.oaiq('consent', false);
  var initialized = false, sent = {}, views = {};
  function init() {
    if (!allowed()) return;
    if (!initialized) {
      initialized = true;w.oaiq('init', { pixelId: pixel });
      var script = document.createElement('script');script.async = true;script.src = 'https://bzrcdn.openai.com/sdk/oaiq.min.js';document.head.appendChild(script);
    }
    w.oaiq('consent', true);
  }
  w.aerionChatgptSend = function (event, ecommerce, eventId) {
    if (!allowed()) return;
    init();var names = { view_item: 'contents_viewed', add_to_cart: 'items_added', begin_checkout: 'checkout_started', purchase: 'order_created', generate_lead: 'lead_created' };
    if (!names[event]) return;
    if (event === 'generate_lead') { eventId = String(eventId || 'aerion_lead_' + Date.now());if (sent[eventId]) return;sent[eventId] = true;w.oaiq('measure', 'lead_created', { type: 'customer_action' }, { event_id: eventId });return; }
    if (!ecommerce || !Array.isArray(ecommerce.items) || !/^[A-Z]{3}$/.test(ecommerce.currency || '') || !isFinite(Number(ecommerce.value)) || Number(ecommerce.value) < 0) return;
    var contents = ecommerce.items.filter(function (i) { return i.item_id != null && String(i.item_id) && Number(i.quantity) > 0 && Number(i.quantity) % 1 === 0 && isFinite(Number(i.price)) && Number(i.price) >= 0; }).map(function (i) { return { id: String(i.item_id), quantity: Number(i.quantity), amount: Math.round(Number(i.price) * 100), currency: ecommerce.currency, content_type: 'product' }; });
    if (!contents.length || contents.length !== ecommerce.items.length) return;
    if (event === 'purchase') { if (!ecommerce.transaction_id) return;eventId = 'aerion_purchase_' + ecommerce.transaction_id; }
    eventId = String(eventId || 'aerion_' + event + '_' + Date.now());if (sent[eventId]) return;
    if (event === 'view_item' || event === 'begin_checkout') { var view = event + ':' + contents.map(function (i) { return i.id; }).join('|');if (views[view]) return;views[view] = true; }
    sent[eventId] = true;w.oaiq('measure', names[event], { type: 'contents', amount: Math.round(Number(ecommerce.value) * 100), currency: ecommerce.currency, contents: contents }, { event_id: eventId });
  };
  function sync() {
    if (!allowed()) { w.oaiq('consent', false);return; }init();
    // Recover current page state only. Do not replay prior cart clicks or leads.
    var latest = {}, layer = w.dataLayer || [];
    for (var i = 0; i < layer.length; i++) if (['view_item','begin_checkout','purchase'].indexOf(layer[i].event) >= 0) latest[layer[i].event] = layer[i];
    for (var name in latest) if (Object.prototype.hasOwnProperty.call(latest, name)) w.aerionChatgptSend(name, latest[name].ecommerce, latest[name].event_id || 'aerion_' + name + '_' + (latest[name]['gtm.uniqueEventId'] || 'current'));
  }
  document.addEventListener('wp_listen_for_consent_change', sync);document.addEventListener('wp_consent_api_status_change_service', sync);sync();
}
function buildChatgptPlan(live, pixelId) {
  if (!/^[a-zA-Z0-9_-]{5,100}$/.test(pixelId)) throw new Error('A verified Pixel ID is required.');
  if ((live.tag || []).some(t => t.type === 'html' && (t.parameter || []).some(p => p.key === 'html' && /oaiq\s*\(|bzrcdn\.openai\.com/.test(p.value || '')) && !t.name.startsWith('Aerion · ChatGPT'))) throw new Error('Existing ChatGPT emitter requires reconciliation.');
  const parameter = (key, value) => ({ key, type: 'template', value });
  const html = body => [parameter('html', '<script>' + body + '</script>')];
  return { variables: [['Aerion · Ecommerce','ecommerce'],['Aerion · Event ID','event_id'],['Aerion · GTM Event ID','gtm.uniqueEventId']].map(([name,key])=>({name,type:'v',parameter:[parameter('name',key),{key:'dataLayerVersion',type:'integer',value:'2'}]})),
    triggers: [{ name: 'Aerion · ChatGPT eventos e consentimento', type: 'customEvent', customEventFilter: [{ type: 'matchRegex', parameter: [parameter('arg0','{{_event}}'),parameter('arg1','^(aerion_consent_updated|view_item|add_to_cart|begin_checkout|purchase|generate_lead)$')] }] }],
    tags: [{ name: 'Aerion · ChatGPT Pixel e ecommerce', type: 'html', tagFiringOption:'oncePerEvent', triggers: ['Aerion · ChatGPT eventos e consentimento'], parameter: html('(' + chatgptBootstrap.toString() + ')(' + JSON.stringify(pixelId) + ');if(window.aerionChatgptSend){window.aerionChatgptSend({{Event}},{{Aerion · Ecommerce}},{{Aerion · Event ID}} || "aerion_"+{{Event}}+"_"+{{Aerion · GTM Event ID}});}') }] };
}
module.exports = { chatgptBootstrap, buildChatgptPlan };
