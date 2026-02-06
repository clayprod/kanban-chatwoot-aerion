const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const cron = require('node-cron');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

require('dotenv').config();

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3001;

app.use(cors());
app.use(express.json());

const AUTH_EMAIL = process.env.AUTH_EMAIL;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET;
const parsedAuthTtl = Number.parseInt(process.env.AUTH_TOKEN_TTL || '86400', 10);
const AUTH_TOKEN_TTL = Number.isFinite(parsedAuthTtl) ? parsedAuthTtl : 86400;
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'aerion_auth';
const AUTH_PUBLIC_PATHS = new Set(['/auth/login', '/auth/logout', '/auth/status']);

const isAuthConfigured = () => Boolean(AUTH_EMAIL && AUTH_PASSWORD && AUTH_TOKEN_SECRET);

const base64UrlEncode = (value) => {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
};

const base64UrlDecode = (value) => {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
};

const safeCompare = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
};

const signAuthToken = (payload) => {
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', AUTH_TOKEN_SECRET).update(payloadPart).digest('base64');
  const signaturePart = signature.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${payloadPart}.${signaturePart}`;
};

const verifyAuthToken = (token) => {
  if (!token || !AUTH_TOKEN_SECRET) {
    return null;
  }
  const [payloadPart, signaturePart] = token.split('.');
  if (!payloadPart || !signaturePart) {
    return null;
  }
  const expectedSignature = crypto.createHmac('sha256', AUTH_TOKEN_SECRET).update(payloadPart).digest('base64');
  const expectedPart = expectedSignature.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (!safeCompare(signaturePart, expectedPart)) {
    return null;
  }
  try {
    const payload = JSON.parse(base64UrlDecode(payloadPart));
    const now = Math.floor(Date.now() / 1000);
    if (!payload || typeof payload.exp !== 'number' || payload.exp <= now) {
      return null;
    }
    return payload;
  } catch (error) {
    return null;
  }
};

const getCookieValue = (req, name) => {
  const cookieHeader = req.headers?.cookie;
  if (!cookieHeader) {
    return null;
  }
  const parts = cookieHeader.split(';').map(part => part.trim()).filter(Boolean);
  const match = parts.find(part => part.startsWith(`${name}=`));
  if (!match) {
    return null;
  }
  return decodeURIComponent(match.slice(name.length + 1));
};

const authCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: Math.max(1, AUTH_TOKEN_TTL) * 1000,
  path: '/',
};

const clearAuthCookie = (res) => {
  res.cookie(AUTH_COOKIE_NAME, '', { ...authCookieOptions, maxAge: 0 });
};

const issueAuthCookie = (res, email) => {
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, AUTH_TOKEN_TTL);
  const token = signAuthToken({ sub: email, exp });
  res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions);
};

app.use('/api', (req, res, next) => {
  if (AUTH_PUBLIC_PATHS.has(req.path)) {
    return next();
  }
  if (!isAuthConfigured()) {
    return res.status(500).json({ error: 'Auth not configured' });
  }
  const token = getCookieValue(req, AUTH_COOKIE_NAME);
  const payload = token ? verifyAuthToken(token) : null;
  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.auth = payload;
  return next();
});

app.post('/api/auth/login', (req, res) => {
  if (!isAuthConfigured()) {
    return res.status(500).json({ error: 'Auth not configured' });
  }
  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  const emailMatches = safeCompare(email.toLowerCase(), AUTH_EMAIL.toLowerCase());
  const passwordMatches = safeCompare(password, AUTH_PASSWORD);
  if (!emailMatches || !passwordMatches) {
    return res.status(401).json({ error: 'Credenciais invalidas.' });
  }
  issueAuthCookie(res, AUTH_EMAIL);
  return res.json({ authenticated: true, email: AUTH_EMAIL });
});

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ authenticated: false });
});

app.get('/api/auth/status', (req, res) => {
  if (!isAuthConfigured()) {
    return res.status(500).json({ authenticated: false, error: 'Auth not configured' });
  }
  const token = getCookieValue(req, AUTH_COOKIE_NAME);
  const payload = token ? verifyAuthToken(token) : null;
  if (!payload) {
    return res.json({ authenticated: false });
  }
  return res.json({ authenticated: true, email: payload.sub });
});

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        user: 'postgres',
        host: '10.0.1.11',
        database: 'tenryu',
        password: '36b27c2d33aa50e9a56d',
        port: 5432,
      }
);

const HISTORY_TABLE = 'kanban_stage_history';
let pollingInProgress = false;

const createHistoryTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${HISTORY_TABLE} (
      id SERIAL PRIMARY KEY,
      contact_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      from_stage TEXT,
      to_stage TEXT,
      changed_at TIMESTAMP NOT NULL DEFAULT NOW(),
      source TEXT NOT NULL
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_kanban_history_contact ON ${HISTORY_TABLE} (contact_id, changed_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_kanban_history_changed ON ${HISTORY_TABLE} (changed_at);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_kanban_history_stage ON ${HISTORY_TABLE} (to_stage, changed_at);`);
};

const seedHistorySnapshot = async () => {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM ${HISTORY_TABLE}`);
  if (rows[0]?.count > 0) {
    return;
  }
  await pool.query(`
    INSERT INTO ${HISTORY_TABLE} (contact_id, account_id, from_stage, to_stage, changed_at, source)
    SELECT id, account_id, NULL, custom_attributes->>'Funil_Vendas', NOW(), 'snapshot'
    FROM contacts
    WHERE custom_attributes->>'Funil_Vendas' IS NOT NULL;
  `);
};

const pollStageChanges = async () => {
  if (pollingInProgress) {
    return;
  }
  pollingInProgress = true;
  try {
    const { rows: contacts } = await pool.query(`
      SELECT id, account_id, custom_attributes
      FROM contacts
      WHERE updated_at >= NOW() - INTERVAL '1 hour'
    `);

    if (contacts.length === 0) {
      return;
    }

    const contactIds = contacts.map(contact => contact.id);
    const { rows: lastStages } = await pool.query(
      `SELECT DISTINCT ON (contact_id) contact_id, to_stage FROM ${HISTORY_TABLE} WHERE contact_id = ANY($1) ORDER BY contact_id, changed_at DESC`,
      [contactIds]
    );

    const lastStageMap = new Map(lastStages.map(row => [row.contact_id, row.to_stage]));
    const inserts = [];
    const values = [];
    let index = 1;

    contacts.forEach(contact => {
      const toStage = contact.custom_attributes?.Funil_Vendas || null;
      if (!toStage) {
        return;
      }
      const fromStage = lastStageMap.get(contact.id) || null;
      if (fromStage === toStage) {
        return;
      }
      values.push(contact.id, contact.account_id, fromStage, toStage, 'polling');
      inserts.push(`($${index}, $${index + 1}, $${index + 2}, $${index + 3}, NOW(), $${index + 4})`);
      index += 5;
    });

    if (inserts.length > 0) {
      await pool.query(
        `INSERT INTO ${HISTORY_TABLE} (contact_id, account_id, from_stage, to_stage, changed_at, source) VALUES ${inserts.join(', ')}`,
        values
      );
    }
  } catch (err) {
    console.error('Error polling stage changes:', err);
  } finally {
    pollingInProgress = false;
  }
};

app.get('/api/contacts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT c.id, c.name, c.location, c.custom_attributes, c.additional_attributes, c.account_id, c.additional_attributes->>'company_name' AS company_name, c.company_id, conv.assignee_id AS agent_id, COALESCE(u.display_name, u.name, u.email) AS agent_name, COALESCE(jsonb_agg(DISTINCT jsonb_build_object('name', t.name, 'color', l.color)) FILTER (WHERE t.name IS NOT NULL), '[]'::jsonb) AS labels FROM contacts c LEFT JOIN LATERAL (SELECT assignee_id FROM conversations WHERE contact_id = c.id AND assignee_id IS NOT NULL ORDER BY last_activity_at DESC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC LIMIT 1) conv ON true LEFT JOIN users u ON u.id = conv.assignee_id LEFT JOIN taggings tg ON tg.taggable_type = 'Contact' AND tg.context = 'labels' AND tg.taggable_id = c.id LEFT JOIN tags t ON t.id = tg.tag_id LEFT JOIN labels l ON l.title = t.name AND l.account_id = c.account_id GROUP BY c.id, conv.assignee_id, u.display_name, u.name, u.email"
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching contacts:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/processo', async (req, res) => {
  try {
    const filePath = path.resolve(__dirname, '..', 'Processos-Comerciais-Vendas.md');
    const content = await fs.readFile(filePath, 'utf8');
    res.json({ content });
  } catch (err) {
    console.error('Error reading process file:', err);
    res.status(500).json({ error: 'Erro ao carregar processo.' });
  }
});

const valueExpr = (alias = '') => `NULLIF(regexp_replace(COALESCE(${alias}custom_attributes->>'Valor_Oportunidade',''), '[^0-9,.-]', '', 'g'), '')`;
const valueNumExpr = (alias = '') => `CASE WHEN ${valueExpr(alias)} IS NULL THEN NULL ELSE REPLACE(REPLACE(${valueExpr(alias)}, '.', ''), ',', '.')::numeric END`;

app.get('/api/overview/summary', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      WITH base AS (
        SELECT
          id,
          custom_attributes->>'Funil_Vendas' AS stage,
          ${valueNumExpr()} AS value_num
        FROM contacts
      ), parsed AS (
        SELECT
          id,
          stage,
          value_num,
          NULLIF(TRIM(SPLIT_PART(stage, '.', 1)), '')::int AS stage_num
        FROM base
      )
      SELECT
        COUNT(*) FILTER (WHERE stage_num BETWEEN 1 AND 17) AS leads_count,
        COUNT(*) FILTER (WHERE stage_num BETWEEN 18 AND 26) AS customers_count,
        COALESCE(SUM(value_num) FILTER (WHERE stage_num IS DISTINCT FROM 14), 0) AS total_value,
        COALESCE(AVG(value_num) FILTER (WHERE stage_num IS DISTINCT FROM 14), 0) AS avg_value
      FROM parsed;
    `);
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching overview summary:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/overview/by-stage', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      WITH base AS (
        SELECT
          custom_attributes->>'Funil_Vendas' AS stage,
          ${valueNumExpr()} AS value_num
        FROM contacts
      ), parsed AS (
        SELECT
          stage,
          value_num,
          NULLIF(TRIM(SPLIT_PART(stage, '.', 1)), '')::int AS stage_num
        FROM base
        WHERE stage IS NOT NULL
      )
      SELECT
        stage,
        stage_num,
        COUNT(*)::int AS count,
        COALESCE(SUM(value_num) FILTER (WHERE stage_num IS DISTINCT FROM 14), 0) AS total_value
      FROM parsed
      GROUP BY stage, stage_num
      ORDER BY stage_num;
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching overview by stage:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/overview/by-label', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      WITH base AS (
        SELECT
          id,
          account_id,
          custom_attributes->>'Funil_Vendas' AS stage,
          ${valueNumExpr()} AS value_num
        FROM contacts
      ), parsed AS (
        SELECT
          id,
          account_id,
          value_num,
          NULLIF(TRIM(SPLIT_PART(stage, '.', 1)), '')::int AS stage_num
        FROM base
      )
      SELECT
        t.name AS label,
        l.color AS color,
        COUNT(DISTINCT b.id)::int AS count,
        COALESCE(SUM(b.value_num) FILTER (WHERE b.stage_num IS DISTINCT FROM 14), 0) AS total_value
      FROM parsed b
      JOIN taggings tg ON tg.taggable_type = 'Contact' AND tg.context = 'labels' AND tg.taggable_id = b.id
      JOIN tags t ON t.id = tg.tag_id
      LEFT JOIN labels l ON l.title = t.name AND l.account_id = b.account_id
      GROUP BY t.name, l.color
      ORDER BY count DESC;
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching overview by label:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/overview/by-state', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      WITH base AS (
        SELECT
          custom_attributes->>'Estado' AS state,
          custom_attributes->>'Funil_Vendas' AS stage,
          ${valueNumExpr()} AS value_num
        FROM contacts
      ), parsed AS (
        SELECT
          state,
          value_num,
          NULLIF(TRIM(SPLIT_PART(stage, '.', 1)), '')::int AS stage_num
        FROM base
        WHERE state IS NOT NULL
      )
      SELECT
        state,
        COUNT(*)::int AS count,
        COALESCE(SUM(value_num) FILTER (WHERE stage_num IS DISTINCT FROM 14), 0) AS total_value
      FROM parsed
      GROUP BY state
      ORDER BY count DESC;
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching overview by state:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/overview/by-channel', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        custom_attributes->>'Canal' AS channel,
        COUNT(*)::int AS count
      FROM contacts
      WHERE custom_attributes->>'Canal' IS NOT NULL
      GROUP BY channel
      ORDER BY count DESC;
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching overview by channel:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/overview/by-customer-type', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        custom_attributes->>'Tipo_Cliente' AS customer_type,
        COUNT(*)::int AS count
      FROM contacts
      WHERE custom_attributes->>'Tipo_Cliente' IS NOT NULL
      GROUP BY customer_type
      ORDER BY count DESC;
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching overview by customer type:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/overview/by-probability', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      WITH base AS (
        SELECT
          custom_attributes->>'Probabilidade_Fechamento' AS probability,
          custom_attributes->>'Funil_Vendas' AS stage,
          ${valueNumExpr()} AS value_num
        FROM contacts
      ), parsed AS (
        SELECT
          probability,
          value_num,
          NULLIF(TRIM(SPLIT_PART(stage, '.', 1)), '')::int AS stage_num
        FROM base
        WHERE probability IS NOT NULL
      )
      SELECT
        probability,
        COALESCE(SUM(value_num) FILTER (WHERE stage_num IS DISTINCT FROM 14), 0) AS total_value
      FROM parsed
      GROUP BY probability
      ORDER BY total_value DESC;
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching overview by probability:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/overview/by-agent', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      WITH agent_contacts AS (
        SELECT
          c.id,
          ${valueNumExpr('c.')} AS value_num,
          NULLIF(TRIM(SPLIT_PART(c.custom_attributes->>'Funil_Vendas', '.', 1)), '')::int AS stage_num,
          conv.assignee_id,
          COALESCE(u.display_name, u.name, u.email) AS agent_name
        FROM contacts c
        LEFT JOIN LATERAL (
          SELECT assignee_id
          FROM conversations
          WHERE contact_id = c.id AND assignee_id IS NOT NULL
          ORDER BY last_activity_at DESC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC
          LIMIT 1
        ) conv ON true
        LEFT JOIN users u ON u.id = conv.assignee_id
      )
      SELECT
        COALESCE(agent_name, 'Sem agente') AS agent,
        assignee_id AS agent_id,
        COUNT(*)::int AS count,
        COALESCE(SUM(value_num) FILTER (WHERE stage_num IS DISTINCT FROM 14), 0) AS total_value
      FROM agent_contacts
      GROUP BY agent, agent_id
      ORDER BY count DESC;
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching overview by agent:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/overview/history', async (req, res) => {
  const granularity = ['day', 'week', 'month'].includes(req.query.granularity)
    ? req.query.granularity
    : 'week';
  const defaultRange = granularity === 'day' ? 30 : granularity === 'month' ? 12 : 12;
  const range = Number(req.query.range) || defaultRange;

  try {
    const { rows } = await pool.query(
      `
        SELECT
          DATE_TRUNC($1, changed_at)::date AS period_start,
          to_stage AS stage,
          COUNT(*)::int AS count
        FROM ${HISTORY_TABLE}
        WHERE changed_at >= NOW() - (($2::text || ' ' || $1)::interval)
          AND to_stage IS NOT NULL
        GROUP BY period_start, stage
        ORDER BY period_start, stage;
      `,
      [granularity, range]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching overview history:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/contacts/:id', async (req, res) => {
    const { id } = req.params;
    const { Funil_Vendas } = req.body;

    try {
        const { rows } = await pool.query(
            'SELECT custom_attributes, account_id FROM contacts WHERE id = $1',
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Contact not found' });
        }

        const previousStage = rows[0].custom_attributes?.Funil_Vendas || null;
        const newCustomAttributes = { ...rows[0].custom_attributes, Funil_Vendas };

        await pool.query(
            'UPDATE contacts SET custom_attributes = $1 WHERE id = $2',
            [newCustomAttributes, id]
        );

        if (Funil_Vendas && previousStage !== Funil_Vendas) {
          await pool.query(
            `INSERT INTO ${HISTORY_TABLE} (contact_id, account_id, from_stage, to_stage, changed_at, source)
             VALUES ($1, $2, $3, $4, NOW(), 'kanban')`,
            [id, rows[0].account_id, previousStage, Funil_Vendas]
          );
        }

        res.json({ message: 'Contact updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


const startServer = async () => {
  try {
    await createHistoryTable();
    await seedHistorySnapshot();
    await pollStageChanges();
    cron.schedule('0 * * * *', pollStageChanges);
  } catch (err) {
    console.error('Error initializing history tracking:', err);
  }

  app.listen(port, () => {
    console.log(`Backend server listening at http://localhost:${port}`);
  });
};

startServer();
