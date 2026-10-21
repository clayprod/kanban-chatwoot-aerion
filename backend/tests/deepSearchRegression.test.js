'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { normalizeProfile } = require('../searchQuality');
test('the real deep collector reaches the PNCP gate after refreshing live terms', async () => {
  const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
  const start = source.indexOf('const runPncpDeepSearchJobUnlocked =');
  const end = source.indexOf("app.get('/api/licitacoes/pncp/search/jobs'", start);
  const cancelled = new Set(); let requests = 0;
  const job = { id: 'regression', account_id: 1, filters: { q: 'drone', status: 'todos', search_profile: { terms: ['drone'], match_mode: 'literal' } }, terms: ['drone'], negative_terms: [], progress: {}, total: 0 };
  const normalize = s => String(s || '').toLowerCase();
  const context = { process: { env: {} }, console: { log() {}, warn() {} }, normalizeProfile,
    uniqueQualityTerms: values => [...new Set(values)], normalizeSearchText: normalize,
    mergeUniqueTerms: (...values) => [...new Set(values.flat())], splitPncpTerms: () => [],
    PNCP_DEEP_SEARCH_JOBS: new Map([[job.id, job]]), PNCP_DEEP_SEARCH_CANCELLED: cancelled,
    PNCP_TERM_RUN_RESUME_STOPS: new Set(), PNCP_TERM_RUN_DONE_STOPS: new Set(),
    PNCP_DEEP_PAGES_PER_SLICE: 2, PNCP_DEEP_INCREMENTAL_PAGES: 2,
    PNCP_RATE_LIMIT_RESUME_DELAY_MS: 1000, schedulePncpSearchResume() {},
    countPncpJobResults: async () => 0, loadPncpJobResultKeys: async () => [],
    persistPncpDeepJob: async () => {}, getPncpGateSnapshot: () => ({}),
    refreshPncpJobSummaryTotals: async () => {},
    upsertTermRun: (rows, run) => rows.push(run),
    withPncpGate: async (fn, options) => { assert.equal(options.priority, 'bulk'); return fn(); },
    fetchPncpSearchStable: async () => { requests++; cancelled.add(job.id); throw new Error('cancelled'); },
    isPncpBulkDeferredError: () => false, isPncpThrottleError: () => false,
  };
  // Evaluate the actual function without starting the server or calling PNCP.
  vm.runInNewContext(`${source.slice(start, end)};globalThis.run=runPncpDeepSearchJobUnlocked;`, context);
  await context.run(job.id);
  assert.equal(requests, 1, job.error);
  assert.notEqual(job.status, 'failed', job.error);
  assert.notEqual(job.error, 'Assignment to constant variable.');
});
