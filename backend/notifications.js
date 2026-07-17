/**
 * Notificações multi-canal: inbox in-app + Web Push (VAPID).
 * WhatsApp continua na fila watchlist_notifications (index.js).
 */

const webpush = require('web-push');

const PUSH_SUBSCRIPTIONS_TABLE = 'push_subscriptions';
const NOTIFICATION_PREFERENCES_TABLE = 'notification_preferences';
const USER_NOTIFICATIONS_TABLE = 'user_notifications';

const NOTIFICATION_CATEGORIES = {
  funil: {
    id: 'funil',
    label: 'Funil e leads',
    description: 'Importações B2B, marcos do funil, ganhos/perdas e leads parados.',
  },
  disparo: {
    id: 'disparo',
    label: 'Disparo WhatsApp',
    description: 'Campanhas iniciadas, pausadas, canceladas ou com falha.',
  },
  licitacoes: {
    id: 'licitacoes',
    label: 'Licitações',
    description: 'Sinais de watchlist, buscas PNCP e prazos do pipeline.',
  },
  metas: {
    id: 'metas',
    label: 'Metas',
    description: 'Alterações nas metas de receita.',
  },
  dados: {
    id: 'dados',
    label: 'Dados e base',
    description: 'Importações RFB e manutenção da base local.',
  },
  sistema: {
    id: 'sistema',
    label: 'Sistema',
    description: 'Avisos técnicos e testes de push.',
  },
};

const NOTIFICATION_TYPE_CATALOG = {
  // —— Funil ——
  'funil.lead_imported': {
    type: 'funil.lead_imported',
    category: 'funil',
    label: 'Leads importados (B2B)',
    description: 'Resumo ao importar contatos da Busca Lead B2B / CNPJ.',
    channels: ['in_app', 'push'],
  },
  'funil.won': {
    type: 'funil.won',
    category: 'funil',
    label: 'Lead ganho / novo cliente',
    description: 'Quando um lead vai para Fechado-Ganho ou Novos Clientes.',
    channels: ['in_app', 'push'],
  },
  'funil.lost': {
    type: 'funil.lost',
    category: 'funil',
    label: 'Lead perdido ou descartado',
    description: 'Quando um lead vai para Fechado-Perdido ou Descartado.',
    channels: ['in_app', 'push'],
  },
  'funil.milestone': {
    type: 'funil.milestone',
    category: 'funil',
    label: 'Marcos do funil',
    description: 'Qualificado (SQL), Demo realizada ou Proposta enviada.',
    channels: ['in_app', 'push'],
  },
  'funil.stale_inbox': {
    type: 'funil.stale_inbox',
    category: 'funil',
    label: 'Leads parados no Inbox',
    description: 'Digest diário de leads no Inbox (Novos) sem avanço.',
    channels: ['in_app', 'push'],
  },
  // —— Disparo ——
  'disparo.started': {
    type: 'disparo.started',
    category: 'disparo',
    label: 'Campanha iniciada',
    description: 'Quando um disparo WhatsApp é enfileirado com sucesso.',
    channels: ['in_app', 'push'],
  },
  'disparo.failed': {
    type: 'disparo.failed',
    category: 'disparo',
    label: 'Falha no disparo',
    description: 'Quando o envio da campanha falha ou nenhuma instância envia.',
    channels: ['in_app', 'push'],
  },
  'disparo.paused': {
    type: 'disparo.paused',
    category: 'disparo',
    label: 'Campanha pausada',
    description: 'Quando uma campanha em andamento é pausada.',
    channels: ['in_app', 'push'],
  },
  'disparo.cancelled': {
    type: 'disparo.cancelled',
    category: 'disparo',
    label: 'Campanha cancelada',
    description: 'Quando uma campanha é cancelada.',
    channels: ['in_app', 'push'],
  },
  // —— Licitações ——
  'watchlist.edital_match': {
    type: 'watchlist.edital_match',
    category: 'licitacoes',
    label: 'Novo edital na assinatura',
    description: 'Quando um edital PNCP casa com uma busca monitorada.',
    channels: ['in_app', 'push'],
  },
  'watchlist.pca_match': {
    type: 'watchlist.pca_match',
    category: 'licitacoes',
    label: 'Novo item de PCA na assinatura',
    description: 'Quando um item de PCA casa com uma busca monitorada.',
    channels: ['in_app', 'push'],
  },
  'search.job_completed': {
    type: 'search.job_completed',
    category: 'licitacoes',
    label: 'Busca de editais concluída',
    description: 'Quando uma busca profunda PNCP termina.',
    channels: ['in_app', 'push'],
  },
  'pipeline.due_48h': {
    type: 'pipeline.due_48h',
    category: 'licitacoes',
    label: 'Prazos críticos em 3 dias úteis',
    description: 'Oportunidades com proposta, impugnação (3 d.ú. antes do edital) ou recurso nos próximos 3 dias úteis (calendário nacional BR).',
    channels: ['in_app', 'push'],
  },
  'pipeline.due_today': {
    type: 'pipeline.due_today',
    category: 'licitacoes',
    label: 'Prazo vence hoje',
    description: 'Oportunidades com prazo de envio de proposta (vencimento) no dia de hoje.',
    channels: ['in_app', 'push'],
  },
  'pipeline.opportunity_created': {
    type: 'pipeline.opportunity_created',
    category: 'licitacoes',
    label: 'Nova oportunidade no pipeline',
    description: 'Quando uma licitação é criada no board de oportunidades.',
    channels: ['in_app', 'push'],
  },
  // —— Metas ——
  'metas.updated': {
    type: 'metas.updated',
    category: 'metas',
    label: 'Meta de receita alterada',
    description: 'Quando um admin salva ou altera a meta mensal.',
    channels: ['in_app', 'push'],
  },
  // —— Dados ——
  'dados.rfb_import_done': {
    type: 'dados.rfb_import_done',
    category: 'dados',
    label: 'Import RFB concluído',
    description: 'Base da Receita Federal atualizada com sucesso.',
    channels: ['in_app', 'push'],
  },
  'dados.rfb_import_failed': {
    type: 'dados.rfb_import_failed',
    category: 'dados',
    label: 'Import RFB falhou',
    description: 'A importação da base RFB terminou com erro.',
    channels: ['in_app', 'push'],
  },
  // —— Sistema ——
  'system.test': {
    type: 'system.test',
    category: 'sistema',
    label: 'Teste de push',
    description: 'Notificação de teste enviada pela página de configurações.',
    channels: ['in_app', 'push'],
  },
};

const DEFAULT_NOTIFICATION_PREFS = {
  push_enabled: false,
  categories: {
    funil: { in_app: true, push: true },
    disparo: { in_app: true, push: true },
    licitacoes: { in_app: true, push: true },
    metas: { in_app: true, push: false },
    dados: { in_app: true, push: true },
    sistema: { in_app: true, push: true },
  },
  types: {
    'funil.lead_imported': { in_app: true, push: false },
    'funil.won': { in_app: true, push: true },
    'funil.lost': { in_app: true, push: true },
    'funil.milestone': { in_app: true, push: false },
    'funil.stale_inbox': { in_app: true, push: false },
    'disparo.started': { in_app: true, push: true },
    'disparo.failed': { in_app: true, push: true },
    'disparo.paused': { in_app: true, push: false },
    'disparo.cancelled': { in_app: true, push: true },
    'watchlist.edital_match': { in_app: true, push: true },
    'watchlist.pca_match': { in_app: true, push: true },
    'search.job_completed': { in_app: true, push: true },
    'pipeline.due_48h': { in_app: true, push: false },
    'pipeline.due_today': { in_app: true, push: true },
    'pipeline.opportunity_created': { in_app: true, push: true },
    'metas.updated': { in_app: true, push: false },
    'dados.rfb_import_done': { in_app: true, push: false },
    'dados.rfb_import_failed': { in_app: true, push: true },
    'system.test': { in_app: true, push: true },
  },
};

/** Número da etapa a partir de "13. Fechado-Ganho". */
const stageNumberFromLabel = (stage) => {
  const m = String(stage || '').trim().match(/^(\d+)/);
  return m ? Number(m[1]) : null;
};

const FUNIL_WON_STAGES = new Set([13, 18]); // Fechado-Ganho, Novos Clientes
const FUNIL_LOST_STAGES = new Set([14, 16]); // Fechado-Perdido, Descartado
const FUNIL_MILESTONE_STAGES = new Set([6, 8, 10]); // Qualificado, Demo, Proposta

const deepMergePrefs = (base, patch) => {
  const out = {
    push_enabled: typeof patch?.push_enabled === 'boolean'
      ? patch.push_enabled
      : Boolean(base.push_enabled),
    categories: { ...(base.categories || {}) },
    types: { ...(base.types || {}) },
  };
  if (patch?.categories && typeof patch.categories === 'object') {
    for (const [key, val] of Object.entries(patch.categories)) {
      if (!val || typeof val !== 'object') continue;
      out.categories[key] = {
        ...(out.categories[key] || { in_app: true, push: true }),
        ...(typeof val.in_app === 'boolean' ? { in_app: val.in_app } : {}),
        ...(typeof val.push === 'boolean' ? { push: val.push } : {}),
      };
    }
  }
  if (patch?.types && typeof patch.types === 'object') {
    for (const [key, val] of Object.entries(patch.types)) {
      if (!val || typeof val !== 'object') continue;
      out.types[key] = {
        ...(out.types[key] || { in_app: true, push: true }),
        ...(typeof val.in_app === 'boolean' ? { in_app: val.in_app } : {}),
        ...(typeof val.push === 'boolean' ? { push: val.push } : {}),
      };
    }
  }
  return out;
};

const getVapidConfig = () => {
  const publicKey = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = String(process.env.VAPID_SUBJECT || 'mailto:ops@aerion.local').trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
};

let vapidConfigured = false;
const ensureVapidConfigured = () => {
  const cfg = getVapidConfig();
  if (!cfg) return null;
  if (!vapidConfigured) {
    webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    vapidConfigured = true;
  }
  return cfg;
};

const createNotificationTables = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${PUSH_SUBSCRIPTIONS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (endpoint)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON ${PUSH_SUBSCRIPTIONS_TABLE} (user_id);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${NOTIFICATION_PREFERENCES_TABLE} (
      user_id INTEGER PRIMARY KEY,
      prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${USER_NOTIFICATIONS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL DEFAULT 2,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      dedupe_key TEXT,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created ON ${USER_NOTIFICATIONS_TABLE} (user_id, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_notifications_user_unread ON ${USER_NOTIFICATIONS_TABLE} (user_id) WHERE read_at IS NULL;`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_notifications_dedupe ON ${USER_NOTIFICATIONS_TABLE} (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;`);
};

const getAuthUserId = (req) => {
  const uid = Number(req.auth?.uid);
  return Number.isFinite(uid) && uid > 0 ? uid : null;
};

const getUserNotificationPrefs = async (pool, userId) => {
  if (!userId) return { ...DEFAULT_NOTIFICATION_PREFS };
  const { rows } = await pool.query(
    `SELECT prefs FROM ${NOTIFICATION_PREFERENCES_TABLE} WHERE user_id = $1`,
    [userId]
  );
  if (!rows[0]?.prefs) return deepMergePrefs(DEFAULT_NOTIFICATION_PREFS, {});
  return deepMergePrefs(DEFAULT_NOTIFICATION_PREFS, rows[0].prefs);
};

/**
 * Resolução de preferências:
 * 1) master push_enabled (só canal push)
 * 2) grupo/categoria deve estar ligado no canal (gate)
 * 3) tipo individual deve estar ligado no canal
 * Tipo NÃO sobrescreve um grupo desligado.
 */
const shouldNotify = (prefs, type, channel) => {
  const meta = NOTIFICATION_TYPE_CATALOG[type];
  if (!meta) return false;
  if (channel === 'push' && !prefs?.push_enabled) return false;
  if (!meta.channels.includes(channel)) return false;

  const catPref = prefs?.categories?.[meta.category];
  const catOn = typeof catPref?.[channel] === 'boolean' ? catPref[channel] : true;
  if (!catOn) return false;

  const typePref = prefs?.types?.[type];
  const typeOn = typeof typePref?.[channel] === 'boolean' ? typePref[channel] : true;
  return typeOn;
};

const getAccountUserIds = async (pool, accountId) => {
  const { rows } = await pool.query(
    `SELECT user_id FROM account_users WHERE account_id = $1`,
    [accountId]
  );
  return rows.map((r) => Number(r.user_id)).filter((id) => Number.isFinite(id) && id > 0);
};

const deletePushSubscriptionByEndpoint = async (pool, endpoint) => {
  if (!endpoint) return;
  await pool.query(`DELETE FROM ${PUSH_SUBSCRIPTIONS_TABLE} WHERE endpoint = $1`, [endpoint]);
};

const sendWebPushToSubscription = async (pool, row, payload) => {
  const cfg = ensureVapidConfigured();
  if (!cfg) return { ok: false, reason: 'vapid_missing' };
  const subscription = {
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
  };
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), {
      TTL: 60 * 60 * 12,
      urgency: 'normal',
    });
    await pool.query(
      `UPDATE ${PUSH_SUBSCRIPTIONS_TABLE} SET last_seen_at = NOW() WHERE id = $1`,
      [row.id]
    );
    return { ok: true };
  } catch (error) {
    const status = error?.statusCode || error?.status;
    if (status === 404 || status === 410) {
      await deletePushSubscriptionByEndpoint(pool, row.endpoint);
      return { ok: false, reason: 'gone' };
    }
    console.warn('[push] send failed:', status || error.message);
    return { ok: false, reason: error.message };
  }
};

const sendWebPushToUser = async (pool, userId, payload) => {
  const { rows } = await pool.query(
    `SELECT id, endpoint, p256dh, auth FROM ${PUSH_SUBSCRIPTIONS_TABLE} WHERE user_id = $1`,
    [userId]
  );
  let sent = 0;
  for (const row of rows) {
    const result = await sendWebPushToSubscription(pool, row, payload);
    if (result.ok) sent += 1;
  }
  return { devices: rows.length, sent };
};

/**
 * Cria inbox rows e dispara push conforme preferências de cada usuário.
 * @returns {{ created: number, pushed: number }}
 */
const createAndDispatchNotification = async (pool, {
  userIds,
  accountId = 2,
  type,
  title,
  body = null,
  data = {},
  dedupeKey = null,
}) => {
  const meta = NOTIFICATION_TYPE_CATALOG[type];
  if (!meta) {
    console.warn('[notifications] tipo desconhecido:', type);
    return { created: 0, pushed: 0 };
  }
  const ids = Array.from(new Set((userIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0)));
  if (!ids.length) return { created: 0, pushed: 0 };

  let created = 0;
  let pushed = 0;
  const payloadBase = {
    type,
    category: meta.category,
    title: String(title || meta.label),
    body: body ? String(body) : null,
    data: data && typeof data === 'object' ? data : {},
  };

  for (const userId of ids) {
    let prefs;
    try {
      prefs = await getUserNotificationPrefs(pool, userId);
    } catch (error) {
      console.warn('[notifications] prefs failed for user', userId, error.message);
      continue;
    }

    const wantInApp = shouldNotify(prefs, type, 'in_app');
    const wantPush = shouldNotify(prefs, type, 'push');
    if (!wantInApp && !wantPush) continue;

    let notificationId = null;
    const key = dedupeKey ? `${type}:${dedupeKey}` : null;
    if (wantInApp || wantPush) {
      try {
        if (key) {
          const existing = await pool.query(
            `SELECT id FROM ${USER_NOTIFICATIONS_TABLE}
              WHERE user_id = $1 AND dedupe_key = $2 LIMIT 1`,
            [userId, key]
          );
          if (existing.rows[0]) {
            // Já notificado (ex.: digest diário) — não reenvia.
            continue;
          }
        }
        const insert = await pool.query(
          `
            INSERT INTO ${USER_NOTIFICATIONS_TABLE}
              (user_id, account_id, type, category, title, body, data, dedupe_key)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
            RETURNING id
          `,
          [
            userId,
            accountId,
            type,
            meta.category,
            payloadBase.title,
            payloadBase.body,
            JSON.stringify(payloadBase.data),
            key,
          ]
        );
        if (insert.rowCount > 0) {
          created += 1;
          notificationId = insert.rows[0].id;
        }
      } catch (error) {
        // Corrida de dedupe (unique parcial)
        if (error.code === '23505' && key) continue;
        console.warn('[notifications] insert failed:', error.message);
        continue;
      }
    }

    if (wantPush) {
      const pushPayload = {
        ...payloadBase,
        id: notificationId,
        url: payloadBase.data?.url || '/',
        view: payloadBase.data?.view || null,
        sub: payloadBase.data?.sub || null,
      };
      try {
        const result = await sendWebPushToUser(pool, userId, pushPayload);
        pushed += result.sent;
      } catch (error) {
        console.warn('[notifications] push failed for user', userId, error.message);
      }
    }
  }

  return { created, pushed };
};

const notifyAccountUsers = async (pool, {
  accountId = 2,
  type,
  title,
  body,
  data,
  dedupeKey,
  onlyUserIds = null,
}) => {
  let userIds = onlyUserIds;
  if (!userIds) {
    try {
      userIds = await getAccountUserIds(pool, accountId);
    } catch (error) {
      console.warn('[notifications] list account users failed:', error.message);
      userIds = [];
    }
  }
  return createAndDispatchNotification(pool, {
    userIds,
    accountId,
    type,
    title,
    body,
    data,
    dedupeKey,
  });
};

/**
 * Classifica mudança de etapa do funil e dispara won / lost / milestone.
 */
const notifyFunnelStageChange = async (pool, {
  accountId = 2,
  contactId,
  contactName,
  fromStage,
  toStage,
  actorName = null,
}) => {
  const toNum = stageNumberFromLabel(toStage);
  if (!toNum) return { created: 0, pushed: 0 };
  const name = String(contactName || `Lead #${contactId}`).slice(0, 80);
  const who = actorName ? ` por ${actorName}` : '';
  const baseData = {
    view: 'Board',
    contact_id: contactId,
    from_stage: fromStage,
    to_stage: toStage,
  };

  if (FUNIL_WON_STAGES.has(toNum)) {
    return notifyAccountUsers(pool, {
      accountId,
      type: 'funil.won',
      title: `Ganho · ${name}`,
      body: `${fromStage || '—'} → ${toStage}${who}`,
      data: baseData,
      dedupeKey: `contact:${contactId}:won:${toNum}`,
    });
  }
  if (FUNIL_LOST_STAGES.has(toNum)) {
    return notifyAccountUsers(pool, {
      accountId,
      type: 'funil.lost',
      title: `Perdido · ${name}`,
      body: `${fromStage || '—'} → ${toStage}${who}`,
      data: baseData,
      dedupeKey: `contact:${contactId}:lost:${toNum}:${Date.now()}`,
    });
  }
  if (FUNIL_MILESTONE_STAGES.has(toNum)) {
    return notifyAccountUsers(pool, {
      accountId,
      type: 'funil.milestone',
      title: `Marco · ${name}`,
      body: `${fromStage || '—'} → ${toStage}${who}`,
      data: baseData,
      dedupeKey: `contact:${contactId}:milestone:${toNum}`,
    });
  }
  return { created: 0, pushed: 0 };
};

/** Digest diário: leads no Inbox (etapa 1) sem atualização há N dias. */
const emitFunnelStaleInboxDigest = async (pool, {
  accountId = 2,
  staleDays = 3,
}) => {
  const dayKey = new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `
      SELECT COUNT(*)::int AS n
        FROM contacts c
       WHERE c.account_id = $1
         AND COALESCE(c.custom_attributes->>'Funil_Vendas', '') LIKE '1.%'
         AND c.updated_at < NOW() - ($2::text || ' days')::interval
    `,
    [accountId, String(Math.max(1, Number(staleDays) || 3))]
  );
  const n = Number(rows[0]?.n) || 0;
  if (n <= 0) return { count: 0, created: 0, pushed: 0 };
  const r = await notifyAccountUsers(pool, {
    accountId,
    type: 'funil.stale_inbox',
    title: `${n} lead${n === 1 ? '' : 's'} parado${n === 1 ? '' : 's'} no Inbox`,
    body: `Sem avanço há ${staleDays}+ dias. Vale priorizar no funil.`,
    data: { view: 'Board', count: n, stale_days: staleDays },
    dedupeKey: `account:${accountId}:day:${dayKey}`,
  });
  return { count: n, ...r };
};

const emitDeadlineDigest = async (pool, {
  accountId = 2,
  getLicitacaoOpenPipelineSql,
  runExpiredLicitacaoProposalMove,
  analyzeLicitacaoDeadlineSummary,
}) => {
  const dayKey = new Date().toISOString().slice(0, 10);

  // Antes do digest: só suspenso → Monitoramento (ativo → Perdido exige confirm na UI).
  if (typeof runExpiredLicitacaoProposalMove === 'function') {
    try {
      await runExpiredLicitacaoProposalMove({ accountId });
    } catch (err) {
      console.warn('[notifications] auto-move suspenso→monitoramento antes do digest falhou:', err.message);
    }
  }

  // Prazos críticos em 3 d.ú. BR: proposta, impugnação (art. 164) e recurso.
  const openSql = typeof getLicitacaoOpenPipelineSql === 'function'
    ? getLicitacaoOpenPipelineSql()
    : `LOWER(COALESCE(NULLIF(TRIM(status), ''), 'ativo')) IN ('ativo', 'suspenso')
       AND NULLIF(substring(COALESCE(fase, '') from '^[0-9]+'), '')::int BETWEEN 2 AND 12`;

  let dueCritical3bd = 0;
  let dueToday = 0;
  let dueImpugnacao3bd = 0;
  let dueRecurso3bd = 0;
  let dueProposta3bd = 0;

  if (typeof analyzeLicitacaoDeadlineSummary === 'function') {
    const { rows } = await pool.query(
      `
        SELECT
          id, titulo, numero_edital, fase, status, valor_oportunidade,
          data_envio_proposta_limite, data_impugnacao_limite, data_recurso_limite
        FROM licitacao_opportunities
        WHERE account_id = $1
          AND ${openSql}
      `,
      [accountId]
    );
    const deadlines = analyzeLicitacaoDeadlineSummary(rows);
    dueCritical3bd = Number(deadlines.due_critical_3bd) || 0;
    dueToday = Number(deadlines.due_today) || 0;
    dueImpugnacao3bd = Number(deadlines.due_impugnacao_3bd) || 0;
    dueRecurso3bd = Number(deadlines.due_recurso_3bd) || 0;
    dueProposta3bd = Number(deadlines.due_proposta_3bd) || 0;
  }

  let created = 0;
  let pushed = 0;

  if (dueToday > 0) {
    const r = await notifyAccountUsers(pool, {
      accountId,
      type: 'pipeline.due_today',
      title: `${dueToday} licitação${dueToday === 1 ? '' : 'ões'} vencem hoje`,
      body: 'Prazo de envio de proposta (vencimento) no dia de hoje.',
      data: { view: 'Licitações', sub: 'overview', count: dueToday },
      dedupeKey: `account:${accountId}:day:${dayKey}`,
    });
    created += r.created;
    pushed += r.pushed;
  }
  if (dueCritical3bd > 0) {
    const parts = [];
    if (dueImpugnacao3bd > 0) parts.push(`${dueImpugnacao3bd} impugnação`);
    if (dueProposta3bd > 0) parts.push(`${dueProposta3bd} proposta`);
    if (dueRecurso3bd > 0) parts.push(`${dueRecurso3bd} recurso`);
    const detail = parts.length ? parts.join(' · ') : 'proposta, impugnação ou recurso';
    const r = await notifyAccountUsers(pool, {
      accountId,
      type: 'pipeline.due_48h',
      title: `${dueCritical3bd} licitação${dueCritical3bd === 1 ? '' : 'ões'} com prazo em 3 dias úteis`,
      body: `Prazos críticos (calendário nacional BR): ${detail}.`,
      data: {
        view: 'Licitações',
        sub: 'overview',
        count: dueCritical3bd,
        due_impugnacao_3bd: dueImpugnacao3bd,
        due_proposta_3bd: dueProposta3bd,
        due_recurso_3bd: dueRecurso3bd,
      },
      dedupeKey: `account:${accountId}:day:${dayKey}`,
    });
    created += r.created;
    pushed += r.pushed;
  }
  return {
    overdue: 0,
    due48: dueCritical3bd,
    dueToday,
    due_critical_3bd: dueCritical3bd,
    due_recurso_3bd: dueRecurso3bd,
    due_impugnacao_3bd: dueImpugnacao3bd,
    due_proposta_3bd: dueProposta3bd,
    created,
    pushed,
  };
};

const registerNotificationRoutes = (app, { pool, defaultAccountId = 2 }) => {
  app.get('/api/notifications/catalog', (req, res) => {
    res.json({
      categories: Object.values(NOTIFICATION_CATEGORIES),
      types: Object.values(NOTIFICATION_TYPE_CATALOG),
      defaults: DEFAULT_NOTIFICATION_PREFS,
    });
  });

  app.get('/api/notifications/vapid-public-key', (req, res) => {
    const cfg = getVapidConfig();
    if (!cfg) {
      return res.status(503).json({
        error: 'Web Push não configurado',
        details: 'Defina VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY no ambiente do backend.',
      });
    }
    return res.json({ publicKey: cfg.publicKey });
  });

  app.get('/api/notifications/preferences', async (req, res) => {
    const userId = getAuthUserId(req);
    if (!userId) {
      return res.status(400).json({
        error: 'Usuário sem id na sessão. Faça login com uma conta do Chatwoot (não bootstrap env).',
      });
    }
    try {
      const prefs = await getUserNotificationPrefs(pool, userId);
      return res.json({
        prefs,
        catalog: {
          categories: Object.values(NOTIFICATION_CATEGORIES),
          types: Object.values(NOTIFICATION_TYPE_CATALOG),
        },
      });
    } catch (error) {
      console.error('[notifications] get preferences:', error);
      return res.status(500).json({ error: 'Erro ao carregar preferências' });
    }
  });

  app.put('/api/notifications/preferences', async (req, res) => {
    const userId = getAuthUserId(req);
    if (!userId) {
      return res.status(400).json({ error: 'Usuário sem id na sessão.' });
    }
    try {
      const current = await getUserNotificationPrefs(pool, userId);
      const next = deepMergePrefs(current, req.body || {});
      await pool.query(
        `
          INSERT INTO ${NOTIFICATION_PREFERENCES_TABLE} (user_id, prefs, updated_at)
          VALUES ($1, $2::jsonb, NOW())
          ON CONFLICT (user_id) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = NOW()
        `,
        [userId, JSON.stringify(next)]
      );
      return res.json({ prefs: next });
    } catch (error) {
      console.error('[notifications] put preferences:', error);
      return res.status(500).json({ error: 'Erro ao salvar preferências' });
    }
  });

  app.post('/api/notifications/push/subscribe', async (req, res) => {
    const userId = getAuthUserId(req);
    if (!userId) {
      return res.status(400).json({ error: 'Usuário sem id na sessão.' });
    }
    if (!getVapidConfig()) {
      return res.status(503).json({ error: 'Web Push não configurado no servidor.' });
    }
    const sub = req.body?.subscription || req.body;
    const endpoint = String(sub?.endpoint || '').trim();
    const p256dh = String(sub?.keys?.p256dh || '').trim();
    const auth = String(sub?.keys?.auth || '').trim();
    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ error: 'Subscription inválida (endpoint/keys).' });
    }
    const userAgent = String(req.headers['user-agent'] || req.body?.user_agent || '').slice(0, 500) || null;
    try {
      await pool.query(
        `
          INSERT INTO ${PUSH_SUBSCRIPTIONS_TABLE}
            (user_id, endpoint, p256dh, auth, user_agent, created_at, last_seen_at)
          VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
          ON CONFLICT (endpoint) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            p256dh = EXCLUDED.p256dh,
            auth = EXCLUDED.auth,
            user_agent = COALESCE(EXCLUDED.user_agent, ${PUSH_SUBSCRIPTIONS_TABLE}.user_agent),
            last_seen_at = NOW()
        `,
        [userId, endpoint, p256dh, auth, userAgent]
      );
      // Master push on when user explicitly subscribes this device
      const prefs = await getUserNotificationPrefs(pool, userId);
      if (!prefs.push_enabled) {
        const next = deepMergePrefs(prefs, { push_enabled: true });
        await pool.query(
          `
            INSERT INTO ${NOTIFICATION_PREFERENCES_TABLE} (user_id, prefs, updated_at)
            VALUES ($1, $2::jsonb, NOW())
            ON CONFLICT (user_id) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = NOW()
          `,
          [userId, JSON.stringify(next)]
        );
      }
      return res.json({ ok: true });
    } catch (error) {
      console.error('[notifications] subscribe:', error);
      return res.status(500).json({ error: 'Erro ao salvar subscription' });
    }
  });

  app.delete('/api/notifications/push/unsubscribe', async (req, res) => {
    const userId = getAuthUserId(req);
    if (!userId) {
      return res.status(400).json({ error: 'Usuário sem id na sessão.' });
    }
    const endpoint = String(req.body?.endpoint || '').trim();
    try {
      if (endpoint) {
        await pool.query(
          `DELETE FROM ${PUSH_SUBSCRIPTIONS_TABLE} WHERE user_id = $1 AND endpoint = $2`,
          [userId, endpoint]
        );
      } else {
        await pool.query(`DELETE FROM ${PUSH_SUBSCRIPTIONS_TABLE} WHERE user_id = $1`, [userId]);
      }
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM ${PUSH_SUBSCRIPTIONS_TABLE} WHERE user_id = $1`,
        [userId]
      );
      if ((rows[0]?.n || 0) === 0) {
        const prefs = await getUserNotificationPrefs(pool, userId);
        const next = deepMergePrefs(prefs, { push_enabled: false });
        await pool.query(
          `
            INSERT INTO ${NOTIFICATION_PREFERENCES_TABLE} (user_id, prefs, updated_at)
            VALUES ($1, $2::jsonb, NOW())
            ON CONFLICT (user_id) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = NOW()
          `,
          [userId, JSON.stringify(next)]
        );
      }
      return res.json({ ok: true, remaining_devices: rows[0]?.n || 0 });
    } catch (error) {
      console.error('[notifications] unsubscribe:', error);
      return res.status(500).json({ error: 'Erro ao remover subscription' });
    }
  });

  app.get('/api/notifications/push/status', async (req, res) => {
    const userId = getAuthUserId(req);
    if (!userId) {
      return res.status(400).json({ error: 'Usuário sem id na sessão.' });
    }
    try {
      const { rows } = await pool.query(
        `SELECT id, endpoint, user_agent, created_at, last_seen_at
           FROM ${PUSH_SUBSCRIPTIONS_TABLE}
          WHERE user_id = $1
          ORDER BY last_seen_at DESC`,
        [userId]
      );
      return res.json({
        vapid_configured: Boolean(getVapidConfig()),
        device_count: rows.length,
        devices: rows.map((r) => ({
          id: r.id,
          endpoint_hint: String(r.endpoint || '').slice(0, 48) + '…',
          user_agent: r.user_agent,
          created_at: r.created_at,
          last_seen_at: r.last_seen_at,
        })),
      });
    } catch (error) {
      console.error('[notifications] push status:', error);
      return res.status(500).json({ error: 'Erro ao listar devices' });
    }
  });

  app.get('/api/notifications', async (req, res) => {
    const userId = getAuthUserId(req);
    if (!userId) {
      return res.status(400).json({ error: 'Usuário sem id na sessão.' });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
    try {
      const { rows } = await pool.query(
        `
          SELECT id, type, category, title, body, data, read_at, created_at
            FROM ${USER_NOTIFICATIONS_TABLE}
           WHERE user_id = $1
             ${unreadOnly ? 'AND read_at IS NULL' : ''}
           ORDER BY created_at DESC
           LIMIT $2 OFFSET $3
        `,
        [userId, limit, offset]
      );
      return res.json({ items: rows, limit, offset });
    } catch (error) {
      console.error('[notifications] list:', error);
      return res.status(500).json({ error: 'Erro ao listar notificações' });
    }
  });

  app.get('/api/notifications/unread-count', async (req, res) => {
    const userId = getAuthUserId(req);
    if (!userId) {
      return res.json({ count: 0 });
    }
    try {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS count FROM ${USER_NOTIFICATIONS_TABLE}
          WHERE user_id = $1 AND read_at IS NULL`,
        [userId]
      );
      return res.json({ count: rows[0]?.count || 0 });
    } catch (error) {
      console.error('[notifications] unread-count:', error);
      return res.status(500).json({ error: 'Erro ao contar notificações' });
    }
  });

  app.post('/api/notifications/read', async (req, res) => {
    const userId = getAuthUserId(req);
    if (!userId) {
      return res.status(400).json({ error: 'Usuário sem id na sessão.' });
    }
    try {
      if (req.body?.all === true) {
        const { rowCount } = await pool.query(
          `UPDATE ${USER_NOTIFICATIONS_TABLE}
              SET read_at = NOW()
            WHERE user_id = $1 AND read_at IS NULL`,
          [userId]
        );
        return res.json({ ok: true, updated: rowCount });
      }
      const ids = Array.isArray(req.body?.ids)
        ? req.body.ids.map(Number).filter((n) => Number.isFinite(n) && n > 0)
        : [];
      if (!ids.length) {
        return res.status(400).json({ error: 'Informe ids ou all: true' });
      }
      const { rowCount } = await pool.query(
        `UPDATE ${USER_NOTIFICATIONS_TABLE}
            SET read_at = NOW()
          WHERE user_id = $1 AND id = ANY($2::bigint[]) AND read_at IS NULL`,
        [userId, ids]
      );
      return res.json({ ok: true, updated: rowCount });
    } catch (error) {
      console.error('[notifications] mark read:', error);
      return res.status(500).json({ error: 'Erro ao marcar como lida' });
    }
  });

  app.post('/api/notifications/test-push', async (req, res) => {
    const userId = getAuthUserId(req);
    if (!userId) {
      return res.status(400).json({ error: 'Usuário sem id na sessão.' });
    }
    if (!getVapidConfig()) {
      return res.status(503).json({ error: 'Web Push não configurado no servidor.' });
    }
    try {
      // Teste ignora master push_enabled / type toggles for the push channel
      // but still creates inbox entry. Force temporary prefs path via direct send.
      const prefs = await getUserNotificationPrefs(pool, userId);
      const forced = deepMergePrefs(prefs, {
        push_enabled: true,
        types: { 'system.test': { in_app: true, push: true } },
      });
      // Temporarily write is not needed — call insert + send directly
      const title = 'Teste de notificação Aerion';
      const body = 'Se você viu isto, o push deste dispositivo está funcionando.';
      const data = { view: 'Notificações', url: '/' };

      const insert = await pool.query(
        `
          INSERT INTO ${USER_NOTIFICATIONS_TABLE}
            (user_id, account_id, type, category, title, body, data)
          VALUES ($1, $2, 'system.test', 'sistema', $3, $4, $5::jsonb)
          RETURNING id
        `,
        [userId, defaultAccountId, title, body, JSON.stringify(data)]
      );
      const id = insert.rows[0].id;
      const pushResult = await sendWebPushToUser(pool, userId, {
        id,
        type: 'system.test',
        category: 'sistema',
        title,
        body,
        data,
        view: 'Notificações',
      });
      // silence unused if eslint
      void forced;
      return res.json({
        ok: true,
        notification_id: id,
        devices: pushResult.devices,
        sent: pushResult.sent,
      });
    } catch (error) {
      console.error('[notifications] test-push:', error);
      return res.status(500).json({ error: 'Erro ao enviar push de teste', details: error.message });
    }
  });
};

module.exports = {
  PUSH_SUBSCRIPTIONS_TABLE,
  NOTIFICATION_PREFERENCES_TABLE,
  USER_NOTIFICATIONS_TABLE,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPE_CATALOG,
  DEFAULT_NOTIFICATION_PREFS,
  createNotificationTables,
  registerNotificationRoutes,
  createAndDispatchNotification,
  notifyAccountUsers,
  getAccountUserIds,
  getUserNotificationPrefs,
  shouldNotify,
  emitDeadlineDigest,
  emitFunnelStaleInboxDigest,
  notifyFunnelStageChange,
  stageNumberFromLabel,
  getVapidConfig,
  ensureVapidConfigured,
};
