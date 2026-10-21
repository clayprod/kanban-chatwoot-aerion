const { encrypt, decrypt, encryptionKey, day, shiftDay, normalizeOrder } = require('./domain');
const crypto = require('node:crypto');

async function createTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ecommerce_connections (
      provider text PRIMARY KEY, config jsonb NOT NULL DEFAULT '{}', secrets text NOT NULL,
      enabled boolean NOT NULL DEFAULT false, info jsonb NOT NULL DEFAULT '{}',
      cursor jsonb, status text NOT NULL DEFAULT 'pending', error text,
      last_success_at timestamptz, last_reconciled_at timestamptz, next_run_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS ecommerce_records (
      provider text NOT NULL, kind text NOT NULL, record_id text NOT NULL,
      date date, data jsonb NOT NULL, generation text, updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (provider, kind, record_id)
    );
    CREATE INDEX IF NOT EXISTS ecommerce_records_period ON ecommerce_records(provider, kind, date);
    ALTER TABLE ecommerce_records ADD COLUMN IF NOT EXISTS generation text;
    CREATE TABLE IF NOT EXISTS ecommerce_webhooks (
      delivery_id text PRIMARY KEY, topic text NOT NULL, resource_id bigint,
      received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS ecommerce_oauth_states (
      state_hash text PRIMARY KEY, expires_at timestamptz NOT NULL, context text NOT NULL
    );
    ALTER TABLE ecommerce_oauth_states ADD COLUMN IF NOT EXISTS context text NOT NULL DEFAULT '';
  `);
}
const PUBLIC_FIELDS = {
  woocommerce: ['url', 'report_user'], ga4: ['property_id'],
  google_ads: ['customer_id', 'login_customer_id', 'client_id', 'auth_type'], meta_ads: ['account_id'],
  search_console: ['site_url'],
};
const SECRET_FIELDS = {
  woocommerce: ['consumer_key', 'consumer_secret', 'report_password', 'webhook_secret'],
  ga4: ['service_account'], google_ads: ['client_secret', 'refresh_token', 'service_account'], meta_ads: ['access_token'],
  search_console: ['service_account'],
};
const lockId = provider => ({ woocommerce: 735101, ga4: 735102, google_ads: 735103, meta_ads: 735104, search_console: 735105 }[provider]);
function publicConnection(row) {
  return { provider: row.provider, config: row.config, enabled: row.enabled, status: row.status,
    error: row.error, info: row.info, syncing: Boolean(row.cursor), last_success_at: row.last_success_at,
    last_reconciled_at: row.last_reconciled_at, next_run_at: row.next_run_at,
    progress: row.cursor ? { from: row.cursor.from, to: row.cursor.to, phase: row.cursor.phase || 'metrics', page: row.cursor.page || 1 } : null };
}
async function upsertRecord(db, provider, kind, id, date, data, generation = null) {
  await db.query(`INSERT INTO ecommerce_records(provider,kind,record_id,date,data,generation) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(provider,kind,record_id) DO UPDATE SET date=EXCLUDED.date,data=EXCLUDED.data,generation=EXCLUDED.generation,updated_at=now()`,
  [provider, kind, String(id), date, data, generation]);
}
async function transaction(client, fn) {
  await client.query('BEGIN');
  try { const result = await fn(); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
}
function createSync({ pool, providers, env = process.env }) {
  let ticking = false;
  async function syncOrder(client, config, id) {
    let order;
    try { order = (await providers.woo(config, `orders/${id}`)).data; }
    catch (error) {
      if (error.httpStatus !== 404) throw error;
      await client.query("DELETE FROM ecommerce_records WHERE provider='woocommerce' AND kind='order' AND record_id=$1", [String(id)]);
      return;
    }
    const refunds = [];
    if (order.refunds?.length) {
      for (let page = 1; ; page++) {
        const { data } = await providers.woo(config, `orders/${id}/refunds`, { per_page: 100, page });
        refunds.push(...data);
        if (data.length < 100) break;
      }
    }
    const normalized = normalizeOrder(order, refunds);
    await upsertRecord(client, 'woocommerce', 'order', normalized.id, normalized.paidDay || normalized.createdDay, normalized);
  }
  async function run(provider, { force = false } = {}) {
    const client = await pool.connect();
    let locked = false;
    try {
      locked = (await client.query('SELECT pg_try_advisory_lock($1) AS locked', [lockId(provider)])).rows[0].locked;
      if (!locked) return;
      const row = (await client.query('SELECT * FROM ecommerce_connections WHERE provider=$1', [provider])).rows[0];
      if (!row?.enabled || (!force && new Date(row.next_run_at) > new Date())) return;
      const config = { ...row.config, ...decrypt(row.secrets, encryptionKey(env)) };
      await client.query("UPDATE ecommerce_connections SET status='syncing',error=NULL WHERE provider=$1", [provider]);
      const info = row.cursor ? row.info : { ...row.info, ...await providers.test(provider, config) };
      await client.query('UPDATE ecommerce_connections SET info=$2 WHERE provider=$1', [provider, info]);
      const today = day();
      const bootstrap = !row.last_success_at;
      const start = new Date(); start.setUTCFullYear(start.getUTCFullYear() - 1);
      if (!info.history_from) {
        info.history_from = day(start);
        await client.query('UPDATE ecommerce_connections SET info=$2 WHERE provider=$1', [provider, info]);
      }
      const reconcile = !row.last_reconciled_at || day(row.last_reconciled_at) < today;
      const lastBridgeDay = row.info.bridge_last_success_at ? shiftDay(day(row.info.bridge_last_success_at), -2) : day(start);
      const visitsFrom = lastBridgeDay < day(start) ? day(start) : lastBridgeDay;
      const initialFrom = bootstrap ? day(start) : reconcile ? shiftDay(today, -89) : shiftDay(today, -2);
      let cursor = row.cursor || (provider === 'woocommerce'
        ? { phase: 'orders', page: 1, from: row.last_success_at ? new Date(new Date(row.last_success_at).getTime() - 120000).toISOString().slice(0, 19) : `${day(start)}T00:00:00`,
          to: new Date().toISOString().slice(0, 19), visitsFrom, reconcile }
        : { from: initialFrom, to: today, next: initialFrom, reconcile });
      if (!cursor.generation) cursor.generation = crypto.randomUUID();
      const cycleEnd = provider === 'woocommerce' ? `${cursor.to}Z` : new Date().toISOString();
      // Save the fixed upper bound before any external requests. A failed batch resumes exactly here.
      await client.query('UPDATE ecommerce_connections SET cursor=$2 WHERE provider=$1', [provider, cursor]);
      if (provider === 'woocommerce') {
        const events = (await client.query('SELECT * FROM ecommerce_webhooks WHERE processed_at IS NULL ORDER BY received_at LIMIT 10')).rows;
        for (const event of events) {
          if (['order.deleted', 'order.trashed'].includes(event.topic)) {
            await client.query("DELETE FROM ecommerce_records WHERE provider='woocommerce' AND kind='order' AND record_id=$1", [String(event.resource_id)]);
          } else if (event.resource_id) await syncOrder(client, config, event.resource_id);
          await client.query('UPDATE ecommerce_webhooks SET processed_at=now() WHERE delivery_id=$1', [event.delivery_id]);
        }
        for (let batch = 0; batch < 6 && cursor; batch++) {
          const { phase, page } = cursor;
          let data;
          const nextPhase = { orders: 'products', products: 'coupons', coupons: 'links', links: 'visits', visits: null };
          if (['links', 'visits'].includes(phase)) {
            if (!config.report_user || !config.report_password) { cursor = null; break; }
            try { data = (await providers.bridge(config, phase, { page, per_page: 100, from: cursor.visitsFrom, to: today })).data; }
            catch {
              info.tracking_error = 'Relatórios de links Aerion indisponíveis. Vendas continuam atualizadas; revise o plugin e suas credenciais.';
              await client.query('UPDATE ecommerce_connections SET info=$2 WHERE provider=$1', [provider, info]);
              cursor = null;
              break;
            }
          } else {
            data = (await providers.woo(config, phase, { per_page: 100, page,
              ...(phase === 'orders' ? { modified_after: cursor.from, modified_before: cursor.to, dates_are_gmt: 'true', orderby: 'modified', order: 'asc', status: 'any' } : {}) })).data;
          }
          if (!Array.isArray(data)) throw new Error('A plataforma não retornou uma lista válida.');
          const normalized = [];
          for (const item of data) {
            if (phase === 'orders') {
              const refunds = [];
              if (item.refunds?.length) {
                for (let refundPage = 1; ; refundPage++) {
                  const result = (await providers.woo(config, `orders/${item.id}/refunds`, { per_page: 100, page: refundPage })).data;
                  refunds.push(...result);
                  if (result.length < 100) break;
                }
              }
              normalized.push({ kind: 'order', id: item.id, data: normalizeOrder(item, refunds) });
            } else if (phase === 'products') normalized.push({ kind: 'product', id: item.id, data: { id: item.id, categories: (item.categories || []).map(c => c.name), name: item.name, sku: item.sku } });
            else if (phase === 'coupons') normalized.push({ kind: 'coupon', id: item.code, data: { code: item.code, discountType: item.discount_type, amount: item.amount, expiresAt: item.date_expires_gmt, usageLimit: item.usage_limit, usageCount: item.usage_count } });
            else normalized.push({ kind: phase === 'links' ? 'link' : 'visit', id: phase === 'links' ? item.link_id : `${item.link_id}:${item.date}`, data: item });
          }
          const next = data.length === 100 ? { ...cursor, page: page + 1 } : nextPhase[phase] ? { ...cursor, phase: nextPhase[phase], page: 1 } : null;
          const completedAt = cursor.to;
          await transaction(client, async () => {
            for (const record of normalized) await upsertRecord(client, provider, record.kind, record.id,
              record.data.paidDay || record.data.date || record.data.createdDay || null, record.data, cursor.generation);
            if (['products', 'coupons', 'links'].includes(phase) && next?.phase !== phase) {
              const kind = { products: 'product', coupons: 'coupon', links: 'link' }[phase];
              await client.query('DELETE FROM ecommerce_records WHERE provider=$1 AND kind=$2 AND generation IS DISTINCT FROM $3', [provider, kind, cursor.generation]);
            }
            await client.query('UPDATE ecommerce_connections SET cursor=$2,last_success_at=COALESCE($3::timestamptz,last_success_at) WHERE provider=$1', [provider, next, next ? null : `${completedAt}Z`]);
            if (phase === 'visits' && !next) {
              info.bridge_last_success_at = new Date().toISOString();
              info.tracking_error = null;
              await client.query('UPDATE ecommerce_connections SET info=$2 WHERE provider=$1', [provider, info]);
            }
          });
          cursor = next;
        }
      } else {
        for (let batch = 0; batch < 3 && cursor; batch++) {
          const from = cursor.next;
          const to = shiftDay(from, 6) < cursor.to ? shiftDay(from, 6) : cursor.to;
          const metrics = await providers.metrics(provider, config, from, to, info);
          const next = to < cursor.to ? { ...cursor, next: shiftDay(to, 1) } : null;
          await transaction(client, async () => {
            await client.query("DELETE FROM ecommerce_records WHERE provider=$1 AND kind='metric' AND date BETWEEN $2 AND $3", [provider, from, to]);
            for (let i = 0; i < metrics.length; i++) {
              const metric = metrics[i];
              const id = crypto.createHash('sha256').update(JSON.stringify([metric.date, metric.kind, metric.source, metric.medium, metric.campaignId, metric.campaign, metric.content, metric.landing, metric.event])).digest('hex');
              await upsertRecord(client, provider, 'metric', id, metric.date, metric);
            }
            await client.query('UPDATE ecommerce_connections SET cursor=$2,last_success_at=CASE WHEN $2::jsonb IS NULL THEN now() ELSE last_success_at END WHERE provider=$1', [provider, next]);
          });
          cursor = next;
        }
      }
      await client.query(`UPDATE ecommerce_connections SET cursor=$2,status=$3,error=NULL,
        last_success_at=CASE WHEN $2::jsonb IS NULL THEN $6::timestamptz ELSE last_success_at END,
        last_reconciled_at=CASE WHEN $4 THEN now() ELSE last_reconciled_at END,
        next_run_at=now()+($5::int*interval '1 second') WHERE provider=$1`,
      [provider, cursor, cursor ? 'syncing' : 'connected', !cursor && reconcile, cursor ? 60 : provider === 'woocommerce' ? 900 : 3600, cycleEnd]);
    } catch (error) {
      // Only controlled provider messages are retained; never database errors or raw upstream text.
      const message = error.retrySeconds ? error.message : 'A sincronização falhou. Revise as credenciais e a configuração do servidor.';
      await client.query("UPDATE ecommerce_connections SET status='error',error=$2,next_run_at=now()+($3::int*interval '1 second') WHERE provider=$1", [provider, message, error.retrySeconds || 300]);
    } finally {
      if (locked) await client.query('SELECT pg_advisory_unlock($1)', [lockId(provider)]);
      client.release();
    }
  }
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const { rows } = await pool.query('SELECT provider FROM ecommerce_connections WHERE enabled AND next_run_at<=now() ORDER BY next_run_at');
      // Sources have independent rate limits. A long GA4 backfill must not delay order updates.
      await Promise.allSettled(rows.map(row => run(row.provider)));
      await pool.query("DELETE FROM ecommerce_webhooks WHERE processed_at < now()-interval '30 days'; DELETE FROM ecommerce_oauth_states WHERE expires_at<now()");
    } finally { ticking = false; }
  }
  return { run, tick };
}
module.exports = { createTables, PUBLIC_FIELDS, SECRET_FIELDS, lockId, publicConnection, upsertRecord, transaction, createSync, encrypt, decrypt };
