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

app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json());

const AUTH_EMAIL = process.env.AUTH_EMAIL;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET;
const parsedAuthTtl = Number.parseInt(process.env.AUTH_TOKEN_TTL || '86400', 10);
const AUTH_TOKEN_TTL = Number.isFinite(parsedAuthTtl) ? parsedAuthTtl : 86400;
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'aerion_auth';
const AUTH_PUBLIC_PATHS = new Set([
  '/auth/login',
  '/auth/logout',
  '/auth/status',
  '/licitacoes/pncp/modalidades',
  '/licitacoes/pncp/modos-disputa',
  '/licitacoes/pncp/tipos-instrumentos',
]);

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
const LICITACAO_TABLE = 'licitacao_opportunities';
const LICITACAO_REQUIREMENTS_TABLE = 'licitacao_requirements';
const LICITACAO_ITEMS_TABLE = 'licitacao_items';
const LICITACAO_ITEM_REQUIREMENTS_TABLE = 'licitacao_item_requirements';
const LICITACAO_CONTACTS_TABLE = 'licitacao_contacts';
const LICITACAO_INTERMEDIARIOS_TABLE = 'licitacao_intermediarios';
const LICITACAO_WATCHLIST_TABLE = 'licitacao_watchlist';
const LICITACAO_SIGNALS_TABLE = 'licitacao_signals';
const LICITACAO_COMMENTS_TABLE = 'licitacao_comments';
const LICITACAO_FASES = [
  '1. Monitoramento de PCA',
  '2. Mapeamento de Áreas',
  '3. Apoio ao ETP / TR',
  '4. Cotação de Preços',
  '5. Gestão de ARPs',
  '6. Monitoramento de Edital',
  '7. Análise Técnica do Edital',
  '8. Impugnação',
  '9. Cadastro e Disputa',
  '10. Recurso',
  '11. Contrarazão',
  '12. Gestão de Contrato/Ata',
  '13. Perdido',
  '14. Não Atendido',
  '15. Descartado',
];
const LICITACAO_FASES_LEGACY_MAP = {
  '2. Mapeamento de Areas': '2. Mapeamento de Áreas',
  '4. Cotacao de Precos': '4. Cotação de Preços',
  '5. Gestao de ARPs': '5. Gestão de ARPs',
  '7. Cadastro e Disputa': '9. Cadastro e Disputa',
  '8. Cadastro e Disputa': '9. Cadastro e Disputa',
  '8. Gestão de Contrato/Ata': '12. Gestão de Contrato/Ata',
  '8. Gestao de Contrato/Ata': '12. Gestão de Contrato/Ata',
  '9. Gestão de Contrato/Ata': '12. Gestão de Contrato/Ata',
  '9. Gestao de Contrato/Ata': '12. Gestão de Contrato/Ata',
  '9. Perdido': '13. Perdido',
  '10. Perdido': '13. Perdido',
  '10. Não Atendido': '14. Não Atendido',
  '10. Nao Atendido': '14. Não Atendido',
  '11. Não Atendido': '14. Não Atendido',
  '11. Nao Atendido': '14. Não Atendido',
  '12. Descartado': '15. Descartado',
};

const migrateLicitacaoFases = async () => {
  const migrations = [
    ['7. Cadastro e Disputa', '9. Cadastro e Disputa'],
    ['8. Cadastro e Disputa', '9. Cadastro e Disputa'],
    ['8. Gestão de Contrato/Ata', '12. Gestão de Contrato/Ata'],
    ['8. Gestao de Contrato/Ata', '12. Gestão de Contrato/Ata'],
    ['9. Gestão de Contrato/Ata', '12. Gestão de Contrato/Ata'],
    ['9. Gestao de Contrato/Ata', '12. Gestão de Contrato/Ata'],
    ['9. Perdido', '13. Perdido'],
    ['10. Perdido', '13. Perdido'],
    ['10. Não Atendido', '14. Não Atendido'],
    ['10. Nao Atendido', '14. Não Atendido'],
    ['11. Não Atendido', '14. Não Atendido'],
    ['11. Nao Atendido', '14. Não Atendido'],
    ['12. Descartado', '15. Descartado'],
  ];
  for (const [from, to] of migrations) {
    await pool.query(
      `UPDATE ${LICITACAO_TABLE} SET fase = $1, updated_at = NOW() WHERE fase = $2`,
      [to, from]
    );
  }
};

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

const createLicitacaoTables = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${LICITACAO_INTERMEDIARIOS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      account_id INTEGER NOT NULL,
      razao_social TEXT NOT NULL,
      cnpj TEXT,
      contato_nome TEXT,
      email TEXT,
      telefone TEXT,
      tipo_parceria TEXT,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${LICITACAO_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      account_id INTEGER NOT NULL,
      titulo TEXT NOT NULL,
      fase TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ativo',
      origem_oportunidade TEXT NOT NULL DEFAULT 'direta',
      orgao_nome TEXT,
      orgao_codigo TEXT,
      uasg_codigo TEXT,
      uasg_nome TEXT,
      modalidade TEXT,
      numero_edital TEXT,
      numero_processo_sei TEXT,
      numero_compra TEXT,
      item_tipo TEXT,
      codigo_item_catalogo TEXT,
      palavras_chave TEXT[],
      valor_oportunidade NUMERIC(14,2),
      data_publicacao DATE,
      data_sessao TIMESTAMP,
      data_limite_envio TIMESTAMP,
      data_impugnacao_limite TIMESTAMP,
      data_esclarecimento_limite TIMESTAMP,
      data_envio_proposta_limite TIMESTAMP,
      data_envio_habilitacao_limite TIMESTAMP,
      data_recurso_limite TIMESTAMP,
      data_contrarrazao_limite TIMESTAMP,
      data_assinatura_ata_limite TIMESTAMP,
      data_empenho_prevista TIMESTAMP,
      data_entrega_limite TIMESTAMP,
      prazo_entrega_dias_apos_assinatura INTEGER,
      links JSONB NOT NULL DEFAULT '{}'::jsonb,
      metadados JSONB NOT NULL DEFAULT '{}'::jsonb,
      owner_user_id INTEGER,
      intermediario_id BIGINT REFERENCES ${LICITACAO_INTERMEDIARIOS_TABLE}(id) ON DELETE SET NULL,
      modelo_intermediacao TEXT,
      comissao_percentual NUMERIC(7,4),
      comissao_valor_previsto NUMERIC(14,2),
      comissao_valor_real NUMERIC(14,2),
      status_comissao TEXT,
      valor_revenda_previsto NUMERIC(14,2),
      valor_revenda_real NUMERIC(14,2),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${LICITACAO_REQUIREMENTS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      opportunity_id BIGINT NOT NULL REFERENCES ${LICITACAO_TABLE}(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL,
      titulo TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'verificar',
      observacao TEXT,
      custo_previsto NUMERIC(14,2),
      custo_real NUMERIC(14,2),
      ordem INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${LICITACAO_ITEMS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      opportunity_id BIGINT NOT NULL REFERENCES ${LICITACAO_TABLE}(id) ON DELETE CASCADE,
      numero_item TEXT,
      descricao TEXT NOT NULL,
      modelo_produto TEXT,
      quantidade NUMERIC(14,3),
      unidade TEXT,
      custo_total_item NUMERIC(14,2),
      valor_referencia NUMERIC(14,2),
      valor_proposta NUMERIC(14,2),
      prazo_entrega_dias INTEGER,
      status_participacao TEXT NOT NULL DEFAULT 'avaliando',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE ${LICITACAO_TABLE} ADD COLUMN IF NOT EXISTS prazo_entrega_dias_apos_assinatura INTEGER;`);
  await pool.query(`ALTER TABLE ${LICITACAO_TABLE} ADD COLUMN IF NOT EXISTS orgao_cnpj TEXT;`);
  await pool.query(`ALTER TABLE ${LICITACAO_ITEMS_TABLE} ADD COLUMN IF NOT EXISTS prazo_entrega_dias INTEGER;`);
  await pool.query(`ALTER TABLE ${LICITACAO_ITEMS_TABLE} ADD COLUMN IF NOT EXISTS modelo_produto TEXT;`);
  await pool.query(`ALTER TABLE ${LICITACAO_ITEMS_TABLE} ADD COLUMN IF NOT EXISTS custo_total_item NUMERIC(14,2);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${LICITACAO_ITEM_REQUIREMENTS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      item_id BIGINT NOT NULL REFERENCES ${LICITACAO_ITEMS_TABLE}(id) ON DELETE CASCADE,
      requisito TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'verificar',
      observacao TEXT,
      valor_referencia NUMERIC(14,2),
      valor_ofertado NUMERIC(14,2),
      ordem INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${LICITACAO_CONTACTS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      opportunity_id BIGINT NOT NULL REFERENCES ${LICITACAO_TABLE}(id) ON DELETE CASCADE,
      contact_id INTEGER NOT NULL,
      papel TEXT,
      principal BOOLEAN NOT NULL DEFAULT FALSE,
      observacao TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(opportunity_id, contact_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${LICITACAO_WATCHLIST_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      account_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      item_tipo TEXT,
      codigo_item_catalogo TEXT,
      palavras_chave TEXT[],
      orgaos JSONB NOT NULL DEFAULT '[]'::jsonb,
      uasgs JSONB NOT NULL DEFAULT '[]'::jsonb,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${LICITACAO_SIGNALS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      account_id INTEGER NOT NULL,
      fonte TEXT NOT NULL,
      chave_externa TEXT NOT NULL,
      payload JSONB NOT NULL,
      score NUMERIC(5,2),
      matched_watchlist_ids BIGINT[],
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(fonte, chave_externa)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${LICITACAO_COMMENTS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      account_id INTEGER NOT NULL,
      opportunity_id BIGINT NOT NULL REFERENCES ${LICITACAO_TABLE}(id) ON DELETE CASCADE,
      author TEXT NOT NULL DEFAULT 'Admin',
      content TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_licitacao_opportunities_account ON ${LICITACAO_TABLE} (account_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_licitacao_opportunities_fase ON ${LICITACAO_TABLE} (fase);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_licitacao_opportunities_status ON ${LICITACAO_TABLE} (status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_licitacao_opportunities_uasg ON ${LICITACAO_TABLE} (uasg_codigo);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_licitacao_opportunities_catalogo ON ${LICITACAO_TABLE} (codigo_item_catalogo);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_licitacao_requirements_opportunity ON ${LICITACAO_REQUIREMENTS_TABLE} (opportunity_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_licitacao_items_opportunity ON ${LICITACAO_ITEMS_TABLE} (opportunity_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_licitacao_item_requirements_item ON ${LICITACAO_ITEM_REQUIREMENTS_TABLE} (item_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_licitacao_contacts_contact ON ${LICITACAO_CONTACTS_TABLE} (contact_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_licitacao_comments_opportunity ON ${LICITACAO_COMMENTS_TABLE} (opportunity_id);`);
};

const getPrazoStatusSql = (alias = '') => `
  CASE
    WHEN ${alias}data_envio_proposta_limite IS NULL THEN 'sem_data'
    WHEN ${alias}data_envio_proposta_limite < NOW() THEN 'atrasado'
    WHEN ${alias}data_envio_proposta_limite <= NOW() + INTERVAL '48 hours' THEN 'vence_48h'
    ELSE 'em_dia'
  END
`;

const asTextArray = (value) => {
  if (Array.isArray(value)) {
    return value.map(item => String(item)).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }
  return [];
};

const asJsonObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
};

const normalizeLicitacaoFase = (fase) => {
  const text = toNullableText(fase);
  if (!text) {
    return null;
  }
  return LICITACAO_FASES_LEGACY_MAP[text] || text;
};

const toNullableNumber = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const toNullableText = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return text.length ? text : null;
};

const createComprasGovUrl = (pathName, query = {}) => {
  const url = new URL(pathName, 'https://dadosabertos.compras.gov.br');
  Object.entries(query).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
};

const fetchComprasGov = async (pathName, query = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(createComprasGovUrl(pathName, query), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Compras.gov error ${response.status}: ${text.slice(0, 300)}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const fetchPncp = async (pathName, query = {}) => {
  const normalizedPath = String(pathName || '').replace(/^\/+/, '');
  const url = new URL(normalizedPath, 'https://pncp.gov.br/api/pncp/');
  Object.entries(query).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`PNCP error ${response.status}: ${text.slice(0, 300)}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
};

// Função para buscar no PNCP via API de busca (editais, contratos, atas)
const fetchPncpSearch = async (query = {}) => {
  const url = new URL('https://pncp.gov.br/api/search/');
  Object.entries(query).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`PNCP Search error ${response.status}: ${text.slice(0, 300)}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
};

// Função para buscar detalhes de uma compra específica no PNCP
const fetchPncpConsulta = async (pathName, query = {}) => {
  const normalizedPath = String(pathName || '').replace(/^\/+/, '');
  const url = new URL(normalizedPath, 'https://pncp.gov.br/api/consulta/');
  Object.entries(query).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`PNCP Consulta error ${response.status}: ${text.slice(0, 300)}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
};

// ============ FUNÇÕES DE IA PARA TERMOS CORRELATOS ============

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_AI_MODEL = process.env.OPENAI_AI_MODEL || 'gpt-4.1-mini';
const GROQ_AI_MODEL = process.env.GROQ_AI_MODEL || 'llama-3.3-70b-versatile';
const AI_RELATIONS_VERSION = 'v2';

// Cache simples para termos correlatos (evita chamadas repetidas)
const termosCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas
const pncpCompraDetalheCache = new Map();
const PNCP_DETALHE_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 horas
const pncpCompraEnrichmentCache = new Map();
const PNCP_ENRICHMENT_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 horas

const removeAcentos = (value = '') => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

const normalizeSearchText = (value = '') => removeAcentos(String(value || '').toLowerCase());

const SEARCH_STOPWORDS = new Set([
  'a', 'ao', 'aos', 'as', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'na', 'nas', 'no', 'nos', 'o', 'os', 'para', 'por', 'um', 'uma', 'uns', 'umas'
]);

const tokenizeSearchTerms = (value = '') => normalizeSearchText(value)
  .replace(/[^a-z0-9\s]/g, ' ')
  .split(/\s+/)
  .filter(token => token && token.length > 2 && !SEARCH_STOPWORDS.has(token));

const HEALTH_CONTEXT_TERMS = [
  'ambulancia', 'uti', 'medic', 'hospital', 'desfibrilador', 'oxigenio', 'monitor multiparametro', 'ventilador', 'socorro', 'emergencia'
];

const GENERIC_BROAD_TERMS = new Set([
  'edital', 'editais', 'licitacao', 'licitacoes', 'contratacao', 'contratacoes', 'aquisicao', 'aquisicoes',
  'compra', 'compras', 'objeto', 'fornecimento', 'servico', 'servicos', 'material', 'materiais', 'item', 'itens'
]);

const OVERBROAD_POSITIVE_TERMS = new Set([
  'mais', 'aparelho', 'aparelhos', 'equipamento', 'equipamentos', 'maquinario', 'maquineta', 'maquinismo',
  'dispositivo', 'dispositivos', 'produto', 'produtos', 'solucao', 'solucoes', 'sistema', 'sistemas', 'veiculo'
]);

const CONTEXT_PROFILES = [
  {
    id: 'monitor_support',
    matchAll: ['suporte', 'monitor'],
    positiveBoost: [
      'ergonomia', 'nr17', 'braco articulado', 'suporte articulado', 'suporte de tela',
      'ajuste de altura', 'estacao de trabalho', 'monitor lcd', 'monitor led', 'fixacao vesa'
    ],
    negativeBoost: [
      'suporte emocional', 'suporte psicologico', 'suporte hospitalar', 'ambulancia',
      'uti movel', 'servico de suporte', 'help desk', 'service desk'
    ],
    negativeMustContainAny: ['emoc', 'psicol', 'hospital', 'uti', 'ambul', 'help', 'service', 'suporte tecnico'],
  },
  {
    id: 'drone',
    matchAny: ['drone', 'uav', 'vant', 'rpa', 'quadricoptero'],
    positiveBoost: [
      'uav', 'vant', 'rpa', 'aeronave remotamente pilotada', 'veiculo aereo nao tripulado',
      'quadricoptero', 'multirrotor', 'drone profissional', 'drone de mapeamento'
    ],
    negativeBoost: [
      'controle de pragas', 'pulverizacao agricola', 'servico de entrega', 'filmagem social',
      'brinquedo', 'drone brinquedo'
    ],
    negativeMustContainAny: ['pulver', 'entrega', 'filmagem', 'brinquedo', 'praga'],
  }
];

const isBroadNonSpecificTerm = (term = '') => {
  const normalized = normalizeSearchText(term).trim();
  return GENERIC_BROAD_TERMS.has(normalized);
};

const parseAiRelationsOutput = (content = '') => {
  const raw = String(content || '').trim();
  if (!raw) {
    return { positivos: [], negativos: [] };
  }

  const withoutFence = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(withoutFence);
    const positivos = Array.isArray(parsed?.positivos) ? parsed.positivos : Array.isArray(parsed?.positive) ? parsed.positive : [];
    const negativos = Array.isArray(parsed?.negativos) ? parsed.negativos : Array.isArray(parsed?.negative) ? parsed.negative : [];
    return { positivos, negativos };
  } catch {
    const lines = withoutFence.split('\n').map(line => line.trim()).filter(Boolean);
    const positivos = [];
    const negativos = [];

    for (const line of lines) {
      if (line.startsWith('+')) {
        positivos.push(line.slice(1).trim());
      } else if (line.startsWith('-')) {
        negativos.push(line.slice(1).trim());
      }
    }

    if (positivos.length || negativos.length) {
      return { positivos, negativos };
    }

      return {
      positivos: withoutFence.split(',').map(item => item.trim()).filter(Boolean),
      negativos: [],
    };
  }
};

const sanitizeAiTerms = (terms = [], { removeGeneric = true } = {}) => {
  const dedup = new Set();
  const cleaned = [];

  for (const raw of terms) {
    const term = String(raw || '').trim();
    if (!term) {
      continue;
    }
    const normalized = normalizeSearchText(term);
    if (!normalized || dedup.has(normalized)) {
      continue;
    }
    if (removeGeneric && isBroadNonSpecificTerm(normalized)) {
      continue;
    }
    if (removeGeneric && OVERBROAD_POSITIVE_TERMS.has(normalized)) {
      continue;
    }
    const words = term.split(/\s+/).filter(Boolean);
    if (words.length > 6 || term.length > 70) {
      continue;
    }
    dedup.add(normalized);
    cleaned.push(term);
  }

  return cleaned;
};

const detectContextProfile = (query = '') => {
  const normalized = normalizeSearchText(query);
  const tokens = tokenizeSearchTerms(normalized);

  for (const profile of CONTEXT_PROFILES) {
    const hasAll = Array.isArray(profile.matchAll)
      ? profile.matchAll.every(term => tokens.includes(term) || normalized.includes(term))
      : true;
    const hasAny = Array.isArray(profile.matchAny)
      ? profile.matchAny.some(term => tokens.includes(term) || normalized.includes(term))
      : true;

    if (hasAll && hasAny) {
      return profile;
    }
  }

  return null;
};

const mergeUniqueTerms = (...groups) => {
  const dedup = new Set();
  const merged = [];

  for (const group of groups) {
    for (const raw of group || []) {
      const term = String(raw || '').trim();
      const normalized = normalizeSearchText(term);
      if (!term || !normalized || dedup.has(normalized)) {
        continue;
      }
      dedup.add(normalized);
      merged.push(term);
    }
  }

  return merged;
};

const getQuerySpecificAllowlist = (query = '') => {
  const q = normalizeSearchText(query);

  if (q.includes('drone')) {
    return ['uav', 'vant', 'rpa', 'quadricoptero', 'multirrotor', 'aeronave remotamente pilotada', 'veiculo aereo nao tripulado'];
  }

  if (q.includes('suporte') && q.includes('monitor')) {
    return ['ergonomia', 'nr17', 'suporte articulado', 'braco articulado', 'suporte de tela', 'material de escritorio'];
  }

  return [];
};

const buildFallbackNegativeTerms = (query = '') => {
  const normalizedQuery = normalizeSearchText(query);
  const negatives = [];

  if (normalizedQuery.includes('suporte') && normalizedQuery.includes('monitor')) {
    negatives.push('suporte hospitalar', 'suporte emocional', 'servico de suporte', 'ambulancia', 'uti movel');
  }

  if (normalizedQuery.includes('drone')) {
    negatives.push('servico de entrega', 'servico de limpeza', 'suporte tecnico geral');
  }

  return negatives;
};

const containsAnyTerm = (text, terms = []) => terms.some(term => text.includes(term));

const isSpecificNoticeIdentifierQuery = (query = '') => {
  const text = String(query || '').trim().toLowerCase();
  if (!text) {
    return false;
  }

  // Ex.: "Edital nº 8.2026-012/2026", "90005/2026", códigos com barras/pontos/hífens
  const hasIdentifierPattern = /\d+[.\-/]\d+/.test(text) || /\d{4,}/.test(text);
  const hasEditalWord = /\b(edital|pregao|concorrencia|dispensa|inexigibilidade)\b/.test(text);
  const mostlyCodeLike = text.replace(/[^a-z0-9]/g, '').length >= 8 && /\d/.test(text) && text.split(/\s+/).length <= 5;

  return hasIdentifierPattern || (hasEditalWord && /\d/.test(text)) || mostlyCodeLike;
};

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const containsTermStrict = (text, term) => {
  const normalizedText = normalizeSearchText(text);
  const normalizedTerm = normalizeSearchText(term).trim();
  if (!normalizedText || !normalizedTerm) {
    return false;
  }

  const phraseRegex = new RegExp(`(^|[^a-z0-9])${escapeRegex(normalizedTerm).replace(/\s+/g, '\\s+')}([^a-z0-9]|$)`);
  return phraseRegex.test(normalizedText);
};

const mapWithConcurrency = async (items, limit, mapper) => {
  const safeLimit = Math.max(1, Number(limit) || 1);
  const results = new Array(items.length);
  let currentIndex = 0;

  const workers = Array.from({ length: Math.min(safeLimit, items.length) }, async () => {
    while (true) {
      const index = currentIndex;
      currentIndex += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
};

const isPncpItemRelevantToQuery = (item, query) => {
  const tokens = tokenizeSearchTerms(query);
  if (tokens.length < 2) {
    return true;
  }

  const text = normalizeSearchText(`${item?.title || item?.titulo || ''} ${item?.description || item?.descricao || ''} ${item?.itens_resumo_texto || item?.__itens_resumo_texto || ''}`);
  const textTokens = new Set(tokenizeSearchTerms(text));
  const exactQuery = normalizeSearchText(query).trim();
  const queryHasHealthContext = containsAnyTerm(normalizeSearchText(query), HEALTH_CONTEXT_TERMS);
  const itemHasHealthContext = containsAnyTerm(text, HEALTH_CONTEXT_TERMS);

  let score = 0;
  if (exactQuery && containsTermStrict(text, exactQuery)) {
    score += 5;
  }

  const matchedCount = tokens.filter(token => textTokens.has(token)).length;
  score += matchedCount * 2;

  if (tokens.length >= 2) {
    const [a, b] = tokens;
    const nearRegex = new RegExp(`${a}(?:\\W+\\w+){0,2}\\W+${b}|${b}(?:\\W+\\w+){0,2}\\W+${a}`);
    if (nearRegex.test(text)) {
      score += 3;
    }
  }

  if (!queryHasHealthContext && itemHasHealthContext) {
    score -= 1;
  }

  return score >= 2;
};

const normalizePncpItemUrl = (itemUrl) => {
  if (!itemUrl) {
    return null;
  }

  const trimmed = String(itemUrl).trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.pathname.startsWith('/app/editais/')) {
        return parsed.toString();
      }
      if (parsed.pathname.startsWith('/editais/')) {
        parsed.pathname = parsed.pathname.replace('/editais/', '/app/editais/');
        return parsed.toString();
      }
      if (parsed.pathname.startsWith('/compras/')) {
        parsed.pathname = parsed.pathname.replace('/compras/', '/app/editais/');
        return parsed.toString();
      }
      return parsed.toString();
    } catch {
      return trimmed;
    }
  }

  if (trimmed.startsWith('/app/editais/')) {
    return `https://pncp.gov.br${trimmed}`;
  }
  if (trimmed.startsWith('/editais/')) {
    return `https://pncp.gov.br${trimmed.replace('/editais/', '/app/editais/')}`;
  }
  if (trimmed.startsWith('/compras/')) {
    return `https://pncp.gov.br${trimmed.replace('/compras/', '/app/editais/')}`;
  }

  return `https://pncp.gov.br${trimmed.startsWith('/') ? trimmed : `/${trimmed}`}`;
};

const getPncpCompraDetalhe = async (cnpj, ano, sequencial) => {
  if (!cnpj || !ano || !sequencial) {
    return null;
  }

  const cacheKey = `${cnpj}/${ano}/${sequencial}`;
  const cached = pncpCompraDetalheCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < PNCP_DETALHE_CACHE_TTL) {
    return cached.value;
  }

  try {
    const detail = await fetchPncpConsulta(`/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}`);
    const value = {
      modo_disputa_id: detail?.modoDisputaId ? String(detail.modoDisputaId) : null,
      modo_disputa_nome: detail?.modoDisputaNome || null,
      tipo_instrumento_convocatorio_id: detail?.tipoInstrumentoConvocatorioCodigo ? String(detail.tipoInstrumentoConvocatorioCodigo) : null,
      tipo_instrumento_convocatorio_nome: detail?.tipoInstrumentoConvocatorioNome || null,
      valor_total_estimado: Number.isFinite(Number(detail?.valorTotalEstimado)) && Number(detail?.valorTotalEstimado) > 0 ? Number(detail.valorTotalEstimado) : null,
      valor_total_homologado: Number.isFinite(Number(detail?.valorTotalHomologado)) && Number(detail?.valorTotalHomologado) > 0 ? Number(detail.valorTotalHomologado) : null,
    };
    pncpCompraDetalheCache.set(cacheKey, { value, timestamp: Date.now() });
    return value;
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.error(`Erro ao consultar detalhe PNCP (${cacheKey}):`, error.message);
    }
    return null;
  }
};

const fetchPncpCompraItens = async (cnpj, ano, sequencial, options = {}) => {
  const pageSize = Math.max(1, Math.min(200, Number(options.pageSize) || 100));
  const maxPages = Math.max(1, Math.min(20, Number(options.maxPages) || 10));

  const allItems = [];
  let page = 1;

  while (page <= maxPages) {
    const itensData = await fetchPncp(`/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}/itens`, {
      pagina: page,
      tamanhoPagina: pageSize,
    });

    const pageItems = Array.isArray(itensData?.data)
      ? itensData.data
      : Array.isArray(itensData)
        ? itensData
        : [];

    if (pageItems.length === 0) {
      break;
    }

    allItems.push(...pageItems);

    if (pageItems.length < pageSize) {
      break;
    }

    page += 1;
  }

  return allItems;
};

const isPncpCompraItemRelevantToQuery = (item, query) => {
  const tokens = tokenizeSearchTerms(query);
  if (!tokens.length) {
    return false;
  }

  const text = normalizeSearchText([
    item?.descricao,
    item?.informacaoComplementar,
    item?.itemCategoriaNome,
    item?.catalogoCodigoItem,
    item?.ncmNbsDescricao,
    item?.materialOuServicoNome,
  ].filter(Boolean).join(' '));

  if (!text) {
    return false;
  }

  const normalizedQuery = normalizeSearchText(query).trim();
  if (normalizedQuery && containsTermStrict(text, normalizedQuery)) {
    return true;
  }

  const matchedCount = tokens.filter(token => containsTermStrict(text, token)).length;
  if (tokens.length === 1) {
    return matchedCount === 1;
  }

  return matchedCount >= 2;
};

const getPncpCompraEnrichment = async (cnpj, ano, sequencial, query = '') => {
  if (!cnpj || !ano || !sequencial) {
    return null;
  }

  const normalizedQuery = normalizeSearchText(query).trim();
  const cacheKey = `${cnpj}/${ano}/${sequencial}|q:${normalizedQuery}`;
  const cached = pncpCompraEnrichmentCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < PNCP_ENRICHMENT_CACHE_TTL) {
    return cached.value;
  }

  try {
    const detalhe = await getPncpCompraDetalhe(cnpj, ano, sequencial);

    let itensResumoTexto = '';
    let totalItens = 0;
    let valorItensPertinentes = null;
    let itensPertinentes = [];
    try {
      const itens = await fetchPncpCompraItens(cnpj, ano, sequencial, {
        pageSize: normalizedQuery ? 100 : 50,
        maxPages: normalizedQuery ? 15 : 1,
      });
      totalItens = itens.length;
      itensResumoTexto = itens
        .map(item => `${item?.descricao || ''} ${item?.itemCategoriaNome || ''} ${item?.catalogoCodigoItem || ''} ${item?.numeroItem || ''}`.trim())
        .filter(Boolean)
        .slice(0, 20)
        .join(' | ');

      if (normalizedQuery) {
        const pertinentes = itens.filter(item => isPncpCompraItemRelevantToQuery(item, normalizedQuery));
        const totalPertinente = pertinentes.reduce((sum, item) => {
          const value = Number(item?.valorTotal);
          return sum + (Number.isFinite(value) && value > 0 ? value : 0);
        }, 0);

        if (pertinentes.length > 0 && totalPertinente > 0) {
          valorItensPertinentes = Number(totalPertinente.toFixed(2));
          itensPertinentes = pertinentes.slice(0, 30).map(item => ({
            numero_item: item?.numeroItem ?? null,
            descricao: item?.descricao || null,
            quantidade: Number.isFinite(Number(item?.quantidade)) ? Number(item.quantidade) : null,
            unidade: item?.unidadeMedida || null,
            valor_unitario_estimado: Number.isFinite(Number(item?.valorUnitarioEstimado)) ? Number(item.valorUnitarioEstimado) : null,
            valor_total: Number.isFinite(Number(item?.valorTotal)) ? Number(item.valorTotal) : null,
          }));
        }
      }
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.error(`Erro ao consultar itens PNCP (${cacheKey}):`, error.message);
      }
    }

    const value = {
      valor_total_estimado: detalhe?.valor_total_estimado ?? null,
      valor_total_homologado: detalhe?.valor_total_homologado ?? null,
      valor_itens_pertinentes: valorItensPertinentes,
      itens_pertinentes: itensPertinentes,
      itens_pertinentes_count: itensPertinentes.length,
      itens_resumo_texto: itensResumoTexto,
      total_itens: totalItens,
    };

    pncpCompraEnrichmentCache.set(cacheKey, { value, timestamp: Date.now() });
    return value;
  } catch (error) {
    console.error(`Erro no enrichment PNCP (${cacheKey}):`, error.message);
    return null;
  }
};

const normalizeOpportunityLinks = (links) => {
  const normalized = { ...asJsonObject(links) };
  const pncpUrl = normalizePncpItemUrl(normalized.pncp || normalized.links_pncp || null);

  if (pncpUrl) {
    normalized.pncp = pncpUrl;
    if (normalized.links_pncp) {
      normalized.links_pncp = pncpUrl;
    }
  }

  return normalized;
};

const normalizeOpportunityRow = (row) => {
  const links = normalizeOpportunityLinks(row?.links);
  return {
    ...row,
    links,
    links_pncp: normalizePncpItemUrl(row?.links_pncp || links.pncp || null),
  };
};

const generateTermosWithGroq = async (termo) => {
  if (!GROQ_API_KEY) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_AI_MODEL,
        messages: [
          {
            role: 'system',
            content: `Você é especialista em busca semântica de licitações.

Objetivo: gerar termos de ALTA PRECISÃO em duas listas:
1) positivos: termos estritamente relacionados ao objeto pesquisado
2) negativos: termos parecidos por palavra, mas de contexto errado

Regras:
- NUNCA inclua termos genéricos: edital, licitação, contratação, aquisição, compra, serviço, fornecimento, material, item.
- NUNCA inclua hipônimos amplos ou vagos: aparelho, equipamento, dispositivo, produto, sistema, maquinário.
- Positivos devem ser sinônimos diretos, variações técnicas, nomes comerciais usuais e siglas canônicas (máx 8).
- NÃO use apenas variação lexical rasa da mesma palavra sem ganho semântico.
- Inclua abreviações e siglas relevantes quando existirem.
- Negativos devem ser ambiguidades comuns do mesmo radical/palavra (máx 8).
- Máximo 5 palavras por termo.
- Sem explicações.

Exemplo obrigatório de padrão:
se entrada = "drone"
positivos devem incluir termos como: "uav", "rpa", "vant", "aeronave remotamente pilotada", "quadricoptero".

Responda SOMENTE JSON válido no formato:
{"positivos":["..."],"negativos":["..."]}`
          },
          {
            role: 'user',
            content: termo
          }
        ],
        temperature: 0.2,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error('Groq API error:', response.status);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    return parseAiRelationsOutput(content);
  } catch (error) {
    console.error('Error calling Groq:', error.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const generateTermosWithOpenAI = async (termo) => {
  if (!OPENAI_API_KEY) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_AI_MODEL,
        messages: [
          {
            role: 'system',
            content: `Você é especialista em busca semântica de licitações.

Objetivo: gerar termos de ALTA PRECISÃO em duas listas:
1) positivos: termos estritamente relacionados ao objeto pesquisado
2) negativos: termos parecidos por palavra, mas de contexto errado

Regras:
- NUNCA inclua termos genéricos: edital, licitação, contratação, aquisição, compra, serviço, fornecimento, material, item.
- NUNCA inclua hipônimos amplos ou vagos: aparelho, equipamento, dispositivo, produto, sistema, maquinário.
- Positivos devem ser sinônimos diretos, variações técnicas, nomes comerciais usuais e siglas canônicas (máx 8).
- NÃO use apenas variação lexical rasa da mesma palavra sem ganho semântico.
- Inclua abreviações e siglas relevantes quando existirem.
- Negativos devem ser ambiguidades comuns do mesmo radical/palavra (máx 8).
- Máximo 5 palavras por termo.
- Sem explicações.

Exemplo obrigatório de padrão:
se entrada = "drone"
positivos devem incluir termos como: "uav", "rpa", "vant", "aeronave remotamente pilotada", "quadricoptero".

Responda SOMENTE JSON válido no formato:
{"positivos":["..."],"negativos":["..."]}`
          },
          {
            role: 'user',
            content: termo
          }
        ],
        temperature: 0.2,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error('OpenAI API error:', response.status);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    return parseAiRelationsOutput(content);
  } catch (error) {
    console.error('Error calling OpenAI:', error.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const pickHighPrecisionPositiveTerms = (original, terms = []) => {
  const originalTokens = new Set(tokenizeSearchTerms(original));
  const filtered = [];
  const sanitized = sanitizeAiTerms(terms, { removeGeneric: true });
  const allowlist = getQuerySpecificAllowlist(original).map(term => normalizeSearchText(term));

  const isInAllowlist = (normalized) => allowlist.some(term => normalized === term || normalized.includes(term) || term.includes(normalized));

  for (const term of sanitized) {
    const normalized = normalizeSearchText(term);
    if (!normalized || normalized === normalizeSearchText(original)) {
      continue;
    }

    const termTokens = tokenizeSearchTerms(term);
    const sharedTokens = termTokens.filter(token => originalTokens.has(token)).length;
    const hasHealthShift = containsAnyTerm(normalized, HEALTH_CONTEXT_TERMS)
      && !containsAnyTerm(normalizeSearchText(original), HEALTH_CONTEXT_TERMS);
    if (hasHealthShift) {
      continue;
    }

    const looksBroad = OVERBROAD_POSITIVE_TERMS.has(normalized);
    if (looksBroad) {
      continue;
    }

    const isShortSingleWord = term.split(/\s+/).filter(Boolean).length === 1 && normalized.length <= 6;
    if (originalTokens.size >= 2 && sharedTokens === 0 && !isInAllowlist(normalized) && !normalized.includes('escritorio') && !normalized.includes('ergonom')) {
      continue;
    }

    if (sharedTokens === 0 && isShortSingleWord && !isInAllowlist(normalized)) {
      continue;
    }

    filtered.push(term);
    if (filtered.length >= 8) {
      break;
    }
  }

  if (filtered.length === 0) {
    return sanitized
      .slice(0, 6);
  }

  return filtered;
};

const pickNegativeTerms = (original, terms = []) => {
  const normalizedOriginal = normalizeSearchText(original);
  const sanitized = sanitizeAiTerms(terms, { removeGeneric: false });
  const profile = detectContextProfile(original);
  const negatives = [];

  for (const term of sanitized) {
    const normalized = normalizeSearchText(term);
    if (!normalized || normalized === normalizedOriginal) {
      continue;
    }
    if (isBroadNonSpecificTerm(normalized)) {
      continue;
    }

    if (profile?.negativeMustContainAny?.length) {
      const isGoodNegative = profile.negativeMustContainAny.some(hint => normalized.includes(hint));
      if (!isGoodNegative) {
        continue;
      }
    }

    negatives.push(term);
    if (negatives.length >= 8) {
      break;
    }
  }

  const fallback = sanitizeAiTerms(buildFallbackNegativeTerms(original), { removeGeneric: false });
  for (const term of fallback) {
    if (negatives.length >= 8) {
      break;
    }
    const normalized = normalizeSearchText(term);
    if (!negatives.some(item => normalizeSearchText(item) === normalized)) {
      negatives.push(term);
    }
  }

  return negatives;
};

const buildIntelligentRelations = (original, aiResult) => {
  const profile = detectContextProfile(original);
  const aiPositivos = aiResult?.positivos || [];
  const aiNegativos = aiResult?.negativos || [];

  const positivosRaw = mergeUniqueTerms(
    aiPositivos,
    getQuerySpecificAllowlist(original),
    profile?.positiveBoost || []
  );

  const negativosRaw = mergeUniqueTerms(
    aiNegativos,
    profile?.negativeBoost || [],
    buildFallbackNegativeTerms(original)
  );

  const positivos = pickHighPrecisionPositiveTerms(original, positivosRaw);
  const negativos = pickNegativeTerms(original, negativosRaw);

  return { positivos, negativos };
};

const shouldExcludeByNegativeTerms = (item, query, positiveTerms = [], negativeTerms = []) => {
  if (!negativeTerms.length) {
    return false;
  }

  const text = normalizeSearchText(`${item?.title || item?.titulo || ''} ${item?.description || item?.descricao || ''} ${item?.itens_resumo_texto || item?.__itens_resumo_texto || ''}`);
  const normalizedQuery = normalizeSearchText(query);
  const queryTokens = tokenizeSearchTerms(query);
  const textTokens = new Set(tokenizeSearchTerms(text));

  const hasNegativeMatch = negativeTerms.some(term => {
    return containsTermStrict(text, term);
  });

  if (!hasNegativeMatch) {
    return false;
  }

  const hasExactQuery = normalizedQuery && containsTermStrict(text, normalizedQuery);
  const hasPositiveMatch = positiveTerms.some(term => {
    return containsTermStrict(text, term);
  });
  const tokenMatches = queryTokens.filter(token => textTokens.has(token)).length;

  return !hasExactQuery && !hasPositiveMatch && tokenMatches < Math.min(2, Math.max(1, queryTokens.length));
};

const getTermosCorrelatos = async (termo) => {
  if (!termo || termo.length < 3) {
    return { original: termo, correlatos: [], positivos: [], negativos: [], fonte: null };
  }

  const cacheKey = `${AI_RELATIONS_VERSION}:${termo.toLowerCase().trim()}`;
  const cached = termosCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return {
      original: termo,
      correlatos: cached.positivos || cached.termos || [],
      positivos: cached.positivos || cached.termos || [],
      negativos: cached.negativos || [],
      fonte: `${cached.fonte} (cache)`,
    };
  }

  // Preferir OpenAI (mais inteligente), fallback Groq
  let termos = await generateTermosWithOpenAI(termo);
  let fonte = `OpenAI (${OPENAI_AI_MODEL})`;

  if (!termos || (!termos.positivos?.length && !termos.negativos?.length)) {
    termos = await generateTermosWithGroq(termo);
    fonte = `Groq (${GROQ_AI_MODEL})`;
  }

  if (termos && (termos.positivos?.length || termos.negativos?.length)) {
    const { positivos, negativos } = buildIntelligentRelations(termo, termos);
    termosCache.set(cacheKey, { termos: positivos, positivos, negativos, fonte, timestamp: Date.now() });
    return { original: termo, correlatos: positivos, positivos, negativos, fonte };
  }

  const fallbackRelations = buildIntelligentRelations(termo, { positivos: [], negativos: [] });
  return {
    original: termo,
    correlatos: fallbackRelations.positivos,
    positivos: fallbackRelations.positivos,
    negativos: fallbackRelations.negativos,
    fonte: null,
  };
};

// Endpoint para obter termos correlatos
app.get('/api/licitacoes/termos-correlatos', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 3) {
      return res.json({ original: q || '', correlatos: [], positivos: [], negativos: [], fonte: null });
    }

    const result = await getTermosCorrelatos(q);
    res.json(result);
  } catch (error) {
    console.error('Error getting termos correlatos:', error);
    res.status(500).json({ error: 'Erro ao buscar termos correlatos', details: error.message });
  }
});

// ============ FIM FUNÇÕES DE IA ============

app.get('/api/contacts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT c.id, c.name, c.location, c.custom_attributes, c.additional_attributes, c.account_id, c.additional_attributes->>'company_name' AS company_name, c.company_id, conv.assignee_id AS agent_id, COALESCE(u.display_name, u.name, u.email) AS agent_name, COALESCE(jsonb_agg(DISTINCT jsonb_build_object('name', t.name, 'color', l.color)) FILTER (WHERE t.name IS NOT NULL), '[]'::jsonb) AS labels FROM contacts c LEFT JOIN LATERAL (SELECT assignee_id FROM conversations WHERE contact_id = c.id AND assignee_id IS NOT NULL ORDER BY last_activity_at DESC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC LIMIT 1) conv ON true LEFT JOIN users u ON u.id = conv.assignee_id LEFT JOIN taggings tg ON tg.taggable_type = 'Contact' AND tg.context = 'labels' AND tg.taggable_id = c.id LEFT JOIN tags t ON t.id = tg.tag_id LEFT JOIN labels l ON l.title = t.name AND l.account_id = c.account_id GROUP BY c.id, conv.assignee_id, u.display_name, u.name, u.email"
    );
    const normalized = rows.map(row => ({
      ...row,
      fase: normalizeLicitacaoFase(row.fase) || row.fase,
    }));
    res.json(normalized);
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
    res.json(rows.map(normalizeOpportunityRow));
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
        WITH periods AS (
          SELECT generate_series(
            DATE_TRUNC($1, NOW()) - (($2::int - 1)::text || ' ' || $1)::interval,
            DATE_TRUNC($1, NOW()),
            ('1 ' || $1)::interval
          ) AS period_start
        ),
        period_contacts AS (
          SELECT c.id AS contact_id,
                 p.period_start,
                 p.period_start + ('1 ' || $1)::interval AS period_end
          FROM contacts c
          CROSS JOIN periods p
        ),
        latest_stage AS (
          SELECT pc.period_start,
                 h.to_stage AS stage
          FROM period_contacts pc
          JOIN LATERAL (
            SELECT to_stage
            FROM ${HISTORY_TABLE} h
            WHERE h.contact_id = pc.contact_id
              AND h.changed_at < pc.period_end
            ORDER BY h.changed_at DESC
            LIMIT 1
          ) h ON true
        )
        SELECT
          period_start::date AS period_start,
          stage,
          COUNT(*)::int AS count
        FROM latest_stage
        WHERE stage IS NOT NULL
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

const getAccountId = (req) => {
  const raw = req.query.account_id ?? req.body?.account_id;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
};

const LICITACAO_STATUS = ['ativo', 'ganho', 'perdido', 'nao_atendido', 'suspenso', 'cancelado', 'fracassado', 'arquivado'];
const LICITACAO_ORIGEM = ['direta', 'intermediario', 'automatica_api'];
const LICITACAO_MODELO_INTERMEDIACAO = ['revenda', 'comissao', 'misto'];
const LICITACAO_STATUS_COMISSAO = ['pendente', 'aprovado', 'pago', 'cancelado'];
const LICITACAO_ITEM_TIPO = ['material', 'servico'];
const LICITACAO_REQUIREMENT_TIPO = ['comercial', 'tecnico'];
const LICITACAO_REQUIREMENT_STATUS = ['ok', 'nao_ok', 'pendente', 'verificar'];

app.get('/api/licitacoes/opportunities', async (req, res) => {
  const accountId = getAccountId(req);
  try {
    const { rows } = await pool.query(
      `
        SELECT
          o.*,
          i.razao_social AS intermediario_razao_social,
          ${getPrazoStatusSql('o.')} AS prazo_status,
          COUNT(r.id)::int AS requirements_count,
          COUNT(lc.id)::int AS linked_contacts_count,
          (
            SELECT COUNT(*)::int
            FROM ${LICITACAO_ITEMS_TABLE} it
            WHERE it.opportunity_id = o.id
          ) AS items_count,
          (
            SELECT COUNT(*)::int
            FROM ${LICITACAO_ITEM_REQUIREMENTS_TABLE} ir
            JOIN ${LICITACAO_ITEMS_TABLE} it ON it.id = ir.item_id
            WHERE it.opportunity_id = o.id
          ) AS technical_requirements_count,
          (
            SELECT COUNT(*)::int
            FROM ${LICITACAO_ITEM_REQUIREMENTS_TABLE} ir
            JOIN ${LICITACAO_ITEMS_TABLE} it ON it.id = ir.item_id
            WHERE it.opportunity_id = o.id AND ir.status <> 'ok'
          ) AS technical_pending_count,
          (
            SELECT COUNT(*)::int
            FROM ${LICITACAO_ITEM_REQUIREMENTS_TABLE} ir
            JOIN ${LICITACAO_ITEMS_TABLE} it ON it.id = ir.item_id
            WHERE it.opportunity_id = o.id AND ir.status = 'nao_ok'
          ) AS technical_non_compliant_count,
          (
            SELECT COUNT(*)::int
            FROM ${LICITACAO_ITEMS_TABLE} it
            WHERE it.opportunity_id = o.id
              AND NOT EXISTS (
                SELECT 1
                FROM ${LICITACAO_ITEM_REQUIREMENTS_TABLE} ir
                WHERE ir.item_id = it.id
              )
          ) AS technical_items_without_checklist_count
        FROM ${LICITACAO_TABLE} o
        LEFT JOIN ${LICITACAO_INTERMEDIARIOS_TABLE} i ON i.id = o.intermediario_id
        LEFT JOIN ${LICITACAO_REQUIREMENTS_TABLE} r ON r.opportunity_id = o.id
        LEFT JOIN ${LICITACAO_CONTACTS_TABLE} lc ON lc.opportunity_id = o.id
        WHERE o.account_id = $1
        GROUP BY o.id, i.razao_social
        ORDER BY o.created_at DESC
      `,
      [accountId]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching licitacao opportunities:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/licitacoes/opportunities', async (req, res) => {
  const accountId = getAccountId(req);
  const body = req.body || {};
  const titulo = String(body.titulo || '').trim();
  const fase = normalizeLicitacaoFase(body.fase || LICITACAO_FASES[0]);

  if (!titulo) {
    return res.status(400).json({ error: 'Titulo e obrigatorio' });
  }
  if (!LICITACAO_FASES.includes(fase)) {
    return res.status(400).json({ error: 'Fase invalida' });
  }

  const status = LICITACAO_STATUS.includes(body.status) ? body.status : 'ativo';
  const origem = LICITACAO_ORIGEM.includes(body.origem_oportunidade) ? body.origem_oportunidade : 'direta';
  const itemTipo = LICITACAO_ITEM_TIPO.includes(body.item_tipo) ? body.item_tipo : null;
  const modeloIntermediacao = LICITACAO_MODELO_INTERMEDIACAO.includes(body.modelo_intermediacao)
    ? body.modelo_intermediacao
    : null;
  const statusComissao = LICITACAO_STATUS_COMISSAO.includes(body.status_comissao)
    ? body.status_comissao
    : null;

  const linkedContacts = Array.isArray(body.linked_contacts)
    ? body.linked_contacts
        .map(item => ({
          contact_id: Number.parseInt(item?.contact_id, 10),
          papel: toNullableText(item?.papel),
          principal: Boolean(item?.principal),
          observacao: toNullableText(item?.observacao),
        }))
        .filter(item => Number.isFinite(item.contact_id))
    : [];
  const normalizedLinks = normalizeOpportunityLinks(body.links);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `
        INSERT INTO ${LICITACAO_TABLE} (
          account_id, titulo, fase, status, origem_oportunidade,
          orgao_nome, orgao_codigo, orgao_cnpj, uasg_codigo, uasg_nome,
          modalidade, numero_edital, numero_processo_sei, numero_compra,
          item_tipo, codigo_item_catalogo, palavras_chave, valor_oportunidade,
          data_publicacao, data_sessao, data_limite_envio,
          data_impugnacao_limite, data_esclarecimento_limite, data_envio_proposta_limite,
          data_envio_habilitacao_limite, data_recurso_limite, data_contrarrazao_limite,
          data_assinatura_ata_limite, data_empenho_prevista, data_entrega_limite, prazo_entrega_dias_apos_assinatura,
          links, metadados, owner_user_id, intermediario_id, modelo_intermediacao,
          comissao_percentual, comissao_valor_previsto, comissao_valor_real,
          status_comissao, valor_revenda_previsto, valor_revenda_real
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14,
          $15, $16, $17, $18,
          $19, $20, $21,
          $22, $23, $24,
          $25, $26, $27,
          $28, $29, $30, $31,
          $32, $33, $34, $35, $36,
          $37, $38, $39,
          $40, $41, $42
        ) RETURNING *
      `,
      [
        accountId, titulo, fase, status, origem,
        body.orgao_nome || null, body.orgao_codigo || null, body.orgao_cnpj || null, body.uasg_codigo || null, body.uasg_nome || null,
        body.modalidade || null, body.numero_edital || null, body.numero_processo_sei || null, body.numero_compra || null,
        itemTipo, body.codigo_item_catalogo || null, asTextArray(body.palavras_chave), toNullableNumber(body.valor_oportunidade),
        body.data_publicacao || null, body.data_sessao || null, body.data_limite_envio || null,
        body.data_impugnacao_limite || null, body.data_esclarecimento_limite || null, body.data_envio_proposta_limite || null,
        body.data_envio_habilitacao_limite || null, body.data_recurso_limite || null, body.data_contrarrazao_limite || null,
        body.data_assinatura_ata_limite || null, body.data_empenho_prevista || null, body.data_entrega_limite || null, toNullableNumber(body.prazo_entrega_dias_apos_assinatura),
        normalizedLinks, asJsonObject(body.metadados), toNullableNumber(body.owner_user_id), toNullableNumber(body.intermediario_id), modeloIntermediacao,
        toNullableNumber(body.comissao_percentual), toNullableNumber(body.comissao_valor_previsto), toNullableNumber(body.comissao_valor_real),
        statusComissao, toNullableNumber(body.valor_revenda_previsto), toNullableNumber(body.valor_revenda_real),
      ]
    );

    const created = rows[0];
    if (linkedContacts.length > 0) {
      let hasPrincipal = false;
      for (const item of linkedContacts) {
        const principal = item.principal && !hasPrincipal;
        if (principal) {
          hasPrincipal = true;
        }
        await client.query(
          `
            INSERT INTO ${LICITACAO_CONTACTS_TABLE} (opportunity_id, contact_id, papel, principal, observacao)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (opportunity_id, contact_id)
            DO UPDATE SET papel = EXCLUDED.papel, principal = EXCLUDED.principal, observacao = EXCLUDED.observacao
          `,
          [created.id, item.contact_id, item.papel, principal, item.observacao]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json(normalizeOpportunityRow(created));
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating licitacao opportunity:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

app.put('/api/licitacoes/opportunities/:id', async (req, res) => {
  const accountId = getAccountId(req);
  const { id } = req.params;
  const body = req.body || {};

  try {
    const existing = await pool.query(`SELECT * FROM ${LICITACAO_TABLE} WHERE id = $1 AND account_id = $2`, [id, accountId]);
    if (!existing.rows.length) {
      return res.status(404).json({ error: 'Oportunidade nao encontrada' });
    }
    const current = existing.rows[0];

    const fase = body.fase !== undefined
      ? normalizeLicitacaoFase(body.fase)
      : normalizeLicitacaoFase(current.fase);
    if (!LICITACAO_FASES.includes(fase)) {
      return res.status(400).json({ error: 'Fase invalida' });
    }
    const status = body.status !== undefined ? String(body.status) : current.status;
    if (!LICITACAO_STATUS.includes(status)) {
      return res.status(400).json({ error: 'Status invalido' });
    }

    const origem = body.origem_oportunidade !== undefined ? String(body.origem_oportunidade) : current.origem_oportunidade;
    if (!LICITACAO_ORIGEM.includes(origem)) {
      return res.status(400).json({ error: 'Origem invalida' });
    }

    const itemTipo = body.item_tipo !== undefined ? body.item_tipo : current.item_tipo;
    if (itemTipo && !LICITACAO_ITEM_TIPO.includes(itemTipo)) {
      return res.status(400).json({ error: 'Tipo de item invalido' });
    }

    const modeloIntermediacao = body.modelo_intermediacao !== undefined ? body.modelo_intermediacao : current.modelo_intermediacao;
    if (modeloIntermediacao && !LICITACAO_MODELO_INTERMEDIACAO.includes(modeloIntermediacao)) {
      return res.status(400).json({ error: 'Modelo de intermediacao invalido' });
    }

    const statusComissao = body.status_comissao !== undefined ? body.status_comissao : current.status_comissao;
    if (statusComissao && !LICITACAO_STATUS_COMISSAO.includes(statusComissao)) {
      return res.status(400).json({ error: 'Status de comissao invalido' });
    }

    const nextLinks = body.links !== undefined
      ? normalizeOpportunityLinks(body.links)
      : normalizeOpportunityLinks(current.links);

    const { rows } = await pool.query(
      `
        UPDATE ${LICITACAO_TABLE}
        SET
          titulo = $1,
          fase = $2,
          status = $3,
          origem_oportunidade = $4,
          orgao_nome = $5,
          orgao_codigo = $6,
          uasg_codigo = $7,
          uasg_nome = $8,
          modalidade = $9,
          numero_edital = $10,
          numero_processo_sei = $11,
          numero_compra = $12,
          item_tipo = $13,
          codigo_item_catalogo = $14,
          palavras_chave = $15,
          valor_oportunidade = $16,
          data_publicacao = $17,
          data_sessao = $18,
          data_limite_envio = $19,
          data_impugnacao_limite = $20,
          data_esclarecimento_limite = $21,
          data_envio_proposta_limite = $22,
          data_envio_habilitacao_limite = $23,
          data_recurso_limite = $24,
          data_contrarrazao_limite = $25,
          data_assinatura_ata_limite = $26,
          data_empenho_prevista = $27,
          data_entrega_limite = $28,
          prazo_entrega_dias_apos_assinatura = $29,
          links = $30,
          metadados = $31,
          owner_user_id = $32,
          intermediario_id = $33,
          modelo_intermediacao = $34,
          comissao_percentual = $35,
          comissao_valor_previsto = $36,
          comissao_valor_real = $37,
          status_comissao = $38,
          valor_revenda_previsto = $39,
          valor_revenda_real = $40,
          updated_at = NOW()
        WHERE id = $41 AND account_id = $42
        RETURNING *
      `,
      [
        body.titulo ?? current.titulo,
        fase,
        status,
        origem,
        body.orgao_nome ?? current.orgao_nome,
        body.orgao_codigo ?? current.orgao_codigo,
        body.uasg_codigo ?? current.uasg_codigo,
        body.uasg_nome ?? current.uasg_nome,
        body.modalidade ?? current.modalidade,
        body.numero_edital ?? current.numero_edital,
        body.numero_processo_sei ?? current.numero_processo_sei,
        body.numero_compra ?? current.numero_compra,
        itemTipo,
        body.codigo_item_catalogo ?? current.codigo_item_catalogo,
        body.palavras_chave !== undefined ? asTextArray(body.palavras_chave) : (current.palavras_chave || []),
        body.valor_oportunidade ?? current.valor_oportunidade,
        body.data_publicacao ?? current.data_publicacao,
        body.data_sessao ?? current.data_sessao,
        body.data_limite_envio ?? current.data_limite_envio,
        body.data_impugnacao_limite ?? current.data_impugnacao_limite,
        body.data_esclarecimento_limite ?? current.data_esclarecimento_limite,
        body.data_envio_proposta_limite ?? current.data_envio_proposta_limite,
        body.data_envio_habilitacao_limite ?? current.data_envio_habilitacao_limite,
        body.data_recurso_limite ?? current.data_recurso_limite,
        body.data_contrarrazao_limite ?? current.data_contrarrazao_limite,
        body.data_assinatura_ata_limite ?? current.data_assinatura_ata_limite,
        body.data_empenho_prevista ?? current.data_empenho_prevista,
        body.data_entrega_limite ?? current.data_entrega_limite,
        body.prazo_entrega_dias_apos_assinatura ?? current.prazo_entrega_dias_apos_assinatura,
        nextLinks,
        body.metadados !== undefined ? asJsonObject(body.metadados) : asJsonObject(current.metadados),
        body.owner_user_id ?? current.owner_user_id,
        body.intermediario_id ?? current.intermediario_id,
        modeloIntermediacao,
        body.comissao_percentual ?? current.comissao_percentual,
        body.comissao_valor_previsto ?? current.comissao_valor_previsto,
        body.comissao_valor_real ?? current.comissao_valor_real,
        statusComissao,
        body.valor_revenda_previsto ?? current.valor_revenda_previsto,
        body.valor_revenda_real ?? current.valor_revenda_real,
        id,
        accountId,
      ]
    );

    res.json(normalizeOpportunityRow(rows[0]));
  } catch (error) {
    console.error('Error updating licitacao opportunity:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/licitacoes/opportunities/:id', async (req, res) => {
  const accountId = getAccountId(req);
  const { id } = req.params;
  try {
    await pool.query(`DELETE FROM ${LICITACAO_TABLE} WHERE id = $1 AND account_id = $2`, [id, accountId]);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting licitacao opportunity:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/licitacoes/opportunities/:id/requirements', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM ${LICITACAO_REQUIREMENTS_TABLE} WHERE opportunity_id = $1 ORDER BY ordem ASC, id ASC`,
      [id]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching licitacao requirements:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/licitacoes/opportunities/:id/requirements', async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const tipo = String(body.tipo || '').trim();
  const titulo = String(body.titulo || '').trim();
  const status = body.status ? String(body.status) : 'pendente';

  if (!LICITACAO_REQUIREMENT_TIPO.includes(tipo)) {
    return res.status(400).json({ error: 'Tipo de requisito invalido' });
  }
  if (!LICITACAO_REQUIREMENT_STATUS.includes(status)) {
    return res.status(400).json({ error: 'Status de requisito invalido' });
  }
  if (!titulo) {
    return res.status(400).json({ error: 'Titulo do requisito e obrigatorio' });
  }

  try {
    const { rows } = await pool.query(
      `
        INSERT INTO ${LICITACAO_REQUIREMENTS_TABLE}
        (opportunity_id, tipo, titulo, status, observacao, custo_previsto, custo_real, ordem)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `,
      [id, tipo, titulo, status, body.observacao || null, body.custo_previsto || null, body.custo_real || null, body.ordem || 0]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error creating licitacao requirement:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/licitacoes/opportunities/:id/requirements/:requirementId', async (req, res) => {
  const { id, requirementId } = req.params;
  const body = req.body || {};
  const status = body.status !== undefined ? String(body.status) : undefined;
  const tipo = body.tipo !== undefined ? String(body.tipo) : undefined;

  if (status && !LICITACAO_REQUIREMENT_STATUS.includes(status)) {
    return res.status(400).json({ error: 'Status de requisito invalido' });
  }
  if (tipo && !LICITACAO_REQUIREMENT_TIPO.includes(tipo)) {
    return res.status(400).json({ error: 'Tipo de requisito invalido' });
  }

  try {
    const existing = await pool.query(
      `SELECT * FROM ${LICITACAO_REQUIREMENTS_TABLE} WHERE id = $1 AND opportunity_id = $2`,
      [requirementId, id]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ error: 'Requisito nao encontrado' });
    }
    const current = existing.rows[0];
    const { rows } = await pool.query(
      `
        UPDATE ${LICITACAO_REQUIREMENTS_TABLE}
        SET
          tipo = $1,
          titulo = $2,
          status = $3,
          observacao = $4,
          custo_previsto = $5,
          custo_real = $6,
          ordem = $7,
          updated_at = NOW()
        WHERE id = $8 AND opportunity_id = $9
        RETURNING *
      `,
      [
        tipo || current.tipo,
        body.titulo ?? current.titulo,
        status || current.status,
        body.observacao ?? current.observacao,
        body.custo_previsto ?? current.custo_previsto,
        body.custo_real ?? current.custo_real,
        body.ordem ?? current.ordem,
        requirementId,
        id,
      ]
    );
    res.json(rows[0]);
  } catch (error) {
    console.error('Error updating licitacao requirement:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/licitacoes/opportunities/:id/requirements/:requirementId', async (req, res) => {
  const { id, requirementId } = req.params;
  try {
    await pool.query(`DELETE FROM ${LICITACAO_REQUIREMENTS_TABLE} WHERE id = $1 AND opportunity_id = $2`, [requirementId, id]);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting licitacao requirement:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/licitacoes/opportunities/:id/items', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `
        SELECT
          it.*,
          COALESCE((
            SELECT SUM(COALESCE(ir.valor_ofertado, 0))
            FROM ${LICITACAO_ITEM_REQUIREMENTS_TABLE} ir
            WHERE ir.item_id = it.id
          ), 0) AS custo_acessorio_total
        FROM ${LICITACAO_ITEMS_TABLE} it
        WHERE it.opportunity_id = $1
        ORDER BY it.created_at ASC, it.id ASC
      `,
      [id]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching licitacao items:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/licitacoes/opportunities/:id/items', async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const descricao = toNullableText(body.descricao);
  if (!descricao) {
    return res.status(400).json({ error: 'Descricao do item e obrigatoria' });
  }
  try {
    const { rows } = await pool.query(
      `
        INSERT INTO ${LICITACAO_ITEMS_TABLE}
        (opportunity_id, numero_item, descricao, modelo_produto, quantidade, unidade, custo_total_item, valor_referencia, valor_proposta, prazo_entrega_dias, status_participacao)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `,
      [
        id,
        toNullableText(body.numero_item),
        descricao,
        toNullableText(body.modelo_produto),
        toNullableNumber(body.quantidade),
        toNullableText(body.unidade),
        toNullableNumber(body.custo_total_item) ?? toNullableNumber(body.valor_referencia),
        toNullableNumber(body.valor_referencia),
        toNullableNumber(body.valor_proposta),
        toNullableNumber(body.prazo_entrega_dias),
        toNullableText(body.status_participacao) || 'avaliando',
      ]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error creating licitacao item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/licitacoes/opportunities/:id/items/:itemId', async (req, res) => {
  const { id, itemId } = req.params;
  const body = req.body || {};
  try {
    const existing = await pool.query(
      `SELECT * FROM ${LICITACAO_ITEMS_TABLE} WHERE id = $1 AND opportunity_id = $2`,
      [itemId, id]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ error: 'Item nao encontrado' });
    }
    const current = existing.rows[0];
    const { rows } = await pool.query(
      `
        UPDATE ${LICITACAO_ITEMS_TABLE}
        SET
          numero_item = $1,
          descricao = $2,
          modelo_produto = $3,
          quantidade = $4,
          unidade = $5,
          custo_total_item = $6,
          valor_referencia = $7,
          valor_proposta = $8,
          prazo_entrega_dias = $9,
          status_participacao = $10,
          updated_at = NOW()
        WHERE id = $11 AND opportunity_id = $12
        RETURNING *
      `,
      [
        body.numero_item ?? current.numero_item,
        body.descricao ?? current.descricao,
        body.modelo_produto ?? current.modelo_produto,
        body.quantidade ?? current.quantidade,
        body.unidade ?? current.unidade,
        body.custo_total_item ?? current.custo_total_item,
        body.valor_referencia ?? current.valor_referencia,
        body.valor_proposta ?? current.valor_proposta,
        body.prazo_entrega_dias ?? current.prazo_entrega_dias,
        body.status_participacao ?? current.status_participacao,
        itemId,
        id,
      ]
    );
    res.json(rows[0]);
  } catch (error) {
    console.error('Error updating licitacao item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/licitacoes/opportunities/:id/items/:itemId', async (req, res) => {
  const { id, itemId } = req.params;
  try {
    await pool.query(`DELETE FROM ${LICITACAO_ITEMS_TABLE} WHERE id = $1 AND opportunity_id = $2`, [itemId, id]);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting licitacao item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/licitacoes/opportunities/:id/items/:itemId/requirements', async (req, res) => {
  const { itemId } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM ${LICITACAO_ITEM_REQUIREMENTS_TABLE} WHERE item_id = $1 ORDER BY ordem ASC, id ASC`,
      [itemId]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching item requirements:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/licitacoes/opportunities/:id/items/:itemId/requirements', async (req, res) => {
  const { itemId } = req.params;
  const body = req.body || {};
  const requisito = toNullableText(body.requisito);
  if (!requisito) {
    return res.status(400).json({ error: 'Requisito e obrigatorio' });
  }
  try {
    const { rows } = await pool.query(
      `
        INSERT INTO ${LICITACAO_ITEM_REQUIREMENTS_TABLE}
        (item_id, requisito, status, observacao, valor_referencia, valor_ofertado, ordem)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `,
      [
        itemId,
        requisito,
        toNullableText(body.status) || 'verificar',
        toNullableText(body.observacao),
        toNullableNumber(body.valor_referencia),
        toNullableNumber(body.valor_ofertado),
        toNullableNumber(body.ordem) || 0,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error creating item requirement:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/licitacoes/opportunities/:id/items/:itemId/requirements/:requirementId', async (req, res) => {
  const { itemId, requirementId } = req.params;
  const body = req.body || {};
  try {
    const existing = await pool.query(
      `SELECT * FROM ${LICITACAO_ITEM_REQUIREMENTS_TABLE} WHERE id = $1 AND item_id = $2`,
      [requirementId, itemId]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ error: 'Requisito tecnico nao encontrado' });
    }
    const current = existing.rows[0];
    const { rows } = await pool.query(
      `
        UPDATE ${LICITACAO_ITEM_REQUIREMENTS_TABLE}
        SET
          requisito = $1,
          status = $2,
          observacao = $3,
          valor_referencia = $4,
          valor_ofertado = $5,
          ordem = $6,
          updated_at = NOW()
        WHERE id = $7 AND item_id = $8
        RETURNING *
      `,
      [
        body.requisito ?? current.requisito,
        body.status ?? current.status,
        body.observacao ?? current.observacao,
        body.valor_referencia ?? current.valor_referencia,
        body.valor_ofertado ?? current.valor_ofertado,
        body.ordem ?? current.ordem,
        requirementId,
        itemId,
      ]
    );
    res.json(rows[0]);
  } catch (error) {
    console.error('Error updating item requirement:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/licitacoes/opportunities/:id/items/:itemId/requirements/:requirementId', async (req, res) => {
  const { itemId, requirementId } = req.params;
  try {
    await pool.query(`DELETE FROM ${LICITACAO_ITEM_REQUIREMENTS_TABLE} WHERE id = $1 AND item_id = $2`, [requirementId, itemId]);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting item requirement:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/licitacoes/opportunities/:id/contacts', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `
        SELECT
          lc.*,
          c.name AS contact_name,
          c.additional_attributes->>'company_name' AS company_name,
          c.custom_attributes->>'Cargo' AS cargo,
          c.phone_number,
          c.email
        FROM ${LICITACAO_CONTACTS_TABLE} lc
        LEFT JOIN contacts c ON c.id = lc.contact_id
        WHERE lc.opportunity_id = $1
        ORDER BY lc.principal DESC, lc.id ASC
      `,
      [id]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching licitacao linked contacts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/licitacoes/opportunities/:id/contacts', async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const contactId = Number.parseInt(body.contact_id, 10);
  if (!Number.isFinite(contactId)) {
    return res.status(400).json({ error: 'contact_id invalido' });
  }

  const principal = Boolean(body.principal);
  const papel = body.papel ? String(body.papel) : null;
  const observacao = body.observacao ? String(body.observacao) : null;

  try {
    await pool.query('BEGIN');
    if (principal) {
      await pool.query(
        `UPDATE ${LICITACAO_CONTACTS_TABLE} SET principal = FALSE WHERE opportunity_id = $1`,
        [id]
      );
    }

    const { rows } = await pool.query(
      `
        INSERT INTO ${LICITACAO_CONTACTS_TABLE} (opportunity_id, contact_id, papel, principal, observacao)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (opportunity_id, contact_id)
        DO UPDATE SET papel = EXCLUDED.papel, principal = EXCLUDED.principal, observacao = EXCLUDED.observacao
        RETURNING *
      `,
      [id, contactId, papel, principal, observacao]
    );
    await pool.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error linking contact to licitacao:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/licitacoes/opportunities/:id/contacts/:linkId', async (req, res) => {
  const { id, linkId } = req.params;
  try {
    await pool.query(`DELETE FROM ${LICITACAO_CONTACTS_TABLE} WHERE id = $1 AND opportunity_id = $2`, [linkId, id]);
    res.status(204).send();
  } catch (error) {
    console.error('Error unlinking contact from licitacao:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ COMENTÁRIOS DE OPORTUNIDADES ============

app.get('/api/licitacoes/opportunities/:id/comments', async (req, res) => {
  const { id } = req.params;
  const accountId = getAccountId(req);
  try {
    const { rows } = await pool.query(
      `SELECT * FROM ${LICITACAO_COMMENTS_TABLE} WHERE opportunity_id = $1 AND account_id = $2 ORDER BY created_at DESC`,
      [id, accountId]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/licitacoes/opportunities/:id/comments', async (req, res) => {
  const { id } = req.params;
  const accountId = getAccountId(req);
  const body = req.body || {};
  const content = String(body.content || '').trim();
  if (!content) {
    return res.status(400).json({ error: 'Conteúdo do comentário é obrigatório' });
  }
  try {
    const { rows } = await pool.query(
      `
        INSERT INTO ${LICITACAO_COMMENTS_TABLE}
        (account_id, opportunity_id, author, content)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `,
      [accountId, id, body.author || 'Admin', content]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/licitacoes/opportunities/:id/comments/:commentId', async (req, res) => {
  const { id, commentId } = req.params;
  const accountId = getAccountId(req);
  try {
    await pool.query(
      `DELETE FROM ${LICITACAO_COMMENTS_TABLE} WHERE id = $1 AND opportunity_id = $2 AND account_id = $3`,
      [commentId, id, accountId]
    );
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/licitacoes/intermediarios', async (req, res) => {
  const accountId = getAccountId(req);
  try {
    const { rows } = await pool.query(
      `SELECT * FROM ${LICITACAO_INTERMEDIARIOS_TABLE} WHERE account_id = $1 ORDER BY razao_social ASC`,
      [accountId]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching intermediarios:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/licitacoes/intermediarios', async (req, res) => {
  const accountId = getAccountId(req);
  const body = req.body || {};
  const razaoSocial = String(body.razao_social || '').trim();
  if (!razaoSocial) {
    return res.status(400).json({ error: 'Razao social e obrigatoria' });
  }
  try {
    const { rows } = await pool.query(
      `
        INSERT INTO ${LICITACAO_INTERMEDIARIOS_TABLE}
        (account_id, razao_social, cnpj, contato_nome, email, telefone, tipo_parceria, ativo)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `,
      [
        accountId,
        razaoSocial,
        body.cnpj || null,
        body.contato_nome || null,
        body.email || null,
        body.telefone || null,
        body.tipo_parceria || null,
        body.ativo !== undefined ? Boolean(body.ativo) : true,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error creating intermediario:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/licitacoes/intermediarios/:id', async (req, res) => {
  const accountId = getAccountId(req);
  const { id } = req.params;
  const body = req.body || {};
  try {
    const existing = await pool.query(
      `SELECT * FROM ${LICITACAO_INTERMEDIARIOS_TABLE} WHERE id = $1 AND account_id = $2`,
      [id, accountId]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ error: 'Intermediario nao encontrado' });
    }
    const current = existing.rows[0];
    const { rows } = await pool.query(
      `
        UPDATE ${LICITACAO_INTERMEDIARIOS_TABLE}
        SET
          razao_social = $1,
          cnpj = $2,
          contato_nome = $3,
          email = $4,
          telefone = $5,
          tipo_parceria = $6,
          ativo = $7,
          updated_at = NOW()
        WHERE id = $8 AND account_id = $9
        RETURNING *
      `,
      [
        body.razao_social ?? current.razao_social,
        body.cnpj ?? current.cnpj,
        body.contato_nome ?? current.contato_nome,
        body.email ?? current.email,
        body.telefone ?? current.telefone,
        body.tipo_parceria ?? current.tipo_parceria,
        body.ativo !== undefined ? Boolean(body.ativo) : current.ativo,
        id,
        accountId,
      ]
    );
    res.json(rows[0]);
  } catch (error) {
    console.error('Error updating intermediario:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/licitacoes/watchlist', async (req, res) => {
  const accountId = getAccountId(req);
  try {
    const { rows } = await pool.query(
      `SELECT * FROM ${LICITACAO_WATCHLIST_TABLE} WHERE account_id = $1 ORDER BY created_at DESC`,
      [accountId]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching watchlist:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/licitacoes/watchlist', async (req, res) => {
  const accountId = getAccountId(req);
  const body = req.body || {};
  const nome = String(body.nome || '').trim();
  if (!nome) {
    return res.status(400).json({ error: 'Nome e obrigatorio' });
  }
  try {
    const { rows } = await pool.query(
      `
        INSERT INTO ${LICITACAO_WATCHLIST_TABLE}
        (account_id, nome, item_tipo, codigo_item_catalogo, palavras_chave, orgaos, uasgs, ativo)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
        RETURNING *
      `,
      [
        accountId,
        nome,
        LICITACAO_ITEM_TIPO.includes(body.item_tipo) ? body.item_tipo : null,
        toNullableText(body.codigo_item_catalogo),
        asTextArray(body.palavras_chave),
        JSON.stringify(Array.isArray(body.orgaos) ? body.orgaos : []),
        JSON.stringify(Array.isArray(body.uasgs) ? body.uasgs : []),
        body.ativo !== undefined ? Boolean(body.ativo) : true,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error creating watchlist:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/licitacoes/compras/pgc', async (req, res) => {
  try {
    const data = await fetchComprasGov('/modulo-pgc/1_consultarPgcDetalhe', {
      pagina: req.query.pagina || 1,
      tamanhoPagina: req.query.tamanhoPagina || 25,
      orgao: req.query.orgao,
      anoPcaProjetoCompra: req.query.ano,
      codigoUasg: req.query.codigoUasg,
    });
    res.json(data);
  } catch (error) {
    console.error('Error fetching compras PGC:', error);
    res.status(502).json({ error: 'Erro ao consultar Compras.gov (PGC)' });
  }
});

app.get('/api/licitacoes/pncp/modalidades', async (req, res) => {
  try {
    console.log('[PNCP Modalidades] Buscando modalidades...');
    const data = await fetchPncp('/v1/modalidades', {
      pagina: req.query.pagina || 1,
      tamanhoPagina: req.query.tamanhoPagina || 200,
    });
    console.log('[PNCP Modalidades] Resposta recebida, keys:', Object.keys(data || {}));
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    console.log('[PNCP Modalidades] Lista extraída, tamanho:', list.length);
    const modalidades = list.map(item => ({
      id: item.id || item.codigo || item.modalidadeId,
      nome: item.nome || item.descricao || item.modalidade || String(item.id || ''),
    }));
    console.log('[PNCP Modalidades] Retornando', modalidades.length, 'modalidades');
    res.json(modalidades);
  } catch (error) {
    console.error('[PNCP Modalidades] Error:', error.message);
    res.status(502).json({ error: 'Erro ao consultar modalidades no PNCP' });
  }
});

app.get('/api/licitacoes/pncp/orgaos', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (query.length < 2) {
    return res.json([]);
  }
  try {
    const data = await fetchPncp('/v1/orgaos', {
      razaoSocial: query,
      pagina: req.query.pagina || 1,
    });
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    const normalized = list.map(item => ({
      cnpj: item.cnpj || item.numeroInscricaoUnidade || item.cnpjOrgao,
      nome: item.nome || item.razaoSocial || item.nomeOrgao,
      codigo: item.codigo || item.id || item.codigoOrgao,
    }));
    const lowered = query.toLowerCase();
    const filtered = lowered
      ? normalized.filter(item => `${item.nome || ''} ${item.cnpj || ''}`.toLowerCase().includes(lowered))
      : normalized;
    res.json(filtered.slice(0, 100));
  } catch (error) {
    console.error('Error fetching PNCP orgaos:', error);
    res.status(502).json({ error: 'Erro ao consultar órgãos no PNCP' });
  }
});

app.get('/api/licitacoes/pncp/orgaos/:cnpj/unidades', async (req, res) => {
  try {
    const data = await fetchPncp(`/v1/orgaos/${req.params.cnpj}/unidades`, {
      pagina: req.query.pagina || 1,
      tamanhoPagina: req.query.tamanhoPagina || 100,
    });
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    const normalized = list.map(item => ({
      codigo: String(item.codigoUnidade || item.codigo || item.id || ''),
      nome: item.nomeUnidade || item.nome || item.descricao || 'Unidade',
    }));
    res.json(normalized.slice(0, 200));
  } catch (error) {
    console.error('Error fetching PNCP unidades:', error);
    res.status(502).json({ error: 'Erro ao consultar unidades no PNCP' });
  }
});

app.get('/api/licitacoes/pncp/catalogos', async (req, res) => {
  try {
    const data = await fetchPncp('/v1/catalogos', {
      pagina: req.query.pagina || 1,
      tamanhoPagina: req.query.tamanhoPagina || 100,
    });
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    const options = list.map(item => ({
      codigo: String(item.id || item.codigo || ''),
      descricao: item.nome || item.descricao || 'Catálogo',
    }));
    res.json(options.slice(0, 200));
  } catch (error) {
    console.error('Error fetching PNCP catalogos:', error);
    res.status(502).json({ error: 'Erro ao consultar catálogos no PNCP' });
  }
});

app.get('/api/licitacoes/pncp/orgaos/:cnpj/compras', async (req, res) => {
  try {
    const data = await fetchPncp(`/v1/orgaos/${req.params.cnpj}/compras`, {
      pagina: req.query.pagina || 1,
      tamanhoPagina: req.query.tamanhoPagina || 30,
      dataInicial: req.query.dataInicial,
      dataFinal: req.query.dataFinal,
    });
    res.json(data);
  } catch (error) {
    console.error('Error fetching PNCP compras:', error);
    res.status(502).json({ error: 'Erro ao consultar compras no PNCP' });
  }
});

// ============ PNCP SEARCH ENDPOINTS (Busca de Editais/Contratações) ============

// Função auxiliar para normalizar item da busca PNCP
// A API PNCP pode retornar campos com nomes diferentes dependendo do endpoint
const normalizePncpItem = (item, matchedTermo = null) => ({
  id: item.id,
  titulo: item.title || 'Sem título',
  descricao: item.description || '',
  url: normalizePncpItemUrl(item.item_url),
  numero_controle_pncp: item.numero_controle_pncp,
  numero_sequencial: item.numero_sequencial,
  ano: item.ano,
  orgao: {
    cnpj: item.orgao_cnpj || item.cnpjOrgao || item.orgaoCnpj || '',
    nome: item.orgao_nome || item.nomeOrgao || item.orgaoNome || item.razaoSocialOrgao || '',
    id: item.orgao_id || item.idOrgao || item.orgaoId || '',
  },
  unidade: {
    codigo: item.unidade_codigo || item.codigoUnidade || item.unidadeOrgaoCodigoUnidade || item.unidadeCodigo || '',
    nome: item.unidade_nome || item.nomeUnidade || item.unidadeOrgaoNomeUnidade || item.unidadeNome || '',
    id: item.unidade_id || item.idUnidade || item.unidadeId || '',
  },
  modalidade: {
    id: item.modalidade_licitacao_id,
    nome: item.modalidade_licitacao_nome,
  },
  situacao: {
    id: item.situacao_id,
    nome: item.situacao_nome,
  },
  tipo: {
    id: item.tipo_id,
    nome: item.tipo_nome,
  },
  esfera: {
    id: item.esfera_id,
    nome: item.esfera_nome,
  },
  poder: {
    id: item.poder_id,
    nome: item.poder_nome,
  },
  uf: item.uf,
  municipio: {
    id: item.municipio_id,
    nome: item.municipio_nome,
  },
  data_publicacao: item.data_publicacao_pncp,
  data_atualizacao: item.data_atualizacao_pncp,
  data_inicio_vigencia: item.data_inicio_vigencia,
  data_fim_vigencia: item.data_fim_vigencia,
  valor_global: item.valor_global,
  valor_itens_pertinentes: item.valor_itens_pertinentes ?? null,
  itens_pertinentes_count: item.itens_pertinentes_count ?? null,
  itens_pertinentes: Array.isArray(item.itens_pertinentes) ? item.itens_pertinentes : [],
  valor_total_estimado: item.valor_total_estimado ?? null,
  valor_total_homologado: item.valor_total_homologado ?? null,
  total_itens: item.total_itens ?? null,
  itens_resumo_texto: item.itens_resumo_texto || item.__itens_resumo_texto || '',
  tem_resultado: item.tem_resultado,
  cancelado: item.cancelado,
  modo_disputa: {
    id: item.modo_disputa_id || null,
    nome: item.modo_disputa_nome || null,
  },
  matched_termo: matchedTermo, // Termo que encontrou este resultado
});

// Endpoint principal de busca de editais/contratações no PNCP
app.get('/api/licitacoes/pncp/search', async (req, res) => {
  console.log('[PNCP Search] Request params:', {
    q: req.query.q,
    status: req.query.status,
    unidade_codigo: req.query.unidade_codigo,
    orgao_cnpj: req.query.orgao_cnpj,
  });
  try {
    const {
      q = '',
      tipos_documento = 'edital',
      status = 'recebendo_proposta',
      modalidade_licitacao_id,
      tipo_id,
      modo_disputa_id,
      uf,
      esfera_id,
      orgao_cnpj,
      unidade_codigo,
      pagina = 1,
      tam = 20,
      ordenacao = 'valor_desc_data_desc',
      usar_ia = 'false', // Ativa busca inteligente com termos correlatos
    } = req.query;

    const qText = String(q || '').trim();
    const normalizedStatus = normalizeSearchText(status);
    const mappedStatus = normalizedStatus === 'suspenso' ? 'suspensa' : status;
    const orgaoFilterRaw = String(orgao_cnpj || '').trim();
    const unidadeFilterRaw = String(unidade_codigo || '').trim();
    const orgaoDigits = orgaoFilterRaw.replace(/\D/g, '');
    const unidadeDigitsMatch = unidadeFilterRaw.match(/\d{4,}/);
    const entityQuerySeed = unidadeDigitsMatch?.[0]
      || (orgaoDigits.length >= 8 ? orgaoDigits : '')
      || unidadeFilterRaw
      || orgaoFilterRaw
      || '';

    const baseParams = {
      tipos_documento,
      pagina,
      tam,
    };
    if (mappedStatus && String(mappedStatus) !== 'todos') {
      baseParams.status = mappedStatus;
    }
    if (modalidade_licitacao_id) baseParams.modalidade_licitacao_id = modalidade_licitacao_id;
    if (tipo_id) baseParams.tipo_id = tipo_id;
    if (uf) baseParams.uf = uf;
    if (esfera_id) baseParams.esfera_id = esfera_id;
    // Nota: orgao_cnpj e unidade_codigo não são suportados pela API /api/search/
    // O filtro é aplicado client-side após receber os resultados

    let allItems = [];
    const tamNum = Math.max(1, Math.min(100, Number(tam) || 20));
    const paginaNum = Math.max(1, Number(pagina) || 1);
    let totalItems = 0;
    let termosUsados = [qText || entityQuerySeed || ''];
    let termosNegativos = [];
    let fonteIA = null;
    let iaPositivos = []; // Sinônimos positivos da IA — usados também no filtro local do endpoint de contratações
    const iaForcada = usar_ia === 'true';
    const shouldUseAi = iaForcada && qText && qText.length >= 3 && !isSpecificNoticeIdentifierQuery(qText);

    // Se usar_ia está ativado e há um termo de busca
    if (shouldUseAi) {
      // Buscar termos correlatos com IA
      const termosResult = await getTermosCorrelatos(qText);
      fonteIA = termosResult.fonte;
      termosNegativos = termosResult.negativos || [];
      iaPositivos = (termosResult.positivos || termosResult.correlatos || []).slice(0, 8);

      // Usar até 8 termos correlatos (além do original) para ampliar cobertura
      let termosParaBuscar = [qText, ...iaPositivos];

      // Se há filtro de UASG/órgão, adicionar buscas combinadas para melhorar cobertura
      const hasEntityFilterAI = Boolean(orgaoFilterRaw || unidadeFilterRaw);
      if (hasEntityFilterAI && entityQuerySeed) {
        console.log('[PNCP Search AI] Adding entity-combined searches for:', entityQuerySeed);
        // Adicionar buscas combinadas com o código da entidade
        termosParaBuscar.push(entityQuerySeed);
        termosParaBuscar.push(`${qText} ${entityQuerySeed}`);
        if (/^\d{5,6}$/.test(entityQuerySeed)) {
          termosParaBuscar.push(`UASG ${entityQuerySeed}`);
          termosParaBuscar.push(`${qText} UASG ${entityQuerySeed}`);
        }
      }

      termosUsados = termosParaBuscar;

      const requiredItemsWithBuffer = Math.min(400, Math.max(40, paginaNum * tamNum * 2));
      const maxPagesPerTerm = 8;

      // Fazer buscas em paralelo (cada termo pode precisar de várias páginas)
      const buscasPromises = termosParaBuscar.map(async (termo, index) => {
        try {
          const isOriginalTerm = index === 0;
          const targetForTerm = isOriginalTerm
            ? requiredItemsWithBuffer
            : Math.max(20, Math.ceil(requiredItemsWithBuffer / Math.max(2, termosParaBuscar.length - 1)));

          const collected = [];
          let page = 1;
          let effectivePageSize = 0;

          while (collected.length < targetForTerm && page <= maxPagesPerTerm) {
            const data = await fetchPncpSearch({ ...baseParams, q: termo, pagina: page, tam: tamNum });
            const items = Array.isArray(data?.items) ? data.items : [];
            if (items.length === 0) {
              break;
            }

            if (effectivePageSize === 0) {
              effectivePageSize = items.length;
            }

            collected.push(...items.map(item => ({ ...item, __matched_termo: termo })));

            // Se retornou menos itens que o solicitado, não há mais páginas
            if (items.length < effectivePageSize) {
              break;
            }

            page += 1;
          }

          return collected;
        } catch (err) {
          console.error(`Erro buscando termo "${termo}":`, err.message);
          return [];
        }
      });

      const resultados = await Promise.all(buscasPromises);

      // Combinar resultados, priorizando o termo original
      const seenIds = new Set();
      for (const resultado of resultados) {
        for (const item of resultado) {
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id);
            allItems.push(item);
          }
        }
      }
    } else {
      // Busca tradicional sem IA
      const hasEntityFilter = Boolean(orgaoFilterRaw || unidadeFilterRaw);
      const effectiveSearchTerm = hasEntityFilter
        ? (qText || entityQuerySeed)
        : qText;

      // Função auxiliar para buscar múltiplas páginas
      const fetchMultiplePages = async (searchTerm, maxPages) => {
        const firstData = await fetchPncpSearch({ ...baseParams, q: searchTerm, pagina: 1, tam: tamNum });
        const firstItems = Array.isArray(firstData?.items) ? firstData.items : [];
        const totalFromApi = Number(firstData?.total) || 0;
        const apiPageSize = firstItems.length > 0 ? firstItems.length : 10;
        const collected = [...firstItems.map(item => ({ ...item, __matched_termo: searchTerm }))];
        let page = 2;
        while (page <= maxPages && ((page - 1) * apiPageSize) < totalFromApi) {
          const nextData = await fetchPncpSearch({ ...baseParams, q: searchTerm, pagina: page, tam: tamNum });
          const nextItems = Array.isArray(nextData?.items) ? nextData.items : [];
          if (nextItems.length === 0) break;
          collected.push(...nextItems.map(item => ({ ...item, __matched_termo: searchTerm })));
          if (nextItems.length < apiPageSize) break;
          page += 1;
        }
        return { items: collected, total: totalFromApi };
      };

      if (hasEntityFilter) {
        // Quando há filtro de órgão/UASG, fazemos buscas paralelas:
        // 1. Busca pelo termo principal (se houver)
        // 2. Busca pelo código da entidade (UASG ou CNPJ)
        // 3. Busca combinando termo + código da entidade (para melhorar cobertura)
        // Isso garante que encontramos resultados mesmo que não estejam nas primeiras páginas do termo principal
        const maxPagesPerSearch = 20;
        console.log('[PNCP Search] Entity filter active:', { orgaoFilterRaw, unidadeFilterRaw, entityQuerySeed, qText, status: mappedStatus });

        const searchTerms = [];

        // Busca pelo termo principal
        if (qText) {
          searchTerms.push(qText);
        }

        // Busca pelo código da entidade (UASG tem prioridade)
        if (entityQuerySeed && entityQuerySeed !== qText) {
          searchTerms.push(entityQuerySeed);
        }

        // Busca combinando termo + código da entidade (melhora cobertura)
        if (qText && entityQuerySeed && entityQuerySeed !== qText) {
          searchTerms.push(`${qText} ${entityQuerySeed}`);
        }

        // Se é um código de UASG (6 dígitos), busca também com prefixo UASG
        if (entityQuerySeed && /^\d{5,6}$/.test(entityQuerySeed)) {
          searchTerms.push(`UASG ${entityQuerySeed}`);
          if (qText) {
            searchTerms.push(`${qText} UASG ${entityQuerySeed}`);
          }
        }

        // Se não há nenhum termo, busca só pela entidade
        if (searchTerms.length === 0 && entityQuerySeed) {
          searchTerms.push(entityQuerySeed);
        }

        console.log('[PNCP Search] Search terms to execute:', searchTerms);

        // Executar buscas em paralelo
        const searchPromises = searchTerms.map(term => {
          console.log(`[PNCP Search] Executing search for: "${term}"`);
          return fetchMultiplePages(term, maxPagesPerSearch);
        });
        const results = await Promise.all(searchPromises);

        // Log detalhado dos resultados
        results.forEach((result, index) => {
          const itemsWithTargetUasg = result.items.filter(item =>
            String(item.unidade_codigo || item.codigoUnidade || '').includes(entityQuerySeed)
          );
          console.log(`[PNCP Search] Term "${searchTerms[index]}": ${result.items.length} items, ${itemsWithTargetUasg.length} match UASG ${entityQuerySeed}`);
        });

        // Combinar resultados removendo duplicatas
        const seenIds = new Set();
        const combined = [];
        for (const result of results) {
          console.log(`[PNCP Search] Got ${result.items.length} items from search, total: ${result.total}`);
          if (result.items.length > 0) {
            const sample = result.items[0];
            console.log('[PNCP Search] Sample item keys:', Object.keys(sample).join(', '));
            console.log('[PNCP Search] Sample unidade data:', {
              unidade_codigo: sample.unidade_codigo,
              codigoUnidade: sample.codigoUnidade,
              unidadeOrgaoCodigoUnidade: sample.unidadeOrgaoCodigoUnidade,
              unidade_nome: sample.unidade_nome,
              nomeUnidade: sample.nomeUnidade,
            });
          }
          for (const item of result.items) {
            const itemId = item.id || `${item.orgao_cnpj}-${item.ano}-${item.numero_sequencial}`;
            if (!seenIds.has(itemId)) {
              seenIds.add(itemId);
              combined.push(item);
            }
          }
        }
        console.log(`[PNCP Search] Combined ${combined.length} unique items`);
        allItems = combined;
      } else {
        // Busca simples sem filtro de entidade - paginação direta da API
        const firstData = await fetchPncpSearch({ ...baseParams, q: effectiveSearchTerm, pagina: 1, tam: tamNum });
        const firstItems = Array.isArray(firstData?.items) ? firstData.items : [];
        const totalFromApi = Number(firstData?.total) || 0;
        const apiPageSize = firstItems.length > 0 ? firstItems.length : 10;

        const startOffset = (paginaNum - 1) * tamNum;
        let apiPage = Math.floor(startOffset / apiPageSize) + 1;
        const offsetInFirstPage = startOffset % apiPageSize;
        const fetched = [];

        const pageData = apiPage === 1
          ? firstData
          : await fetchPncpSearch({ ...baseParams, q: effectiveSearchTerm, pagina: apiPage, tam: tamNum });
        const pageItems = Array.isArray(pageData?.items) ? pageData.items : [];
        fetched.push(...pageItems.slice(offsetInFirstPage));

        while (fetched.length < tamNum && (startOffset + fetched.length) < totalFromApi) {
          apiPage += 1;
          const nextData = await fetchPncpSearch({ ...baseParams, q: effectiveSearchTerm, pagina: apiPage, tam: tamNum });
          const nextItems = Array.isArray(nextData?.items) ? nextData.items : [];
          if (nextItems.length === 0) {
            break;
          }
          fetched.push(...nextItems);
          if (nextItems.length < apiPageSize) {
            break;
          }
        }

        allItems = fetched.slice(0, tamNum).map(item => ({ ...item, __matched_termo: effectiveSearchTerm }));
        totalItems = totalFromApi;
      }
    }

    // BUSCA SUPLEMENTAR: quando UASG está ativo, consultar /v1/contratacoes/publicacao
    // que suporta codigoUnidadeOrgao nativamente. A API /api/search/ não indexa UASG
    // como campo filtrável e pode não retornar itens por diferença de terminologia
    // (ex: busca "drone" não encontra "aeronaves remotamente pilotadas").
    if (entityQuerySeed && /^\d{5,6}$/.test(entityQuerySeed)) {
      try {
        const hoje = new Date();
        const doisAnosAtras = new Date(hoje);
        doisAnosAtras.setFullYear(hoje.getFullYear() - 2);
        const seisM = new Date(hoje);
        seisM.setMonth(hoje.getMonth() + 6);
        const fmtDate = (d) => d.toISOString().split('T')[0].replace(/-/g, '');

        const consultaPageSize = 50;
        const maxConsultaPages = 10;
        let consultaPage = 1;
        let consultaHasMore = true;
        const consultaRawItems = [];

        while (consultaHasMore && consultaPage <= maxConsultaPages) {
          const data = await fetchPncp('v1/contratacoes/publicacao', {
            codigoUnidadeOrgao: entityQuerySeed,
            dataInicial: fmtDate(doisAnosAtras),
            dataFinal: fmtDate(seisM),
            pagina: consultaPage,
            tamanhoPagina: consultaPageSize,
          });
          const items = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
          if (items.length === 0) break;
          consultaRawItems.push(...items);
          consultaHasMore = items.length >= consultaPageSize;
          consultaPage++;
        }

        console.log(`[PNCP Contratações UASG ${entityQuerySeed}] ${consultaRawItems.length} itens encontrados`);

        if (consultaRawItems.length > 0) {
          // Termos para filtro local: qText + sinônimos da IA, excluindo termos puramente numéricos
          const textTermsForFilter = [qText, ...iaPositivos].filter(t => t && t.length >= 3 && !/^\d+$/.test(t.trim()));
          // IDs já presentes em allItems para deduplicação
          const seenIdsSet = new Set(allItems.map(it => String(it.id || it.numero_controle_pncp || '')).filter(Boolean));

          let addedCount = 0;
          for (const item of consultaRawItems) {
            const itemId = item.numeroControlePNCP
              || `${item.cnpjOrgao || item.orgaoEntidade?.cnpj || ''}-${item.anoCompra}-${item.sequencialCompra}`;
            if (seenIdsSet.has(itemId)) continue;

            // Filtro de status local (quando status !== 'todos')
            if (mappedStatus && mappedStatus !== 'todos') {
              const statusNorm = normalizeSearchText(mappedStatus.replace(/_/g, ' '));
              const itemStatus = normalizeSearchText(item.situacaoCompraDescricao || '');
              if (!itemStatus.includes(statusNorm)) continue;
            }

            // Filtro de texto local: ao menos um token de qualquer termo deve aparecer no objeto
            if (textTermsForFilter.length > 0) {
              const text = normalizeSearchText(`${item.objetoCompra || ''} ${item.informacaoComplementar || ''}`);
              const matchesText = textTermsForFilter.some(term => {
                const tokens = normalizeSearchText(term).split(/\s+/).filter(t => t.length >= 3);
                return tokens.length > 0 && tokens.some(t => text.includes(t));
              });
              if (!matchesText) continue;
            }

            seenIdsSet.add(itemId);
            addedCount++;
            allItems.push({
              id: itemId,
              title: item.objetoCompra || '',
              description: item.objetoCompra || '',
              item_url: item.linkSistemaOrigem || null,
              numero_controle_pncp: item.numeroControlePNCP,
              numero_sequencial: item.sequencialCompra,
              ano: item.anoCompra,
              orgao_cnpj: item.cnpjOrgao || item.orgaoEntidade?.cnpj || '',
              orgao_nome: item.nomeOrgao || item.orgaoEntidade?.razaoSocial || '',
              unidade_codigo: item.codigoUnidadeOrgao || item.unidadeOrgao?.codigoUnidade || '',
              unidade_nome: item.nomeUnidadeOrgao || item.unidadeOrgao?.nomeUnidade || '',
              modalidade_licitacao_id: item.modalidadeId,
              modalidade_licitacao_nome: item.modalidadeNome,
              situacao_id: item.situacaoCompraId,
              situacao_nome: item.situacaoCompraDescricao,
              data_publicacao_pncp: item.dataPublicacaoPncp,
              data_atualizacao_pncp: item.dataAtualizacaoPncp,
              valor_global: item.valorTotalEstimado,
              valor_total_estimado: item.valorTotalEstimado,
              valor_total_homologado: item.valorTotalHomologado,
              uf: item.unidadeOrgao?.ufSigla || item.ufSigla || '',
              municipio_nome: item.unidadeOrgao?.municipioNome || item.municipioNome || '',
              // Datas de abertura/encerramento de propostas (nomes possíveis no PNCP)
              data_inicio_vigencia: item.dataAberturaPropostas || item.dataInicioPropostas || item.dataInicioVigencia || null,
              data_fim_vigencia: item.dataEncerramentoProposta || item.dataEncerramentoPropostas || item.dataFimPropostas || item.dataFimVigencia || null,
              __matched_termo: qText || entityQuerySeed,
              __from_consulta_uasg: true,
            });
          }

          if (addedCount > 0) {
            console.log(`[PNCP Contratações UASG ${entityQuerySeed}] +${addedCount} itens adicionados. Total: ${allItems.length}`);
          }
        }
      } catch (err) {
        console.error(`[PNCP Contratações UASG] Erro ao buscar UASG ${entityQuerySeed}:`, err.message);
      }
    }

    if (modo_disputa_id) {
      const detailedItems = await Promise.all(allItems.map(async (item) => {
        const detalhe = await getPncpCompraDetalhe(item?.orgao_cnpj, item?.ano, item?.numero_sequencial);
        if (!detalhe) {
          return item;
        }
        return {
          ...item,
          modo_disputa_id: detalhe.modo_disputa_id,
          modo_disputa_nome: detalhe.modo_disputa_nome,
          tipo_id: item?.tipo_id || detalhe.tipo_instrumento_convocatorio_id,
          tipo_nome: item?.tipo_nome || detalhe.tipo_instrumento_convocatorio_nome,
        };
      }));

      allItems = detailedItems.filter(item => String(item?.modo_disputa_id || '') === String(modo_disputa_id));
    }

    const iaRealmenteUsada = shouldUseAi;
    const hasLocalEntityFilter = Boolean(orgaoFilterRaw || unidadeFilterRaw);
    const isValueSort = String(ordenacao || '').startsWith('valor_');
    const precisaEnriquecer = iaRealmenteUsada
      || (isValueSort && allItems.length <= 120 && (!hasLocalEntityFilter || qText.length >= 3));

    if (precisaEnriquecer && allItems.length > 0) {
      const maxEnrichmentItems = hasLocalEntityFilter ? Math.min(20, allItems.length) : Math.min(Math.max(tamNum, 20), allItems.length);
      allItems = await mapWithConcurrency(allItems, hasLocalEntityFilter ? 3 : 5, async (item, index) => {
        if (index >= maxEnrichmentItems) {
          return item;
        }
        const enrichment = await getPncpCompraEnrichment(item?.orgao_cnpj, item?.ano, item?.numero_sequencial, qText);
        if (!enrichment) {
          return item;
        }
        return {
          ...item,
          valor_itens_pertinentes: enrichment.valor_itens_pertinentes ?? item?.valor_itens_pertinentes ?? null,
          itens_pertinentes: enrichment.itens_pertinentes ?? item?.itens_pertinentes ?? [],
          itens_pertinentes_count: enrichment.itens_pertinentes_count ?? item?.itens_pertinentes_count ?? null,
          valor_total_estimado: enrichment.valor_total_estimado ?? item?.valor_total_estimado ?? null,
          valor_total_homologado: enrichment.valor_total_homologado ?? item?.valor_total_homologado ?? null,
          total_itens: enrichment.total_itens ?? item?.total_itens ?? null,
          itens_resumo_texto: enrichment.itens_resumo_texto || item?.itens_resumo_texto || '',
        };
      });
    }

    allItems = allItems
      .filter(item => {
        if (!iaRealmenteUsada) {
          return true;
        }
        const matchedTermo = item?.__matched_termo;
        if (!matchedTermo || matchedTermo === qText) {
          return true;
        }
        const contextOk = isPncpItemRelevantToQuery(item, qText);
        if (!contextOk) {
          return false;
        }

        return !shouldExcludeByNegativeTerms(item, qText, termosUsados.slice(1), termosNegativos);
      })
      .map(item => normalizePncpItem(item, item.__matched_termo || qText || entityQuerySeed));

    const rawOrgaoFilter = String(orgao_cnpj || '').trim();
    const rawUnidadeFilter = String(unidade_codigo || '').trim();
    const normalizedOrgaoDigitsFilter = rawOrgaoFilter.replace(/\D/g, '');
    const normalizedOrgaoTextFilter = normalizeSearchText(rawOrgaoFilter).trim();
    const normalizedUnidadeTextFilter = normalizeSearchText(rawUnidadeFilter).trim();
    // Extrai apenas os dígitos do filtro de unidade para comparação numérica
    const unidadeDigitsFilter = rawUnidadeFilter.replace(/\D/g, '');

    if (normalizedOrgaoTextFilter || normalizedUnidadeTextFilter) {
      console.log(`[PNCP Filter] Before client-side filter: ${allItems.length} items`);
      console.log(`[PNCP Filter] Filtering by orgao: "${normalizedOrgaoTextFilter}", unidade: "${normalizedUnidadeTextFilter}", unidadeDigits: "${unidadeDigitsFilter}"`);
      if (allItems.length > 0) {
        console.log('[PNCP Filter] Sample normalized item:', {
          orgao: allItems[0]?.orgao,
          unidade: allItems[0]?.unidade,
          titulo: allItems[0]?.titulo?.substring(0, 50),
        });
      }
      allItems = allItems.filter(item => {
        const orgaoCnpjItem = String(item?.orgao?.cnpj || '').replace(/\D/g, '');
        const orgaoNomeItem = normalizeSearchText(item?.orgao?.nome || '').trim();
        const unidadeCodigoItem = String(item?.unidade?.codigo || '').trim();
        const unidadeCodigoDigits = unidadeCodigoItem.replace(/\D/g, '');
        const unidadeNomeItem = normalizeSearchText(item?.unidade?.nome || '').trim();

        const matchesOrgao = !normalizedOrgaoTextFilter || (
          (normalizedOrgaoDigitsFilter.length >= 8 && orgaoCnpjItem === normalizedOrgaoDigitsFilter)
          || orgaoNomeItem.includes(normalizedOrgaoTextFilter)
          || (normalizedOrgaoDigitsFilter.length >= 3 && orgaoCnpjItem.includes(normalizedOrgaoDigitsFilter))
        );

        // Comparação mais flexível para código de unidade
        const matchesUnidade = !normalizedUnidadeTextFilter || (
          // Comparação exata de dígitos (ex: 200331 === 200331)
          (unidadeDigitsFilter.length >= 4 && unidadeCodigoDigits === unidadeDigitsFilter)
          // Código contém os dígitos do filtro
          || (unidadeDigitsFilter.length >= 4 && unidadeCodigoDigits.includes(unidadeDigitsFilter))
          // Nome da unidade contém o texto do filtro
          || unidadeNomeItem.includes(normalizedUnidadeTextFilter)
          // Código normalizado contém o filtro
          || normalizeSearchText(unidadeCodigoItem).includes(normalizedUnidadeTextFilter)
        );

        // Debug: log primeiro item que passa ou não passa o filtro
        if (allItems.indexOf(item) < 3) {
          console.log('[PNCP Filter] Item check:', {
            titulo: item?.titulo?.substring(0, 40),
            unidadeCodigo: unidadeCodigoItem,
            unidadeNome: unidadeNomeItem,
            matchesUnidade,
            matchesOrgao,
          });
        }

        return matchesOrgao && matchesUnidade;
      });
      console.log(`[PNCP Filter] After client-side filter: ${allItems.length} items`);
    }

    const getDateSortValue = (item) => new Date(item?.data_publicacao || 0).getTime() || 0;
    const getValueSortValue = (item) => {
      const estimated = Number(item?.valor_total_estimado);
      if (Number.isFinite(estimated) && estimated > 0) {
        return estimated;
      }
      const globalValue = Number(item?.valor_global);
      if (Number.isFinite(globalValue) && globalValue > 0) {
        return globalValue;
      }
      return -1;
    };

    if (ordenacao === 'data_asc') {
      allItems.sort((a, b) => getDateSortValue(a) - getDateSortValue(b));
    } else if (ordenacao === 'valor_asc_data_desc') {
      allItems.sort((a, b) => {
        const byValue = getValueSortValue(a) - getValueSortValue(b);
        if (byValue !== 0) {
          return byValue;
        }
        return getDateSortValue(b) - getDateSortValue(a);
      });
    } else if (ordenacao === 'valor_desc_data_desc' || !ordenacao) {
      allItems.sort((a, b) => {
        const byValue = getValueSortValue(b) - getValueSortValue(a);
        if (byValue !== 0) {
          return byValue;
        }
        return getDateSortValue(b) - getDateSortValue(a);
      });
    } else {
      allItems.sort((a, b) => getDateSortValue(b) - getDateSortValue(a));
    }

    // Paginar resultados combinados (busca IA ou filtros locais por órgão/UASG)
    const hasLocalFilterForPagination = Boolean(normalizedOrgaoTextFilter || normalizedUnidadeTextFilter);
    if (iaRealmenteUsada || hasLocalFilterForPagination) {
      totalItems = allItems.length;
    }
    const startIndex = (paginaNum - 1) * tamNum;
    const paginatedItems = (iaRealmenteUsada || hasLocalFilterForPagination)
      ? allItems.slice(startIndex, startIndex + tamNum)
      : allItems;

    res.json({
      items: paginatedItems,
      total: totalItems,
      pagina: paginaNum,
      tamanhoPagina: tamNum,
      totalPaginas: Math.ceil(totalItems / tamNum) || 1,
      termosUsados: iaRealmenteUsada ? termosUsados : [qText || entityQuerySeed || ''],
      termosNegativos: iaRealmenteUsada ? termosNegativos : [],
      fonteIA: iaRealmenteUsada ? fonteIA : null,
      iaDesativadaPorConsultaEspecifica: iaForcada && !iaRealmenteUsada && isSpecificNoticeIdentifierQuery(qText),
    });
  } catch (error) {
    console.error('Error searching PNCP:', error);
    res.status(502).json({ error: 'Erro ao buscar licitações no PNCP', details: error.message });
  }
});

// Opções de status disponíveis para busca
app.get('/api/licitacoes/pncp/search/status-options', (req, res) => {
  res.json([
    { id: 'recebendo_proposta', nome: 'Recebendo Proposta' },
    { id: 'encerrada', nome: 'Encerrada' },
    { id: 'suspensa', nome: 'Suspensa' },
    { id: 'revogada', nome: 'Revogada' },
    { id: 'anulada', nome: 'Anulada' },
    { id: 'todos', nome: 'Todos' },
  ]);
});

// Opções de tipos de documento disponíveis
app.get('/api/licitacoes/pncp/search/tipos-documento', (req, res) => {
  res.json([
    { id: 'edital', nome: 'Edital' },
    { id: 'ata', nome: 'Ata de Registro de Preços' },
    { id: 'contrato', nome: 'Contrato' },
    { id: 'edital,ata', nome: 'Editais e Atas' },
    { id: 'edital,ata,contrato', nome: 'Todos os Documentos' },
  ]);
});

// Opções de esferas disponíveis
app.get('/api/licitacoes/pncp/search/esferas', (req, res) => {
  res.json([
    { id: 'F', nome: 'Federal' },
    { id: 'E', nome: 'Estadual' },
    { id: 'M', nome: 'Municipal' },
    { id: 'N', nome: 'Não se aplica' },
  ]);
});

app.get('/api/licitacoes/pncp/modos-disputa', async (req, res) => {
  try {
    console.log('[PNCP Modos Disputa] Buscando modos de disputa...');
    const data = await fetchPncp('/v1/modos-disputas', {
      pagina: req.query.pagina || 1,
      tamanhoPagina: req.query.tamanhoPagina || 100,
    });
    console.log('[PNCP Modos Disputa] Resposta recebida, keys:', Object.keys(data || {}));
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    console.log('[PNCP Modos Disputa] Lista extraída, tamanho:', list.length);
    const modos = list
      .filter(item => item && item.id)
      .map(item => ({
        id: String(item.id),
        nome: item.nome || item.descricao || `Modo ${item.id}`,
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    console.log('[PNCP Modos Disputa] Retornando', modos.length, 'modos');
    res.json(modos);
  } catch (error) {
    console.error('[PNCP Modos Disputa] Error:', error.message);
    res.status(502).json({ error: 'Erro ao consultar modos de disputa no PNCP' });
  }
});

app.get('/api/licitacoes/pncp/tipos-instrumentos', async (req, res) => {
  try {
    console.log('[PNCP Tipos Instrumento] Buscando tipos de instrumento...');
    const data = await fetchPncp('/v1/tipos-instrumentos-convocatorios', {
      pagina: req.query.pagina || 1,
      tamanhoPagina: req.query.tamanhoPagina || 100,
    });
    console.log('[PNCP Tipos Instrumento] Resposta recebida, keys:', Object.keys(data || {}));
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    console.log('[PNCP Tipos Instrumento] Lista extraída, tamanho:', list.length);
    const tipos = list
      .filter(item => item && item.id)
      .map(item => ({
        id: String(item.id),
        nome: item.nome || item.descricao || `Tipo ${item.id}`,
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    console.log('[PNCP Tipos Instrumento] Retornando', tipos.length, 'tipos');
    res.json(tipos);
  } catch (error) {
    console.error('[PNCP Tipos Instrumento] Error:', error.message);
    res.status(502).json({ error: 'Erro ao consultar tipos de instrumento no PNCP' });
  }
});

// Opções de UFs disponíveis
app.get('/api/licitacoes/pncp/search/ufs', (req, res) => {
  res.json([
    { sigla: 'AC', nome: 'Acre' },
    { sigla: 'AL', nome: 'Alagoas' },
    { sigla: 'AP', nome: 'Amapá' },
    { sigla: 'AM', nome: 'Amazonas' },
    { sigla: 'BA', nome: 'Bahia' },
    { sigla: 'CE', nome: 'Ceará' },
    { sigla: 'DF', nome: 'Distrito Federal' },
    { sigla: 'ES', nome: 'Espírito Santo' },
    { sigla: 'GO', nome: 'Goiás' },
    { sigla: 'MA', nome: 'Maranhão' },
    { sigla: 'MT', nome: 'Mato Grosso' },
    { sigla: 'MS', nome: 'Mato Grosso do Sul' },
    { sigla: 'MG', nome: 'Minas Gerais' },
    { sigla: 'PA', nome: 'Pará' },
    { sigla: 'PB', nome: 'Paraíba' },
    { sigla: 'PR', nome: 'Paraná' },
    { sigla: 'PE', nome: 'Pernambuco' },
    { sigla: 'PI', nome: 'Piauí' },
    { sigla: 'RJ', nome: 'Rio de Janeiro' },
    { sigla: 'RN', nome: 'Rio Grande do Norte' },
    { sigla: 'RS', nome: 'Rio Grande do Sul' },
    { sigla: 'RO', nome: 'Rondônia' },
    { sigla: 'RR', nome: 'Roraima' },
    { sigla: 'SC', nome: 'Santa Catarina' },
    { sigla: 'SP', nome: 'São Paulo' },
    { sigla: 'SE', nome: 'Sergipe' },
    { sigla: 'TO', nome: 'Tocantins' },
  ]);
});

// Buscar detalhes de uma compra específica
app.get('/api/licitacoes/pncp/compra/:cnpj/:ano/:sequencial', async (req, res) => {
  try {
    const { cnpj, ano, sequencial } = req.params;
    const data = await fetchPncpConsulta(`/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}`);
    res.json(data);
  } catch (error) {
    console.error('Error fetching PNCP compra details:', error);
    res.status(502).json({ error: 'Erro ao consultar detalhes da compra no PNCP', details: error.message });
  }
});

// Buscar itens de uma compra específica
app.get('/api/licitacoes/pncp/compra/:cnpj/:ano/:sequencial/itens', async (req, res) => {
  try {
    const { cnpj, ano, sequencial } = req.params;
    const data = await fetchPncp(`/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}/itens`, {
      pagina: req.query.pagina || 1,
      tamanhoPagina: req.query.tamanhoPagina || 100,
    });
    res.json(data);
  } catch (error) {
    console.error('Error fetching PNCP compra itens:', error);
    res.status(502).json({ error: 'Erro ao consultar itens da compra no PNCP', details: error.message });
  }
});

// Buscar arquivos/documentos de uma compra específica
app.get('/api/licitacoes/pncp/compra/:cnpj/:ano/:sequencial/arquivos', async (req, res) => {
  try {
    const { cnpj, ano, sequencial } = req.params;
    const data = await fetchPncp(`/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}/arquivos`);
    res.json(data);
  } catch (error) {
    console.error('Error fetching PNCP compra arquivos:', error);
    res.status(502).json({ error: 'Erro ao consultar arquivos da compra no PNCP', details: error.message });
  }
});

// ============ FIM PNCP SEARCH ENDPOINTS ============

app.get('/api/licitacoes/compras/uasgs', async (req, res) => {
  try {
    const params = { pagina: 1 };
    if (req.query.estado) params.siglaUf = req.query.estado;
    if (req.query.codigoUasg) params.codigoUasg = req.query.codigoUasg;
    if (req.query.cnpj) params.cnpj = req.query.cnpj;

    const data = await fetchComprasGov('/modulo-uasg/1_consultarUasg', params);
    const resultado = Array.isArray(data?.resultado) ? data.resultado : [];
    res.json(resultado.slice(0, 200)); // Aumentado limite para 200
  } catch (error) {
    console.error('Error fetching UASGs:', error);
    res.status(502).json({ error: 'Erro ao consultar UASGs no Compras.gov' });
  }
});

app.get('/api/licitacoes/compras/catalogo-options', async (req, res) => {
  const tipo = req.query.tipo === 'servico' ? 'servico' : 'material';
  const endpoint = tipo === 'servico'
    ? '/modulo-pesquisa-preco/3_consultarServico'
    : '/modulo-pesquisa-preco/1_consultarMaterial';

  try {
    const data = await fetchComprasGov(endpoint, {
      pagina: 1,
      tamanhoPagina: 50,
      codigoUasg: req.query.codigoUasg,
      estado: req.query.estado,
      codigoItemCatalogo: req.query.codigoItemCatalogo,
    });
    const resultado = Array.isArray(data?.resultado) ? data.resultado : [];
    const optionsMap = new Map();
    resultado.forEach(item => {
      const code = item.codigoItemCatalogo;
      const description = item.descricaoItem || item.descricaoDetalhadaItem || item.objetoCompra;
      if (!code || optionsMap.has(String(code))) {
        return;
      }
      optionsMap.set(String(code), {
        codigo: String(code),
        descricao: description || `Item ${code}`,
      });
    });
    res.json(Array.from(optionsMap.values()).slice(0, 100));
  } catch (error) {
    console.error('Error fetching catalog options:', error);
    res.status(502).json({ error: 'Erro ao consultar catalogo no Compras.gov' });
  }
});

app.get('/api/licitacoes/compras/modalidades', async (req, res) => {
  try {
    const data = await fetchComprasGov('/modulo-contratacoes/1_consultarContratacoes_PNCP_14133', {
      pagina: 1,
      tamanhoPagina: 50,
      unidadeOrgaoUfSigla: req.query.estado,
      unidadeOrgaoCodigoUnidade: req.query.codigoUasg,
    });
    const resultado = Array.isArray(data?.resultado) ? data.resultado : [];
    const set = new Set();
    resultado.forEach(item => {
      [item.modalidadeNome, item.modalidade, item.descricaoModalidade, item.codigoModalidade]
        .filter(Boolean)
        .forEach(value => set.add(String(value)));
    });
    const modalidades = Array.from(set)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
    res.json(modalidades);
  } catch (error) {
    console.error('Error fetching modalidades:', error);
    res.status(502).json({ error: 'Erro ao consultar modalidades no Compras.gov' });
  }
});

app.get('/api/licitacoes/compras/precos/material', async (req, res) => {
  try {
    const data = await fetchComprasGov('/modulo-pesquisa-preco/1_consultarMaterial', {
      pagina: req.query.pagina || 1,
      tamanhoPagina: req.query.tamanhoPagina || 25,
      codigoItemCatalogo: req.query.codigoItemCatalogo,
      codigoUasg: req.query.codigoUasg,
      estado: req.query.estado,
      dataCompraInicio: req.query.dataCompraInicio,
      dataCompraFim: req.query.dataCompraFim,
    });
    res.json(data);
  } catch (error) {
    console.error('Error fetching compras preco material:', error);
    res.status(502).json({ error: 'Erro ao consultar Compras.gov (Precos Material)' });
  }
});

app.get('/api/licitacoes/compras/precos/servico', async (req, res) => {
  try {
    const data = await fetchComprasGov('/modulo-pesquisa-preco/3_consultarServico', {
      pagina: req.query.pagina || 1,
      tamanhoPagina: req.query.tamanhoPagina || 25,
      codigoItemCatalogo: req.query.codigoItemCatalogo,
      codigoUasg: req.query.codigoUasg,
      estado: req.query.estado,
      dataCompraInicio: req.query.dataCompraInicio,
      dataCompraFim: req.query.dataCompraFim,
    });
    res.json(data);
  } catch (error) {
    console.error('Error fetching compras preco servico:', error);
    res.status(502).json({ error: 'Erro ao consultar Compras.gov (Precos Servico)' });
  }
});

const runComprasSync = async () => {
  const { rows: watchRows } = await pool.query(
    `SELECT * FROM ${LICITACAO_WATCHLIST_TABLE} WHERE ativo = TRUE ORDER BY created_at DESC LIMIT 50`
  );

  let inserted = 0;
  for (const watch of watchRows) {
    const itemTipo = watch.item_tipo || 'material';
    const endpoint = itemTipo === 'servico'
      ? '/modulo-pesquisa-preco/3_consultarServico'
      : '/modulo-pesquisa-preco/1_consultarMaterial';
    const data = await fetchComprasGov(endpoint, {
      pagina: 1,
      tamanhoPagina: 10,
      codigoItemCatalogo: watch.codigo_item_catalogo,
    });

    const resultados = Array.isArray(data?.resultado) ? data.resultado : [];
    for (const result of resultados) {
      const chaveExterna = `${watch.id}:${result.idCompra || 'x'}:${result.idItemCompra || 'y'}`;
      const score = watch.codigo_item_catalogo && String(result.codigoItemCatalogo) === String(watch.codigo_item_catalogo)
        ? 95
        : 70;
      const insertedRow = await pool.query(
        `
          INSERT INTO ${LICITACAO_SIGNALS_TABLE}
          (account_id, fonte, chave_externa, payload, score, matched_watchlist_ids)
          VALUES ($1, $2, $3, $4::jsonb, $5, $6)
          ON CONFLICT (fonte, chave_externa) DO NOTHING
          RETURNING id
        `,
        [watch.account_id, 'compras_preco', chaveExterna, JSON.stringify(result), score, [watch.id]]
      );
      if (insertedRow.rowCount > 0) {
        inserted += 1;
      }
    }
  }

  return { watchlist_count: watchRows.length, inserted_signals: inserted };
};

app.post('/api/licitacoes/compras/sync', async (req, res) => {
  try {
    const result = await runComprasSync();
    res.json(result);
  } catch (error) {
    console.error('Error syncing compras data:', error);
    res.status(500).json({ error: 'Erro ao sincronizar dados do Compras.gov' });
  }
});

app.get('/api/licitacoes/overview/summary', async (req, res) => {
  const accountId = getAccountId(req);
  try {
    const { rows } = await pool.query(
      `
        SELECT
          COUNT(*)::int AS opportunities_count,
          COALESCE(
            SUM(valor_oportunidade) FILTER (
              WHERE LOWER(COALESCE(status, '')) <> 'perdido'
                AND LOWER(COALESCE(fase, '')) NOT LIKE '%perdido%'
                AND LOWER(COALESCE(fase, '')) NOT LIKE '%descartado%'
            ),
            0
          ) AS total_value,
          COUNT(*) FILTER (WHERE status = 'ganho')::int AS won_count,
          COUNT(*) FILTER (WHERE status = 'perdido' OR status = 'nao_atendido')::int AS lost_count,
          COUNT(*) FILTER (WHERE ${getPrazoStatusSql()} = 'vence_48h')::int AS due_48h,
          COUNT(*) FILTER (WHERE ${getPrazoStatusSql()} = 'atrasado')::int AS overdue_count,
          COALESCE(SUM(comissao_valor_previsto), 0) AS comissao_prevista,
          COALESCE(SUM(comissao_valor_real) FILTER (WHERE status_comissao = 'pago'), 0) AS comissao_paga
        FROM ${LICITACAO_TABLE}
        WHERE account_id = $1
      `,
      [accountId]
    );
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching licitacao overview summary:', error);
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
    await createLicitacaoTables();
    await migrateLicitacaoFases();
    await seedHistorySnapshot();
    await pollStageChanges();
    cron.schedule('0 * * * *', pollStageChanges);
    cron.schedule('30 7 * * *', async () => {
      try {
        await runComprasSync();
      } catch (error) {
        console.error('Error running automatic compras sync:', error);
      }
    });
  } catch (err) {
    console.error('Error initializing history tracking:', err);
  }

  app.listen(port, () => {
    console.log(`Backend server listening at http://localhost:${port}`);
  });
};

startServer();
