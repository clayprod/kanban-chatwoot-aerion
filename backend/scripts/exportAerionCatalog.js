'use strict';
// Read-only export from the user's local shop. No WordPress data is modified.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = process.argv[2];
if (!root) throw new Error('Informe a pasta do projeto Aerion.');
const php = `require '/var/www/html/wp-load.php';
$rows=[];
foreach(wc_get_products(['limit'=>-1,'status'=>'publish','return'=>'objects']) as $p){
  if($p->is_type('variable')) continue;
  $q=Aerion_Pricing::quote($p,'trade',0);
  $rows[]=['id'=>$p->get_id(),'sku'=>$p->get_sku(),'name'=>$p->get_name(),'slug'=>$p->get_slug(),
    'trade'=>$p->get_meta('_aerion_trade_price',true),'sale_price'=>$q['card'],'pix'=>$q['pix'],
    'bom'=>$p->get_meta('_aerion_bom',true),'description'=>wp_strip_all_tags($p->get_description()),
    'short_description'=>wp_strip_all_tags($p->get_short_description()),
    'url'=>get_permalink($p->get_id()),'categories'=>wp_get_object_terms($p->get_id(),'product_cat',['fields'=>'names']),
    'family'=>wp_get_object_terms($p->get_id(),'aerion_family',['fields'=>'names'])];
}
echo json_encode($rows,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);`;
const raw = execFileSync('docker', ['exec', 'aerion-wordpress-wordpress-1', 'php', '-r', php], { encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
const rows = JSON.parse(raw);
const priced = rows.filter(p => Number(p.trade) > 0 && Number(p.sale_price) > 0);
const institutional = JSON.parse(fs.readFileSync(path.join(root, 'wordpress/wp-content/plugins/aerion-core/data/institutional-products.json'), 'utf8')).products;
const result = { exported_at: new Date().toISOString(), price_basis: 'distribution_table_card', source: 'Loja WordPress local: _aerion_trade_price, sem desconto de pagamento, campanha ou nível de parceiro',
  products: priced.map(p => {
    const family = Object.values(institutional).find(f => (p.family || []).includes(f.name) || (p.sku === 'EVO-NEST' && f.slug === 'evo-nest'));
    const isEquipment = (p.categories || []).some(c => /^(Drones|Kits|Docas|Softwares)$/i.test(c));
    const variants = isEquipment && family ? family.variants || [] : [];
    const variant = variants.length === 1 ? variants[0] : variants.find(v => new RegExp(`\\b${v.id}\\b`, 'i').test(p.name));
    const specificationText = variant ? Object.entries(variant.specs || {}).filter(([section]) => !/controlador|controle remoto/i.test(section)).map(([section, values]) => `${section}\n${Object.entries(values).map(([key, val]) => `${key}: ${val}`).join('\n')}`).join('\n\n') : '';
    const bom = Array.isArray(p.bom) ? p.bom : [];
    const sourceText = [p.name, p.description, p.short_description, bom.length ? `Composição por SKU: ${bom.map(b => `${b.qty} × ${rows.find(r => r.sku === b.sku)?.name || b.sku} (SKU ${b.sku})`).join('; ')}` : '',
      specificationText ? `Ficha institucional da variante ${variant.name}:\n${specificationText}` : ''].filter(Boolean).join('\n\n');
    return { ...p, source_key: `aerion-store:${p.sku || p.id}`, unit: 'un', price_basis: 'distribution', sale_price: Number(p.trade), source_url: `https://aerion.com.br${new URL(p.url).pathname}`,
      source_text: sourceText, category: (p.categories || []).join('; '), institutional_source: variant ? { slug: family.slug, name: variant.name, brochure: family.brochure, downloads: family.downloads } : null };
  }),
  without_distribution_price: rows.filter(p => !priced.includes(p)).map(({ sku, name }) => ({ sku, name })) };
fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'data', 'aerionCatalog.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ exported: result.products.length, without_distribution_price: result.without_distribution_price }));
