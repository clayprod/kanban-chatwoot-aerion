const { normalizeOrder } = require('./domain');
function paidGa4Payload(order, context, now = Date.now()) {
  const normalized = normalizeOrder(order);
  if (!['processing', 'completed'].includes(order.status) || !order.date_paid_gmt || !normalized.paidAt) return { eligible: false, reason: 'payment_not_confirmed' };
  if (context?.statistics !== true || context?.revoked === true || !context.source
    || !Number.isFinite(Date.parse(context.recordedAt)) || Date.parse(context.recordedAt) > now
    || now - Date.parse(context.recordedAt) > 72 * 3600000
    || !/^\d+\.\d+$/.test(context.clientId || '')) return { eligible: false, reason: 'statistics_consent_and_client_id_required' };
  const paidAt = Date.parse(normalized.paidAt);
  if (!Number.isFinite(paidAt) || now - paidAt > 72 * 3600000 || paidAt > now) return { eligible: false, reason: 'measurement_time_window_expired' };
  if (!normalized.items?.length || normalized.items.some(i => !i.sku)) return { eligible: false, reason: 'sku_required' };
  const items = normalized.items.map(item => ({ item_id: item.sku, item_name: item.name, quantity: item.quantity,
    price: item.quantity ? item.revenue / item.quantity : 0 }));
  // GA4 reconciles browser and server by transaction_id. Do not add another
  // primary Google Ads conversion; Meta keeps its existing emitter untouched.
  return { eligible: true, transactionId: String(order.id), eventId: `aerion_purchase_${order.id}`,
    body: { client_id: context.clientId, timestamp_micros: Math.round(paidAt * 1000),
      consent: { ad_user_data: context.marketing === true ? 'GRANTED' : 'DENIED', ad_personalization: context.marketing === true ? 'GRANTED' : 'DENIED' },
      events: [{ name: 'purchase', params: { transaction_id: String(order.id), currency: normalized.currency,
        value: Math.round(items.reduce((sum, i) => sum + i.price * i.quantity, 0) * 100) / 100, items } }] } };
}
async function createMeasurementTables(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS ecommerce_marketing_conversions (
    destination text NOT NULL, transaction_id text NOT NULL, event_id text NOT NULL,
    state text NOT NULL, reason text, submitted_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(destination,transaction_id)
  )`);
}
module.exports = { paidGa4Payload, createMeasurementTables };
