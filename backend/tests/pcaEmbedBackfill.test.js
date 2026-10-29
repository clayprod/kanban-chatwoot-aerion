'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runPcaEmbedBackfillBatch } = require('../embeddings');

// Pool falso: registra as queries e devolve páginas de pendentes por cursor de id.
function fakePool(ids) {
  const log = [];
  const run = async (sql, params = []) => {
    log.push({ sql: String(sql), params });
    if (/FROM pca_itens\s+WHERE embedding IS NULL AND descricao IS NOT NULL AND id > \$1/.test(sql)) {
      const rows = ids.filter(id => id > params[0]).slice(0, params[1]).map(id => ({ id, descricao: 'item ' + id }));
      return { rows };
    }
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ total: ids.length }] };
    return { rows: [], rowCount: 0 };
  };
  return { log, query: run, connect: async () => ({ query: run, release() {} }) };
}

test('backfill do PCA seleciona por cursor de id, sem JOIN nem ORDER BY global', async () => {
  const pool = fakePool([1, 2, 3, 4, 5]);
  await runPcaEmbedBackfillBatch({ pool, batchSize: 2 });
  await runPcaEmbedBackfillBatch({ pool, batchSize: 2 });
  const selects = pool.log.filter(q => /SELECT id, descricao FROM pca_itens/.test(q.sql));
  assert.equal(selects.length, 2);
  assert.deepEqual(selects.map(q => q.params[0]), [0, 2]); // cursor avança para o último id lido
  for (const q of selects) assert.doesNotMatch(q.sql, /JOIN|pca_planos/);
});

test('backfill do PCA cria o índice parcial uma vez e cacheia o COUNT', async () => {
  const pool = fakePool([]);
  await runPcaEmbedBackfillBatch({ pool, batchSize: 2 });
  await runPcaEmbedBackfillBatch({ pool, batchSize: 2 });
  const indices = pool.log.filter(q => /CREATE INDEX CONCURRENTLY/.test(q.sql));
  const counts = pool.log.filter(q => /COUNT\(\*\)/.test(q.sql));
  assert.ok(indices.length <= 1);
  assert.ok(counts.length <= 1);
});
