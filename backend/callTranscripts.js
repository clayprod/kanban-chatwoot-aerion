const crypto = require('crypto');

const CALL_TRANSCRIPTS_TABLE = 'call_transcripts';
const HIDDEN_CALLER_VALUES = new Set([
  '',
  'anonymous',
  'anonimo',
  'anônimo',
  'hidden',
  'oculto',
  'private',
  'restricted',
  'unknown',
  'unavailable',
]);

const digitsOnly = (value) => String(value ?? '').replace(/[^0-9]/g, '');

const normalizeNationalPhone = (raw) => {
  const text = String(raw ?? '').trim().toLowerCase();
  if (HIDDEN_CALLER_VALUES.has(text)) return null;

  let digits = digitsOnly(text);
  if (!digits || /^0+$/.test(digits)) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);

  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0') && (digits.length === 11 || digits.length === 12)) {
    digits = digits.slice(1);
  } else if (digits.startsWith('0') && (digits.length === 13 || digits.length === 14)) {
    // Formato brasileiro com código da operadora: 0 + CSP (2) + DDD + número.
    digits = digits.slice(3);
  }

  return digits.length === 10 || digits.length === 11 ? digits : null;
};

const phoneMatchCandidates = (raw) => {
  const national = normalizeNationalPhone(raw);
  if (!national) return [];

  const nationalCandidates = new Set([national]);
  // Algumas bases antigas ainda guardam celular sem o nono dígito.
  if (national.length === 11 && national[2] === '9') {
    nationalCandidates.add(`${national.slice(0, 2)}${national.slice(3)}`);
  } else if (national.length === 10 && /^[6-9]$/.test(national[2])) {
    nationalCandidates.add(`${national.slice(0, 2)}9${national.slice(2)}`);
  }

  const candidates = new Set();
  for (const value of nationalCandidates) {
    candidates.add(value);
    candidates.add(`55${value}`);
  }
  return [...candidates];
};

const formatDuration = (seconds) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const formatCallDate = (call = {}) => {
  if (call.started_at_local) {
    const parsed = new Date(call.started_at_local);
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
        timeStyle: 'medium',
      }).format(parsed);
    }
  }
  if (call.started_at_utc) {
    const parsed = new Date(call.started_at_utc);
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
        timeStyle: 'medium',
      }).format(parsed);
    }
  }
  return 'data não informada';
};

const buildContactNote = (payload) => {
  const call = payload.call || {};
  const lines = [
    `Ligação telefônica — ${formatCallDate(call)} (São Paulo)`,
    `Número: ${String(call.caller_number || 'não identificado')} | DID: ${String(call.did || 'não informado')}`,
    `Status: ${String(call.dial_status || 'unknown')} | Duração: ${formatDuration(call.duration_seconds)}`,
    '',
    'Transcrição:',
    String(payload.plain_text || '').trim() || '(sem falas transcritas)',
    '',
    `ID da ligação: ${payload.transcript_id}`,
  ];
  return lines.join('\n');
};

const validateTranscriptPayload = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw Object.assign(new Error('JSON da transcrição inválido.'), { statusCode: 400 });
  }
  const transcriptId = String(payload.transcript_id || '').trim();
  if (!transcriptId || transcriptId.length > 255) {
    throw Object.assign(new Error('transcript_id é obrigatório e deve ter até 255 caracteres.'), { statusCode: 400 });
  }
  const serializedSize = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (serializedSize > 2 * 1024 * 1024) {
    throw Object.assign(new Error('JSON da transcrição excede 2 MB.'), { statusCode: 413 });
  }
  return transcriptId;
};

const createCallTranscriptsTable = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${CALL_TRANSCRIPTS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      transcript_id TEXT NOT NULL UNIQUE,
      account_id BIGINT NOT NULL,
      contact_id BIGINT,
      note_id BIGINT,
      caller_number TEXT,
      normalized_phone TEXT,
      call_started_at TIMESTAMPTZ,
      match_status TEXT NOT NULL DEFAULT 'pending',
      match_count INTEGER NOT NULL DEFAULT 0,
      payload JSONB NOT NULL,
      processed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_call_transcripts_contact
      ON ${CALL_TRANSCRIPTS_TABLE} (account_id, contact_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_call_transcripts_unmatched
      ON ${CALL_TRANSCRIPTS_TABLE} (account_id, match_status, created_at DESC)
      WHERE contact_id IS NULL
  `);
};

const findContactsByPhone = async (client, accountId, callerNumber) => {
  const candidates = phoneMatchCandidates(callerNumber);
  if (!candidates.length) return { candidates, contacts: [] };

  const { rows } = await client.query(
    `SELECT id, name, phone_number
       FROM contacts
      WHERE account_id = $1
        AND regexp_replace(COALESCE(phone_number, ''), '[^0-9]', '', 'g') = ANY($2::text[])
      ORDER BY id`,
    [accountId, candidates]
  );
  return { candidates, contacts: rows };
};

const ingestCallTranscript = async (pool, { accountId, payload }) => {
  const transcriptId = validateTranscriptPayload(payload);
  const call = payload.call && typeof payload.call === 'object' ? payload.call : {};
  const callerNumber = String(call.caller_number || '').trim() || null;
  const normalizedCaller = normalizeNationalPhone(callerNumber);
  const normalizedDid = normalizeNationalPhone(call.did);
  // Alguns troncos SIP substituem o Caller ID pelo próprio DID quando a
  // identidade recebida não é confiável. Nunca associe esse número ao CRM:
  // ele pertence à Aerion, não ao cliente que originou a chamada.
  const callerIsDid = Boolean(
    normalizedCaller
    && normalizedDid
    && normalizedCaller === normalizedDid
  );
  const normalizedPhone = callerIsDid ? null : normalizedCaller;
  const phoneForMatching = callerIsDid ? null : callerNumber;
  const startedAt = call.started_at_utc || call.started_at_local || null;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO ${CALL_TRANSCRIPTS_TABLE}
         (transcript_id, account_id, caller_number, normalized_phone, call_started_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (transcript_id) DO UPDATE SET
         caller_number = EXCLUDED.caller_number,
         normalized_phone = EXCLUDED.normalized_phone,
         call_started_at = EXCLUDED.call_started_at,
         payload = EXCLUDED.payload,
         updated_at = NOW()
       RETURNING id, contact_id, note_id, match_status`,
      [transcriptId, accountId, callerNumber, normalizedPhone, startedAt, JSON.stringify(payload)]
    );
    const tracked = rows[0];

    if (tracked.note_id) {
      await client.query('COMMIT');
      return {
        ok: true,
        duplicate: true,
        transcript_id: transcriptId,
        match_status: tracked.match_status,
        contact_id: tracked.contact_id,
        note_id: tracked.note_id,
      };
    }

    const { contacts } = await findContactsByPhone(client, accountId, phoneForMatching);
    if (contacts.length !== 1) {
      const matchStatus = contacts.length > 1 ? 'ambiguous' : 'unmatched';
      await client.query(
        `UPDATE ${CALL_TRANSCRIPTS_TABLE}
            SET contact_id = NULL, note_id = NULL, match_status = $2, match_count = $3,
                processed_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [tracked.id, matchStatus, contacts.length]
      );
      await client.query('COMMIT');
      return {
        ok: true,
        duplicate: false,
        transcript_id: transcriptId,
        match_status: matchStatus,
        match_count: contacts.length,
      };
    }

    const contact = contacts[0];
    const noteContent = buildContactNote(payload);
    const noteResult = await client.query(
      `INSERT INTO notes (content, account_id, contact_id, user_id, created_at, updated_at)
       VALUES ($1, $2, $3, NULL, timezone('UTC', NOW()), timezone('UTC', NOW()))
       RETURNING id`,
      [noteContent, accountId, contact.id]
    );
    const noteId = noteResult.rows[0].id;

    await client.query(
      `UPDATE ${CALL_TRANSCRIPTS_TABLE}
          SET contact_id = $2, note_id = $3, match_status = 'matched', match_count = 1,
              processed_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [tracked.id, contact.id, noteId]
    );
    await client.query('COMMIT');
    return {
      ok: true,
      duplicate: false,
      transcript_id: transcriptId,
      match_status: 'matched',
      contact_id: contact.id,
      contact_name: contact.name,
      note_id: noteId,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const safeTokenEquals = (provided, expected) => {
  const left = Buffer.from(String(provided || ''), 'utf8');
  const right = Buffer.from(String(expected || ''), 'utf8');
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
};

const extractWebhookToken = (req) => {
  const authorization = String(req.get('authorization') || '');
  if (/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, '').trim();
  return String(req.get('x-webhook-token') || '').trim();
};

const registerCallTranscriptRoutes = (app, { pool, accountId, webhookToken }) => {
  app.post('/api/call-transcripts', async (req, res) => {
    if (!webhookToken) {
      return res.status(503).json({ error: 'Integração de transcrições não configurada.' });
    }
    if (!safeTokenEquals(extractWebhookToken(req), webhookToken)) {
      return res.status(401).json({ error: 'Token inválido.' });
    }
    try {
      const result = await ingestCallTranscript(pool, { accountId, payload: req.body });
      return res.status(result.duplicate ? 200 : 201).json(result);
    } catch (error) {
      console.error('[call-transcripts] ingest failed:', error.message);
      return res.status(error.statusCode || 500).json({
        error: error.statusCode ? error.message : 'Falha ao registrar a transcrição.',
      });
    }
  });
};

module.exports = {
  CALL_TRANSCRIPTS_TABLE,
  normalizeNationalPhone,
  phoneMatchCandidates,
  buildContactNote,
  validateTranscriptPayload,
  createCallTranscriptsTable,
  ingestCallTranscript,
  registerCallTranscriptRoutes,
};
