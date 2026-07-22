const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPncpProxyPool,
  parseWebshareProxies,
  mergeProxyList,
  pickPncpProxy,
  reportPncpProxyOk,
  reportPncpProxyThrottle,
  countAliveProxies,
  countRecentProxyThrottles,
  reportPncpProxyDown,
  isPncpProxyTransportError,
  proxyToUrl,
  getPncpProxyPoolSnapshot,
} = require('../pncpProxyPool');

const makePool = (env = {}) =>
  createPncpProxyPool({ WEBSHARE_TOKEN: 'tok', ...env });

const seedProxies = (pool, n, now = 0) => {
  mergeProxyList(pool, Array.from({ length: n }, (_, i) => ({
    id: `10.0.0.${i}:8000`,
    host: `10.0.0.${i}`,
    port: 8000,
    username: `u${i}`,
    password: `p${i}`,
    country: 'US',
  })), now);
};

test('desabilitado sem WEBSHARE_TOKEN ou com PNCP_PROXY_ENABLED=0', () => {
  assert.equal(createPncpProxyPool({}).enabled, false);
  assert.equal(makePool({ PNCP_PROXY_ENABLED: '0' }).enabled, false);
  assert.equal(makePool().enabled, true);
});

test('parse do payload do webshare filtra inválidos e incompletos', () => {
  const parsed = parseWebshareProxies({
    results: [
      { proxy_address: '1.1.1.1', port: 80, username: 'u', password: 'p', country_code: 'GB', valid: true },
      { proxy_address: '2.2.2.2', port: 81, username: 'u', password: 'p', valid: false },
      { proxy_address: '3.3.3.3', port: 82, username: 'u' },
    ],
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, '1.1.1.1:80');
  assert.equal(parsed[0].country, 'GB');
});

test('bulk nunca recebe proxy; interactive e sync rotacionam round-robin', () => {
  const pool = makePool();
  seedProxies(pool, 3);
  assert.equal(pickPncpProxy(pool, 'bulk', 0), null);
  const picked = [
    pickPncpProxy(pool, 'interactive', 0).id,
    pickPncpProxy(pool, 'sync', 0).id,
    pickPncpProxy(pool, 'interactive', 0).id,
    pickPncpProxy(pool, 'interactive', 0).id,
  ];
  assert.deepEqual(picked, ['10.0.0.0:8000', '10.0.0.1:8000', '10.0.0.2:8000', '10.0.0.0:8000']);
});

test('2 throttles seguidos colocam o proxy em quarentena com backoff exponencial', () => {
  const pool = makePool();
  seedProxies(pool, 1);
  const [p] = pool.proxies;
  assert.equal(reportPncpProxyThrottle(pool, p.id, 1_000), false);
  assert.equal(reportPncpProxyThrottle(pool, p.id, 10_000), true);
  assert.equal(p.quarantineUntil, 10_000 + 2 * 60 * 1000);
  // Terceiro throttle (após sair da quarentena) dobra o backoff.
  const t3 = p.quarantineUntil + 1;
  assert.equal(reportPncpProxyThrottle(pool, p.id, t3), true);
  assert.equal(p.quarantineUntil, t3 + 4 * 60 * 1000);
});

test('throttles em <800ms são deduplicados (retry + gate veem o mesmo erro)', () => {
  const pool = makePool();
  seedProxies(pool, 1);
  const [p] = pool.proxies;
  reportPncpProxyThrottle(pool, p.id, 1_000);
  reportPncpProxyThrottle(pool, p.id, 1_400);
  assert.equal(p.failStreak, 1);
  assert.equal(p.totalThrottle, 1);
});

test('sucesso zera o failStreak', () => {
  const pool = makePool();
  seedProxies(pool, 1);
  const [p] = pool.proxies;
  reportPncpProxyThrottle(pool, p.id, 1_000);
  reportPncpProxyOk(pool, p.id, 2_000);
  assert.equal(p.failStreak, 0);
  assert.equal(p.totalOk, 1);
});

test('todos em quarentena → fallback IP direto (null); quarentena expira', () => {
  const pool = makePool();
  seedProxies(pool, 2);
  for (const p of pool.proxies) {
    reportPncpProxyThrottle(pool, p.id, 0);
    reportPncpProxyThrottle(pool, p.id, 1_000);
  }
  assert.equal(countAliveProxies(pool, 2_000), 0);
  assert.equal(pickPncpProxy(pool, 'interactive', 2_000), null);
  // Depois do backoff (2min), voltam ao pool.
  const later = 1_000 + 2 * 60 * 1000 + 1;
  assert.notEqual(pickPncpProxy(pool, 'interactive', later), null);
});

test('pickPncpProxy pula lanes ocupadas (exclude) e devolve null se todas ocupadas', () => {
  const pool = makePool();
  seedProxies(pool, 2);
  const busy = new Set(['10.0.0.0:8000']);
  assert.equal(pickPncpProxy(pool, 'interactive', 0, busy).id, '10.0.0.1:8000');
  busy.add('10.0.0.1:8000');
  assert.equal(pickPncpProxy(pool, 'interactive', 0, busy), null);
});

test('countRecentProxyThrottles conta proxies distintos na janela de 90s', () => {
  const pool = makePool();
  seedProxies(pool, 4);
  reportPncpProxyThrottle(pool, '10.0.0.0:8000', 10_000);
  reportPncpProxyThrottle(pool, '10.0.0.1:8000', 50_000);
  reportPncpProxyThrottle(pool, '10.0.0.2:8000', 100_000);
  // Aos 120s: proxy 0 (110s atrás) já saiu da janela; 1 e 2 ainda contam.
  assert.equal(countRecentProxyThrottles(pool, 90_000, 120_000), 2);
});

test('PNCP_PROXY_LANES respeita limites (1..10, default 6)', () => {
  assert.equal(makePool().maxLanes, 6);
  assert.equal(makePool({ PNCP_PROXY_LANES: '3' }).maxLanes, 3);
  assert.equal(makePool({ PNCP_PROXY_LANES: '99' }).maxLanes, 10);
  assert.equal(makePool({ PNCP_PROXY_LANES: '0' }).maxLanes, 1);
});

test('refresh preserva o pacing (lastAt) da lane junto com as estatísticas', () => {
  const pool = makePool();
  seedProxies(pool, 1);
  pool.proxies[0].lastAt = 5_000;
  mergeProxyList(pool, [
    { id: '10.0.0.0:8000', host: '10.0.0.0', port: 8000, username: 'u0', password: 'p0', country: 'US' },
  ], 6_000);
  assert.equal(pool.proxies[0].lastAt, 5_000);
});

test('refresh preserva estatísticas de proxies que continuam na lista', () => {
  const pool = makePool();
  seedProxies(pool, 2);
  reportPncpProxyOk(pool, '10.0.0.0:8000', 1_000);
  mergeProxyList(pool, [
    { id: '10.0.0.0:8000', host: '10.0.0.0', port: 8000, username: 'u0', password: 'nova', country: 'US' },
    { id: '10.9.9.9:8000', host: '10.9.9.9', port: 8000, username: 'u9', password: 'p9', country: 'JP' },
  ], 2_000);
  const kept = pool.proxies.find(p => p.id === '10.0.0.0:8000');
  assert.equal(kept.totalOk, 1);
  assert.equal(kept.password, 'nova');
  assert.equal(pool.proxies.find(p => p.id === '10.0.0.1:8000'), undefined);
});

test('isPncpProxyTransportError separa falha de túnel de resposta HTTP do PNCP', () => {
  // Falhas de transporte (banda esgotada / proxy morto): retry direto.
  assert.equal(isPncpProxyTransportError(new Error('fetch failed')), true);
  assert.equal(isPncpProxyTransportError('curl exit 56: Received HTTP code 402 from proxy after CONNECT'), true);
  assert.equal(isPncpProxyTransportError({ message: 'fetch failed', cause: { code: 'ECONNREFUSED' } }), true);
  assert.equal(isPncpProxyTransportError('curl JSON parse error: Unexpected token <'), true);
  // Respostas HTTP reais do PNCP: o túnel funcionou — não é culpa do proxy.
  assert.equal(isPncpProxyTransportError(new Error('PNCP error 429: too many requests')), false);
  assert.equal(isPncpProxyTransportError(new Error('PNCP Consulta error 404: not found')), false);
});

test('proxy down: quarentena longa imediata, escalonada, sem poluir a janela de 90s', () => {
  const pool = makePool();
  seedProxies(pool, 2);
  const [p] = pool.proxies;
  assert.equal(reportPncpProxyDown(pool, p.id, 1_000), true);
  assert.equal(p.quarantineUntil, 1_000 + 10 * 60 * 1000);
  // Não conta como throttle do PNCP → não dispara o freio global "3+ em 90s".
  assert.equal(countRecentProxyThrottles(pool, 90_000, 2_000), 0);
  // Dedupe dentro de 800ms; depois escala (10min → 20min).
  assert.equal(reportPncpProxyDown(pool, p.id, 1_500), false);
  const t2 = p.quarantineUntil + 1;
  reportPncpProxyDown(pool, p.id, t2);
  assert.equal(p.quarantineUntil, t2 + 20 * 60 * 1000);
  // Sucesso (após quarentena) zera o downStreak.
  reportPncpProxyOk(pool, p.id, t2 + 1);
  assert.equal(p.downStreak, 0);
});

test('snapshot não expõe credenciais; proxyToUrl escapa caracteres especiais', () => {
  const pool = makePool();
  seedProxies(pool, 1);
  const snapshot = JSON.stringify(getPncpProxyPoolSnapshot(pool, 0));
  assert.ok(!snapshot.includes('u0'));
  assert.ok(!snapshot.includes('p0'));
  assert.equal(
    proxyToUrl({ username: 'a@b', password: 'p:x', host: '1.1.1.1', port: 80 }),
    'http://a%40b:p%3Ax@1.1.1.1:80'
  );
});
