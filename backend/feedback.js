/**
 * Log append-only de feedback de relevância (labels de treino para ML).
 * Cada evento representa uma ação do usuário sobre um item de busca
 * (visto, promovido para pipeline, descartado, etc.) e vira label
 * numérico (+2 / +1 / -1 / 0) para futuro re-treino/ranqueamento.
 *
 * Uso:
 *   await initFeedback({ pool });
 *   recordSearchFeedback(req, { accountId, source: 'editais_deep', action: 'promovido', entityKey });
 */

const FEEDBACK_TABLE = 'search_feedback_events';

const ITEM_SNAPSHOT_MAX_LENGTH = 2000;
const LONG_STRING_FIELD_THRESHOLD = 500;

let pool = null;

// Mapeia a ação livre do chamador para um label numérico de treino.
const normalizeLabel = (action) => {
  const normalized = String(action || '').toLowerCase();
  if (['pipeline', 'promovido', 'promote_item', 'importado'].includes(normalized)) return 2;
  if (['visto', 'visible', 'restaurado'].includes(normalized)) return 1;
  if (['hidden', 'descartado', 'dismiss'].includes(normalized)) return -1;
  return 0;
};

// Extrai o autor da ação a partir do request, de forma defensiva (req pode ser null/undefined).
const extractActor = (req) => {
  try {
    if (!req) return null;
    const user = req.user || {};
    return user.name || user.email || (req.headers && req.headers['x-user-email']) || null;
  } catch (error) {
    return null;
  }
};

// Trunca um objeto/valor para caber no snapshot: primeiro corta campos de texto
// longos (>500 chars), depois corta o JSON serializado no limite total.
const truncateItemSnapshot = (itemSnapshot) => {
  if (itemSnapshot === undefined || itemSnapshot === null) return null;
  try {
    let candidate = itemSnapshot;
    if (candidate && typeof candidate === 'object') {
      const clipped = Array.isArray(candidate) ? [...candidate] : { ...candidate };
      for (const key of Object.keys(clipped)) {
        const value = clipped[key];
        if (typeof value === 'string' && value.length > LONG_STRING_FIELD_THRESHOLD) {
          clipped[key] = `${value.slice(0, LONG_STRING_FIELD_THRESHOLD)}…`;
        }
      }
      candidate = clipped;
    }
    let serialized = JSON.stringify(candidate);
    if (serialized && serialized.length > ITEM_SNAPSHOT_MAX_LENGTH) {
      serialized = `${serialized.slice(0, ITEM_SNAPSHOT_MAX_LENGTH - 1)}…`;
    }
    return serialized || null;
  } catch (error) {
    console.warn('[feedback] falha ao truncar item_snapshot:', error.message);
    return null;
  }
};

// Cria o schema (idempotente). Nunca lança — apenas loga warn em caso de falha.
const initFeedback = async ({ pool: injectedPool } = {}) => {
  pool = injectedPool || null;
  if (!pool) {
    console.warn('[feedback] initFeedback chamado sem pool; recordSearchFeedback ficará inativo.');
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${FEEDBACK_TABLE} (
        id BIGSERIAL PRIMARY KEY,
        account_id BIGINT NOT NULL,
        actor TEXT,
        source TEXT NOT NULL,
        action TEXT NOT NULL,
        label SMALLINT,
        entity_key TEXT NOT NULL,
        job_id TEXT,
        query_text TEXT,
        matched_term TEXT,
        score NUMERIC,
        score_breakdown JSONB,
        evidencia JSONB,
        item_snapshot JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sfe_acct_created
        ON ${FEEDBACK_TABLE} (account_id, created_at DESC)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sfe_source_action
        ON ${FEEDBACK_TABLE} (source, action)
    `);
    console.log('[feedback] schema pronto (search_feedback_events).');
  } catch (error) {
    console.warn('[feedback] falha ao inicializar schema:', error.message);
  }
};

// Grava um evento de feedback. Fire-and-forget: nunca lança nem rejeita.
const recordSearchFeedback = async (req, opts = {}) => {
  try {
    if (!pool) {
      console.warn('[feedback] pool não inicializado; evento descartado.');
      return;
    }
    const {
      accountId,
      source,
      action,
      entityKey,
      jobId = null,
      queryText = null,
      matchedTerm = null,
      score = null,
      scoreBreakdown = null,
      evidencia = null,
      itemSnapshot = null,
    } = opts || {};

    if (!accountId || !source || !action || !entityKey) {
      console.warn('[feedback] evento incompleto (accountId/source/action/entityKey obrigatórios); descartado.');
      return;
    }

    const actor = extractActor(req);
    const label = normalizeLabel(action);
    const snapshotJson = truncateItemSnapshot(itemSnapshot);

    await pool.query(
      `INSERT INTO ${FEEDBACK_TABLE}
        (account_id, actor, source, action, label, entity_key, job_id, query_text,
         matched_term, score, score_breakdown, evidencia, item_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        accountId,
        actor,
        source,
        action,
        label,
        entityKey,
        jobId,
        queryText,
        matchedTerm,
        score,
        scoreBreakdown ? JSON.stringify(scoreBreakdown) : null,
        evidencia ? JSON.stringify(evidencia) : null,
        snapshotJson,
      ]
    );
  } catch (error) {
    console.warn('[feedback] falha ao gravar evento de feedback:', error.message);
  }
};

// Grava vários eventos de uma vez (1 INSERT multi-VALUES). Também nunca lança.
const recordSearchFeedbackBatch = async (req, eventsArray) => {
  try {
    if (!pool) {
      console.warn('[feedback] pool não inicializado; batch descartado.');
      return;
    }
    if (!Array.isArray(eventsArray) || !eventsArray.length) return;

    const actor = extractActor(req);
    const valid = eventsArray.filter((evt) => evt && evt.accountId && evt.source && evt.action && evt.entityKey);
    if (!valid.length) {
      console.warn('[feedback] batch sem eventos válidos (accountId/source/action/entityKey obrigatórios); descartado.');
      return;
    }

    const values = [];
    const placeholders = [];
    let paramIndex = 1;
    for (const evt of valid) {
      const {
        accountId,
        source,
        action,
        entityKey,
        jobId = null,
        queryText = null,
        matchedTerm = null,
        score = null,
        scoreBreakdown = null,
        evidencia = null,
        itemSnapshot = null,
      } = evt;

      const label = normalizeLabel(action);
      const snapshotJson = truncateItemSnapshot(itemSnapshot);

      placeholders.push(
        `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, ` +
        `$${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8}, $${paramIndex + 9}, ` +
        `$${paramIndex + 10}, $${paramIndex + 11}, $${paramIndex + 12})`
      );
      values.push(
        accountId,
        actor,
        source,
        action,
        label,
        entityKey,
        jobId,
        queryText,
        matchedTerm,
        score,
        scoreBreakdown ? JSON.stringify(scoreBreakdown) : null,
        evidencia ? JSON.stringify(evidencia) : null,
        snapshotJson
      );
      paramIndex += 13;
    }

    await pool.query(
      `INSERT INTO ${FEEDBACK_TABLE}
        (account_id, actor, source, action, label, entity_key, job_id, query_text,
         matched_term, score, score_breakdown, evidencia, item_snapshot)
       VALUES ${placeholders.join(', ')}`,
      values
    );
  } catch (error) {
    console.warn('[feedback] falha ao gravar batch de feedback:', error.message);
  }
};

// Estatísticas simples para endpoint de saúde/monitoramento.
const getFeedbackStats = async () => {
  const empty = { total: 0, by_source_action: [] };
  try {
    if (!pool) return empty;
    const totalResult = await pool.query(`SELECT COUNT(*)::int AS total FROM ${FEEDBACK_TABLE}`);
    const bySourceActionResult = await pool.query(`
      SELECT source, action, COUNT(*)::int AS total
        FROM ${FEEDBACK_TABLE}
       GROUP BY source, action
       ORDER BY source, action
    `);
    return {
      total: totalResult.rows[0] ? totalResult.rows[0].total : 0,
      by_source_action: bySourceActionResult.rows,
    };
  } catch (error) {
    console.warn('[feedback] falha ao calcular estatísticas:', error.message);
    return empty;
  }
};

module.exports = {
  initFeedback,
  recordSearchFeedback,
  recordSearchFeedbackBatch,
  getFeedbackStats,
};
