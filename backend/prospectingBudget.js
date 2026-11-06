// One budget for all commercial numbers. Pending messages reserve capacity;
// only delivered messages are reported as sent. PostgreSQL owns concurrency.
const DAY_START = "date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'";
const DAILY_LIMIT_KEY = 'prospeccao_max_por_dia';
const validDailyLimit = value => (typeof value === 'number' || typeof value === 'string') && /^\d+$/.test(String(value)) && Number(value) >= 1 && Number(value) <= 100;
const resolveDailyLimit = (settings, fallback = 10) => validDailyLimit(settings?.get(DAILY_LIMIT_KEY)) ? Number(settings.get(DAILY_LIMIT_KEY)) : fallback;
async function readBudget(db, accountId, fallback = 10) {
  const { rows } = await db.query(`SELECT
    (SELECT valor FROM ai_settings WHERE chave = '${DAILY_LIMIT_KEY}') AS limite,
    COUNT(*) FILTER (WHERE status = 'sent' AND enviado_em >= ${DAY_START})::int AS enviados,
    COUNT(*) FILTER (WHERE status = 'pending')::int AS reservados,
    (SELECT COUNT(*)::int FROM prospeccao_log WHERE account_id=$1 AND status='dry_run' AND created_at >= ${DAY_START}) AS simulados
    FROM outbound_queue WHERE account_id=$1 AND origem='prospeccao'`, [accountId]);
  const r = rows[0] || {};
  const limite = validDailyLimit(r.limite) ? Number(r.limite) : fallback;
  const enviados = Number(r.enviados || 0), reservados = Number(r.reservados || 0), simulados = Number(r.simulados || 0);
  return { limite, enviados, reservados, simulados, saldo: Math.max(0, limite - enviados - reservados - simulados) };
}
async function withAccountLock(pool, accountId, task, { dispatch = false } = {}) {
  const db = await pool.connect();
  const key = `${dispatch ? 'outbound-dispatch' : 'prospecting-budget'}:${accountId}`;
  let locked = false;
  try {
    const { rows } = await db.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [key]);
    locked = rows[0]?.locked === true;
    if (!locked) return { skipped: 'outro ciclo em execução' };
    return await task(db);
  } finally {
    let unlockError;
    if (locked) {
      try { await db.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]); }
      catch (error) { unlockError = error; }
    }
    // Never return a session holding a lock to the connection pool.
    db.release(unlockError);
  }
}
module.exports = { DAILY_LIMIT_KEY, DAY_START, validDailyLimit, resolveDailyLimit, readBudget, withAccountLock };
