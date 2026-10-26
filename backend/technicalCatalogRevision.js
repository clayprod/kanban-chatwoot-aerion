'use strict';
const catalog=require('./data/aerionTechnicalSpecifications.json');
const {structuredFacts}=require('./structuredSpecifications');
const {hash}=require('./technicalRules');
const {capabilityRows}=require('./catalogCapabilities');
const REVISION='structured-specifications-v5-documented-capabilities';
async function reviseTechnicalCatalog(client,account){
  if((await client.query('SELECT 1 FROM technical_catalog_imports WHERE account_id=$1 AND version=$2',[account,REVISION])).rowCount)return;
  for(const row of catalog.products){
    const product=(await client.query('SELECT * FROM technical_products WHERE account_id=$1 AND source_key=$2 AND active=TRUE AND superseded_by IS NULL',[account,row.source_key])).rows[0];
    if(!product || !row.rows.length || product.specs.some(f=>f.reviewed===true))continue;
    const rows=[...row.rows,...capabilityRows(row.sku)];
    const body=[`${row.name}\nVariante: ${row.variant}`,row.review_note || 'Ficha estruturada do catálogo Aerion. As condições de cada campo foram preservadas.',`Fonte: ${row.manufacturer_source || row.source_url}`, ...rows.map(r=>`${r.section}\n${r.label}: ${r.value}${r.note?'\n'+r.note:''}`)].join('\n\n');
    const source=(await client.query(`INSERT INTO technical_sources(account_id,sha256,name,url,content_type,bytes,pages,complete)
      VALUES($1,$2,$3,$4,'text/plain',$5,$6::jsonb,TRUE) ON CONFLICT(account_id,sha256) DO UPDATE SET sha256=EXCLUDED.sha256 RETURNING *`,
      [account,hash(body),`${row.sku} — especificações por componente.txt`,row.manufacturer_source || row.source_url,Buffer.from(body),JSON.stringify([{location:'Ficha estruturada',text:body}])])).rows[0];
    const facts=structuredFacts(rows,source);
    await client.query('UPDATE technical_product_sources SET active=FALSE WHERE account_id=$1 AND product_id=$2',[account,product.id]);
    await client.query('INSERT INTO technical_product_sources(account_id,product_id,source_id) VALUES($1,$2,$3) ON CONFLICT(product_id,source_id) DO UPDATE SET active=TRUE',[account,product.id,source.id]);
    await client.query('UPDATE technical_products SET specs=$3::jsonb,specs_complete=TRUE,specs_version=specs_version+1,version=version+1,updated_at=NOW() WHERE account_id=$1 AND id=$2',[account,product.id,JSON.stringify(facts)]);
    await client.query("UPDATE technical_jobs SET status='superseded',error=NULL WHERE account_id=$1 AND kind='product' AND target=$2 AND status IN ('queued','running','failed','partial')",[account,String(product.id)]);
  }
  await client.query("UPDATE technical_candidates SET updated_at=NOW()-INTERVAL '25 hours' WHERE account_id=$1",[account]);
  await client.query('INSERT INTO technical_catalog_imports(account_id,version) VALUES($1,$2) ON CONFLICT DO NOTHING',[account,REVISION]);
}
module.exports={reviseTechnicalCatalog};
