const CONTACT_REMINDERS_TABLE = 'contact_followup_reminders';

const REMINDER_NOTE_MAX_LENGTH = 160;

const latestInteractionLateralSql = (contactAlias = 'c') => `
  LEFT JOIN LATERAL (
    SELECT event_kind, occurred_at
      FROM (
        (
          SELECT
            CASE
              WHEN COALESCE(m."private", false) THEN 'conversation_note'
              WHEN m.message_type = 0 THEN 'incoming_message'
              ELSE 'outgoing_message'
            END AS event_kind,
            m.created_at AS occurred_at,
            m.id AS event_id,
            1 AS source_rank
          FROM conversations conversation
          INNER JOIN messages m ON m.conversation_id = conversation.id
          WHERE conversation.contact_id = ${contactAlias}.id
            AND m.account_id = ${contactAlias}.account_id
            AND (
              COALESCE(m."private", false) = true
              OR (
                COALESCE(m."private", false) = false
                AND m.message_type IN (0, 1)
              )
            )
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT 1
        )
        UNION ALL
        (
          SELECT
            'contact_note' AS event_kind,
            n.created_at AS occurred_at,
            n.id AS event_id,
            2 AS source_rank
          FROM notes n
          WHERE n.contact_id = ${contactAlias}.id
            AND n.account_id = ${contactAlias}.account_id
          ORDER BY n.created_at DESC, n.id DESC
          LIMIT 1
        )
      ) interaction_events
      ORDER BY occurred_at DESC, source_rank DESC, event_id DESC
      LIMIT 1
  ) latest_interaction ON true
`;

const createContactReminderTable = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${CONTACT_REMINDERS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      account_id INTEGER NOT NULL,
      contact_id BIGINT NOT NULL,
      due_at TIMESTAMPTZ NOT NULL,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'completed', 'cancelled', 'rescheduled')),
      completion_reason TEXT
        CHECK (completion_reason IS NULL OR completion_reason IN ('manual', 'interaction', 'cancelled', 'rescheduled')),
      created_by_user_id INTEGER,
      completed_by_user_id INTEGER,
      replaced_by_id BIGINT REFERENCES ${CONTACT_REMINDERS_TABLE}(id) ON DELETE SET NULL,
      notified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_followup_one_pending
      ON ${CONTACT_REMINDERS_TABLE} (account_id, contact_id)
      WHERE status = 'pending'
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contact_followup_pending_due
      ON ${CONTACT_REMINDERS_TABLE} (due_at)
      WHERE status = 'pending' AND notified_at IS NULL
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contact_followup_contact_history
      ON ${CONTACT_REMINDERS_TABLE} (account_id, contact_id, created_at DESC)
  `);
};

const normalizeReminderPayload = ({ due_at: dueAt, note }, now = new Date()) => {
  const due = new Date(dueAt);
  if (!dueAt || Number.isNaN(due.getTime())) {
    const error = new Error('Informe uma data e hora válidas.');
    error.statusCode = 400;
    throw error;
  }
  if (due.getTime() <= now.getTime()) {
    const error = new Error('Escolha um horário futuro para o retorno.');
    error.statusCode = 400;
    throw error;
  }
  const normalizedNote = String(note || '').trim();
  if (normalizedNote.length > REMINDER_NOTE_MAX_LENGTH) {
    const error = new Error(`O motivo pode ter no máximo ${REMINDER_NOTE_MAX_LENGTH} caracteres.`);
    error.statusCode = 400;
    throw error;
  }
  return {
    dueAt: due.toISOString(),
    note: normalizedNote || null,
  };
};

const shouldAutoCompleteReminder = (createdAt, lastInteractionAt) => {
  if (!createdAt || !lastInteractionAt) return false;
  const created = new Date(createdAt).getTime();
  const interaction = new Date(lastInteractionAt).getTime();
  return Number.isFinite(created) && Number.isFinite(interaction) && interaction > created;
};

const statusSelectSql = ({ oneContact = false } = {}) => `
  SELECT
    c.id AS contact_id,
    latest_interaction.event_kind AS last_interaction_kind,
    latest_interaction.occurred_at AS last_interaction_at,
    reminder.id AS reminder_id,
    reminder.due_at AS reminder_due_at,
    reminder.note AS reminder_note,
    reminder.created_at AS reminder_created_at,
    reminder.created_by_user_id,
    COALESCE(latest_assignee.assignee_id, reminder.created_by_user_id) AS reminder_assignee_id,
    COALESCE(
      NULLIF(TRIM(assignee_access.seller_label), ''),
      NULLIF(TRIM(assignee.display_name), ''),
      NULLIF(TRIM(assignee.name), ''),
      assignee.email,
      NULLIF(TRIM(creator.display_name), ''),
      NULLIF(TRIM(creator.name), ''),
      creator.email
    ) AS reminder_assignee_name
  FROM contacts c
  ${latestInteractionLateralSql('c')}
  LEFT JOIN LATERAL (
    SELECT r.*
    FROM ${CONTACT_REMINDERS_TABLE} r
    WHERE r.account_id = c.account_id
      AND r.contact_id = c.id
      AND r.status = 'pending'
    LIMIT 1
  ) reminder ON true
  LEFT JOIN LATERAL (
    SELECT conversation.assignee_id
    FROM conversations conversation
    WHERE conversation.contact_id = c.id
      AND conversation.assignee_id IS NOT NULL
    ORDER BY conversation.last_activity_at DESC NULLS LAST,
             conversation.updated_at DESC NULLS LAST,
             conversation.created_at DESC
    LIMIT 1
  ) latest_assignee ON true
  LEFT JOIN users assignee ON assignee.id = latest_assignee.assignee_id
  LEFT JOIN app_user_access assignee_access ON assignee_access.user_id = latest_assignee.assignee_id
  LEFT JOIN users creator ON creator.id = reminder.created_by_user_id
  WHERE c.account_id = $1
    AND COALESCE(NULLIF(TRIM(c.custom_attributes->>'Funil_Vendas'), ''), '') <> ''
    ${oneContact ? 'AND c.id = $2' : ''}
  ORDER BY c.id
`;

const mapFollowupStatusRow = (row) => ({
  contact_id: row.contact_id,
  last_interaction: row.last_interaction_at
    ? {
        kind: row.last_interaction_kind,
        occurred_at: row.last_interaction_at,
      }
    : null,
  reminder: row.reminder_id
    ? {
        id: row.reminder_id,
        due_at: row.reminder_due_at,
        note: row.reminder_note || '',
        created_at: row.reminder_created_at,
        created_by_user_id: row.created_by_user_id,
        assignee_id: row.reminder_assignee_id,
        assignee_name: row.reminder_assignee_name || null,
      }
    : null,
});

const getContactFollowupStatuses = async (pool, accountId) => {
  const { rows } = await pool.query(statusSelectSql(), [accountId]);
  return rows.map(mapFollowupStatusRow);
};

const getContactFollowupStatus = async (pool, accountId, contactId) => {
  const { rows } = await pool.query(statusSelectSql({ oneContact: true }), [accountId, contactId]);
  return rows[0] ? mapFollowupStatusRow(rows[0]) : null;
};

const replaceContactReminder = async (pool, {
  accountId,
  contactId,
  dueAt,
  note,
  userId = null,
}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const contact = await client.query(
      `SELECT id FROM contacts
        WHERE id = $1 AND account_id = $2
          AND COALESCE(NULLIF(TRIM(custom_attributes->>'Funil_Vendas'), ''), '') <> ''
        FOR UPDATE`,
      [contactId, accountId]
    );
    if (!contact.rows[0]) {
      const error = new Error('Contato não encontrado no funil.');
      error.statusCode = 404;
      throw error;
    }

    const previous = await client.query(
      `SELECT id FROM ${CONTACT_REMINDERS_TABLE}
        WHERE account_id = $1 AND contact_id = $2 AND status = 'pending'
        FOR UPDATE`,
      [accountId, contactId]
    );
    if (previous.rows[0]) {
      await client.query(
        `UPDATE ${CONTACT_REMINDERS_TABLE}
            SET status = 'rescheduled', completion_reason = 'rescheduled',
                completed_at = NOW(), completed_by_user_id = $2, updated_at = NOW()
          WHERE id = $1`,
        [previous.rows[0].id, userId]
      );
    }

    const inserted = await client.query(
      `INSERT INTO ${CONTACT_REMINDERS_TABLE}
        (account_id, contact_id, due_at, note, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [accountId, contactId, dueAt, note, userId]
    );
    if (previous.rows[0]) {
      await client.query(
        `UPDATE ${CONTACT_REMINDERS_TABLE} SET replaced_by_id = $2 WHERE id = $1`,
        [previous.rows[0].id, inserted.rows[0].id]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return getContactFollowupStatus(pool, accountId, contactId);
};

const closeContactReminder = async (pool, {
  accountId,
  contactId,
  userId = null,
  action,
}) => {
  const isCancel = action === 'cancelled';
  const { rowCount } = await pool.query(
    `UPDATE ${CONTACT_REMINDERS_TABLE}
        SET status = $3,
            completion_reason = $4,
            completed_at = NOW(),
            completed_by_user_id = $5,
            updated_at = NOW()
      WHERE account_id = $1 AND contact_id = $2 AND status = 'pending'`,
    [
      accountId,
      contactId,
      isCancel ? 'cancelled' : 'completed',
      isCancel ? 'cancelled' : 'manual',
      userId,
    ]
  );
  if (!rowCount) {
    const error = new Error('Este contato não possui um retorno pendente.');
    error.statusCode = 404;
    throw error;
  }
  return getContactFollowupStatus(pool, accountId, contactId);
};

const processContactFollowups = async (pool, {
  accountId,
  notifyDue,
}) => {
  const autoCompleted = await pool.query(`
    WITH candidates AS (
      SELECT reminder.id, latest_interaction.occurred_at
      FROM ${CONTACT_REMINDERS_TABLE} reminder
      INNER JOIN contacts c
        ON c.id = reminder.contact_id AND c.account_id = reminder.account_id
      ${latestInteractionLateralSql('c')}
      WHERE reminder.account_id = $1
        AND reminder.status = 'pending'
        AND latest_interaction.occurred_at > reminder.created_at
      FOR UPDATE OF reminder SKIP LOCKED
    )
    UPDATE ${CONTACT_REMINDERS_TABLE} reminder
       SET status = 'completed',
           completion_reason = 'interaction',
           completed_at = candidates.occurred_at,
           updated_at = NOW()
      FROM candidates
     WHERE reminder.id = candidates.id
       AND reminder.status = 'pending'
    RETURNING reminder.id
  `, [accountId]);

  const dueRows = await pool.query(`
    WITH due AS (
      SELECT
        reminder.id,
        reminder.contact_id,
        reminder.note,
        c.name AS contact_name,
        COALESCE(latest_assignee.assignee_id, reminder.created_by_user_id) AS assignee_id
      FROM ${CONTACT_REMINDERS_TABLE} reminder
      INNER JOIN contacts c
        ON c.id = reminder.contact_id AND c.account_id = reminder.account_id
      ${latestInteractionLateralSql('c')}
      LEFT JOIN LATERAL (
        SELECT conversation.assignee_id
        FROM conversations conversation
        WHERE conversation.contact_id = c.id
          AND conversation.assignee_id IS NOT NULL
        ORDER BY conversation.last_activity_at DESC NULLS LAST,
                 conversation.updated_at DESC NULLS LAST,
                 conversation.created_at DESC
        LIMIT 1
      ) latest_assignee ON true
      WHERE reminder.account_id = $1
        AND reminder.status = 'pending'
        AND reminder.notified_at IS NULL
        AND reminder.due_at <= NOW()
        AND (
          latest_interaction.occurred_at IS NULL
          OR latest_interaction.occurred_at <= reminder.created_at
        )
      FOR UPDATE OF reminder SKIP LOCKED
    )
    UPDATE ${CONTACT_REMINDERS_TABLE} reminder
       SET notified_at = NOW(), updated_at = NOW()
      FROM due
     WHERE reminder.id = due.id
       AND reminder.status = 'pending'
       AND reminder.notified_at IS NULL
    RETURNING reminder.id, due.contact_id, due.note, due.contact_name, due.assignee_id
  `, [accountId]);

  let notified = 0;
  for (const reminder of dueRows.rows) {
    await notifyDue(reminder);
    notified += 1;
  }
  return {
    auto_completed: autoCompleted.rowCount,
    notified,
  };
};

module.exports = {
  CONTACT_REMINDERS_TABLE,
  REMINDER_NOTE_MAX_LENGTH,
  createContactReminderTable,
  normalizeReminderPayload,
  shouldAutoCompleteReminder,
  getContactFollowupStatuses,
  getContactFollowupStatus,
  replaceContactReminder,
  closeContactReminder,
  processContactFollowups,
};
