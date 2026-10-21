'use strict';
// Read the public shop, preserving private distribution prices from the authorized export.
const fs = require('node:fs');
const path = require('node:path');
const filename = path.join(__dirname, '../data/aerionCatalog.json');
const decode = value => String(value).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/\s+/g, ' ').trim();
const section = (html, name) => html.split(`id="tab-${name}"`)[1]?.split('woocommerce-Tabs-panel')[0] || '';
async function main() {
  const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
  const response = await fetch('https://aerion.com.br/wp-json/wc/store/v1/products?per_page=100');
  if (!response.ok) throw Error(`Loja: HTTP ${response.status}`);
  const live = await response.json();
  for (const row of data.products) {
    const p = live.find(p => p.sku === row.sku);
    if (!p) { row.live_missing = true; continue; }
    const response = await fetch(p.permalink);
    if (!response.ok) throw Error(`${row.sku}: HTTP ${response.status}`);
    const html = await response.text();
    const contents = section(html, 'aerion_contents');
    row.package_contents = [...contents.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(m => decode(m[1])).filter(Boolean);
    const specs = section(html, 'aerion_specifications');
    row.live_specification_text = decode(specs);
    const compatibility = specs.split('<h2>Compatibilidade</h2>')[1] || '';
    row.compatibility = [...compatibility.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(m => decode(m[1]));
    row.source_url = p.permalink; row.live_verified_at = new Date().toISOString();
    row.image_url = p.images?.[0]?.src || '';
    row.source_text = [p.name, decode(p.description), row.live_specification_text,
      row.package_contents.length ? `O que acompanha este pacote:\n${row.package_contents.join('\n')}` : 'Conteúdo do pacote não informado.',
      row.compatibility.length ? `Compatibilidade declarada na loja:\n${row.compatibility.join('\n')}` : ''].filter(Boolean).join('\n\n');
  }
  data.live_verified_at = new Date().toISOString();
  fs.writeFileSync(filename, JSON.stringify(data, null, 2) + '\n');
  console.log(JSON.stringify(data.products.map(p => ({ sku: p.sku, missing: !!p.live_missing, contents: p.package_contents, compatibility: p.compatibility }))));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
