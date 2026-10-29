const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value, max = 500) => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const https = value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } };
const GROUPS = ['Drones', 'Kits', 'Payloads', 'Acessórios', 'Outros'];
function productGroup(categories) {
  const names = categories.join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/payload|camera|sensor/.test(names)) return 'Payloads';
  if (/acessor|bateria|helice|carregador/.test(names)) return 'Acessórios';
  if (/kit|combo/.test(names)) return 'Kits';
  return /drone/.test(names) ? 'Drones' : 'Outros';
}
function projectProduct(raw) {
  // Only the anonymous consumer quote from our WP bridge is authoritative.
  // Never read REST price, metadata containing wholesale prices, or arbitrary fields.
  if (raw.price_source !== 'aerion_consumer_card_v1') throw new Error('consumer_price_required');
  if (!Number.isSafeInteger(Number(raw.id)) || Number(raw.id) <= 0) throw new Error('invalid_product');
  const categories = Array.isArray(raw.categories) ? raw.categories.map(c => text(c, 100)) : [];
  const product = { id: String(raw.id), parentId: String(raw.parent_id || raw.id), sku: text(raw.sku, 100),
    name: text(raw.name), description: text(raw.description, 5000), url: https(raw.url) ? raw.url : '',
    image: https(raw.image) && !/placeholder|woocommerce-placeholder/i.test(raw.image) ? raw.image : '',
    brand: text(raw.brand, 150), gtin: /^\d{8,14}$/.test(raw.gtin || '') ? raw.gtin : '',
    price: Number(raw.consumer_price), regularPrice: Number(raw.consumer_regular_price), currency: text(raw.currency, 3),
    availability: ['in_stock', 'out_of_stock', 'preorder', 'backorder'].includes(raw.availability) ? raw.availability : null,
    availabilityDate: raw.availability_date || null, published: raw.status === 'publish' && raw.visible === true,
    categories, group: productGroup(categories), modifiedAt: raw.modified_at || null };
  if (!Number.isFinite(product.price)) product.price = null;
  if (!Number.isFinite(product.regularPrice)) product.regularPrice = null;
  product.version = digest(product);
  return product;
}
function eligibleProducts(products, now = new Date()) {
  const counts = new Map();
  products.filter(p => p.published && p.sku).forEach(p => counts.set(p.sku, (counts.get(p.sku) || 0) + 1));
  return products.map(p => {
    const issues = [];
    if (!p.published) issues.push('not_published');
    if (!p.sku) issues.push('missing_sku');
    if (counts.get(p.sku) > 1) issues.push('duplicate_sku');
    if (!p.image) issues.push('missing_real_image');
    if (!p.url) issues.push('missing_url');
    if (!p.name || !p.description) issues.push('missing_description');
    if (!(p.price > 0) || !(p.regularPrice >= p.price) || p.currency !== 'BRL') issues.push('invalid_consumer_price');
    if (!p.brand && !p.gtin) issues.push('missing_brand_or_gtin');
    if (!p.availability) issues.push('unknown_availability');
    if (['preorder', 'backorder'].includes(p.availability) && (!p.availabilityDate || !Number.isFinite(Date.parse(p.availabilityDate)) || Date.parse(p.availabilityDate) < now.getTime())) issues.push('missing_future_availability_date');
    return { ...p, eligible: !issues.length, issues, warnings: p.group === 'Outros' ? ['classification_required'] : [] };
  });
}
function metaFeed(products) {
  const columns = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand', 'gtin', 'sale_price', 'availability_date', 'item_group_id', 'custom_label_0'];
  const availability = { in_stock: 'in stock', out_of_stock: 'out of stock', preorder: 'preorder', backorder: 'available for order' };
  const cell = value => String(value ?? '').replace(/[\t\r\n]/g, ' ');
  return [columns, ...eligibleProducts(products).filter(p => p.eligible).map(p => [p.sku, p.name, p.description,
    availability[p.availability], 'new', `${p.regularPrice.toFixed(2)} BRL`, p.url, p.image, p.brand, p.gtin,
    p.price < p.regularPrice ? `${p.price.toFixed(2)} BRL` : '', p.availabilityDate || '', p.parentId !== p.id ? p.parentId : '', p.group])]
    .map(row => row.map(cell).join('\t')).join('\n') + '\n';
}
function reconcileGoogle(products, snapshot) {
  const offers = new Map((snapshot?.products || []).map(p => [p.offerId, p]));
  const expected = eligibleProducts(products);
  const rows = expected.map(p => {
    const offer = offers.get(p.sku);
    return { id: p.id, sku: p.sku, eligible: p.eligible, siteVersion: p.version, siteUpdatedAt: p.updatedAt,
      received: snapshot ? Boolean(offer) : null, observedAt: snapshot?.observedAt || null,
      approved: offer ? offer.destinations?.some(d => d.approved?.includes('BR')) || false : null,
      reason: !p.eligible ? p.issues.join(', ') : !snapshot ? 'merchant_unavailable' : !offer ? 'not_received' : offer.issues?.map(i => i.code).join(', ') || 'received',
      issues: offer?.issues || [] };
  });
  const skus = new Set(expected.map(p => p.sku));
  return { available: Boolean(snapshot), observedAt: snapshot?.observedAt || null, rows,
    unexpected: (snapshot?.products || []).filter(o => !skus.has(o.offerId)).map(o => ({ sku: o.offerId, reason: 'not_in_store_projection' })) };
}
const STORE_AUDIENCES = [
  { id: 'visitors', days: 30, ga4: 'page_view', meta: 'PageView', excludePaidDays: 180 },
  { id: 'product_interest', days: 30, ga4: 'view_item', meta: 'ViewContent', excludePaidDays: 180 },
  { id: 'cart', days: 14, ga4: 'add_to_cart', meta: 'AddToCart', excludePaidDays: 180 },
  { id: 'checkout', days: 7, ga4: 'begin_checkout', meta: 'InitiateCheckout', excludePaidDays: 180 },
  { id: 'paid_buyers', days: 180, ga4: 'purchase', meta: 'Purchase', excludePaidDays: null },
];
function campaignPlan(input, products, contents) {
  const total = Number(input.total), google = Number(input.google), meta = Number(input.meta);
  if (![total, google, meta].every(n => Number.isFinite(n) && n > 0 && Number.isSafeInteger(Math.round(n * 100)) && Math.abs(n * 100 - Math.round(n * 100)) < 0.000001) || Math.abs(Math.round(total * 100) - Math.round(google * 100) - Math.round(meta * 100)) > 0) throw Object.assign(new Error('Informe o teto mensal total e parcelas positivas de Google e Meta cuja soma seja o total.'), { status: 400 });
  const eligible = eligibleProducts(products).filter(p => p.eligible);
  const approved = contents.filter(c => c.kind === 'creative' && c.status === 'approved' && eligible.some(p => p.id === c.product_id && p.version === c.product_version));
  return { currency: 'BRL', period: 'monthly', total, google, meta, automaticTransfer: false, status: 'PAUSED',
    remotelyCreated: false, activationAllowed: false, context: 'ecommerce',
    structures: [{ platform: 'google_ads', type: 'PERFORMANCE_MAX', status: 'PAUSED', budget: google },
      { platform: 'meta_ads', type: 'OUTCOME_SALES', status: 'PAUSED', budget: meta, budgetLevel: 'campaign' }],
    productIds: eligible.map(p => p.sku).sort(), contentIds: approved.map(c => c.id).sort(), groups: GROUPS,
    blockers: [...(!eligible.length ? ['eligible_products_required'] : []), ...(!approved.length ? ['approved_creatives_required'] : []), 'platform_permissions_and_exclusions_review_required'],
    billingNote: 'Teto de planejamento mensal; a cobrança segue as regras de cada plataforma.' };
}
function seoOpportunities(records, today) {
  const shift = n => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  // Search Console final data can lag. Use the last fully covered day, never today.
  const through = records.filter(r => r.kind === 'search_total' && r.date < today).map(r => r.date).sort().at(-1);
  if (!through) return { available: false, reason: 'final_search_data_required', rows: [] };
  const end = Date.parse(`${through}T12:00:00Z`);
  const from = n => new Date(end - n * 86400000).toISOString().slice(0, 10);
  const covered = new Set(records.filter(r => r.kind === 'search_total').map(r => r.date));
  if (Array.from({ length: 56 }, (_, i) => from(i)).some(d => !covered.has(d))) return { available: false, reason: '56_complete_days_required', from: from(55), to: through, rows: [] };
  const pages = new Map();
  for (const row of records.filter(r => r.kind === 'search_page' && r.date >= from(55) && r.date <= through)) {
    if (!pages.has(row.landing)) pages.set(row.landing, { url: row.landing, current: { clicks: 0, impressions: 0, weighted: 0 }, previous: { clicks: 0, impressions: 0, weighted: 0 } });
    const period = pages.get(row.landing)[row.date >= from(27) ? 'current' : 'previous'];
    period.clicks += row.clicks; period.impressions += row.impressions; period.weighted += row.position * row.impressions;
  }
  const rows = [...pages.values()].map(p => { const c = p.current, prev = p.previous;
    return { url: p.url, clicks: c.clicks, impressions: c.impressions, ctr: c.impressions ? c.clicks / c.impressions * 100 : null,
      position: c.impressions ? c.weighted / c.impressions : null, previousClicks: prev.clicks,
      decline: prev.clicks > 0 ? (c.clicks - prev.clicks) / prev.clicks * 100 : null };
  }).filter(p => p.impressions >= 100 && ((p.position >= 4 && p.position <= 20) || p.ctr < 2 || p.decline <= -20)).sort((a, b) => b.impressions - a.impressions);
  return { available: true, from: from(27), to: through, previousFrom: from(55), previousTo: from(28), generatedForWeek: shift(-new Date(`${today}T12:00:00Z`).getUTCDay()), rows };
}
module.exports = { digest, projectProduct, eligibleProducts, metaFeed, reconcileGoogle, STORE_AUDIENCES, campaignPlan, seoOpportunities, GROUPS };
