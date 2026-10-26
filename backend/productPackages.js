'use strict';
const { text, hash, evidenceValid, compareRequirement } = require('./technicalRules');
const {componentOf}=require('./technicalMetrics');

// Configuration is explicit: compatibility and scope never come from matching names.
const componentKey = requirement => {
  const label = text(`${requirement.label || ''} ${requirement.quote || ''}`);
  if (requirement.kind === 'numeric' && /baterias?/.test(label) && (/quantidade|fornecid|acompanhar|no minimo|baterias? de voo/.test(label)||/^battery_quantity(?:_reserve)?$/.test(requirement.key)) && ['un', 'unidade', 'unidades', 'bateria', 'baterias', ''].includes(text(requirement.unit))) return 'battery';
  if (/\brtk\b/.test(label) && !/camera|sensor cmos/.test(label)) return 'rtk';
  if (/hub|multi.?carregador|estacao de carregamento/.test(label)) return 'charging_hub';
  return requirement.component_key && /^[a-z][a-z0-9_]{1,50}$/.test(requirement.component_key) ? requirement.component_key : null;
};
function cleanPackageItems(items) {
  if (!Array.isArray(items) || items.length > 100) throw Error('Informe até 100 componentes do pacote.');
  return items.map(item => {
    const quantity = Number(item.quantity);
    const operating=item.operating_quantity==null||item.operating_quantity===''?null:Number(item.operating_quantity);
    if (!String(item.label || '').trim() || !Number.isInteger(quantity) || quantity < 0 || quantity > 10000) throw Error('Cada componente precisa de nome e quantidade inteira válida.');
    if(operating!==null&&(!Number.isInteger(operating)||operating<1||operating>100))throw Error('Informe a quantidade de baterias usadas simultaneamente por voo.');
    return { key: String(item.key || '').slice(0, 60), label: String(item.label).trim().slice(0, 300), quantity, ...(operating!==null?{operating_quantity:operating}:{}),unit: String(item.unit || 'un').slice(0, 30), source_url: String(item.source_url || '').slice(0, 2000) };
  });
}
function assembleProduct(product, requirements, accessories, sources) {
  const included = product.package_confirmed ? product.included_items || [] : [];
  const additions = [], missing = [];
  const available = accessories.filter(a => a.active && a.product_type === 'accessory' && (product.compatible_ids || []).map(String).includes(String(a.id)));
  for (const req of requirements) {
    const key = componentKey(req);
    if (!key || !evidenceValid(req, sources)) continue;
    if (key !== 'battery' && compareRequirement(req, product.specs || [], sources, { spec_ids: (product.specs || []).filter(s => text(s.key) === text(req.key)).map(s => s.id) }).status === 'ok') continue;
    const base = included.filter(c => c.key === key).reduce((sum, c) => sum + c.quantity, 0);
    if (key === 'battery' && (!['min', 'eq'].includes(req.operator) || req.conditions)) continue;
    const reserve=key==='battery'&&/reserva|reserve|spare/.test(text(`${req.key} ${req.label} ${req.quote}`));
    const operating=included.find(c=>c.key==='battery')?.operating_quantity;
    if(reserve&&!Number.isInteger(operating)){missing.push('Quantidade de baterias usadas simultaneamente no voo não confirmada; não é possível calcular as reservas.');continue;}
    const needed = key === 'battery' && req.kind === 'numeric' ? Number(req.value)+(reserve?operating:0) : 1;
    if (!Number.isInteger(needed) || needed < 1 || needed > 1000 || base >= needed) continue;
    if (key === 'battery' && !included.some(c => c.key === key)) { missing.push('Quantidade de baterias do pacote não confirmada.'); continue; }
    const candidates = available.filter(a => a.accessory_key === key && Number(a.units_per_sale) > 0 && a.package_confirmed);
    const choices = candidates.map(a => ({ a, quantity: Math.ceil((needed - base) / a.units_per_sale) })).sort((x, y) => x.quantity * x.a.sale_price - y.quantity * y.a.sale_price);
    const choice = choices[0];
    if (!choice) { missing.push(`Complemento necessário sem acessório compatível cadastrado: ${req.label}.`); continue; }
    const previous = additions.find(a => String(a.product_id) === String(choice.a.id));
    if (previous) previous.quantity = Math.max(previous.quantity, choice.quantity);
    else additions.push({ product_id: choice.a.id, name: choice.a.name, quantity: choice.quantity, unit_price: Number(choice.a.sale_price), key, units_per_sale: choice.a.units_per_sale, specs_version: choice.a.specs_version });
  }
  const extra = additions.reduce((sum, a) => sum + Math.round(a.unit_price * 100) * a.quantity, 0) / 100;
  const syntheticId = `package:${product.id}:${hash(included).slice(0, 12)}`;
  const quantities = included.map(c => ({ ...c }));
  for (const a of additions) {
    const existing = quantities.find(c => c.key === a.key);
    if (existing) existing.quantity += a.quantity * a.units_per_sale;
    else quantities.push({ key: a.key, label: a.name, quantity: a.quantity * a.units_per_sale, unit: 'un' });
  }
  const syntheticLines = [];
  const specs = [...(product.specs || [])];
  for (const req of requirements) {
    const key = componentKey(req), c = quantities.find(c => c.key === key);
    if (key === 'battery' && c && req.kind === 'numeric' && ['min', 'eq'].includes(req.operator) && !req.conditions) {
      const reserve=/reserva|reserve|spare/.test(text(`${req.key} ${req.label} ${req.quote}`));
      if(reserve&&!Number.isInteger(c.operating_quantity))continue;
      // Replace the count only; autonomy, battery chemistry and other metrics stay untouched.
      for (let index = specs.length - 1; index >= 0; index--) if (text(specs[index].key) === text(req.key)) specs.splice(index, 1);
      const offered=c.quantity-(reserve?c.operating_quantity:0);
      const quote = `Baterias de voo ${reserve?'reservas':'no pacote proposto'}: ${offered} ${req.unit}${reserve?` (${c.operating_quantity} em operação; ${c.quantity} no conjunto)`:''}`;
      syntheticLines.push(quote);
      specs.push({ id: `package-${req.id}`, key: req.key,component:componentOf(req), label: req.label, kind: 'numeric', value: offered, unit: req.unit, conditions: '', source_id: syntheticId, location: 'Composição conferida do pacote', quote });
    } else if (key) {
      const chosen = additions.filter(a => a.key === key).map(a => available.find(p => String(p.id) === String(a.product_id)));
      for (const a of chosen) {
        const matching = (a.specs || []).filter(s => text(s.key) === text(req.key));
        if (!matching.length) continue;
        // Only optional module metrics may be supplied by this accessory.
        for (let index = specs.length - 1; index >= 0; index--) if (text(specs[index].key) === text(req.key)) specs.splice(index, 1);
        specs.push(...matching);
      }
    }
  }
  const complete = additions.every(a => a.key === 'battery' || available.find(p => String(p.id) === String(a.product_id))?.specs_complete);
  return { product: { ...product, specs, sale_price: (Math.round(Number(product.sale_price) * 100) + Math.round(extra * 100)) / 100, specs_complete: product.specs_complete && complete && missing.length === 0 },
    sources: [{ id: syntheticId, text: syntheticLines.join('\n'), notes: [] }],
    configuration: { base_price: Number(product.sale_price), additions, extra_price: extra, missing, included_items: included, source_urls: [...new Set(included.map(c => c.source_url).filter(Boolean))] } };
}
module.exports = { componentKey, cleanPackageItems, assembleProduct };
