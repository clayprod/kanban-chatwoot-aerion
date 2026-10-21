'use strict';
// Consolidation is reviewed by SKU, never by approximate names.
const replacements = {
  'AUTEL-ALPHA': '901030260', '901030263': '901030260', '901030264': '901030260',
  '102003506': '102003505', '102003508': '102003505',
  '102003296': '102002996', '102002998': '102002996', '102003298': '102002996',
  '102003324': '102002930', '102003300': '102002930', '102003301': '102002930', '102001512': '102001513',
};
const accessoryKeys = { '102002556': ['battery', 2], '102000941': ['battery', 1], '102003061': ['battery', 1],
  '102002596': ['rtk', 1], TBS100: ['charging_hub', 1], '102000642': ['charging_hub', 1], '102002546': ['charging_hub', 1] };
function canonicalCatalog(catalog) {
  return catalog.products.filter(p => !replacements[p.sku] && !p.live_missing).map(row => {
    const accessory = row.categories.some(c => ['Baterias e Carregadores', 'Payloads'].includes(c));
    const included = (row.package_contents || []).map(label => ({
      key: /baterias? de voo/i.test(label) ? 'battery' : /hub|multi.?carregador/i.test(label) ? 'charging_hub' : /m[oó]dulo rtk/i.test(label) ? 'rtk' : '',
      label, quantity: Number(label.match(/^\s*(\d+)/)?.[1] || 1), unit: 'un', source_url: row.source_url,
    }));
    if (/sem baterias/i.test(row.name)) included.push({ key: 'battery', label: 'Baterias de voo (não incluídas)', quantity: 0, unit: 'un', source_url: row.source_url });
    const family = /EVO Max/.test(row.name) ? 'max' : /EVO Lite/.test(row.name) ? 'lite' : /Alpha/.test(row.name) ? 'alpha' : '';
    const compatibleSkus = accessory ? [] : catalog.products.filter(p => !replacements[p.sku] && p.sku !== row.sku && p.categories.some(c => ['Baterias e Carregadores', 'Payloads'].includes(c)) &&
      family && (p.compatibility || []).some(v => family === 'max' ? /EVO Max/i.test(v) && !/firmware/i.test(v) : family === 'lite' ? /EVO Lite/i.test(v) : /Autel Alpha/i.test(v))).map(p => p.sku);
    return { ...row, product_type: accessory ? 'accessory' : 'product', included_items: included,
      compatible_skus: compatibleSkus, accessory_key: accessoryKeys[row.sku]?.[0] || '', units_per_sale: accessoryKeys[row.sku]?.[1] || 1,
      composition: included.map(c => c.label).join('\n'), package_confirmed: included.length > 0 || accessory };
  });
}
module.exports = { canonicalCatalog, replacements };
