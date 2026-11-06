'use strict';
const { randomUUID } = require('node:crypto');
const net = require('node:net');
const { withAccountLock } = require('./prospectingBudget');
const ORIGIN_GAP_MS = 10000;
async function createResearchEgress(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS research_egress_leases (
    id UUID PRIMARY KEY, node_id TEXT NOT NULL, origin TEXT NOT NULL, kind TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ, outcome TEXT)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS research_egress_origin ON research_egress_leases(origin, started_at)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS research_egress_health (
    node_id TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, successes INTEGER NOT NULL DEFAULT 0,
    checked_at TIMESTAMPTZ, retry_at TIMESTAMPTZ, last_error TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS research_egress_cooldown (origin TEXT PRIMARY KEY, until_at TIMESTAMPTZ NOT NULL)`);
}
function parseNodes(raw) {
  try {
    return JSON.parse(raw || '[]').filter(n => {
      const u = new URL(n.proxy);
      // Only the two explicitly authorized tailnet devices, never public proxies.
      return typeof n.id === 'string' && ['100.117.55.18', '100.80.200.77'].includes(u.hostname)
        && u.protocol === 'http:' && u.username && u.password && u.port === '3128';
    });
  } catch { return []; }
}
const tcpHealth = node => new Promise(resolve => {
  const u = new URL(node.proxy), socket = net.connect({ host: u.hostname, port: Number(u.port), timeout: 2000 });
  let done = false;
  const finish = result => { if (!done) { done = true; socket.destroy(); resolve(result); } };
  socket.once('connect', () => finish(true)); socket.once('timeout', () => finish(false)); socket.once('error', () => finish(false));
});
function createBroker({ pool, readSecret, probe = tcpHealth }) {
  async function acquire({ url, kind = 'research' }) {
    const u = new URL(url);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || !['', '80', '443'].includes(u.port)) throw new Error('Destino inválido');
    if (!['research', 'download'].includes(kind)) throw new Error('Tipo inválido');
    const nodes = parseNodes(await readSecret('RESEARCH_EGRESS_NODES'));
    if (!nodes.length) return { available: false, reason: 'dispositivos não configurados' };
    return withAccountLock(pool, 'research-egress', async db => {
      const { rows } = await db.query(`SELECT
        COUNT(*) FILTER (WHERE origin=$1 AND started_at>NOW()-INTERVAL '1 hour')::int AS hourly,
        COUNT(*) FILTER (WHERE origin=$1 AND started_at>NOW()-INTERVAL '24 hours')::int AS daily,
        COUNT(*) FILTER (WHERE origin=$1 AND finished_at IS NULL AND expires_at>NOW())::int AS busy,
        COUNT(*) FILTER (WHERE kind='download' AND finished_at IS NULL AND expires_at>NOW())::int AS downloads,
        MAX(started_at) FILTER (WHERE origin=$1) AS last_start FROM research_egress_leases`, [u.origin]);
      const r = rows[0] || {};
      const cooldown = (await db.query('SELECT until_at FROM research_egress_cooldown WHERE origin=$1 AND until_at>NOW()', [u.origin])).rows[0];
      if (cooldown || Number(r.hourly) >= 60 || Number(r.daily) >= 300 || Number(r.busy) || (r.last_start && Date.now() - new Date(r.last_start) < ORIGIN_GAP_MS) || (kind === 'download' && Number(r.downloads))) {
        // A policy refusal is not an offline node: callers must defer this origin.
        return { available: false, defer: true, reason: 'domínio em pausa ou limite compartilhado atingido' };
      }
      for (const node of nodes) {
        const state = (await db.query('SELECT * FROM research_egress_health WHERE node_id=$1', [node.id])).rows[0];
        if (state?.retry_at && new Date(state.retry_at) > new Date()) continue;
        const online = state?.checked_at && Date.now() - new Date(state.checked_at) < 15000 && !state.failures ? true : await probe(node);
        await db.query(`INSERT INTO research_egress_health(node_id,failures,successes,checked_at,retry_at,last_error)
          VALUES($1,$2,$3,NOW(),CASE WHEN $2>0 THEN NOW()+INTERVAL '60 seconds' ELSE NULL END,$4)
          ON CONFLICT(node_id) DO UPDATE SET failures=CASE WHEN $2=0 THEN 0 ELSE research_egress_health.failures+1 END,
          successes=CASE WHEN $2=0 THEN research_egress_health.successes+1 ELSE 0 END,checked_at=NOW(),
          retry_at=CASE WHEN $2>0 THEN NOW()+INTERVAL '60 seconds' ELSE NULL END,last_error=$4`, [node.id, online ? 0 : 1, online ? 1 : 0, online ? null : 'dispositivo indisponível']);
        if (!online) continue;
        if (state && (Number(state.failures)>0 || Number(state.successes)<1)) continue;
        const id = randomUUID();
        await db.query(`INSERT INTO research_egress_leases(id,node_id,origin,kind,expires_at)
          VALUES($1,$2,$3,$4,NOW()+CASE WHEN $4='download' THEN INTERVAL '35 minutes' ELSE INTERVAL '2 minutes' END)`, [id, node.id, u.origin, kind]);
        return { available: true, id, node: node.id, proxy: node.proxy, limitBytesPerSecond: 625000 };
      }
      return { available: false, reason: 'dispositivos offline' };
    });
  }
  async function release({ id, outcome = 'ok', retryAfterSeconds = 0 }) {
    if (!/^[a-f0-9-]{36}$/i.test(String(id))) throw new Error('Reserva inválida');
    const safeOutcome = ['ok', 'transport', 'blocked', 'login_required'].includes(outcome) ? outcome : 'transport';
    const { rows } = await pool.query(`UPDATE research_egress_leases SET finished_at=NOW(),outcome=$2
      WHERE id=$1 AND finished_at IS NULL RETURNING origin,node_id`, [id, safeOutcome]);
    if (rows[0] && ['blocked', 'login_required'].includes(safeOutcome)) {
      const seconds = Math.max(1800, Math.min(86400, Number(retryAfterSeconds) || 0));
      await pool.query(`INSERT INTO research_egress_cooldown(origin,until_at) VALUES($1,NOW()+$2*INTERVAL '1 second')
        ON CONFLICT(origin) DO UPDATE SET until_at=GREATEST(research_egress_cooldown.until_at,EXCLUDED.until_at)`, [rows[0].origin, seconds]);
    }
    if (rows[0] && safeOutcome === 'transport') await pool.query(`UPDATE research_egress_health SET failures=failures+1,retry_at=NOW()+INTERVAL '60 seconds',last_error='falha de transporte' WHERE node_id=$1`, [rows[0].node_id]);
    return { ok: true };
  }
  async function status() {
    const configured = parseNodes(await readSecret('RESEARCH_EGRESS_NODES')).map(n => n.id);
    const health = (await pool.query('SELECT node_id,checked_at,retry_at,last_error FROM research_egress_health')).rows;
    const pending = (await pool.query("SELECT valor FROM ai_settings WHERE chave='research_egress_setup_blocker'")).rows[0]?.valor || null;
    const instagram=await require('./instagramSession').handleSession({ler:readSecret},{operation:'status'});
    return { configured, nodes: health.filter(n => configured.includes(n.node_id)), instagram, pending_action:pending, download_mbps: 5, fallback: 'fluxo existente' };
  }
  return { acquire, release, status };
}
module.exports = { createResearchEgress, createBroker, parseNodes, tcpHealth };
