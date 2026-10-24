'use strict';
const { hash } = require('./technicalRules');
const catalog = require('./data/aerionCatalog.json');
const { canonicalCatalog, replacements } = require('./aerionCatalogModel');
const {reviseTechnicalCatalog}=require('./technicalCatalogRevision');
const IMPORT_VERSION = 'original-packages-v2';
async function seedTechnicalCatalog(pool, accountId) {
  if (!Number.isInteger(Number(accountId)) || Number(accountId) <= 0) throw Error('Conta Aerion inválida para importar catálogo.');
  const client = await pool.connect(); let inserted = 0;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(81620472)');
    await client.query('CREATE TABLE IF NOT EXISTS technical_catalog_imports(account_id INTEGER,version TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(account_id,version))');
    const rows = canonicalCatalog(catalog);
    if ((await client.query('SELECT 1 FROM technical_catalog_imports WHERE account_id=$1 AND version=$2', [accountId, IMPORT_VERSION])).rows.length) {
      await reviseTechnicalCatalog(client,accountId);
      await client.query('COMMIT'); return { inserted: 0, available: rows.length, price_basis: catalog.price_basis };
    }
    await client.query('INSERT INTO technical_config(account_id) VALUES($1) ON CONFLICT DO NOTHING', [accountId]);
    const ids = new Map();
    for (const row of rows) {
      const keywords = [row.name, row.sku, ...(row.family || [])];
      if (row.product_type !== 'accessory' && row.categories.some(c => /Drones|Kits/.test(c))) keywords.push('drone', 'drones', 'aeronave não tripulada', 'vant', 'rpa', 'uav');
      const p = (await client.query(`INSERT INTO technical_products(account_id,name,model,category,description,keywords,sale_price,unit,source_key,price_basis)
        VALUES($1,$2,$2,$3,$4,$5,$6,'un',$7,'distribution') ON CONFLICT(account_id,source_key) WHERE source_key IS NOT NULL DO UPDATE SET source_key=EXCLUDED.source_key RETURNING *`,
      [accountId, row.name, row.category, row.description || row.short_description || '', keywords, row.sale_price, row.source_key])).rows[0];
      ids.set(row.sku, p.id);
      const product = (await client.query(`UPDATE technical_products SET composition=$3,included_items=$4::jsonb,package_confirmed=$5,product_type=$6,accessory_key=$7,units_per_sale=$8,source_url=$9,image_url=$10,
        specs_complete=FALSE,specs_version=specs_version+1,version=version+1,updated_at=NOW() WHERE account_id=$1 AND id=$2 RETURNING *`,
      [accountId, p.id, row.composition, JSON.stringify(row.included_items), row.package_confirmed, row.product_type, row.accessory_key, row.units_per_sale, row.source_url, row.image_url || ''])).rows[0];
      const bytes = Buffer.from(`${row.source_text}\n\nOrigem: ${row.source_url}\nConteúdo conferido no site em ${catalog.live_verified_at}.`);
      const source = (await client.query(`INSERT INTO technical_sources(account_id,sha256,name,url,content_type,bytes)
        VALUES($1,$2,$3,$4,'text/plain',$5) ON CONFLICT(account_id,sha256) DO UPDATE SET sha256=EXCLUDED.sha256 RETURNING id`,
      [accountId, hash(bytes), `${row.sku} — ficha e pacote original.txt`, row.source_url, bytes])).rows[0];
      await client.query('UPDATE technical_product_sources SET active=FALSE WHERE account_id=$1 AND product_id=$2', [accountId, p.id]);
      await client.query('INSERT INTO technical_product_sources(account_id,product_id,source_id) VALUES($1,$2,$3) ON CONFLICT(product_id,source_id) DO UPDATE SET active=TRUE', [accountId, p.id, source.id]);
      await client.query(`INSERT INTO technical_jobs(account_id,kind,target,revision,context) VALUES($1,'product',$2,$3,$4::jsonb) ON CONFLICT DO NOTHING`, [accountId, String(p.id), String(product.specs_version), JSON.stringify({ version: product.specs_version })]);
      inserted++;
    }
    for (const row of rows) await client.query('UPDATE technical_products SET compatible_ids=$3::bigint[] WHERE account_id=$1 AND id=$2', [accountId, ids.get(row.sku), row.compatible_skus.map(sku => ids.get(sku)).filter(Boolean)]);
    for (const [oldSku, currentSku] of Object.entries(replacements)) await client.query("UPDATE technical_products SET active=FALSE,superseded_by=$3,specs_version=specs_version+1 WHERE account_id=$1 AND source_key=$2", [accountId, `aerion-store:${oldSku}`, ids.get(currentSku)]);
    await client.query(`UPDATE technical_jobs j SET status='partial',error='Variante consolidada no pacote original.' FROM technical_products p WHERE j.account_id=$1 AND j.kind='product' AND j.target=p.id::text AND p.superseded_by IS NOT NULL AND j.status IN ('queued','running','failed')`, [accountId]);
    // Explicit user request: include existing searches, within the configured budgets.
    await client.query('UPDATE technical_config SET enabled=TRUE,updated_at=NOW() WHERE account_id=$1', [accountId]);
    await client.query("UPDATE technical_candidates SET updated_at=NOW()-INTERVAL '25 hours' WHERE account_id=$1", [accountId]);
    await client.query('INSERT INTO technical_catalog_imports(account_id,version) VALUES($1,$2)', [accountId, IMPORT_VERSION]);
    await reviseTechnicalCatalog(client,accountId);
    await client.query('COMMIT'); return { inserted, available: rows.length, price_basis: catalog.price_basis };
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}
module.exports = { seedTechnicalCatalog };
