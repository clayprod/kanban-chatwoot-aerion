const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const cron = require('node-cron');
const fs = require('fs/promises');
const path = require('path');

require('dotenv').config();

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3001;

app.use(cors());
app.use(express.json());

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
        COALESCE(SUM(value_num), 0) AS total_value,
        COALESCE(AVG(value_num), 0) AS avg_value
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
        COALESCE(SUM(value_num), 0) AS total_value
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
          ${valueNumExpr()} AS value_num
        FROM contacts
      )
      SELECT
        t.name AS label,
        l.color AS color,
        COUNT(DISTINCT b.id)::int AS count,
        COALESCE(SUM(b.value_num), 0) AS total_value
      FROM base b
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
      SELECT
        custom_attributes->>'Estado' AS state,
        COUNT(*)::int AS count,
        COALESCE(SUM(${valueNumExpr()}), 0) AS total_value
      FROM contacts
      WHERE custom_attributes->>'Estado' IS NOT NULL
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
      SELECT
        custom_attributes->>'Probabilidade_Fechamento' AS probability,
        COALESCE(SUM(${valueNumExpr()}), 0) AS total_value
      FROM contacts
      WHERE custom_attributes->>'Probabilidade_Fechamento' IS NOT NULL
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
        COALESCE(SUM(value_num), 0) AS total_value
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
