'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compareNumeric, compareCompound, compareRequirement, assessProduct, summarize, guardLegacyRequirement } = require('../technicalRules');
const { publicIp, extract, chunksForSource } = require('../technicalDocuments');
const { DEFAULTS, itemInScope } = require('../technicalAnalysis');
const req = { id: 'r', key: 'flight_time', kind: 'numeric', value: 41, unit: 'min', operator: 'min', quote: 'Autonomia mínima de 41 min', source_id: 'edital', location: 'Página 1', conditions: '' };
const spec = { id: 's', key: 'flight_time', kind: 'numeric', value: 40, unit: 'min', quote: 'Autonomia de 40 min', source_id: 'ficha', location: 'Página 1', conditions: '' };
const sources = [{ id: 'edital', text: req.quote }, { id: 'ficha', text: spec.quote }];
const product = { id: '1', name: 'Produto A', sale_price: 100, unit: 'un', package_confirmed: true, specs_complete: true, specs: [spec] };
const mapping = [{ requirement_id: 'r', spec_ids: ['s'] }];
test('technical triage cannot broaden an AUTEL-only search with generic catalogue terms',()=>{
  const catalog=[{keywords:['drone'],name:'Drone cadastrado'}];
  assert.equal(itemInScope({numeroItem:1,descricao:'Drone DJI'},{terms:['AUTEL']},catalog),false);
  assert.equal(itemInScope({numeroItem:2,descricao:'Bateria compatível'},{terms:['AUTEL']},catalog,['2']),true);
});
test('41 minutes minimum rejects 40, accepts 41, never rounds', () => {
  assert.equal(compareNumeric(req, spec).status, 'nao_ok');
  assert.equal(compareNumeric(req, { ...spec, value: 41, quote: 'Autonomia de 41 min' }).status, 'ok');
  assert.equal(compareNumeric(req, { ...spec, value: 40.99, quote: 'Autonomia de 40,99 min' }).status, 'nao_ok');
});
test('safe unit conversion, maximum, range and exact boundaries', () => {
  assert.equal(compareNumeric(req, { ...spec, value: 2460, unit: 's', quote: 'Autonomia 2460 s' }).status, 'ok');
  const max = { ...req, key: 'mass', value: 1, unit: 'kg', operator: 'max', quote: 'Peso máximo de 1 kg' };
  assert.equal(compareNumeric(max, { ...spec, key: 'mass', value: 1001, unit: 'g', quote: 'Peso 1001 g' }).status, 'nao_ok');
  assert.equal(compareNumeric({ ...req, operator: 'range', value: 40, upper: 42, quote: 'Entre 40 e 42 min' }, spec).status, 'ok');
});
test('conditions, optical/hybrid distinction, unsupported units and invented numbers remain uncertain', () => {
  assert.equal(compareNumeric(req, { ...spec, conditions: 'sem carga' }).status, 'verificar');
  assert.equal(compareNumeric({ ...req, key: 'optical_zoom' }, { ...spec, key: 'hybrid_zoom' }).status, 'verificar');
  assert.equal(compareNumeric(req, { ...spec, value: 42 }).status, 'verificar');
  assert.equal(compareNumeric({ ...req, operator: 'max' }, spec).status, 'verificar');
  assert.equal(compareNumeric({ ...req, unit: 'furlong' }, spec).status, 'verificar');
  assert.equal(compareNumeric(req, { ...spec, value: 50, quote: 'Autonomia de 50 s' }).status, 'verificar');
  const length = { ...req, key: 'length', value: .7, unit: 'm', operator: 'eq', quote: 'Comprimento: 0,7 m' };
  assert.equal(compareNumeric(length, { ...spec, key: 'length', value: 70, unit: 'cm', quote: 'Comprimento: 70 cm' }).status, 'ok');
  const speed = { ...req, key: 'speed', value: 10, unit: 'm/s', quote: 'Velocidade mínima de 10 m/s' };
  assert.equal(compareNumeric(speed, { ...spec, key: 'speed', value: 36, unit: 'km/h', quote: 'Velocidade de 36 km/h' }).status, 'ok');
  const batteries = { ...req, key: 'battery_count', value: 4, unit: 'baterias', quote: 'Mínimo de 4 baterias' };
  assert.equal(compareNumeric(batteries, { ...spec, key: 'battery_count', value: 2, unit: 'baterias', quote: 'Incluídas 2 baterias' }).status, 'nao_ok');
});
test('compound IP and resolution criteria use specific rules, never a scalar rating shortcut', () => {
  const r = { ...req, key: 'protecao_ip', kind: 'compound', value: 'IP54', quote: 'Proteção mínima IP54' };
  assert.equal(compareCompound(r, { ...spec, key: r.key, value: 'IP43', quote: 'Proteção IP43' }).status, 'nao_ok');
  assert.equal(compareCompound(r, { ...spec, key: r.key, value: 'IP55', quote: 'Proteção IP55' }).status, 'ok');
  assert.equal(compareCompound(r, { ...spec, key: r.key, value: 'IP67', quote: 'Proteção IP67' }), null);
  const resolution = { ...r, key: 'thermal_resolution', value: '640×512', quote: 'Resolução mínima 640×512' };
  assert.equal(compareCompound(resolution, { ...spec, key: resolution.key, value: '320×256', quote: 'Resolução 320×256' }).status, 'nao_ok');
  assert.equal(guardLegacyRequirement({ requisito: 'Autonomia mínima 41 min', status: 'ok', observacao: 'produto 40 min' }).status, 'verificar');
});
test('source contradictions, absent evidence and optional modules never grant compliance', () => {
  assert.equal(compareRequirement(req, [spec], [], mapping[0]).status, 'verificar');
  assert.equal(compareRequirement(req, [spec], [sources[0], { ...sources[1], notes: ['OCR com dúvida em números na página 1'] }], mapping[0]).status, 'verificar');
  const other = { ...spec, id: 's2', source_id: 'ficha2', value: 42, quote: 'Autonomia 42 min' };
  assert.equal(compareRequirement(req, [spec, other], [...sources, { id: 'ficha2', text: other.quote }], { spec_ids: ['s', 's2'] }).status, 'verificar');
  const categorical = { ...req, kind: 'categorical', key: 'rtk_included', value: 'incluído', quote: 'RTK incluído' };
  const optional = { ...spec, kind: 'categorical', key: 'rtk_included', value: 'opcional', quote: 'RTK opcional' };
  assert.equal(compareRequirement(categorical, [optional], [{ id: 'edital', text: categorical.quote }, { id: 'ficha', text: optional.quote }], mapping[0]).status, 'verificar');
});
test('full compliance requires complete documents and complete product specifications', () => {
  const r = { ...req, value: 40, quote: 'Autonomia mínima de 40 min' }, ss = [{ id: 'edital', text: r.quote }, sources[1]];
  assert.equal(assessProduct(product, [r], ss, mapping, true, { unit: 'un', reference_price: 120 }).status, 'full');
  assert.equal(assessProduct(product, [r], ss, mapping, false, { unit: 'un' }).status, 'uncertain');
  assert.equal(assessProduct({ ...product, specs_complete: false }, [r], ss, mapping, true, { unit: 'un' }).status, 'uncertain');
});
test('cheapest fully compliant product wins, and low price never overrides a failure', () => {
  const candidates = [{ product_id: '1', status: 'full', sale_price: 200, technical_bonus: 20, commercial_bonus: 1, counts: { ok: 1, total: 1 } },
    { product_id: '2', status: 'failed', sale_price: 10, counts: { ok: 0, total: 1 } },
    { product_id: '3', status: 'full', sale_price: 100, technical_bonus: 20, commercial_bonus: 5, counts: { ok: 1, total: 1 } }];
  const r = summarize([{ number: '1', in_scope: true, products: candidates }, { number: '2', in_scope: false, products: [] }], 80);
  assert.equal(r.items[0].recommended_product.product_id, '3'); assert.equal(r.full_items, 1); assert.equal(r.relevant_items, 1); assert.equal(r.score, 100);
});
test('commercial bonus requires comparable unit and composition and favors lower prices', () => {
  const r = { ...req, value: 40, quote: 'Autonomia mínima de 40 min' }, ss = [{ id: 'edital', text: r.quote }, sources[1]];
  const assess = (p, item) => assessProduct(p, [r], ss, mapping, true, item);
  assert.equal(assess(product, { unit: 'un', reference_price: 120 }).commercial_bonus, 5);
  assert.equal(assess(product, { unit: 'un', reference_price: 100 }).commercial_bonus, 3);
  assert.equal(assess(product, { unit: 'un', reference_price: 90 }).commercial_bonus, 1);
  assert.equal(assess(product, { unit: 'kit', reference_price: 120 }).commercial_bonus, 0);
  assert.equal(assess({ ...product, package_confirmed: false }, { unit: 'un', reference_price: 120 }).commercial_bonus, 0);
});
test('weighted bonus uses all relevant item values, or equal weights if any reference is missing', () => {
  const p = { status: 'full', sale_price: 1, technical_bonus: 20, commercial_bonus: 5, counts: { ok: 1, total: 1 } };
  const items = [{ in_scope: true, quantity: 1, reference_price: 300, products: [p] }, { in_scope: true, quantity: 1, reference_price: 100, products: [] }];
  assert.equal(summarize(items, 68).technical_bonus, 15);
  assert.equal(summarize([{ ...items[0], reference_price: null }, items[1]], 68).technical_bonus, 10);
});
test('safe defaults and rejection of local, mapped, reserved and multicast addresses', () => {
  assert.deepEqual(DEFAULTS, { enabled: false, min_score: 68, limit_mode: 'score', daily_limit: 30, daily_tokens: 2000000 });
  for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.20.0.1', '192.168.0.1', '100.64.0.1', '::1', '::ffff:127.0.0.1', 'ff00::1', 'fc00::1']) assert.equal(publicIp(ip), false, ip);
  assert.equal(publicIp('8.8.8.8'), true);
});
test('automatic analysis respects explicit exclusions and official service classification in any sector', () => {
  const profile = { terms: ['drone'], item_kind: 'material', excluded_terms: ['manutenção'] };
  assert.equal(itemInScope({ descricao: 'Serviços de operação de drone', materialOuServico: 'S' }, profile, []), false);
  assert.equal(itemInScope({ descricao: 'Drone para manutenção', materialOuServico: 'M' }, profile, []), false);
  assert.equal(itemInScope({ descricao: 'Drone profissional' }, profile, []), true);
  assert.equal(itemInScope({ descricaoItem: 'Aquisição de agulhas hipodérmicas' }, {}, [{ name: 'agulha hipodérmica' }]), true);
  assert.equal(itemInScope({ descricao: 'Medida cautelar' }, { terms: ['AUTEL'] }, []), false);
});
test('web sources flag client-side/incomplete content; chunking covers the entire source', async () => {
  const value = await extract(Buffer.from('<html><div id="root">Especificações técnicas disponíveis apenas ao carregar a página no navegador.</div></html>'), 'page.html', 'text/html');
  assert.equal(value.complete, false);
  const source = { id: '1', pages: [{ location: 'Página 1', text: 'abc '.repeat(10000) }] };
  const chunks = chunksForSource(source);
  assert.ok(chunks.length > 5); assert.equal(chunks.at(-1).text.endsWith('abc '), true);
});
