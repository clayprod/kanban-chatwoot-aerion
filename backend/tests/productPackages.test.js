'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assembleProduct } = require('../productPackages');
const { assessProduct } = require('../technicalRules');
const { canonicalCatalog } = require('../aerionCatalogModel');
const catalog = require('../data/aerionCatalog.json');
const requirement = { id: 'r', key: 'battery_count', kind: 'numeric', label: 'Quantidade mínima de baterias de voo', value: 3, unit: 'baterias', operator: 'min', conditions: '', quote: 'Fornecer no mínimo 3 baterias de voo.', source_id: 'notice', location: 'Página 6' };
const sources = [{ id: 'notice', text: requirement.quote }];
const base = { id: '1', name: 'Drone', sale_price: 100, unit: 'un', active: true, specs: [], specs_complete: true, package_confirmed: true, compatible_ids: ['2'], included_items: [{ key: 'battery', label: 'Baterias de voo', quantity: 2 }] };
const battery = { id: '2', name: 'Bateria original', product_type: 'accessory', accessory_key: 'battery', sale_price: 20, units_per_sale: 1, active: true, package_confirmed: true, specs_complete: true, specs_version: 1 };
test('original packages: 19 entries, no duplicate drone kits; live contents and RTK compatibility', () => {
  const rows = canonicalCatalog(catalog);
  assert.equal(rows.length, 19); assert.equal(rows.filter(p => p.product_type === 'accessory').length, 11);
  assert.equal(rows.find(p => p.sku === '102003505').included_items.find(c => c.key === 'battery').quantity, 0);
  assert.ok(rows.find(p => p.sku === '102003505').compatible_skus.includes('102002596'));
  assert.equal(rows.find(p => p.sku === 'HUBSAN-MINI-7').included_items.find(c => c.key === 'battery').quantity, 3);
  assert.equal(rows.filter(p => p.sku === '102002996').length, 1);
  assert.ok(rows.every(p => p.live_verified_at && p.source_url.startsWith('https://aerion.com.br/')));
});
test('three batteries means one extra beyond the two included, with cost in ranking', () => {
  const a = assembleProduct(base, [requirement], [battery], sources);
  assert.equal(a.configuration.additions[0].quantity, 1); assert.equal(a.product.sale_price, 120);
  const mapping = [{ requirement_id: 'r', spec_ids: a.product.specs.map(s => s.id) }];
  const result = assessProduct(a.product, [requirement], [...sources, ...a.sources], mapping, true, { unit: 'un', reference_price: 110 });
  assert.equal(result.status, 'full'); assert.equal(result.commercial_bonus, 1); assert.equal(result.sale_price, 120);
  const duplicate = { ...base, specs: [{ id: 'old1', key: requirement.key, value: 2 }, { id: 'old2', key: requirement.key, value: 2 }] };
  assert.equal(assembleProduct(duplicate, [requirement], [battery], sources).product.specs.filter(s => s.key === requirement.key).length, 1);
});
test('incompatible, missing and unconfirmed accessories never create full compliance', () => {
  for (const p of [{ ...base, compatible_ids: [] }, { ...base, package_confirmed: false }]) {
    const a = assembleProduct(p, [requirement], [battery], sources);
    assert.equal(a.configuration.additions.length, 0); assert.ok(a.configuration.missing.length); assert.equal(a.product.specs_complete, false);
  }
});
test('battery packs round purchase quantities upwards and extras cannot repair intrinsic failure', () => {
  const r = { ...requirement, value: 5, quote: 'Fornecer no mínimo 5 baterias de voo.' };
  const src = [{ id: 'notice', text: r.quote }];
  const a = assembleProduct(base, [r], [{ ...battery, units_per_sale: 2 }], src);
  assert.equal(a.configuration.additions[0].quantity, 2); assert.equal(a.product.sale_price, 140);
  assert.equal(a.product.specs[0].value, 6);
  const time = { ...r, id: 'time', key: 'flight_time', label: 'Autonomia mínima de 41 min por bateria', value: 41, unit: 'min', quote: 'Autonomia mínima de 41 min por bateria' };
  const failing = { ...base, specs: [{ ...time, id: 'spec', value: 40, operator: 'eq', quote: 'Autonomia de 40 min por bateria', source_id: 'specsource' }] };
  const allSources = [...sources, { id: 'notice', text: time.quote }, { id: 'specsource', text: failing.specs[0].quote }];
  const assembled = assembleProduct(failing, [time], [battery], allSources);
  assert.equal(assembled.configuration.additions.length, 0); assert.equal(assembled.product.specs[0].value, 40);
});
test('installing a confirmed RTK accessory uses only its evidenced RTK facts', () => {
  const r = { id: 'rtk', key: 'rtk', label: 'Suporte RTK', kind: 'categorical', value: 'RTK', quote: 'Equipamento com suporte RTK', source_id: 'notice', location: 'Página 2', conditions: '' };
  const spec = { id: 'rtks', key: 'rtk', label: 'RTK', kind: 'categorical', value: 'RTK', quote: 'Módulo com suporte RTK', source_id: 'module', location: 'Ficha', conditions: '' };
  const allSources = [{ id: 'notice', text: r.quote }, { id: 'module', text: spec.quote }];
  const a = assembleProduct(base, [r], [{ ...battery, accessory_key: 'rtk', specs: [spec] }], allSources);
  assert.equal(a.product.sale_price, 120); assert.ok(a.product.specs.some(s => s.id === 'rtks'));
  const result = assessProduct(a.product, [r], allSources, [{ requirement_id: 'rtk', spec_ids: ['rtks'] }], true, {});
  assert.equal(result.status, 'full');
  const conflict = { ...spec, id: 'rtk-conflict', value: 'não', quote: 'Módulo não suporta RTK' };
  const conflictingSources = [{ id: 'notice', text: r.quote }, { id: 'module', text: spec.quote + '\n' + conflict.quote }];
  const uncertain = assembleProduct(base, [r], [{ ...battery, accessory_key: 'rtk', specs: [spec, conflict] }], conflictingSources);
  assert.equal(uncertain.product.specs.length, 2);
  assert.equal(assessProduct(uncertain.product, [r], conflictingSources, [{ requirement_id: 'rtk', spec_ids: ['rtks', 'rtk-conflict'] }], true, {}).status, 'uncertain');
});
