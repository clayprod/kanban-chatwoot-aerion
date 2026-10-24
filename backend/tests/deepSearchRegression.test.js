'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { FACTS_FORMAT } = require('../technicalAiFormat');
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
    PNCP_HEAVY_JOB: { current: 'deep-search', queue: [] }, yieldPncpHeavyJobSlot: async () => {},
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

test('a checkpointed collector lends its heavy slot to technical analysis and then resumes', async () => {
  const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
  const start = source.indexOf('const PNCP_HEAVY_JOB =');
  const end = source.indexOf('/** Orçamento de enriquecimento', start);
  const context = { console: { log() {} } };
  vm.runInNewContext(`${source.slice(start, end)};globalThis.slot={run:withPncpHeavyJobSlot,yield:yieldPncpHeavyJobSlot,snapshot:getPncpHeavyJobSnapshot};`, context);
  const order = []; let release;
  const checkpoint = new Promise(resolve => { release = resolve; });
  const collector = context.slot.run('deep-search', async () => {
    order.push('page saved'); await checkpoint; await context.slot.yield();
    assert.equal(context.slot.snapshot().current, 'deep-search'); order.push('next page');
  });
  const technical = context.slot.run('technical-notice', async () => {
    assert.equal(context.slot.snapshot().current, 'technical-notice'); order.push('technical read');
  });
  release(); await Promise.all([collector, technical]);
  assert.deepEqual(order, ['page saved', 'technical read', 'next page']);
  assert.equal(context.slot.snapshot().current, null); assert.equal(context.slot.snapshot().queue_len, 0);
});

test('technical pagination accepts confirmed HTTP 204, but never a broken empty HTTP 200', async () => {
  const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
  const start = source.indexOf('const fetchJsonWithCurl =');
  const end = source.indexOf('const describeFetchError =', start);
  let response = '\n204';
  const context = { process: { platform: 'linux' }, getPncpCallProxy: () => null,
    spawn: (_bin, args) => {
      assert.ok(args.includes('--write-out'));
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      queueMicrotask(() => { child.stdout.emit('data', response); child.emit('close', 0); });
      return child;
    } };
  vm.runInNewContext(`${source.slice(start, end)};globalThis.read=fetchJsonWithCurl;`, context);
  assert.equal((await context.read('https://example.org', 45, { allowNoContent: true })).length, 0);
  response = '\n200';
  await assert.rejects(context.read('https://example.org', 45, { allowNoContent: true }), /JSON parse/);
  response = '[{"numeroItem":1}]\n200';
  assert.equal((await context.read('https://example.org', 45, { allowNoContent: true }))[0].numeroItem, 1);
});

test('technical providers request strict facts from an available model without changing other AI callers', async () => {
  const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
  const start = source.indexOf('const getAiChatProviders =');
  const end = source.indexOf('const technicalAnalysis =', start);
  const requests = [];
  const context = { process: { env: {} }, OPENAI_API_KEY: 'test', GROQ_API_KEY: 'test', OPENROUTER_API_KEY: 'test',
    OPENAI_AI_MODEL: 'gpt-4.1-mini', GROQ_AI_MODEL: 'llama-3.3-70b-versatile', OPENROUTER_AI_MODEL: 'openai/gpt-4o-mini',
    AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"complete":true,"facts":[],"conflicts":[]}' }, finish_reason: 'stop' }], usage: { total_tokens: 10 } }) };
    } };
  vm.runInNewContext(`${source.slice(start, end)};globalThis.ask=chatCompletionJson;`, context);
  const request = { system: 'Extract JSON facts', user: 'data', maxTokens: 7000, maxProviderAttempts: 1, responseFormat: FACTS_FORMAT };
  assert.equal((await context.ask({ ...request, technical: true, providerOffset: 1 })).ok, true);
  assert.equal(requests[0].body.model, 'openai/gpt-oss-120b');
  // O teto de 4000 tokens para chamada tecnica no Groq foi removido de proposito em
  // 1b7e115 (`Math.min(maxTokens, 4000)` virou `maxTokens`); a assercao tinha ficado
  // para tras e deixou a main vermelha, bloqueando deploy de todo mundo.
  assert.equal(requests[0].body.max_tokens, 7000);
  assert.deepEqual(requests[0].body.response_format, FACTS_FORMAT);
  await context.ask({ ...request, technical: true, providerOffset: 2 });
  assert.equal(requests[1].body.provider.require_parameters, true);
  await context.ask({ ...request, providerOffset: 1 });
  assert.equal(requests[2].body.model, 'llama-3.3-70b-versatile');
  assert.equal(requests[2].body.max_tokens, 7000);
  assert.equal(requests[2].body.response_format, undefined);
});
