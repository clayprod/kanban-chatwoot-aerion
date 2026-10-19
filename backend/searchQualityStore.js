'use strict';
const crypto = require('node:crypto');
const { QUALITY_VERSION, normalizeProfile, evaluateResult, classifyItem } = require('./searchQuality');
const profileHash = p => crypto.createHash('sha256').update(JSON.stringify(normalizeProfile(p))).digest('hex');

async function createSearchQualityTables(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS search_drafts (
    id BIGSERIAL PRIMARY KEY, account_id INTEGER NOT NULL, source TEXT NOT NULL,
    profile JSONB NOT NULL, filters JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS search_drafts_account ON search_drafts(account_id, updated_at DESC)`);
  for (const table of ['pca_watchlist', 'edital_watchlist']) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS scan_state JSONB NOT NULL DEFAULT '{}'`);
  }
  await pool.query(`ALTER TABLE pca_watchlist ADD COLUMN IF NOT EXISTS search_profile JSONB`);
  await pool.query(`ALTER TABLE pca_watchlist ADD COLUMN IF NOT EXISTS filtros JSONB NOT NULL DEFAULT '{}'`);
  await pool.query(`ALTER TABLE pca_itens ADD COLUMN IF NOT EXISTS official_item_kind TEXT`);
  await pool.query(`ALTER TABLE pca_itens ADD COLUMN IF NOT EXISTS classification_version INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS pca_quality_unclassified ON pca_itens(id) WHERE classification_version < ${QUALITY_VERSION}`);
  for (const table of ['pncp_search_job_results', 'edital_signals', 'pca_signals']) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS quality_hidden BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS quality_review JSONB`);
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS search_quality_reviews (
    account_id INTEGER NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL,
    profile_hash TEXT NOT NULL, cursor TEXT NOT NULL DEFAULT '', complete BOOLEAN NOT NULL DEFAULT FALSE,
    reviewed INTEGER NOT NULL DEFAULT 0, rejected INTEGER NOT NULL DEFAULT 0,
    pending INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(account_id, source, source_id))`);
  await pool.query(`ALTER TABLE search_quality_reviews ADD COLUMN IF NOT EXISTS cycle_pending INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE search_quality_reviews ADD COLUMN IF NOT EXISTS next_review_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await pool.query(`CREATE TABLE IF NOT EXISTS search_quality_history (
    id BIGSERIAL PRIMARY KEY, account_id INTEGER NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL,
    result_key TEXT NOT NULL, previous_review JSONB, review JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS search_scan_audit (
    id BIGSERIAL PRIMARY KEY, account_id INTEGER NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL,
    term TEXT, stats JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS search_scan_audit_account_date ON search_scan_audit(account_id, created_at DESC)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS search_pending_candidates (
    account_id INTEGER NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL, result_key TEXT NOT NULL,
    profile_hash TEXT NOT NULL, payload JSONB NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending', next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(account_id,source,source_id,result_key))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS search_pending_due ON search_pending_candidates(next_attempt_at) WHERE status='pending'`);
}

async function queueCandidates(pool, { accountId, source, id, profile, items, getKey }) {
  const candidates = [...new Map(items.filter(item => !item.quality_items_complete).map(item =>
    [String(getKey(item) || ''), item])).entries()].filter(([key]) => key).map(([key, payload]) => ({ key, payload }));
  for (let start = 0; start < candidates.length; start += 500) {
    await pool.query(`INSERT INTO search_pending_candidates(account_id,source,source_id,result_key,profile_hash,payload)
      SELECT $1,$2,$3,candidate.key,$4,candidate.payload FROM jsonb_to_recordset($5::jsonb) AS candidate(key text,payload jsonb)
      ON CONFLICT(account_id,source,source_id,result_key) DO UPDATE SET
      payload=CASE WHEN search_pending_candidates.profile_hash=EXCLUDED.profile_hash AND search_pending_candidates.attempts > 0
        THEN search_pending_candidates.payload || EXCLUDED.payload || jsonb_build_object(
          'quality_items',search_pending_candidates.payload->'quality_items',
          'quality_items_complete',search_pending_candidates.payload->'quality_items_complete',
          'quality_items_next_page',search_pending_candidates.payload->'quality_items_next_page')
        ELSE search_pending_candidates.payload || EXCLUDED.payload END,
      status=CASE WHEN search_pending_candidates.profile_hash <> EXCLUDED.profile_hash THEN 'pending' ELSE search_pending_candidates.status END,
      next_attempt_at=CASE WHEN search_pending_candidates.profile_hash <> EXCLUDED.profile_hash THEN NOW() ELSE search_pending_candidates.next_attempt_at END,
      profile_hash=EXCLUDED.profile_hash,updated_at=NOW()`,
      [accountId, source, String(id), profileHash(profile), JSON.stringify(candidates.slice(start, start + 500))]);
  }
}

// Bounded, resumable review. Visibility/status belong to the user and are never
// overwritten. A separate quality_hidden flag makes automatic rejection reversible.
async function reviewSearchBatch(pool, { source, id, accountId, profile, limit = 100, enrich }) {
  const hash = profileHash(profile);
  await pool.query(`INSERT INTO search_quality_reviews(account_id,source,source_id,profile_hash)
    VALUES($1,$2,$3,$4) ON CONFLICT(account_id,source,source_id) DO UPDATE
    SET cursor = CASE WHEN search_quality_reviews.profile_hash <> $4 THEN '' ELSE search_quality_reviews.cursor END,
        complete = CASE WHEN search_quality_reviews.profile_hash <> $4 THEN FALSE ELSE search_quality_reviews.complete END,
        cycle_pending = CASE WHEN search_quality_reviews.profile_hash <> $4 THEN 0 ELSE search_quality_reviews.cycle_pending END,
        next_review_at = CASE WHEN search_quality_reviews.profile_hash <> $4 THEN NOW() ELSE search_quality_reviews.next_review_at END,
        profile_hash = $4`, [accountId, source, String(id), hash]);
  const { rows: states } = await pool.query(`SELECT * FROM search_quality_reviews WHERE account_id=$1 AND source=$2 AND source_id=$3`, [accountId, source, String(id)]);
  const state = states[0];
  if (state?.complete) return state;
  if (new Date(state?.next_review_at || 0).getTime() > Date.now()) return { ...state, skipped: true };
  const config = {
    job: { table: 'pncp_search_job_results', key: 'result_key', parent: 'job_id', preserved: "r.visibility IN ('hidden','pipeline')" },
    edital: { table: 'edital_signals', key: 'id', parent: 'watchlist_id', preserved: "r.status NOT IN ('novo','visto')" },
    pca: { table: 'pca_signals', key: 'id', parent: 'watchlist_id', preserved: "r.status NOT IN ('novo','visto')" },
  }[source];
  if (!config) throw new Error('Fonte inválida');
  const { table, key, parent, preserved } = config;
  const cursor = state?.cursor || (source === 'job' ? '' : '0');
  const { rows } = await pool.query(`SELECT r.*, ${preserved} AS preserve_manual
    ${source === 'pca' ? ', i.descricao, i.payload_raw, i.official_item_kind' : ''}
    FROM ${table} r ${source === 'pca' ? 'JOIN pca_itens i ON i.id=r.item_id' : ''}
    WHERE r.account_id=$1 AND r.${parent}=$2 AND r.${key} > $3
    ORDER BY r.${key} LIMIT $4`, [accountId, id, cursor, Math.min(200, limit)]);
  let rejected = 0;
  let pending = 0;
  for (const row of rows) {
    let item = source === 'pca' ? { ...row.payload_raw, descricao: row.descricao, quality_is_pca: true } : (row.payload || {});
    if (enrich && source !== 'pca' && !item.quality_items_complete) item = await enrich(item);
    let review = evaluateResult(item, profile);
    // An old index-only payload cannot prove that the *items* are unrelated.
    if (!review.accepted && review.reason === 'no_evidence' && source !== 'pca' && !item.quality_items_complete) {
      review = { ...review, status: 'pending_verification', reason: 'items_not_verified' };
    }
    review.profile_hash = hash;
    const hidden = review.status === 'rejected' && !row.preserve_manual;
    if (hidden) rejected++;
    if (review.status.startsWith('pending')) pending++;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO search_quality_history(account_id,source,source_id,result_key,previous_review,review)
        VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)`, [accountId, source, String(id), String(row[key]),
        JSON.stringify(row.quality_review), JSON.stringify(review)]);
      await client.query(`UPDATE ${table} SET quality_hidden=$1,quality_review=$2::jsonb
        WHERE account_id=$3 AND ${parent}=$4 AND ${key}=$5`, [hidden, JSON.stringify(review), accountId, id, row[key]]);
      await client.query(`UPDATE search_quality_reviews SET cursor=$4,reviewed=reviewed+1,
        rejected=rejected+$5,pending=pending+$6,cycle_pending=cycle_pending+$6,updated_at=NOW()
        WHERE account_id=$1 AND source=$2 AND source_id=$3`, [accountId, source, String(id), String(row[key]), hidden ? 1 : 0, review.status.startsWith('pending') ? 1 : 0]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  const exhausted = rows.length < Math.min(200, limit);
  const retryPending = exhausted && (Number(state?.cycle_pending || 0) + pending > 0);
  const complete = exhausted && !retryPending;
  await pool.query(`UPDATE search_quality_reviews SET complete=$4,
    cursor=CASE WHEN $5 THEN '' ELSE cursor END,
    cycle_pending=CASE WHEN $5 THEN 0 ELSE cycle_pending END,
    next_review_at=CASE WHEN $5 THEN NOW()+INTERVAL '1 hour' ELSE NOW() END,updated_at=NOW()
    WHERE account_id=$1 AND source=$2 AND source_id=$3`, [accountId, source, String(id), complete, retryPending]);
  return { reviewed: rows.length, rejected, pending, complete };
}

async function backfillPcaClassifications(pool, limit = 500) {
  const { rows } = await pool.query('SELECT id,payload_raw FROM pca_itens WHERE classification_version < $1 ORDER BY id LIMIT $2', [QUALITY_VERSION, limit]);
  const mapped = rows.map(row => {
    const classification = classifyItem(row.payload_raw);
    return { id: row.id, kind: classification.kind === 'material' ? 'M' : classification.kind === 'service' ? 'S' : null };
  });
  if (mapped.length) await pool.query(`UPDATE pca_itens i SET official_item_kind=batch.kind,classification_version=$2
    FROM jsonb_to_recordset($1::jsonb) AS batch(id bigint,kind text) WHERE i.id=batch.id`, [JSON.stringify(mapped), QUALITY_VERSION]);
  return rows.length;
}

async function persistRejectedJobCandidates(pool, { id, accountId, items, getKey }) {
  const batch = items.filter(i => i.quality_items_complete === true).map(item => ({ key: String(getKey(item)), payload: item }));
  if (!batch.length) return;
  await pool.query(`WITH batch AS (
      SELECT DISTINCT ON (key) key,payload FROM jsonb_to_recordset($3::jsonb) AS b(key text,payload jsonb)
    ), previous AS MATERIALIZED (
      SELECT r.result_key,r.quality_review AS old_review,b.payload
      FROM pncp_search_job_results r JOIN batch b ON b.key=r.result_key
      WHERE r.job_id=$1::uuid AND r.account_id=$2 FOR UPDATE OF r
    ), changed AS (
      UPDATE pncp_search_job_results r SET
        quality_hidden=CASE WHEN r.visibility IN ('hidden','pipeline') THEN FALSE ELSE TRUE END,
        quality_review=p.payload->'search_quality',payload=r.payload || p.payload
      FROM previous p WHERE r.job_id=$1::uuid AND r.account_id=$2 AND r.result_key=p.result_key
      RETURNING r.result_key,p.old_review,r.quality_review
    ) INSERT INTO search_quality_history(account_id,source,source_id,result_key,previous_review,review)
      SELECT $2,'job',$1::text,result_key,old_review,quality_review FROM changed`,
    [id, accountId, JSON.stringify(batch)]);
}

module.exports = { createSearchQualityTables, reviewSearchBatch, backfillPcaClassifications, profileHash, queueCandidates, persistRejectedJobCandidates };
