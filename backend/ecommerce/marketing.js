const crypto = require('node:crypto');
const { projectProduct, eligibleProducts, metaFeed, reconcileGoogle, STORE_AUDIENCES, campaignPlan, seoOpportunities } = require('./marketingDomain');
const { connectionConfig, transaction, lockId } = require('./store');
const { encryptionKey } = require('./domain');
const { createCustomerAudienceTables, syncCustomerAudiences } = require('./customerAudiences');
const { paidGa4Payload, createMeasurementTables } = require('./serverMeasurement');

async function createMarketingTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ecommerce_marketing_products (
      product_id text PRIMARY KEY, parent_id text NOT NULL, data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ecommerce_marketing_parent ON ecommerce_marketing_products(parent_id);
    CREATE TABLE IF NOT EXISTS ecommerce_marketing_jobs (
      id bigserial PRIMARY KEY, kind text NOT NULL, resource text NOT NULL,
      status text NOT NULL DEFAULT 'pending', revision bigint NOT NULL DEFAULT 1,
      attempts int NOT NULL DEFAULT 0, next_run_at timestamptz NOT NULL DEFAULT now(),
      lease_until timestamptz, error text, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(kind,resource)
    );
    CREATE INDEX IF NOT EXISTS ecommerce_marketing_due ON ecommerce_marketing_jobs(status,next_run_at);
    CREATE TABLE IF NOT EXISTS ecommerce_marketing_history (
      id bigserial PRIMARY KEY, job_id bigint, kind text NOT NULL, resource text NOT NULL,
      outcome text NOT NULL, error text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS ecommerce_marketing_state (
      name text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS ecommerce_marketing_content (
      id uuid PRIMARY KEY, product_id text NOT NULL, product_version text NOT NULL,
      kind text NOT NULL, status text NOT NULL DEFAULT 'draft', data jsonb NOT NULL,
      reviewed_by text, reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await createCustomerAudienceTables(pool);
  await createMeasurementTables(pool);
}
async function enqueueMarketing(db, kind, resource) {
  await db.query(`INSERT INTO ecommerce_marketing_jobs(kind,resource) VALUES($1,$2)
    ON CONFLICT(kind,resource) DO UPDATE SET revision=ecommerce_marketing_jobs.revision+1,
      status=CASE WHEN ecommerce_marketing_jobs.status='running' THEN 'running' ELSE 'pending' END,
      attempts=0,next_run_at=now(),error=NULL,updated_at=now()`, [kind, String(resource)]);
}
async function saveState(db, name, data) {
  await db.query(`INSERT INTO ecommerce_marketing_state(name,data) VALUES($1,$2)
    ON CONFLICT(name) DO UPDATE SET data=EXCLUDED.data,updated_at=now()`, [name, data]);
}
async function productsFrom(db) {
  return (await db.query('SELECT data,updated_at FROM ecommerce_marketing_products ORDER BY product_id')).rows.map(r => ({ ...r.data, updatedAt: r.updated_at }));
}
function createMarketing({ pool, providers, env = process.env }) {
  let ticking = false;
  const feedToken = () => env.ECOMMERCE_META_FEED_TOKEN || crypto.createHmac('sha256', encryptionKey(env)).update('aerion-meta-feed-v1').digest('hex');
  const metaSettings = async db => {
    const saved = (await db.query("SELECT data FROM ecommerce_marketing_state WHERE name='meta_setup'")).rows[0]?.data || {};
    return { catalogId: env.ECOMMERCE_META_CATALOG_ID || saved.catalogId, feedId: env.ECOMMERCE_META_FEED_ID || saved.feedId,
      businessId: env.ECOMMERCE_META_BUSINESS_ID, pixelId: env.ECOMMERCE_META_PIXEL_ID || '1668777180919759' };
  };
  const load = async (db, provider) => {
    const row = (await db.query('SELECT * FROM ecommerce_connections WHERE provider=$1', [provider])).rows[0];
    if (!row?.enabled) throw new Error('connection_required');
    return connectionConfig(db, row, env);
  };
  async function persistProducts(db, products, parentId = null) {
    const ids = products.map(p => p.id);
    if (parentId != null) await db.query('DELETE FROM ecommerce_marketing_products WHERE (parent_id=$1 OR product_id=$1) AND NOT(product_id=ANY($2::text[]))', [String(parentId), ids]);
    else await db.query('DELETE FROM ecommerce_marketing_products WHERE NOT(product_id=ANY($1::text[]))', [ids]);
    for (const p of products) {
      await db.query(`INSERT INTO ecommerce_marketing_products(product_id,parent_id,data) VALUES($1,$2,$3)
        ON CONFLICT(product_id) DO UPDATE SET parent_id=EXCLUDED.parent_id,data=EXCLUDED.data,updated_at=now()
        WHERE ecommerce_marketing_products.data->>'version' IS DISTINCT FROM EXCLUDED.data->>'version'`, [p.id, p.parentId, p]);
    }
    await db.query(`UPDATE ecommerce_marketing_content c SET status='stale'
      WHERE status IN ('approved','draft','published') AND NOT EXISTS (
        SELECT 1 FROM ecommerce_marketing_products p WHERE p.product_id=c.product_id AND p.data->>'version'=c.product_version)`);
    await db.query("DELETE FROM ecommerce_marketing_jobs WHERE kind='seo' AND resource NOT IN (SELECT product_id FROM ecommerce_marketing_products)");
    await db.query("DELETE FROM ecommerce_marketing_state WHERE name LIKE 'seo:%' AND substring(name FROM 5) NOT IN (SELECT product_id FROM ecommerce_marketing_products)");
  }
  async function productJob(db, job) {
    const config = await load(db, 'woocommerce');
    if (!config.report_user || !config.report_password) throw new Error('consumer_bridge_required');
    const all = [], seen = new Set();
    const full = job.kind === 'reconcile';
    for (let page = 1; page <= 1000; page++) {
      let result;
      try { result = (await providers.bridge(config, 'marketing-products', full ? { page, per_page: 100 } : { product_id: job.resource })).data; }
      catch (error) {
        if (!full && error.httpStatus === 404) {
          await transaction(db, async () => {
            await db.query('DELETE FROM ecommerce_marketing_products WHERE product_id=$1 OR parent_id=$1', [job.resource]);
            await db.query("UPDATE ecommerce_marketing_content SET status='stale' WHERE product_id=$1 OR product_id NOT IN (SELECT product_id FROM ecommerce_marketing_products)", [job.resource]);
            await db.query("DELETE FROM ecommerce_marketing_jobs WHERE kind='seo' AND resource NOT IN (SELECT product_id FROM ecommerce_marketing_products)");
            await db.query("DELETE FROM ecommerce_marketing_state WHERE name LIKE 'seo:%' AND substring(name FROM 5) NOT IN (SELECT product_id FROM ecommerce_marketing_products)");
          });
          return;
        }
        throw error;
      }
      if (result.price_source !== 'aerion_consumer_card_v1' || !Array.isArray(result.products) || !Number.isInteger(result.parents_count) || result.parents_count < 0 || result.parents_count > 100) throw new Error('invalid_consumer_snapshot');
      for (const raw of result.products) {
        const product = projectProduct(raw);
        if (seen.has(product.id)) throw new Error('repeated_product_page');
        seen.add(product.id); all.push(product);
      }
      if (!full || result.parents_count < 100) break;
      if (page === 1000) throw new Error('pagination_limit');
    }
    await transaction(db, async () => {
      // A variation webhook is resolved to its parent by the bridge.
      const parent = all[0]?.parentId || job.resource;
      await persistProducts(db, all, full ? null : parent);
      await saveState(db, 'products', { status: 'operational', observedAt: new Date().toISOString(), source: 'WooCommerce · preço público no cartão', fullReconciliation: full });
      for (const p of all.filter(p => p.published)) await enqueueMarketing(db, 'seo', p.id);
    });
  }
  async function execute(db, job) {
    if (job.kind === 'webhooks') {
      const config = await load(db, 'woocommerce');
      const origin = new URL(env.ECOMMERCE_PUBLIC_URL);
      if (origin.protocol !== 'https:' || origin.username || origin.password) throw new Error('connection_required');
      const result = await providers.ensureProductWebhooks(config, `${origin.origin}/api/ecommerce/webhooks/woocommerce`);
      await saveState(db, 'webhooks', result);
      return;
    }
    if (job.kind === 'campaign_stage') {
      const states = Object.fromEntries((await db.query("SELECT name,data FROM ecommerce_marketing_state WHERE name IN ('campaign_plan','campaign_review')")).rows.map(r => [r.name, r.data]));
      if (!states.campaign_plan || !states.campaign_review?.exclusionsReviewed) throw new Error('campaign_review_required');
      const products = await productsFrom(db);
      const contents = (await db.query('SELECT * FROM ecommerce_marketing_content')).rows;
      const plan = campaignPlan(states.campaign_plan, products, contents);
      if (!plan.productIds.length || !plan.contentIds.length) throw new Error('campaign_assets_required');
      const key = crypto.createHash('sha256').update(JSON.stringify([plan.total, plan.google, plan.meta, plan.productIds, plan.contentIds])).digest('hex').slice(0, 16);
      if (states.campaign_review.key !== key) throw new Error('campaign_review_required');
      const merchant = (await db.query("SELECT config FROM ecommerce_connections WHERE provider='merchant_center'")).rows[0]?.config;
      if (!merchant?.account_id) throw new Error('merchant_ads_approval_required');
      // Only create named paused shells. Asset groups/ad sets and activation
      // remain gated by approved files, buyer exclusions and platform review.
      const google = await providers.stageGoogleSalesCampaign(await load(db, 'google_ads'), plan, merchant.account_id, key);
      await saveState(db, 'campaign_google', { ...google, planKey: key, monthlyPlannedBudget: plan.google });
      const meta = await providers.stageMetaSalesCampaign(await load(db, 'meta_ads'), plan, key);
      await saveState(db, 'campaign_meta', { ...meta, planKey: key, monthlyPlannedBudget: plan.meta });
      return;
    }
    if (job.kind === 'seo_publish') {
      const content = (await db.query('SELECT * FROM ecommerce_marketing_content WHERE id=$1', [job.resource])).rows[0];
      if (content?.status === 'published') return;
      if (!content || content.kind !== 'seo' || content.status !== 'approved') return;
      const product = (await db.query('SELECT data FROM ecommerce_marketing_products WHERE product_id=$1', [content.product_id])).rows[0]?.data;
      if (!product || product.version !== content.product_version) {
        await db.query("UPDATE ecommerce_marketing_content SET status='stale' WHERE id=$1", [content.id]); return;
      }
      const config = await load(db, 'woocommerce');
      const result = await providers.publishProductSeo(config, product, content);
      if (result.published !== true || result.content_id !== content.id) throw new Error('publication_not_confirmed');
      const updated = projectProduct(result.product);
      if (updated.id !== product.id) throw new Error('publication_not_confirmed');
      await transaction(db, async () => {
        await db.query('UPDATE ecommerce_marketing_products SET data=$2,updated_at=now() WHERE product_id=$1', [product.id, updated]);
        await db.query("UPDATE ecommerce_marketing_content SET status='published',product_version=$2 WHERE id=$1", [content.id, updated.version]);
        await db.query("UPDATE ecommerce_marketing_content SET status='stale' WHERE product_id=$1 AND id<>$2 AND status IN ('approved','draft') AND product_version<>$3", [product.id, content.id, updated.version]);
      });
      return;
    }
    if (job.kind === 'paid_event') {
      if (env.ECOMMERCE_GA4_SERVER_PURCHASE_ENABLED !== '1' || env.ECOMMERCE_GA4_SERVER_PURCHASE_VALIDATED !== '1') return;
      const config = await load(db, 'woocommerce');
      const settings = { measurementId: env.ECOMMERCE_GA4_MEASUREMENT_ID, apiSecret: env.ECOMMERCE_GA4_MEASUREMENT_SECRET };
      const destination = `${settings.measurementId}:${config.url}`;
      const previous = (await db.query('SELECT state FROM ecommerce_marketing_conversions WHERE destination=$1 AND transaction_id=$2', [destination, job.resource])).rows[0];
      if (previous?.state === 'submitted') return;
      const excluded = (await db.query('SELECT 1 FROM ecommerce_order_exclusions WHERE order_id=$1 AND excluded', [job.resource])).rowCount;
      if (excluded) return;
      const { data: order } = await providers.woo(config, `orders/${job.resource}`);
      const context = (order.meta_data || []).find(m => m.key === '_aerion_measurement_context')?.value;
      const event = paidGa4Payload(order, context);
      if (event.eligible) await providers.ga4ServerPurchase(settings, event.body);
      await db.query(`INSERT INTO ecommerce_marketing_conversions(destination,transaction_id,event_id,state,reason,submitted_at)
        VALUES($1,$2,$3,$4,$5,CASE WHEN $4='submitted' THEN now() ELSE NULL END)
        ON CONFLICT(destination,transaction_id) DO UPDATE SET state=EXCLUDED.state,reason=EXCLUDED.reason,submitted_at=EXCLUDED.submitted_at,updated_at=now()`,
      [destination, job.resource, `aerion_purchase_${job.resource}`, event.eligible ? 'submitted' : 'ineligible', event.reason || null]);
      return;
    }
    if (['product', 'reconcile'].includes(job.kind)) return productJob(db, job);
    if (job.kind === 'seo') {
      const p = (await db.query('SELECT data FROM ecommerce_marketing_products WHERE product_id=$1', [job.resource])).rows[0]?.data;
      if (!p?.published || !p.url) return;
      const config = await load(db, 'woocommerce');
      const result = await providers.auditProduct(config, p);
      await saveState(db, `seo:${p.id}`, { ...result, productVersion: p.version });
      return;
    }
    if (job.kind === 'meta') {
      const config = await load(db, 'meta_ads');
      const settings = await metaSettings(db);
      if (!settings.catalogId) throw new Error('meta_catalog_required');
      const snapshot = await providers.metaCatalog(config, settings.catalogId, settings.feedId);
      await saveState(db, 'meta_catalog', snapshot);
      return;
    }
    if (job.kind === 'meta_setup') {
      const config = await load(db, 'meta_ads');
      const settings = await metaSettings(db);
      const ready = (await db.query("SELECT 1 FROM ecommerce_marketing_state WHERE name='products'")).rowCount;
      if (!ready) throw new Error('consumer_bridge_required');
      const origin = new URL(env.ECOMMERCE_PUBLIC_URL);
      if (origin.protocol !== 'https:' || origin.username || origin.password) throw new Error('connection_required');
      const setup = await providers.ensureMetaMarketing(config, { ...settings, feedUrl: `${origin.origin}/api/ecommerce/feeds/meta?token=${feedToken()}` });
      await saveState(db, 'meta_setup', setup);
      await enqueueMarketing(db, 'meta', 'catalog');
      return;
    }
    if (job.kind === 'meta_audiences') {
      const config = await load(db, 'meta_ads');
      const settings = await metaSettings(db);
      const audiences = await providers.ensureMetaStoreAudiences(config, settings.pixelId);
      await saveState(db, 'meta_audiences', audiences);
      return;
    }
    if (job.kind === 'google_audiences') {
      const config = await load(db, 'ga4');
      const audiences = await providers.ensureGoogleStoreAudiences(config);
      await saveState(db, 'google_audiences', audiences);
      return;
    }
    if (job.kind === 'customer_audiences') {
      const result = await syncCustomerAudiences({ db, providers, env, configFor: provider => load(db, provider) });
      await saveState(db, 'customer_audiences', result);
      return;
    }
    if (job.kind === 'seo_weekly') {
      const records = (await db.query("SELECT data FROM ecommerce_records WHERE provider='search_console' AND kind='metric' AND date>=current_date-interval '120 days'")).rows.map(r => r.data);
      const opportunities = seoOpportunities(records, new Date().toISOString().slice(0, 10));
      const products = await productsFrom(db);
      await transaction(db, async () => {
        await saveState(db, 'seo_weekly', { ...opportunities, observedAt: new Date().toISOString() });
        for (const opportunity of opportunities.rows.slice(0, 20)) {
          const product = products.find(p => p.published && p.url === opportunity.url);
          if (!product) continue; // Main domain and store URLs require an explicit association.
          const seed = crypto.createHash('sha256').update(`seo:${opportunities.from}:${product.id}:${product.version}`).digest('hex').slice(0, 32);
          const id = `${seed.slice(0, 8)}-${seed.slice(8, 12)}-${seed.slice(12, 16)}-${seed.slice(16, 20)}-${seed.slice(20)}`;
          const title = `${product.name} | Aerion`.slice(0, 200);
          const description = product.description.slice(0, 155);
          const data = { sku: product.sku, name: product.name, context: 'ecommerce', approach: 'SEO',
            destination: product.url, title, description,
            copy: `Título proposto: ${title}\nDescrição proposta: ${description}`, searchEvidence: opportunity,
            publication: 'approval_required', generatedFrom: 'existing_product_facts', internalLinks: products.filter(p => p.published && p.group === product.group && p.id !== product.id && p.url).slice(0, 5).map(p => ({ sku: p.sku, url: p.url, anchor: p.name })) };
          await db.query(`INSERT INTO ecommerce_marketing_content(id,product_id,product_version,kind,data) VALUES($1,$2,$3,'seo',$4) ON CONFLICT DO NOTHING`, [id, product.id, product.version, data]);
        }
      });
      return;
    }
    throw new Error('unknown_job');
  }
  async function tick() {
    if (ticking) return;
    ticking = true;
    let db;
    let locked = false;
    try {
      db = await pool.connect();
      locked = (await db.query('SELECT pg_try_advisory_lock(735120) AS locked')).rows[0].locked;
      if (!locked) return;
      // Session lock serializes workers. Expired leases recover after process loss.
      await db.query("UPDATE ecommerce_marketing_jobs SET status='retry',lease_until=NULL WHERE status='running' AND lease_until<now()");
      const woo = (await db.query("SELECT enabled FROM ecommerce_connections WHERE provider='woocommerce'")).rows[0];
      if (!woo?.enabled) return;
      if (env.ECOMMERCE_MARKETING_ENABLED === '0') return;
      await db.query(`INSERT INTO ecommerce_marketing_jobs(kind,resource) VALUES('reconcile','nightly') ON CONFLICT DO NOTHING`);
      await db.query("INSERT INTO ecommerce_marketing_jobs(kind,resource) VALUES('webhooks','products') ON CONFLICT DO NOTHING");
      await db.query("INSERT INTO ecommerce_marketing_jobs(kind,resource) VALUES('seo_weekly','opportunities') ON CONFLICT DO NOTHING");
      if (env.ECOMMERCE_META_CATALOG_ID) await db.query("INSERT INTO ecommerce_marketing_jobs(kind,resource) VALUES('meta','catalog') ON CONFLICT DO NOTHING");
      if (env.ECOMMERCE_CUSTOMER_LISTS) await db.query("INSERT INTO ecommerce_marketing_jobs(kind,resource) VALUES('customer_audiences','daily') ON CONFLICT DO NOTHING");
      // Successful recurring jobs become due again; retries keep their own backoff.
      await db.query(`UPDATE ecommerce_marketing_jobs SET status='pending',attempts=0 WHERE status='done' AND
        ((kind IN ('reconcile','webhooks','seo','seo_weekly','meta_audiences','google_audiences','customer_audiences') AND next_run_at<=now()) OR (kind='meta' AND next_run_at<=now()))`);
      for (let i = 0; i < 8; i++) {
        const job = (await db.query(`UPDATE ecommerce_marketing_jobs SET status='running',lease_until=now()+interval '10 minutes'
          WHERE id=(SELECT id FROM ecommerce_marketing_jobs WHERE status IN ('pending','retry') AND next_run_at<=now()
          ORDER BY CASE kind WHEN 'product' THEN 0 WHEN 'paid_event' THEN 0 WHEN 'reconcile' THEN 1 WHEN 'meta' THEN 2 ELSE 3 END,next_run_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`)).rows[0];
        if (!job) break;
        const sourceLocks = ['customer_audiences','campaign_stage'].includes(job.kind) ? [lockId('woocommerce'), lockId('meta_ads'), lockId('google_ads')]
          : [lockId(job.kind.startsWith('meta') ? 'meta_ads' : job.kind.startsWith('google') ? 'ga4' : 'woocommerce')];
        const acquired = [];
        for (const id of sourceLocks) {
          if (!(await db.query('SELECT pg_try_advisory_lock($1) AS locked', [id])).rows[0].locked) break;
          acquired.push(id);
        }
        const sourceLocked = acquired.length === sourceLocks.length;
        if (!sourceLocked) {
          for (const id of acquired) await db.query('SELECT pg_advisory_unlock($1)', [id]);
          await db.query("UPDATE ecommerce_marketing_jobs SET status='pending',lease_until=NULL,next_run_at=now()+interval '15 seconds' WHERE id=$1", [job.id]);
          continue;
        }
        try {
          await execute(db, job);
          await transaction(db, async () => {
            await db.query(`UPDATE ecommerce_marketing_jobs SET status=CASE WHEN revision=$2 THEN 'done' ELSE 'pending' END,
              attempts=0,error=NULL,lease_until=NULL,updated_at=now(),
              next_run_at=CASE WHEN revision<>$2 THEN now() WHEN kind='meta' THEN now()+interval '1 hour' WHEN kind='seo_weekly' THEN now()+interval '7 days' ELSE now()+interval '1 day' END WHERE id=$1`, [job.id, job.revision]);
            await db.query("INSERT INTO ecommerce_marketing_history(job_id,kind,resource,outcome) VALUES($1,$2,$3,'done')", [job.id, job.kind, job.resource]);
          });
        } catch (error) {
          // Keep only internal error codes and controlled HTTP status. Never raw upstream errors.
          const known = ['consumer_bridge_required', 'invalid_consumer_snapshot', 'consumer_price_required', 'meta_catalog_required', 'connection_required', 'repeated_product_page', 'pagination_limit', 'audience_mapping_required', 'audience_destination_collision', 'audience_source_incomplete', 'audience_upload_failed', 'campaign_review_required', 'campaign_assets_required', 'merchant_ads_approval_required'];
          const code = known.includes(error.message) ? error.message : error.httpStatus ? `platform_http_${Number(error.httpStatus)}` : 'integration_unavailable';
          const delay = Math.min(86400, Math.max(Number(error.retrySeconds) || 0, Math.min(21600, 30 * 2 ** Math.min(job.attempts, 10))));
          await transaction(db, async () => {
            await db.query(`UPDATE ecommerce_marketing_jobs SET status=CASE WHEN revision=$4 THEN 'retry' ELSE 'pending' END,
              attempts=CASE WHEN revision=$4 THEN attempts+1 ELSE 0 END,error=CASE WHEN revision=$4 THEN $2 ELSE NULL END,lease_until=NULL,
              next_run_at=CASE WHEN revision=$4 THEN now()+($3::int*interval '1 second') ELSE now() END,updated_at=now() WHERE id=$1`, [job.id, code, delay, job.revision]);
            await db.query("INSERT INTO ecommerce_marketing_history(job_id,kind,resource,outcome,error) VALUES($1,$2,$3,'retry',$4)", [job.id, job.kind, job.resource, code]);
          });
        } finally { for (const id of acquired) await db.query('SELECT pg_advisory_unlock($1)', [id]); }
      }
      await db.query("DELETE FROM ecommerce_marketing_history WHERE created_at<now()-interval '90 days'");
    } finally {
      try { if (locked) await db.query('SELECT pg_advisory_unlock(735120)'); }
      finally { db?.release(); ticking = false; }
    }
  }
  async function report() {
    const [products, states, jobs, history, contents, connections, merchant, searches, failures] = await Promise.all([
      productsFrom(pool), pool.query('SELECT * FROM ecommerce_marketing_state'),
      pool.query('SELECT id,kind,resource,status,attempts,error,next_run_at,updated_at FROM ecommerce_marketing_jobs ORDER BY updated_at DESC LIMIT 200'),
      pool.query('SELECT kind,resource,outcome,error,created_at FROM ecommerce_marketing_history ORDER BY id DESC LIMIT 50'),
      pool.query('SELECT * FROM ecommerce_marketing_content ORDER BY created_at DESC LIMIT 200'),
      pool.query('SELECT provider,config,enabled,status,error,last_success_at,info FROM ecommerce_connections'),
      pool.query("SELECT data FROM ecommerce_records WHERE provider='merchant_center' AND kind='merchant_catalog' AND record_id='current'"),
      pool.query("SELECT data FROM ecommerce_records WHERE provider='search_console' AND kind='metric' AND date>=current_date-interval '120 days'"),
      pool.query("SELECT DISTINCT ON (kind) kind,error,updated_at FROM ecommerce_marketing_jobs WHERE status='retry' ORDER BY kind,updated_at DESC"),
    ]);
    const state = Object.fromEntries(states.rows.map(r => [r.name, { ...r.data, updatedAt: r.updated_at }]));
    const meta = state.meta_catalog || null;
    const pendingJob = kind => failures.rows.find(j => j.kind === kind);
    const enabled = env.ECOMMERCE_MARKETING_ENABLED !== '0' && connections.rows.some(c => c.provider === 'woocommerce' && c.enabled);
    const permissions = connections.rows.map(c => ({ provider: c.provider, account: c.config.account_id || c.config.customer_id || c.config.property_id || c.config.site_url || c.config.url,
      read: c.last_success_at ? 'verified' : 'unverified', write: c.provider === 'ga4' && state.google_audiences || c.provider === 'meta_ads' && (state.meta_setup || state.meta_audiences) ? 'verified_for_created_resources' : 'unverified', lastVerifiedAt: c.last_success_at,
      lastError: c.error, action: c.error ? 'Reautorizar a identidade existente e testar acesso salvo em Conexões.' : null }));
    const metaAction = { integration: 'meta_catalog', status: meta && !pendingJob('meta') && meta.pixelLink === 'verified' && meta.hourlySchedule === 'verified' && meta.adAccountLinked
      ? meta.uploads?.[0]?.end && !Number(meta.uploads[0].invalid) ? 'operational' : 'awaiting_external_processing' : 'administrator_action',
      account: env.ECOMMERCE_META_CATALOG_ID || state.meta_setup?.catalogId || connections.rows.find(c => c.provider === 'meta_ads')?.config.account_id || null,
      permission: 'catalog_management, business_management e ads_management; acesso ao catálogo, conta anunciante e dataset Site Aerion',
      action: 'Reautorizar a identidade Meta existente com permissões de catálogo e escrita (ads_read/ads_mcp_management não comprovam esse acesso); selecionar Business/catálogo, executar a preparação da fonte horária e conferir o Pixel/dataset 1668777180919759.',
      link: 'https://business.facebook.com/commerce/', lastError: (pendingJob('meta') || pendingJob('meta_setup'))?.error || null };
    const productJob = pendingJob('reconcile') || pendingJob('product');
    const google = reconcileGoogle(products, merchant.rows[0]?.data);
    const googleComplete = google.rows.some(r => r.eligible) && google.rows.filter(r => r.eligible).every(r => r.received && r.approved);
    return { observedAt: new Date().toISOString(), enabled,
      products: eligibleProducts(products), jobs: jobs.rows, history: history.rows, contents: contents.rows,
      googleReconciliation: google, metaCatalog: meta,
      diagnostics: Object.entries(state).filter(([key]) => key.startsWith('seo:')).map(([key, value]) => ({ productId: key.slice(4), ...value })),
      seo: state.seo_weekly || seoOpportunities(searches.rows.map(r => r.data), new Date().toISOString().slice(0, 10)),
      audiences: { store: state.meta_audiences?.store || STORE_AUDIENCES.map(a => ({ ...a, status: 'administrator_action', uploaded: false, size: null })),
        google: state.google_audiences || null,
        customers: state.customer_audiences || null,
        crm: { status: state.customer_audiences ? 'awaiting_external_processing' : 'administrator_action', uploaded: Boolean(state.customer_audiences), reason: 'advertising_eligibility_and_destination_lists_required', separateFromStore: true } },
      campaign: state.campaign_plan ? campaignPlan(state.campaign_plan, products, contents.rows) : null, permissions,
      stagedCampaigns: [state.campaign_google, state.campaign_meta].filter(Boolean),
      coverage: { timezone: 'America/Sao_Paulo', products: state.products || null, meta: meta?.observedAt || null,
        searchConsoleGa4Link: 'unverified', coreWebVitals: 'unavailable', serverPurchase: env.ECOMMERCE_GA4_SERVER_PURCHASE_ENABLED === '1' && env.ECOMMERCE_GA4_SERVER_PURCHASE_VALIDATED === '1' ? 'enabled_consent_required' : 'disabled_pending_consent_and_emitter_audit' },
      readiness: [
        { integration: 'product_webhooks', status: state.webhooks && !state.webhooks.existingSecretsRequireReview && !pendingJob('webhooks') ? 'operational' : 'administrator_action',
          permission: 'WooCommerce REST API: leitura e escrita de webhooks',
          action: 'O worker cadastra somente os três webhooks de produto ausentes, assinados com o segredo existente. Se a chave for somente leitura, conceder escrita ou cadastrar os tópicos no WooCommerce. Webhooks existentes são preservados; conferir seu segredo.',
          link: 'https://loja.aerion.com.br/wp-admin/admin.php?page=wc-settings&tab=advanced&section=webhooks', lastError: pendingJob('webhooks')?.error || null },
        { integration: 'products', status: enabled && state.products && !productJob ? 'operational' : 'administrator_action',
          account: connections.rows.find(c => c.provider === 'woocommerce')?.config.url || null,
          permission: 'aerion_read_reports', action: 'Instalar marketing.php junto do plugin de relatórios e cadastrar webhooks product.created, product.updated e product.deleted na URL de webhook existente.',
          link: 'https://loja.aerion.com.br/wp-admin/admin.php?page=wc-settings&tab=advanced&section=webhooks', lastError: productJob?.error || null },
        { integration: 'google_catalog', status: merchant.rows.length ? googleComplete ? 'operational' : 'awaiting_external_processing' : 'administrator_action',
          account: connections.rows.find(c => c.provider === 'merchant_center')?.config.account_id || null,
          action: 'Conferir destinos, domínio e vínculo Ads no Merchant; preservar a fonte diária existente.', link: 'https://merchants.google.com/' },
        metaAction,
        { integration: 'measurement', status: 'administrator_action', action: 'Identificar origem dos eventos SERVER do Meta; validar consentimento, event_id e GA4 Measurement Protocol em teste antes de habilitar envio pago.' },
        { integration: 'audiences', status: 'administrator_action', action: 'Validar autorização de escrita Meta/GA4 e elegibilidade publicitária dos cadastros antes de criar ou sincronizar listas.' },
      ] };
  }
  function mountPublic(router) {
    router.get('/feeds/meta', async (req, res) => {
      const expected = feedToken();
      const actual = String(req.query.token || '');
      if (expected.length < 32 || Buffer.byteLength(actual) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) return res.sendStatus(401);
      const ready = (await pool.query("SELECT 1 FROM ecommerce_marketing_state s JOIN ecommerce_connections c ON c.provider='woocommerce' AND c.enabled WHERE s.name='products'")).rowCount;
      if (!ready || env.ECOMMERCE_MARKETING_ENABLED === '0') return res.status(503).send('Catálogo ainda indisponível.');
      res.set('Cache-Control', 'private, no-store').type('text/tab-separated-values').send(metaFeed(await productsFrom(pool)));
    });
  }
  function mountRead(router) {
    router.get('/marketing', async (req, res) => res.json(await report()));
  }
  function mountAdmin(router) {
    router.post('/marketing/reconcile', async (req, res) => { await enqueueMarketing(pool, 'reconcile', 'nightly'); res.status(202).json({ queued: true }); });
    router.post('/marketing/meta/sync', async (req, res) => { await enqueueMarketing(pool, 'meta', 'catalog'); res.status(202).json({ queued: true }); });
    router.post('/marketing/meta/setup', async (req, res) => { await enqueueMarketing(pool, 'meta_setup', 'catalog'); res.status(202).json({ queued: true }); });
    router.post('/marketing/audiences/meta', async (req, res) => { await enqueueMarketing(pool, 'meta_audiences', 'store'); res.status(202).json({ queued: true }); });
    router.post('/marketing/audiences/google', async (req, res) => { await enqueueMarketing(pool, 'google_audiences', 'store'); res.status(202).json({ queued: true }); });
    router.post('/marketing/audiences/customers', async (req, res) => { await enqueueMarketing(pool, 'customer_audiences', 'daily'); res.status(202).json({ queued: true }); });
    router.put('/marketing/campaign-plan', async (req, res) => {
      const products = await productsFrom(pool);
      const contents = (await pool.query('SELECT * FROM ecommerce_marketing_content')).rows;
      const plan = campaignPlan(req.body || {}, products, contents);
      await saveState(pool, 'campaign_plan', plan);
      res.json(plan);
    });
    router.post('/marketing/campaigns/stage', async (req, res) => {
      const saved = (await pool.query("SELECT data FROM ecommerce_marketing_state WHERE name='campaign_plan'")).rows[0]?.data;
      if (!saved || req.body?.exclusionsReviewed !== true) return res.status(400).json({ error: 'Salve o orçamento e confirme a revisão das exclusões antes de preparar as estruturas pausadas.' });
      const plan = campaignPlan(saved, await productsFrom(pool), (await pool.query('SELECT * FROM ecommerce_marketing_content')).rows);
      if (!plan.productIds.length || !plan.contentIds.length) return res.status(409).json({ error: 'São necessários produtos elegíveis e criativos aprovados na versão atual.' });
      const key = crypto.createHash('sha256').update(JSON.stringify([plan.total, plan.google, plan.meta, plan.productIds, plan.contentIds])).digest('hex').slice(0, 16);
      await saveState(pool, 'campaign_review', { key, exclusionsReviewed: true, reviewedBy: String(req.auth?.uid || req.auth?.sub || 'admin'), reviewedAt: new Date().toISOString() });
      await enqueueMarketing(pool, 'campaign_stage', 'ecommerce');
      res.status(202).json({ queued: true, status: 'PAUSED' });
    });
    router.post('/marketing/content', async (req, res) => {
      const product = (await pool.query('SELECT data FROM ecommerce_marketing_products WHERE product_id=$1', [String(req.body?.productId || '')])).rows[0]?.data;
      if (!product) return res.status(404).json({ error: 'Produto não encontrado na projeção.' });
      if (!product.url) return res.status(409).json({ error: 'O produto precisa de uma URL pública válida antes do briefing.' });
      const kind = req.body?.kind;
      if (!['seo', 'creative'].includes(kind)) return res.status(400).json({ error: 'Escolha SEO ou criativo.' });
      const approach = String(req.body?.approach || 'demonstração');
      if (!['demonstração', 'comparação', 'objeções', 'recuperação', 'acessórios'].includes(approach)) return res.status(400).json({ error: 'Abordagem inválida.' });
      const title = String(req.body?.title || '').trim();
      const description = String(req.body?.description || '').trim();
      if (kind === 'seo' && (!title || title.length > 200 || !description || description.length > 500)) return res.status(400).json({ error: 'Informe título SEO (até 200 caracteres) e descrição (até 500 caracteres) para revisão.' });
      const copy = kind === 'seo' ? `Título proposto: ${title}\nDescrição proposta: ${description}` : String(req.body?.copy || '').trim();
      if (copy.length > 12000) return res.status(400).json({ error: 'O texto deve ter até 12.000 caracteres.' });
      const destination = new URL(product.url);
      destination.searchParams.set('utm_source', kind === 'seo' ? 'organic' : 'content_hub');
      destination.searchParams.set('utm_medium', kind === 'seo' ? 'seo' : 'paid_social');
      destination.searchParams.set('utm_campaign', `aerion_${product.sku}`);
      destination.searchParams.set('utm_content', approach);
      const id = crypto.randomUUID();
      const data = { sku: product.sku, name: product.name, description: product.description, price: product.price,
        currency: product.currency, availability: product.availability, availabilityDate: product.availabilityDate,
        context: 'ecommerce', approach, audience: 'store', destination: destination.toString(), copy,
        ...(kind === 'seo' ? { title, description } : {}),
        contentHub: { status: 'brief_ready', integration: 'manual_export', productVersion: product.version }, publication: 'approval_required' };
      await pool.query('INSERT INTO ecommerce_marketing_content(id,product_id,product_version,kind,data) VALUES($1,$2,$3,$4,$5)', [id, product.id, product.version, kind, data]);
      res.status(201).json({ id, status: 'draft', data });
    });
    router.post('/marketing/content/:id/review', async (req, res) => {
      if (!/^[a-f0-9-]{36}$/i.test(req.params.id) || !['approved', 'rejected'].includes(req.body?.status)) return res.status(400).json({ error: 'Revisão inválida.' });
      const result = await pool.query(`UPDATE ecommerce_marketing_content c SET status=$2,reviewed_by=$3,reviewed_at=now()
        WHERE id=$1 AND status='draft' AND ($2='rejected' OR (length(trim(c.data->>'copy'))>0 AND EXISTS
          (SELECT 1 FROM ecommerce_marketing_products p WHERE p.product_id=c.product_id AND p.data->>'version'=c.product_version))) RETURNING id,status`,
      [req.params.id, req.body.status, String(req.auth?.uid || req.auth?.sub || 'admin')]);
      if (!result.rowCount) return res.status(409).json({ error: 'Texto vazio, versão desatualizada ou revisão já concluída. Prepare uma nova versão.' });
      res.json(result.rows[0]);
    });
    router.post('/marketing/content/:id/publish-seo', async (req, res) => {
      if (!/^[a-f0-9-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: 'Conteúdo inválido.' });
      const found = await pool.query(`SELECT 1 FROM ecommerce_marketing_content c JOIN ecommerce_marketing_products p ON p.product_id=c.product_id
        WHERE c.id=$1 AND c.kind='seo' AND c.status='approved' AND c.product_version=p.data->>'version'`, [req.params.id]);
      if (!found.rowCount) return res.status(409).json({ error: 'A publicação exige uma proposta SEO aprovada para a versão atual do produto.' });
      await enqueueMarketing(pool, 'seo_publish', req.params.id);
      res.status(202).json({ queued: true });
    });
  }
  return { tick, report, mountPublic, mountRead, mountAdmin };
}
module.exports = { createMarketingTables, enqueueMarketing, createMarketing };
