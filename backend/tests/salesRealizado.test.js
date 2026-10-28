const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hybridRealizado, revenueSource } = require('../salesRealizado');

const invoice = (company, overrides = {}) => ({ id: '1', companyId: company, resource: 'invoices', date: '2026-10-22',
  authorized: true, invoiceStatus: '1', currency: 'BRL', productValue: company, sellerCode: '33', sellerName: 'Vendedor', ...overrides });
function database({ companies = [100, 102], missing = [], documents = {} } = {}) {
  return { query: async (sql, params) => {
    if (sql.includes('connections')) return { rows: companies.map(company_id => ({ company_id, feed_realizado: true, national_currency: 'BRL' })) };
    if (sql.includes('SELECT * FROM sankhya_reporting_streams')) return { rows: companies.filter(c => !missing.includes(c))
      .map(company_id => ({ company_id, last_success_at: '2026-10-28T17:00:00Z' })) };
    assert(sql.includes('s.published_generation=d.generation'));
    assert(sql.includes('d.company_id=$3'));
    return { rows: (documents[params[2]] || [invoice(params[2])]).map(data => ({ data })) };
  } };
}

test('both automatic companies exclude legacy imports and keep equal document IDs separate', async () => {
  const legacyPool = { query: async () => { assert.fail('automatic companies must never read legacy revenue'); } };
  const pool = database();
  const result = await hybridRealizado({ pool, legacyPool, year: 2026 });
  assert.equal(result.source, 'sankhya_100_102_invoices');
  assert.equal(result.partial, false);
  assert.deepEqual(result.meses[9], { mes: 10, receita: 202, receita_100: 100, receita_102: 102, vendas: 2, vendas_100: 1, vendas_102: 1 });
  const sellers = await hybridRealizado({ pool, legacyPool, year: 2026, bySeller: true, month: 10 });
  assert.equal(sellers.vendedores.length, 1); assert.equal(sellers.vendedores[0].receita, 202);
});

test('missing company 100 snapshot stays partial without silently restoring its old import', async () => {
  const result = await hybridRealizado({ pool: database({ missing: [100] }), year: 2026,
    legacyPool: { query: async () => { assert.fail('no legacy fallback for enabled company 100'); } } });
  assert.equal(result.partial, true); assert.equal(result.sources[0].available, false);
  assert.equal(result.meses[9].receita_100, 0); assert.equal(result.meses[9].receita_102, 102);
});

test('only company 100 can switch while company 102 keeps its explicit legacy company filter', async () => {
  const result = await hybridRealizado({ pool: database({ companies: [100] }), year: 2026, month: 10,
    legacyPool: { query: async (sql, params) => {
      assert(sql.includes('empresa=$3')); assert.deepEqual(params, [2026, 10, 102]);
      return { rows: [{ mes: 10, document_id: '1', seller_code: '33', seller: 'Vendedor', value: 30 }] };
    } } });
  assert.equal(result.source, 'hybrid_100_invoices_102_database');
  assert.equal(result.receita, 130); assert.equal(result.vendas, 2);
});

test('invalid fiscal status, orders and unidentified amounts in either company cannot inflate revenue', async () => {
  const result = await hybridRealizado({ pool: database({ documents: {
    100: [invoice(100), invoice(100, { id: '2', resource: 'orders', productValue: 999 }),
      invoice(100, { id: '3', authorized: false, invoiceStatus: '2' }), invoice(100, { id: '4', productValue: null })],
    102: [invoice(102), invoice(102, { id: '5', currency: null, currencyCode: '1' })],
  } }), year: 2026 });
  assert.equal(result.meses[9].receita, 202); assert.equal(result.excludedIncompleteDocuments, 2); assert.equal(result.partial, true);
});

test('unconfigured automatic revenue preserves the existing source', async () => {
  assert.equal(revenueSource([]), 'existing_reporting_database');
  assert.equal(revenueSource([{ company_id: 100, feed_realizado: false }]), 'existing_reporting_database');
  assert.equal(revenueSource([{ company_id: 102, feed_realizado: true }]), 'hybrid_100_database_102_invoices');
  assert.equal(await hybridRealizado({ pool: database({ companies: [] }), year: 2026 }), null);
});
