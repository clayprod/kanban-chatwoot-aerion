'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTechnicalAnalysis } = require('../technicalAnalysis');

function worker(state = {}, overrides = {}, config = { enabled: true, daily_limit: 30 }) {
  const job = { id: 1, account_id: 1, kind: 'notice', state, context: { ids: {}, profile: {}, payload: {} }, attempts: 2 };
  const queries = [];
  const query = async (sql, args) => {
    queries.push({ sql, args });
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    if (sql.startsWith('SELECT j.*')) return { rows: [job] };
    if (sql.startsWith('SELECT * FROM technical_config')) return { rows: [config] };
    if (sql.includes('SELECT notices FROM technical_usage')) return { rows: [{ notices: 0 }] };
    return { rows: [] };
  };
  const pool = { query, connect: async () => ({ query, release() {} }) };
  const service = createTechnicalAnalysis({ pool, heavy: async (_name, fn) => fn(),
    getNotice: async () => { throw Object.assign(new Error('PNCP bulk gate wait exceeded (paused)'), { code: 'PNCP_BULK_DEFERRED' }); },
    ...overrides });
  return { service, job, queries };
}

test('PNCP deferrals never exhaust retries or reserve analyzed-notice quota', async () => {
  const { service, job, queries } = worker();
  for (let n = 0; n < 4; n++) await service.tick();
  const waits = queries.filter(q => q.sql.includes("stage='waiting_pncp'"));
  assert.equal(waits.length, 4);
  assert.ok(waits.every(q => q.sql.includes("status='queued'") && q.sql.includes('attempts=0') && q.sql.includes('error=NULL')));
  assert.equal(queries.some(q => q.sql.includes('attempts=attempts+1')), false);
  assert.equal(queries.some(q => q.sql.includes('INSERT INTO technical_usage')), false);
  assert.deepEqual(job.state, {});
});

test('transient PNCP download wait preserves file cursor, evidence and completeness', async () => {
  const state = { initialized: true, items_complete: true, files: [{ name: 'TR.pdf', url: 'https://pncp.gov.br/tr.pdf' }], file_cursor: 0, source_ids: ['9'], complete: true, notes: [] };
  const before = structuredClone(state);
  const { service, queries } = worker(state, { documentIO: { download: async () => { throw new Error('PNCP bulk budget deferred'); } } });
  await service.tick();
  assert.deepEqual(state, before);
  assert.ok(queries.some(q => q.sql.includes("stage='waiting_pncp'")));
  assert.equal(queries.some(q => q.sql.includes('SET state=')), false);
});

test('throttle classification also pauses while real errors retain the failure budget', async () => {
  const throttle = worker({}, { getNotice: async () => { throw new Error('429 PNCP'); }, isPncpThrottleError: e => e.message === '429 PNCP' });
  await throttle.service.tick();
  assert.ok(throttle.queries.some(q => q.sql.includes("stage='waiting_pncp'")));
  const broken = worker({}, { getNotice: async () => { throw new Error('Invalid document response'); } });
  await broken.service.tick();
  assert.ok(broken.queries.some(q => q.sql.includes('attempts=attempts+1') && q.args[1] === 'Invalid document response'));
  assert.equal(broken.queries.some(q => q.sql.includes("stage='waiting_pncp'")), false);
});

test('resumed metadata request advances to documents using the same analysis', async () => {
  let paused = true;
  const { service, job, queries } = worker({}, {
    getNotice: async () => { if (paused) throw new Error('PNCP bulk gate wait exceeded (queue)'); return { open: true }; },
    getItems: async () => Object.assign([], { complete: true }), getFiles: async () => [], isEligible: () => true,
  });
  await service.tick();
  paused = false;
  await service.tick();
  await service.tick();
  await service.tick();
  assert.equal(job.stage, 'documents');
  assert.equal(job.state.initialized, true);
  assert.equal(queries.filter(q => q.sql.includes('SET state=')).length, 3);
  assert.equal(queries.filter(q => q.sql.includes('INSERT INTO technical_usage')).length, 0);
});

test('PNCP terminated sockets and download disconnects wait without skipping evidence', async () => {
  for (const error of [new TypeError('terminated'), Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } })]) {
    const metadata = worker({}, { getNotice: async () => { throw error; } });
    await metadata.service.tick();
    assert.ok(metadata.queries.some(q => q.sql.includes("stage='waiting_pncp'")));
  }
  const state = { initialized: true, items_complete: true, files: [{ name: 'TR.pdf', url: 'https://pncp.gov.br/tr.pdf' }], file_cursor: 0, source_ids: [], complete: true, notes: [] };
  const download = worker(state, { documentIO: { download: async () => { throw new TypeError('terminated'); } } });
  await download.service.tick();
  assert.equal(state.file_cursor, 0); assert.equal(state.complete, true); assert.deepEqual(state.notes, []);
  assert.ok(download.queries.some(q => q.sql.includes("stage='waiting_pncp'")));
});

test('a failure listing items does not discard a successful notice request', async () => {
  let notices = 0, items = 0;
  const { service, job } = worker({}, {
    getNotice: async () => { notices++; return { open: true }; }, isEligible: () => true,
    getItems: async () => { if (++items === 1) throw new TypeError('terminated'); return Object.assign([], { complete: true }); },
    getFiles: async () => [],
  });
  await service.tick(); await service.tick();
  assert.equal(job.state.notice_checked, true); assert.equal(job.state.items_loaded, undefined);
  await service.tick(); await service.tick();
  assert.equal(job.state.initialized, true); assert.equal(notices, 1); assert.equal(items, 2);
});

test('metadata and downloads are not blocked by an AI notice budget before any AI request', async () => {
  const { service, job, queries } = worker({ notice_checked: true, items_loaded: true }, {
    getFiles: async () => [], isPncpThrottleError: e => /limite/i.test(e.message),
  }, { enabled: true, daily_limit: 0 });
  await service.tick();
  assert.equal(queries.some(q => q.sql.includes("stage='waiting_pncp'")), false);
  assert.equal(job.state.initialized,true);
  assert.equal(queries.some(q => q.sql.includes('INSERT INTO technical_usage')),false);
});

test('a failed attachment is never skipped and another notice can run before its scheduled retry', async () => {
  const state={initialized:true,items_complete:true,files:[{name:'Termo de referência',url:'https://example.org/tr.pdf'}],file_cursor:0,source_ids:[],complete:true,notes:[]};
  const {service,job,queries}=worker(state,{documentIO:{download:async()=>{throw new Error('HTTP 503');}}});
  await service.tick();
  assert.equal(state.file_cursor,0);assert.deepEqual(state.source_ids,[]);
  assert.equal(job.stage,'recovering_documents');assert.equal(state.file_errors['0'].name,'Termo de referência');
  assert.ok(queries.some(q=>q.sql.includes("INTERVAL '20 minutes'") && q.args[1].includes('não foi ignorado')));
  assert.equal(queries.some(q=>q.sql.includes('attempts=attempts+1')),false);
});
