const crypto = require('node:crypto');

const PROVIDERS = ['woocommerce', 'ga4', 'google_ads', 'meta_ads', 'search_console'];
const DAY = 86400000;
const day = (date = new Date()) => new Date(date).toISOString().slice(0, 10);
const shiftDay = (date, days) => day(new Date(`${date}T12:00:00Z`).getTime() + days * DAY);
const saoPauloDay = (date = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(date)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const amount = value => Math.round((Number(value) || 0) * 100) / 100;

function dateRange(query = {}) {
  const to = query.to || saoPauloDay();
  const from = query.from || shiftDay(to, -29);
  for (const value of [from, to]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || day(value) !== value) {
      throw Object.assign(new Error('Informe datas válidas no formato AAAA-MM-DD.'), { status: 400 });
    }
  }
  const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
  if (days < 1 || days > 731) throw Object.assign(new Error('Selecione um período de até 731 dias.'), { status: 400 });
  return { from, to, previousFrom: shiftDay(from, -days), previousTo: shiftDay(from, -1) };
}

function encryptionKey(env = process.env) {
  const value = env.ECOMMERCE_ENCRYPTION_KEY || '';
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new Error('Configure ECOMMERCE_ENCRYPTION_KEY com 64 caracteres hexadecimais no servidor.');
  return Buffer.from(value, 'hex');
}
function encrypt(value, key = encryptionKey()) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(part => part.toString('base64url')).join('.');
}
function decrypt(value, key = encryptionKey()) {
  const [iv, tag, data] = value.split('.').map(part => Buffer.from(part, 'base64url'));
  const cipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8'));
}
function verifyWebhook(raw, signature, secret) {
  if (!Buffer.isBuffer(raw) || !secret || typeof signature !== 'string') return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('base64');
  const actual = Buffer.from(signature);
  return actual.length === Buffer.byteLength(expected) && crypto.timingSafeEqual(actual, Buffer.from(expected));
}
function normalizeOrder(order, refunds = []) {
  const meta = Object.fromEntries((order.meta_data || []).map(item => [item.key, item.value]));
  const items = (order.line_items || []).map(item => {
    const refundItems = refunds.flatMap(refund => refund.line_items || []).filter(line =>
      (line.meta_data || []).some(entry => entry.key === '_refunded_item_id' && String(entry.value) === String(item.id)));
    const refunded = amount(refundItems.reduce((sum, line) => sum + Math.abs(Number(line.total) || 0), 0));
    return { id: String(item.id), productId: String(item.product_id), variationId: String(item.variation_id || 0),
      name: item.name, sku: item.sku || '', quantity: Number(item.quantity) || 0,
      refundedQuantity: refundItems.reduce((sum, line) => sum + Math.abs(Number(line.quantity) || 0), 0),
      subtotal: amount(item.subtotal), total: amount(item.total), refunded,
      revenue: amount((Number(item.total) || 0) - refunded) };
  });
  // The store implements Pix as a negative fee, not a WooCommerce coupon.
  // Allocate its remaining amount across net product lines so product/UTM totals
  // reconcile to paid product revenue without treating shipping fees as discounts.
  const paymentFees = (order.fee_lines || []).filter(fee => ['desconto no pix', 'mercado pago discount'].includes(String(fee.name || '').trim().toLowerCase()) && Number(fee.total) < 0);
  const paymentDiscountOriginal = amount(paymentFees.reduce((sum, fee) => sum - Number(fee.total), 0));
  const returnedDiscount = amount(refunds.flatMap(refund => refund.line_items || []).filter(line =>
    (line.meta_data || []).some(meta => meta.key === '_refunded_item_id' && paymentFees.some(fee => String(fee.id) === String(meta.value))))
    .reduce((sum, line) => sum + Math.max(0, Number(line.total) || 0), 0));
  const weights = items.map(item => Math.max(0, Math.round(item.revenue * 100)));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const discountCents = Math.min(weightTotal, Math.max(0, Math.round((paymentDiscountOriginal - returnedDiscount) * 100)));
  const shares = weights.map((weight, index) => {
    const exact = weightTotal ? discountCents * weight / weightTotal : 0;
    return { index, cents: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remainder = discountCents - shares.reduce((sum, share) => sum + share.cents, 0);
  [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index).forEach(share => { if (remainder > 0) { share.cents++; remainder--; } });
  shares.forEach(share => { items[share.index].paymentDiscount = share.cents / 100; items[share.index].revenue = amount(items[share.index].revenue - share.cents / 100); });
  // Amount-only refunds cannot safely be assigned to products or tax/shipping.
  const allocatedRefunds = refunds.reduce((sum, refund) => sum + (refund.line_items || []).reduce((n, line) =>
    n + Math.abs(Number(line.total) || 0) + Math.abs(Number(line.total_tax) || 0), 0), 0);
  const unallocatedRefund = amount(Math.max(0, refunds.reduce((sum, refund) => sum + Math.abs(Number(refund.amount) || 0), 0) - allocatedRefunds));
  const paidAt = order.date_paid_gmt ? `${order.date_paid_gmt.replace(/Z$/, '')}Z` : null;
  const createdAt = order.date_created_gmt ? `${order.date_created_gmt.replace(/Z$/, '')}Z` : null;
  const paid = Boolean(paidAt) && !['pending', 'failed', 'cancelled', 'trash'].includes(order.status);
  return {
    id: String(order.id), number: String(order.number || order.id), status: order.status,
    currency: order.currency || 'BRL', paidAt, paidDay: paidAt ? saoPauloDay(paidAt) : null,
    createdAt, createdDay: createdAt ? saoPauloDay(createdAt) : null,
    modifiedAt: order.date_modified_gmt ? `${order.date_modified_gmt.replace(/Z$/, '')}Z` : null,
    paid, items, coupons: (order.coupon_lines || []).map(line => ({ code: line.code, discount: amount(line.discount) })),
    revenue: paid ? amount(items.reduce((sum, item) => sum + item.revenue, 0)) : 0,
    shipping: amount(order.shipping_total), tax: amount(order.total_tax), discount: amount(order.discount_total),
    total: amount(order.total), refunded: amount(refunds.reduce((sum, refund) => sum + Number(refund.amount || 0), 0)),
    paymentDiscount: discountCents / 100, paymentDiscountOriginal,
    unallocatedRefund,
    attribution: {
      linkId: String(meta._aerion_utm_link_id || ''),
      source: String(meta._wc_order_attribution_utm_source || ''),
      medium: String(meta._wc_order_attribution_utm_medium || ''),
      campaign: String(meta._wc_order_attribution_utm_campaign || ''),
      content: String(meta._wc_order_attribution_utm_content || ''),
      term: String(meta._wc_order_attribution_utm_term || ''),
      sourceType: String(meta._wc_order_attribution_source_type || ''),
    },
  };
}

function buildReport({ orders = [], metrics = [], links = [], visits = [], connections = [], range }) {
  const orderDay = o => o.paidDay || o.createdDay || (o.createdAt ? saoPauloDay(o.createdAt) : '');
  const currentOrders = orders.filter(o => orderDay(o) >= range.from && orderDay(o) <= range.to);
  const paid = currentOrders.filter(o => o.paid);
  const previous = orders.filter(o => o.paid && o.paidDay >= range.previousFrom && o.paidDay <= range.previousTo);
  const byProvider = provider => metrics.filter(m => m.provider === provider && m.date >= range.from && m.date <= range.to);
  const sum = (rows, key) => amount(rows.reduce((n, row) => n + Number(row[key] || 0), 0));
  const available = provider => connections.some(c => c.provider === provider && c.last_success_at);
  const wooHistoryFrom = connections.find(c => c.provider === 'woocommerce')?.info?.history_from;
  const traffic = byProvider('ga4');
  const ads = metrics.filter(m => ['google_ads', 'meta_ads'].includes(m.provider) && m.date >= range.from && m.date <= range.to);
  const currencies = [...new Set([...currentOrders.map(o => o.currency), ...ads.map(m => m.currency)].filter(Boolean))];
  const validPaid = paid.filter(o => o.currency === 'BRL');
  const validAds = ads.filter(m => m.currency === 'BRL');
  const revenue = sum(validPaid, 'revenue');
  const spend = sum(validAds, 'spend');
  const unpaid = currentOrders.filter(o => !o.paid && o.currency === 'BRL' && ['pending', 'on-hold'].includes(o.status));
  const efficiency = rows => {
    const totals = Object.fromEntries(['spend', 'clicks', 'impressions', 'conversions', 'conversionValue'].map(key => [key, sum(rows, key)]));
    return { ...totals, cpc: totals.clicks ? totals.spend / totals.clicks : null,
      ctr: totals.impressions ? totals.clicks / totals.impressions * 100 : null,
      cpm: totals.impressions ? totals.spend / totals.impressions * 1000 : null,
      cpa: totals.conversions ? totals.spend / totals.conversions : null,
      roas: totals.spend ? totals.conversionValue / totals.spend : null };
  };
  const platforms = ['google_ads', 'meta_ads'].map(provider => ({ provider, available: available(provider), currency: 'BRL',
    ...(available(provider) ? efficiency(validAds.filter(row => row.provider === provider)) : Object.fromEntries(['spend', 'clicks', 'impressions', 'conversions', 'conversionValue', 'cpc', 'ctr', 'cpm', 'cpa', 'roas'].map(key => [key, null]))) }));
  const group = (rows, getKey, make, add) => {
    const map = new Map();
    for (const row of rows) {
      const key = getKey(row);
      if (!map.has(key)) map.set(key, make(row));
      add(map.get(key), row);
    }
    return [...map.values()];
  };
  const products = group(validPaid.flatMap(o => o.items), i => `${i.productId}:${i.variationId}`, i => ({
    id: `${i.productId}:${i.variationId}`, name: i.name, sku: i.sku, quantity: 0, revenue: 0, refunded: 0,
  }), (r, i) => { r.quantity += i.quantity - i.refundedQuantity; r.revenue = amount(r.revenue + i.revenue); r.refunded = amount(r.refunded + i.refunded); }).sort((a, b) => b.revenue - a.revenue);
  const coupons = group(validPaid.flatMap(o => o.coupons.map(c => ({ ...c, order: o }))), c => c.code, c => ({
    code: c.code, orders: 0, discount: 0, revenue: 0, withUtm: 0, withoutUtm: 0,
  }), (r, c) => { r.orders++; r.discount = amount(r.discount + c.discount); r.revenue = amount(r.revenue + c.order.revenue);
    if (c.order.attribution.linkId || c.order.attribution.source) r.withUtm++; else r.withoutUtm++;
  }).sort((a, b) => b.revenue - a.revenue);
  const daily = [];
  for (let date = range.from; date <= range.to; date = shiftDay(date, 1)) {
    const dayOrders = validPaid.filter(o => o.paidDay === date);
    daily.push({ date, revenue: available('woocommerce') ? sum(dayOrders, 'revenue') : null,
      orders: available('woocommerce') ? dayOrders.length : null,
      sessions: available('ga4') ? sum(traffic.filter(m => m.date === date && m.kind === 'total'), 'sessions') : null,
      activeUsers: available('ga4') ? sum(traffic.filter(m => m.date === date && m.kind === 'total'), 'activeUsers') : null,
      unpaidValue: available('woocommerce') ? sum(unpaid.filter(o => o.createdDay === date), 'total') : null,
      googleSpend: available('google_ads') ? sum(validAds.filter(m => m.date === date && m.provider === 'google_ads'), 'spend') : null,
      metaSpend: available('meta_ads') ? sum(validAds.filter(m => m.date === date && m.provider === 'meta_ads'), 'spend') : null,
      spend: available('google_ads') || available('meta_ads') ? sum(validAds.filter(m => m.date === date), 'spend') : null });
  }
  const utms = group(validPaid, o => JSON.stringify([o.attribution.linkId, o.attribution.source, o.attribution.medium, o.attribution.campaign, o.attribution.content]), o => ({
    ...o.attribution, orders: 0, revenue: 0, withCoupon: 0,
  }), (r, o) => { r.orders++; r.revenue = amount(r.revenue + o.revenue); if (o.coupons.length) r.withCoupon++; });
  const linkReports = links.map(link => {
    const attributed = validPaid.filter(o => o.attribution.linkId === link.link_id);
    const linkVisits = visits.filter(v => v.link_id === link.link_id && v.date >= range.from && v.date <= range.to);
    const bridgeAvailable = connections.some(c => c.provider === 'woocommerce' && c.info?.bridge_last_success_at);
    return { ...link, landings: bridgeAvailable ? sum(linkVisits, 'landings') : null, visitorDays: bridgeAvailable ? sum(linkVisits, 'visitors') : null,
      orders: attributed.length, revenue: sum(attributed, 'revenue'),
      withCoupon: attributed.filter(o => o.coupons.length).length,
      couponOutside: validPaid.filter(o => o.attribution.linkId !== link.link_id && o.coupons.some(c => (link.coupon_codes || []).includes(c.code))).length };
  });
  const totalTraffic = traffic.filter(m => m.kind === 'total');
  return {
    range, connections, currencies, summary: {
      revenue: available('woocommerce') ? revenue : null,
      previousRevenue: available('woocommerce') && (!wooHistoryFrom || range.previousFrom >= wooHistoryFrom) ? sum(previous.filter(o => o.currency === 'BRL'), 'revenue') : null,
      orders: available('woocommerce') ? validPaid.length : null,
      ticket: available('woocommerce') && validPaid.length ? amount(revenue / validPaid.length) : null,
      sessions: available('ga4') ? sum(totalTraffic, 'sessions') : null,
      purchases: available('ga4') ? sum(totalTraffic, 'purchases') : null,
      spend: available('google_ads') || available('meta_ads') ? spend : null,
      revenuePerAdSpend: available('woocommerce') && spend ? amount(revenue / spend) : null,
      unpaidOrders: available('woocommerce') ? unpaid.length : null,
      unpaidValue: available('woocommerce') ? sum(unpaid, 'total') : null,
      media: platforms.some(p => p.available) ? efficiency(validAds) : null,
      mediaPartial: platforms.some(p => !p.available),
      cartAbandonmentRate: null,
      unallocatedRefund: sum(validPaid, 'unallocatedRefund'),
    },
    daily, platforms, products, coupons, utms: utms.sort((a, b) => b.revenue - a.revenue), links: linkReports,
    orders: currentOrders.sort((a, b) => String(b.paidAt || b.createdAt).localeCompare(String(a.paidAt || a.createdAt))),
    traffic: traffic.filter(m => m.kind !== 'total'), ads,
  };
}
module.exports = { PROVIDERS, day, shiftDay, saoPauloDay, amount, dateRange, encrypt, decrypt, encryptionKey, verifyWebhook, normalizeOrder, buildReport };
