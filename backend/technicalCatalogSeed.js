'use strict';
const { hash } = require('./technicalRules');
const catalog = require('./data/aerionCatalog.json');
// An explicitly requested import for Aerion's account. It never seeds other
// customer accounts, overwrites edited products, or enables automation.
async function seedTechnicalCatalog(pool, accountId) {
  if (!Number.isInteger(Number(accountId)) || Number(accountId) <= 0) throw new Error('Conta Aerion inválida para importar catálogo.');
  const client = await pool.connect(); let inserted = 0;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(81620472)');
    await client.query('INSERT INTO technical_config(account_id) VALUES($1) ON CONFLICT DO NOTHING', [accountId]);
    for (const row of catalog.products) {
      const categories = row.categories || [];
      const isAircraft = categories.some(v => /^(Drones|Kits)$/i.test(v));
      const keywords = [row.name, row.sku, ...(row.family || [])];
      if (isAircraft && !/baterias autel/i.test(row.name)) keywords.push('drone', 'drones', 'aeronave não tripulada', 'veículo aéreo não tripulado', 'vant', 'rpa', 'uav');
      const product = (await client.query(`INSERT INTO technical_products(account_id,name,model,category,description,keywords,sale_price,unit,composition,package_confirmed,source_key,price_basis)
        VALUES($1,$2,$3,$4,$5,$6,$7,'un',$8,TRUE,$9,'distribution') ON CONFLICT(account_id,source_key) WHERE source_key IS NOT NULL DO NOTHING RETURNING *`,
      [accountId, row.name, row.name, row.category || '', row.description || row.short_description || '', keywords, row.sale_price,
        `${row.name}${Array.isArray(row.bom) && row.bom.length ? '\nComposição: ' + row.bom.map(b => `${b.qty} × ${catalog.products.find(p => p.sku === b.sku)?.name || b.sku}`).join('; ') : ''}`, row.source_key])).rows[0];
      if (!product) continue;
      const bytes = Buffer.from(`${row.source_text}\n\nOrigem: ${row.source_url}\nPreço de distribuição unitário: R$ ${row.sale_price.toFixed(2)}\nTabela exportada em ${catalog.exported_at}.`);
      const source = (await client.query(`INSERT INTO technical_sources(account_id,sha256,name,url,content_type,bytes)
        VALUES($1,$2,$3,$4,'text/plain',$5) ON CONFLICT(account_id,sha256) DO UPDATE SET sha256=EXCLUDED.sha256 RETURNING id`,
      [accountId, hash(bytes), `${row.sku} — ficha da loja.txt`, row.source_url, bytes])).rows[0];
      await client.query('INSERT INTO technical_product_sources(account_id,product_id,source_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [accountId, product.id, source.id]);
      await client.query(`INSERT INTO technical_jobs(account_id,kind,target,revision,context) VALUES($1,'product',$2,'1',$3::jsonb) ON CONFLICT DO NOTHING`, [accountId, String(product.id), JSON.stringify({ version: 1 })]);
      inserted++;
    }
    await client.query('COMMIT'); return { inserted, available: catalog.products.length, price_basis: catalog.price_basis };
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}
module.exports = { seedTechnicalCatalog };
