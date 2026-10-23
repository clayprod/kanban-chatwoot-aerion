const test = require('node:test');
const assert = require('node:assert/strict');
const { scopeProcurementItems } = require('../searchQuality');
const { normalizeProfile, matchesTerm, classifyItem, evaluateResult, applyQuality, buildPcaPredicate } = require('../searchQuality');
const { fallbackInterpret, sanitizeInterpretation, registerSearchGuidance } = require('../searchGuidance');
const { scanSearchTerm } = require('../searchScan');

const profile = extra => normalizeProfile({ terms: ['AUTEL'], confirmed_at: '2026-10-19', ...extra });
test('preview and import scope retain interested items, use whole terms and honor official service exclusion', () => {
  const items=[
    {numeroItem:1,descricao:'Aeronave AUTEL',materialOuServico:'M'},
    {numeroItem:2,descricao:'Providência cautelar',materialOuServico:'M'},
    {numeroItem:3,descricao:'Manutenção AUTEL',materialOuServico:'S'},
    {numeroItem:4,descricao:'Bateria AUTEL',materialOuServico:'M'},
    {numeroItem:5,descricao:'Peça AUTEL'},
  ];
  const result=scopeProcurementItems(items,profile({item_kind:'material',excluded_terms:['manutenção']}),[1,3]);
  assert.deepEqual(result.relevant.map(i=>i.numeroItem),[1,4,5]);
  assert.deepEqual(result.other.map(i=>i.numeroItem),[2,3]);
  assert.equal(result.relevant[2].scope_pending,true);
  assert.equal(result.unscoped,false);
});
test('known pertinent numbers survive abbreviated descriptions without widening to unrelated items', () => {
  const result=scopeProcurementItems([{numero_item:'22',descricao:'Bateria compatível',materialOuServico:'M'},{numero_item:'23',descricao:'Papel sulfite'}],profile(),['22']);
  assert.deepEqual(result.relevant.map(i=>i.numero_item),['22']);
  assert.equal(scopeProcurementItems([{numeroItem:1,descricao:'Sem critério disponível'}],{}).unscoped,true);
});
test('AUTEL is never a substring match and legacy expansion does not broaden the brand', () => {
  for (const text of ['cautelar', 'cautela', 'acautelamento', 'AUTELAR', 'aquisição cautelar de drones']) {
    assert.equal(evaluateResult({ descricao: text }, profile()).accepted, false, text);
  }
  assert.equal(evaluateResult({ descricao: 'Aquisição AUTEL Robotics' }, profile()).accepted, true);
  const legacy = normalizeProfile(null, { q: 'AUTEL', palavras_chave: ['AUTEL', 'drone', 'vant'], usar_ia: true });
  assert.deepEqual(legacy.terms, ['AUTEL']); assert.equal(legacy.match_mode, 'literal');
  assert.equal(evaluateResult({ descricao: 'Compra de drone' }, legacy).accepted, false);
});
test('sectors, accents, hyphens and controlled plurals; phrases require adjacency', () => {
  for (const [text, term] of [['CÂMERAS térmicas', 'camera'], ['raio-X portátil', 'raio x'], ['veículos blindados', 'veiculo blindado'], ['agulhas cirúrgicas', 'agulha cirurgica']]) {
    assert.equal(matchesTerm(text, term), true, term);
  }
  assert.equal(matchesTerm('Suporte hospitalar; monitor de pressão', 'suporte monitor'), false);
  assert.equal(matchesTerm('câmara de vereadores', 'camera'), false);
  assert.equal(matchesTerm('extravagante', 'vant'), false);
  assert.equal(matchesTerm('terraplanagem', 'rpa'), false);
});
test('expanded search uses approved relations, not unrelated generic provider suggestions', () => {
  const p = profile({ terms: ['equipamento odontologico'], match_mode: 'expanded', related_terms: ['cadeira odontologica'] });
  assert.equal(evaluateResult({ descricao: 'Compra de cadeiras odontológicas' }, p).accepted, true);
  assert.equal(evaluateResult({ descricao: 'Monitoramento de segurança predial', score: 100, valor_global: 99999999 }, p).accepted, false);
  p.match_mode = 'literal';
  assert.equal(evaluateResult({ descricao: 'Compra de cadeiras odontológicas' }, p).accepted, false);
});
test('only authoritative classification; PCA category IDs do not share the M/S domain', () => {
  assert.equal(classifyItem({ materialOuServico: 'S' }).kind, 'service');
  assert.equal(classifyItem({ classificacaoCatalogo: 1 }).kind, 'material');
  assert.equal(classifyItem({ categoriaItemPca: 2 }).kind, 'unknown');
  assert.equal(classifyItem({ descricao: 'prestação de serviço' }).kind, 'unknown');
  assert.equal(classifyItem({ materialOuServico: 'M', classificacaoCatalogo: 2 }).kind, 'unknown');
});
test('mixed procurement keeps only relevant materials and their value', () => {
  const item = { titulo: 'Compra e manutenção AUTEL', quality_items_complete: true,
    quality_items: [{ numeroItem: 1, descricao: 'Drone AUTEL', materialOuServico: 'M', valorTotal: 100 },
      { numeroItem: 2, descricao: 'Manutenção AUTEL', materialOuServico: 'S', valorTotal: 600 },
      { numeroItem: 3, descricao: 'Mesa de escritório', materialOuServico: 'M', valorTotal: 900 }] };
  const result = applyQuality([item], profile({ item_kind: 'material' })).items[0];
  assert.equal(result.search_quality.status, 'accepted');
  assert.deepEqual(result.search_quality.matching_item_numbers, [1]);
  assert.equal(result.valor_itens_pertinentes, 100);
});
test('services are excluded only with official evidence; missing/conflicting classification stays pending', () => {
  const p = profile({ item_kind: 'material' });
  const service = { titulo: 'AUTEL', quality_items: [{ descricao: 'manutenção de equipamentos', materialOuServico: 'S' }], quality_items_complete: true };
  assert.equal(evaluateResult(service, p).reason, 'official_item_kind');
  assert.equal(evaluateResult({ ...service, quality_items_complete: false }, p).status, 'pending_classification');
  assert.equal(evaluateResult({ descricao: 'Serviço AUTEL' }, p).status, 'pending_classification');
  assert.equal(evaluateResult({ descricao: 'AUTEL', materialOuServico: 'M', classificacaoCatalogo: 2, quality_is_pca: true }, p).status, 'pending_classification');
});
test('evidence beyond item 20 is recovered; a one-item purchase cannot manufacture evidence', () => {
  const quality_items = Array.from({ length: 35 }, (_, i) => ({ descricao: i === 32 ? 'Bateria AUTEL' : 'Material diverso', numeroItem: i + 1, materialOuServico: 'M' }));
  const result = evaluateResult({ titulo: 'Compra de materiais diversos', quality_items, quality_items_complete: true }, profile());
  assert.equal(result.accepted, true); assert.deepEqual(result.matching_item_numbers, [33]);
  assert.equal(evaluateResult({ quality_items: [{ descricao: 'Cirurgia cardíaca', valorTotal: 999999 }] }, profile()).accepted, false);
  const titleOnly = applyQuality([{ titulo: 'Compra AUTEL', valor_itens_pertinentes: 999999,
    itens_pertinentes: [{ descricao: 'Material diverso', valor_total: 999999 }] }], profile()).items[0];
  assert.equal(titleOnly.valor_itens_pertinentes, null);
  assert.equal(titleOnly.itens_pertinentes_count, 0);
});
test('negative phrases use full boundaries and do not discard other relevant items', () => {
  const p = profile({ excluded_terms: ['manutencao preventiva'] });
  assert.equal(evaluateResult({ descricao: 'AUTEL manutenção preventiva' }, p).accepted, false);
  assert.equal(evaluateResult({ descricao: 'AUTEL manutenção de câmara; compra preventiva' }, p).accepted, true);
  assert.equal(evaluateResult({ titulo: 'Manutenção preventiva AUTEL', quality_items: [{ descricao: 'Compra de bateria AUTEL', materialOuServico: 'M' }] }, p).accepted, true);
});
test('SQL binds user terms, retains unknowns, and uses the same phrase boundaries', () => {
  const params = [];
  const sql = buildPcaPredicate(profile({ terms: ["agulha'); DROP TABLE pca_itens; --"], item_kind: 'material' }), params);
  assert.equal(sql.includes('DROP TABLE'), false);
  assert.equal(sql.includes('IS NULL'), true);
  assert.equal(params.at(-1), 'M');
});
test('guidance never auto-approves AI suggestions or invents explicit answers', () => {
  const interpreted = sanitizeInterpretation({ terms: ['trator'], suggested_terms: ['maquina agricola'], related_terms: ['qualquer coisa'], confirmed_at: 'yes' }, 'Procuro trator');
  assert.deepEqual(interpreted.profile.related_terms, []);
  assert.equal(interpreted.profile.confirmed_at, null);
  assert.equal(interpreted.questions.length, 2);
  assert.equal(fallbackInterpret('Procuro cadeiras').profile.terms[0], 'cadeiras');
  const explicit = sanitizeInterpretation({ terms: ['AUTEL'], explicit_answers: { match_mode: 'literal' } }, 'Só AUTEL');
  assert.deepEqual(explicit.questions.map(q => q.id), ['item_kind']);
  const ambiguous = sanitizeInterpretation({ terms: ['monitor'], clarifications: [{ question: 'Que tipo de monitor?',
    options: [{ label: 'Tela de computador', terms: ['monitor de computador'], confirmed_at: 'fake' },
      { label: 'Monitor de sinais vitais', terms: ['monitor de sinais vitais'] }] }] }, 'monitor');
  assert.deepEqual(ambiguous.profile.terms, ['monitor']);
  assert.equal(ambiguous.questions[0].options[0].criteria.confirmed_at, undefined);
  assert.deepEqual(ambiguous.questions[0].options[0].criteria.terms, ['monitor de computador']);
});
test('rotating scanner reaches results beyond 500 without losing head updates', async () => {
  let state = {};
  const seen = new Set();
  const calls = [];
  for (let tick = 0; tick < 3; tick++) {
    state = await scanSearchTerm({ state, fetchPage: async page => {
      calls.push(page); return { total: 625, items: Array.from({ length: Math.max(0, Math.min(50, 625 - (page - 1) * 50)) }, (_, n) => ({ id: (page - 1) * 50 + n })) };
    }, processPage: async items => items.forEach(i => seen.add(i.id)) });
  }
  assert.equal(seen.size, 625); assert.equal(state.complete, true);
  assert.equal(calls.filter(p => p === 1).length, 3);
});
test('page and persistence failures resume at the failed page, not the following one', async () => {
  const state = await scanSearchTerm({ state: { next_page: 7 }, fetchPage: async page => ({ total: 2000, items: Array(50).fill(page) }),
    processPage: async (items, page) => { if (page === 8) throw new Error('database unavailable'); } });
  assert.equal(state.next_page, 8); assert.equal(state.complete, false); assert.equal(state.errors[0].page, 8);
});

test('API page-size clamping does not silently terminate the scan', async () => {
  const seen = new Set();
  const state = await scanSearchTerm({ pageSize: 50, headPages: 2, tailPages: 4,
    fetchPage: async page => ({ total: 125, items: Array.from({ length: 25 }, (_, i) => ({ id: (page - 1) * 25 + i })) }),
    processPage: async items => items.forEach(i => seen.add(i.id)) });
  assert.equal(seen.size, 125); assert.equal(state.complete, true);
});
test('unexpected empty pages retain the cursor and report incomplete coverage', async () => {
  const state = await scanSearchTerm({ state: { next_page: 9 }, fetchPage: async page => ({ total: 1000, items: page === 9 ? [] : Array(50).fill({}) }), processPage: async () => {} });
  assert.equal(state.next_page, 9); assert.equal(state.complete, false); assert.equal(state.errors[0].page, 9);
});
test('explicit expanded brand search is possible without locking the product to a sector', () => {
  const p = normalizeProfile({ terms: ['AUTEL'], match_mode: 'expanded', related_terms: ['aeronave remotamente pilotada'] });
  assert.equal(p.match_mode, 'expanded');
  assert.equal(evaluateResult({ descricao: 'Aeronave remotamente pilotada' }, p).accepted, true);
  const invalid = sanitizeInterpretation({ terms: ['trator'], explicit_answers: { match_mode: 'service' } }, 'trator');
  assert.equal(invalid.questions.length, 2);
});

test('preview API caps the real sample, rejects substring hits and performs no activation writes', async () => {
  const handlers = new Map();
  const app = { post: (route, fn) => handlers.set(route, fn), get: () => {} };
  const values = {};
  const res = { status(code) { values.status = code; return this; }, json(data) { values.data = data; return this; } };
  registerSearchGuidance(app, { pool: { query: () => { throw new Error('Preview must not write'); } },
    getAccountId: () => 7, interpret: async () => null,
    preview: async ({ accountId }) => {
      assert.equal(accountId, 7);
      return { items: [{ descricao: 'Aquisição cautelar' }, ...Array.from({ length: 15 }, () => ({ descricao: 'Drone AUTEL' }))], coverage: { pages_requested: 1 } };
    } });
  await handlers.get('/api/licitacoes/search/guide/preview')({ body: { profile: profile(), source: 'edital' } }, res);
  assert.equal(values.data.items.length, 10);
  assert.equal(values.data.coverage.complete, false);
  assert.equal(values.data.quality_audit.rejected, 1);
  assert.equal(values.data.coverage.sample_only, true);
});
