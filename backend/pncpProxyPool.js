// Pool de proxies rotativos para o PNCP (fonte: API do webshare).
//
// Fase 2: LANES paralelas — cada proxy vivo é uma lane com pacing próprio e o
// gate roda até (lanes vivas + 1 direta) requests simultâneos. Throttle de um
// proxy quarentena só a lane dele; 3+ proxies distintos com throttle em 90s é
// evidência de limite global (não por IP) e reativa o freio global do gate.
//
// Regras:
// - Só prioridades em PNCP_PROXY_PRIORITIES (default interactive,sync) usam
//   proxy; bulk fica na lane direta (free tier do webshare tem ~1GB/mês).
// - Circuit breaker por proxy: 2+ throttles seguidos → quarentena com backoff
//   exponencial (2min → 30min). Todos em quarentena → fallback IP direto.
// - Credenciais nunca aparecem em log/snapshot.

const WEBSHARE_LIST_URL = 'https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page=1&page_size=100';

const QUARANTINE_BASE_MS = 2 * 60 * 1000;
const QUARANTINE_MAX_MS = 30 * 60 * 1000;
const THROTTLE_DEDUPE_MS = 800;
// Proxy QUEBRADO (banda esgotada, CONNECT recusado): quarentena mais longa que
// throttle — não é o PNCP reclamando, é o proxy que não serve.
const DOWN_BASE_MS = 10 * 60 * 1000;
const DOWN_MAX_MS = 2 * 60 * 60 * 1000;

const createPncpProxyPool = (env = process.env) => {
  const token = String(env.WEBSHARE_TOKEN || '').trim();
  const enabled = Boolean(token) && env.PNCP_PROXY_ENABLED !== '0';
  const priorities = new Set(
    String(env.PNCP_PROXY_PRIORITIES || 'interactive,sync')
      .split(',')
      .map(p => p.trim())
      .filter(Boolean)
  );
  return {
    enabled,
    token,
    priorities,
    // Lanes de proxy simultâneas (fase 2). +1 lane direta sempre existe.
    maxLanes: (() => {
      const lanes = Number.parseInt(env.PNCP_PROXY_LANES, 10);
      return Math.max(1, Math.min(10, Number.isNaN(lanes) ? 6 : lanes));
    })(),
    proxies: [],
    rr: 0,
    lastRefreshAt: 0,
    refreshMs: Math.max(5 * 60 * 1000, Number(env.PNCP_PROXY_REFRESH_MS) || 30 * 60 * 1000),
    lastRefreshError: null,
  };
};

const parseWebshareProxies = (payload) => {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results
    .filter(r => r && r.valid !== false && r.proxy_address && r.port && r.username && r.password)
    .map(r => ({
      id: `${r.proxy_address}:${r.port}`,
      host: String(r.proxy_address),
      port: Number(r.port),
      username: String(r.username),
      password: String(r.password),
      country: String(r.country_code || '?'),
    }));
};

/** Atualiza a lista preservando as estatísticas dos proxies que continuam. */
const mergeProxyList = (pool, incoming, now = Date.now()) => {
  const prev = new Map(pool.proxies.map(p => [p.id, p]));
  pool.proxies = incoming.map(next => {
    const old = prev.get(next.id);
    return {
      ...next,
      failStreak: old?.failStreak || 0,
      quarantineUntil: old?.quarantineUntil || 0,
      totalOk: old?.totalOk || 0,
      totalThrottle: old?.totalThrottle || 0,
      lastOkAt: old?.lastOkAt || 0,
      lastThrottleAt: old?.lastThrottleAt || 0,
      lastAt: old?.lastAt || 0,
      downStreak: old?.downStreak || 0,
      totalDown: old?.totalDown || 0,
      lastDownAt: old?.lastDownAt || 0,
    };
  });
  pool.lastRefreshAt = now;
};

const refreshPncpProxyPool = async (pool, { fetchImpl = fetch, now = Date.now() } = {}) => {
  if (!pool.enabled) return false;
  try {
    const response = await fetchImpl(WEBSHARE_LIST_URL, {
      headers: { Authorization: `Token ${pool.token}` },
    });
    if (!response.ok) throw new Error(`webshare list HTTP ${response.status}`);
    const parsed = parseWebshareProxies(await response.json());
    if (!parsed.length) throw new Error('webshare list vazia');
    mergeProxyList(pool, parsed, now);
    pool.lastRefreshError = null;
    return true;
  } catch (error) {
    // Lista antiga continua valendo — proxies datacenter do webshare são estáveis.
    pool.lastRefreshError = String(error.message || error);
    pool.lastRefreshAt = now;
    return false;
  }
};

const isProxyAlive = (proxy, now = Date.now()) => now >= (proxy.quarantineUntil || 0);

const countAliveProxies = (pool, now = Date.now()) =>
  pool.proxies.filter(p => isProxyAlive(p, now)).length;

/**
 * Escolhe o próximo proxy (round-robin entre os vivos, pulando `exclude` — as
 * lanes ocupadas) para a prioridade dada. Retorna null (= IP direto) para bulk,
 * pool desabilitado ou nenhum proxy disponível.
 */
const pickPncpProxy = (pool, priority, now = Date.now(), exclude = null) => {
  if (!pool.enabled || !pool.priorities.has(priority)) return null;
  const available = pool.proxies.filter(
    p => isProxyAlive(p, now) && !(exclude && exclude.has(p.id))
  );
  if (!available.length) return null;
  const proxy = available[pool.rr % available.length];
  pool.rr = (pool.rr + 1) % Number.MAX_SAFE_INTEGER;
  return proxy;
};

/**
 * Quantos proxies DISTINTOS tomaram throttle na janela. 3+ em 90s indica que o
 * limite do PNCP não é por IP naquele momento → tratar como throttle global.
 */
const countRecentProxyThrottles = (pool, windowMs = 90_000, now = Date.now()) =>
  pool.proxies.filter(p => p.lastThrottleAt && now - p.lastThrottleAt <= windowMs).length;

const reportPncpProxyOk = (pool, proxyId, now = Date.now()) => {
  const proxy = pool.proxies.find(p => p.id === proxyId);
  if (!proxy) return;
  proxy.failStreak = 0;
  proxy.downStreak = 0;
  proxy.totalOk += 1;
  proxy.lastOkAt = now;
};

/**
 * Erro de TRANSPORTE do proxy (banda esgotada → 402/CONNECT recusado, timeout
 * do túnel, página de erro do provedor) — diferente de resposta HTTP real do
 * PNCP, que chega como "PNCP ... error <status>". Só faz sentido chamar quando
 * a request usou proxy; no IP direto os mesmos sintomas são problema do PNCP.
 */
const isPncpProxyTransportError = (errorOrText) => {
  const text = [
    errorOrText?.message,
    errorOrText?.cause?.code,
    errorOrText?.cause?.message,
    typeof errorOrText === 'string' ? errorOrText : '',
  ].filter(Boolean).join(' ').toLowerCase();
  // Resposta HTTP do PNCP (429/404/500...): o túnel funcionou — não é o proxy.
  if (/pncp[^:]*error \d{3}/.test(text)) return false;
  return /fetch failed|und_err|econnrefused|econnreset|etimedout|timed out|socket|tunnel|proxy|connect|tls|ssl|json parse error|curl exit (5|7|28|35|52|56|97)\b/.test(text);
};

/**
 * Marca o proxy como quebrado: quarentena imediata e longa (10min → 2h).
 * NÃO toca lastThrottleAt — proxy morto não é sinal de rate limit do PNCP e
 * não pode contar na regra "3+ proxies em 90s = limite global".
 */
const reportPncpProxyDown = (pool, proxyId, now = Date.now()) => {
  const proxy = pool.proxies.find(p => p.id === proxyId);
  if (!proxy) return false;
  if (proxy.lastDownAt && now - proxy.lastDownAt < THROTTLE_DEDUPE_MS) return false;
  proxy.downStreak += 1;
  proxy.totalDown += 1;
  proxy.lastDownAt = now;
  const backoff = Math.min(DOWN_MAX_MS, DOWN_BASE_MS * 2 ** (proxy.downStreak - 1));
  proxy.quarantineUntil = Math.max(proxy.quarantineUntil || 0, now + backoff);
  return true;
};

/** Registra throttle no proxy; retorna true se ele entrou em quarentena agora. */
const reportPncpProxyThrottle = (pool, proxyId, now = Date.now()) => {
  const proxy = pool.proxies.find(p => p.id === proxyId);
  if (!proxy) return false;
  // O mesmo erro passa por mais de um ponto de captura (retry + gate): não
  // conta duas vezes o mesmo throttle.
  if (proxy.lastThrottleAt && now - proxy.lastThrottleAt < THROTTLE_DEDUPE_MS) return false;
  proxy.failStreak += 1;
  proxy.totalThrottle += 1;
  proxy.lastThrottleAt = now;
  if (proxy.failStreak < 2) return false;
  const backoff = Math.min(
    QUARANTINE_MAX_MS,
    QUARANTINE_BASE_MS * 2 ** (proxy.failStreak - 2)
  );
  proxy.quarantineUntil = now + backoff;
  return true;
};

const proxyToUrl = (proxy) =>
  `http://${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@${proxy.host}:${proxy.port}`;

const getPncpProxyPoolSnapshot = (pool, now = Date.now()) => ({
  enabled: pool.enabled,
  max_lanes: pool.maxLanes,
  priorities: [...pool.priorities],
  total: pool.proxies.length,
  alive: countAliveProxies(pool, now),
  last_refresh_at: pool.lastRefreshAt || null,
  last_refresh_error: pool.lastRefreshError,
  proxies: pool.proxies.map(p => ({
    id: p.id,
    country: p.country,
    alive: isProxyAlive(p, now),
    quarantined_for_ms: Math.max(0, (p.quarantineUntil || 0) - now),
    fail_streak: p.failStreak,
    total_ok: p.totalOk,
    total_throttle: p.totalThrottle,
    total_down: p.totalDown,
    last_ok_at: p.lastOkAt || null,
    last_throttle_at: p.lastThrottleAt || null,
  })),
});

module.exports = {
  createPncpProxyPool,
  parseWebshareProxies,
  mergeProxyList,
  refreshPncpProxyPool,
  pickPncpProxy,
  reportPncpProxyOk,
  reportPncpProxyThrottle,
  reportPncpProxyDown,
  isPncpProxyTransportError,
  countAliveProxies,
  countRecentProxyThrottles,
  proxyToUrl,
  getPncpProxyPoolSnapshot,
};
