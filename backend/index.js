const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const cron = require('node-cron');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const { spawn } = require('child_process');
const bcrypt = require('bcryptjs');
const {
  createNotificationTables,
  registerNotificationRoutes,
  notifyAccountUsers,
  emitDeadlineDigest,
  emitFunnelStaleInboxDigest,
  notifyFunnelStageChange,
  ensureVapidConfigured,
  getVapidConfig,
} = require('./notifications');
const {
  analyzeLicitacaoDeadlineSummary,
} = require('./brazilBusinessDays');

// Carrega backend/.env (cwd do nodemon) e, se existir, .env da raiz do monorepo.
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3001;

app.use(cors({
  origin: true,
  credentials: true,
}));
// Limite alto para o pool de mensagens do disparo (mídia em base64).
app.use(express.json({ limit: '30mb' }));

const AUTH_EMAIL = process.env.AUTH_EMAIL;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET;
// Persistent login: default 30 days (override with AUTH_TOKEN_TTL in seconds).
const parsedAuthTtl = Number.parseInt(process.env.AUTH_TOKEN_TTL || '2592000', 10);
const AUTH_TOKEN_TTL = Number.isFinite(parsedAuthTtl) ? parsedAuthTtl : 2592000;
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'aerion_auth';
const AUTH_PUBLIC_PATHS = new Set([
  '/auth/login',
  '/auth/logout',
  '/auth/status',
  '/licitacoes/pncp/modalidades',
  '/licitacoes/pncp/modos-disputa',
  '/licitacoes/pncp/tipos-instrumentos',
  '/rfb/import-progress',
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

const issueAuthCookie = (res, claims) => {
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, AUTH_TOKEN_TTL);
  const base = typeof claims === 'string' ? { sub: claims } : (claims || {});
  const token = signAuthToken({ ...base, exp });
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

app.post('/api/auth/login', async (req, res) => {
  if (!isAuthConfigured()) {
    return res.status(500).json({ error: 'Auth not configured' });
  }
  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  // 1) Try the users table (real accounts with bcrypt hashes).
  try {
    const user = await getUserByEmail(email);
    if (user) {
      if (!user.active) {
        return res.status(403).json({ error: 'Usuario inativo.' });
      }
      const ok = await bcrypt.compare(password, user.password_hash || '');
      if (!ok) {
        return res.status(401).json({ error: 'Credenciais invalidas.' });
      }
      issueAuthCookie(res, { sub: user.email, uid: user.id, role: user.role, name: user.name });
      return res.json({
        authenticated: true,
        email: user.email,
        name: user.name,
        role: user.role,
        uid: user.id,
        allowed_views: user.allowed_views || [],
        page_permissions: user.page_permissions || null,
        is_app_admin: Boolean(user.is_app_admin),
      });
    }
  } catch (error) {
    console.error('login users lookup failed, falling back to env:', error.message);
  }
  // 2) Bootstrap fallback: single env credential (acts as admin).
  const emailMatches = safeCompare(email.toLowerCase(), AUTH_EMAIL.toLowerCase());
  const passwordMatches = safeCompare(password, AUTH_PASSWORD);
  if (!emailMatches || !passwordMatches) {
    return res.status(401).json({ error: 'Credenciais invalidas.' });
  }
  issueAuthCookie(res, { sub: AUTH_EMAIL, role: 'admin', name: 'Admin' });
  return res.json({
    authenticated: true,
    email: AUTH_EMAIL,
    name: 'Admin',
    role: 'admin',
    uid: null,
    allowed_views: null,
    page_permissions: null,
    is_app_admin: true,
  });
});

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ authenticated: false });
});

app.get('/api/auth/status', async (req, res) => {
  if (!isAuthConfigured()) {
    return res.status(500).json({ authenticated: false, error: 'Auth not configured' });
  }
  const token = getCookieValue(req, AUTH_COOKIE_NAME);
  const payload = token ? verifyAuthToken(token) : null;
  if (!payload) {
    return res.json({ authenticated: false });
  }
  // Enrich with fresh app role / permissions from the DB when we have a user id.
  let role = payload.role || 'member';
  let name = payload.name || payload.sub;
  let allowedViews = null;
  let pagePermissions = null;
  let isAppAdmin = role === 'admin';
  let uid = payload.uid || null;
  if (payload.uid) {
    try {
      const fresh = await getUserById(payload.uid);
      if (fresh) {
        role = fresh.role;
        name = fresh.name;
        allowedViews = fresh.allowed_views;
        pagePermissions = fresh.page_permissions;
        isAppAdmin = Boolean(fresh.is_app_admin);
        uid = fresh.id;
        // Reemite cookie se o role do app mudou (admin independente do CW).
        if (payload.role !== role) {
          issueAuthCookie(res, { sub: payload.sub, uid: payload.uid, role, name });
        }
      }
    } catch (error) {
      console.error('auth status enrich failed:', error.message);
    }
  } else if (role === 'admin') {
    allowedViews = null; // bootstrap admin sees everything
    isAppAdmin = true;
  }
  return res.json({
    authenticated: true,
    email: payload.sub,
    name,
    role,
    uid,
    allowed_views: allowedViews,
    page_permissions: pagePermissions,
    is_app_admin: isAppAdmin,
  });
});

// Resiliência do pool: sem isso, se as conexões saturarem (ex.: um job pesado
// em background) as queries ficam presas para sempre e o nginx devolve 504.
// connectionTimeoutMillis faz a query falhar rápido (500 claro) em vez de pendurar.
const POOL_TUNING = {
  max: Number.parseInt(process.env.PG_POOL_MAX || '20', 10) || 20,
  connectionTimeoutMillis: Number.parseInt(process.env.PG_CONNECT_TIMEOUT_MS || '10000', 10) || 10000,
  idleTimeoutMillis: 30000,
  keepAlive: true,
};
const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ...POOL_TUNING }
    : {
        // Prefer DATABASE_URL in prod. Fallback uses only env vars — never hardcode credentials.
        user: process.env.PGUSER || 'postgres',
        host: process.env.PGHOST || '127.0.0.1',
        database: process.env.PGDATABASE || 'tenryu',
        password: process.env.PGPASSWORD || '',
        port: Number.parseInt(process.env.PGPORT || '5432', 10) || 5432,
        ...POOL_TUNING,
      }
);
// Um erro num client ocioso (ex.: Postgres reiniciou) não pode derrubar o processo.
pool.on('error', (err) => {
  console.error('[pg] idle client error:', err.message);
});

// ===================== Auth / RBAC (Chatwoot-backed auth, app-side roles) =====================
// Authenticate against Chatwoot's `users` table (Devise bcrypt) + account membership.
// App role (is_app_admin) and page_permissions (view|edit) live in app_user_access —
// independent of Chatwoot Administrator flag.
const CHATWOOT_ACCOUNT_ID = Number.parseInt(process.env.CHATWOOT_ACCOUNT_ID || '2', 10) || 2;
const APP_ACCESS_TABLE = 'app_user_access';
const APP_PAGE_VIEWS = ['Overview', 'Board', 'Busca Lead B2B', 'Licitações', 'Notificações', 'Processo', 'Disparo WhatsApp', 'Radar Trends', 'Metas', 'Usuários'];
const APP_PERM_LEVELS = new Set(['none', 'view', 'edit']);

// Web Push (VAPID) — inbox + push multi-navegador. Ver backend/notifications.js
registerNotificationRoutes(app, { pool, defaultAccountId: CHATWOOT_ACCOUNT_ID });
if (getVapidConfig()) {
  ensureVapidConfigured();
  console.log('[notifications] Web Push VAPID configurado');
} else {
  console.warn('[notifications] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY ausentes — push desabilitado até configurar');
}

/** Slug estável para agrupar contas do mesmo vendedor no ranking (ex.: Clayton pessoal + Aerion). */
const sellerIdentityFromLabel = (label) => {
  const slug = String(label || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || null;
};

const normalizePagePermissions = (raw, { fromAllowedViews = null } = {}) => {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const key of APP_PAGE_VIEWS) {
      const v = String(raw[key] || '').toLowerCase();
      if (APP_PERM_LEVELS.has(v)) out[key] = v;
    }
  }
  // Legado: allowed_views string[] → cada uma = edit; vazio = todas edit (comportamento antigo).
  if (!Object.keys(out).length && Array.isArray(fromAllowedViews)) {
    if (fromAllowedViews.length === 0) {
      for (const key of APP_PAGE_VIEWS) out[key] = 'edit';
    } else {
      for (const key of APP_PAGE_VIEWS) {
        out[key] = fromAllowedViews.includes(key) ? 'edit' : 'none';
      }
      // Notificações sempre pelo menos view se não listada explicitamente como off — mantém default amigável.
      if (!fromAllowedViews.includes('Notificações') && out.Notificações === 'none') {
        out.Notificações = 'view';
      }
    }
  }
  return out;
};

const pagePermissionsToAllowedViews = (perms) => {
  if (!perms || typeof perms !== 'object') return [];
  return APP_PAGE_VIEWS.filter((k) => perms[k] === 'view' || perms[k] === 'edit');
};

async function ensureAppAccessTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${APP_ACCESS_TABLE} (
        user_id INTEGER PRIMARY KEY,
        allowed_views JSONB NOT NULL DEFAULT '[]'::jsonb,
        is_seller BOOLEAN NOT NULL DEFAULT false,
        seller_identity TEXT,
        seller_label TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`ALTER TABLE ${APP_ACCESS_TABLE} ADD COLUMN IF NOT EXISTS is_seller BOOLEAN NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE ${APP_ACCESS_TABLE} ADD COLUMN IF NOT EXISTS seller_identity TEXT`);
    await pool.query(`ALTER TABLE ${APP_ACCESS_TABLE} ADD COLUMN IF NOT EXISTS seller_label TEXT`);
    await pool.query(`ALTER TABLE ${APP_ACCESS_TABLE} ADD COLUMN IF NOT EXISTS is_app_admin BOOLEAN NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE ${APP_ACCESS_TABLE} ADD COLUMN IF NOT EXISTS page_permissions JSONB NOT NULL DEFAULT '{}'::jsonb`);

    // Seed inicial: só se ainda não houver nenhum vendedor marcado.
    // Clayton [Pessoal] + Clayton Aerion → identidade única; Thelga vendedora; Rebeca/Marketing fora do rank.
    const { rows: sellerCountRows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM ${APP_ACCESS_TABLE} WHERE is_seller = true`
    );
    if ((sellerCountRows[0]?.n || 0) === 0) {
      const seeds = [
        { id: 1, is_seller: true, identity: 'clayton', label: 'Clayton' },
        { id: 2, is_seller: true, identity: 'clayton', label: 'Clayton' },
        { id: 8, is_seller: true, identity: null, label: null },
        { id: 6, is_seller: false, identity: null, label: null },
        { id: 5, is_seller: false, identity: null, label: null },
      ];
      for (const seed of seeds) {
        await pool.query(
          `INSERT INTO ${APP_ACCESS_TABLE} (user_id, allowed_views, is_seller, seller_identity, seller_label, updated_at)
           VALUES ($1, '[]'::jsonb, $2, $3, $4, now())
           ON CONFLICT (user_id) DO UPDATE SET
             is_seller = EXCLUDED.is_seller,
             seller_identity = EXCLUDED.seller_identity,
             seller_label = EXCLUDED.seller_label,
             updated_at = now()`,
          [seed.id, seed.is_seller, seed.identity, seed.label]
        );
      }
    }

    // Bootstrap one-shot: Chatwoot admins → is_app_admin (só se ainda ninguém for app admin).
    const { rows: appAdminCount } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM ${APP_ACCESS_TABLE} WHERE is_app_admin = true`
    );
    if ((appAdminCount[0]?.n || 0) === 0) {
      await pool.query(
        `
          INSERT INTO ${APP_ACCESS_TABLE} (user_id, allowed_views, is_app_admin, page_permissions, updated_at)
          SELECT au.user_id, '[]'::jsonb, true, '{}'::jsonb, now()
            FROM account_users au
           WHERE au.account_id = $1
             AND au.role = 1
          ON CONFLICT (user_id) DO UPDATE SET
            is_app_admin = true,
            updated_at = now()
        `,
        [CHATWOOT_ACCOUNT_ID]
      );
      console.log('[auth] bootstrap is_app_admin from Chatwoot role=1');
    }

    // Migra allowed_views → page_permissions quando page_permissions ainda vazio.
    await pool.query(`
      UPDATE ${APP_ACCESS_TABLE}
         SET page_permissions = '{}'::jsonb
       WHERE page_permissions IS NULL
    `).catch(() => {});
  } catch (error) {
    console.error('ensureAppAccessTable failed:', error.message);
  }
}
ensureAppAccessTable();

/**
 * Vendedores do account, já agrupados por seller_identity.
 * id canônico = menor user_id do grupo (ex.: Clayton pessoal = 1).
 */
async function getSellerGroups(accountId = CHATWOOT_ACCOUNT_ID) {
  const { rows } = await pool.query(
    `SELECT u.id,
            COALESCE(NULLIF(TRIM(u.display_name), ''), NULLIF(TRIM(u.name), ''), u.email) AS name,
            COALESCE(acc.is_seller, false) AS is_seller,
            NULLIF(TRIM(acc.seller_identity), '') AS seller_identity,
            NULLIF(TRIM(acc.seller_label), '') AS seller_label
       FROM account_users au
       JOIN users u ON u.id = au.user_id
       LEFT JOIN ${APP_ACCESS_TABLE} acc ON acc.user_id = u.id
      WHERE au.account_id = $1
        AND COALESCE(acc.is_seller, false) = true
      ORDER BY u.id ASC`,
    [accountId]
  );
  const groups = new Map();
  for (const row of rows) {
    const key = row.seller_identity || `id:${row.id}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        id: Number(row.id),
        name: row.seller_label || row.name || `Agente #${row.id}`,
        user_ids: [Number(row.id)],
        identity: row.seller_identity || null,
      });
    } else {
      existing.user_ids.push(Number(row.id));
      if (row.seller_label) existing.name = row.seller_label;
    }
  }
  return Array.from(groups.values()).sort((a, b) =>
    String(a.name).localeCompare(String(b.name), 'pt-BR', { sensitivity: 'base' })
  );
}

/** Expande agent_id canônico (ou qualquer id do grupo) para todos os user_ids da identidade. */
async function resolveSellerActorIds(agentId, accountId = CHATWOOT_ACCOUNT_ID) {
  const id = Number.parseInt(agentId, 10);
  if (!Number.isFinite(id) || id <= 0) return null;
  const groups = await getSellerGroups(accountId);
  const group = groups.find((g) => g.id === id || g.user_ids.includes(id));
  return group ? group.user_ids : [id];
}

const mapChatwootRole = (cwRole) => (Number(cwRole) === 1 ? 'admin' : 'member');

const mapUserAccessRow = (u) => {
  const isAppAdmin = Boolean(u.is_app_admin);
  const allowedViews = Array.isArray(u.allowed_views) ? u.allowed_views : null;
  let pagePermissions = normalizePagePermissions(u.page_permissions, { fromAllowedViews: allowedViews });
  // page_permissions vazio no DB + allowed_views null → acesso amplo (legado)
  if (!Object.keys(pagePermissions).length && (allowedViews == null || (Array.isArray(allowedViews) && !allowedViews.length))) {
    pagePermissions = Object.fromEntries(APP_PAGE_VIEWS.map((k) => [k, 'edit']));
  }
  const role = isAppAdmin ? 'admin' : 'member';
  return {
    id: u.id,
    email: u.email,
    name: u.name || u.display_name || u.email,
    role,
    is_app_admin: isAppAdmin,
    cw_role: mapChatwootRole(u.cw_role),
    allowed_views: pagePermissionsToAllowedViews(pagePermissions),
    page_permissions: pagePermissions,
    is_seller: Boolean(u.is_seller),
    seller_identity: u.seller_identity || null,
    seller_label: u.seller_label || null,
  };
};

async function getUserByEmail(email) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name, u.display_name, u.encrypted_password, u.confirmed_at,
            au.role AS cw_role, acc.allowed_views, acc.page_permissions,
            COALESCE(acc.is_app_admin, false) AS is_app_admin,
            COALESCE(acc.is_seller, false) AS is_seller,
            acc.seller_identity, acc.seller_label
       FROM users u
       LEFT JOIN account_users au ON au.user_id = u.id AND au.account_id = $2
       LEFT JOIN ${APP_ACCESS_TABLE} acc ON acc.user_id = u.id
      WHERE LOWER(u.email) = LOWER($1)
      ORDER BY au.role DESC NULLS LAST
      LIMIT 1`,
    [String(email || '').trim(), CHATWOOT_ACCOUNT_ID]
  );
  const u = rows[0];
  if (!u) return null;
  const mapped = mapUserAccessRow(u);
  return {
    ...mapped,
    password_hash: u.encrypted_password,
    active: true,
  };
}

async function getUserById(id) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name, u.display_name, au.role AS cw_role,
            acc.allowed_views, acc.page_permissions,
            COALESCE(acc.is_app_admin, false) AS is_app_admin,
            COALESCE(acc.is_seller, false) AS is_seller,
            acc.seller_identity, acc.seller_label
       FROM users u
       LEFT JOIN account_users au ON au.user_id = u.id AND au.account_id = $2
       LEFT JOIN ${APP_ACCESS_TABLE} acc ON acc.user_id = u.id
      WHERE u.id = $1
      ORDER BY au.role DESC NULLS LAST
      LIMIT 1`,
    [id, CHATWOOT_ACCOUNT_ID]
  );
  const u = rows[0];
  if (!u) return null;
  return mapUserAccessRow(u);
}

const requireAdmin = (req, res, next) => {
  if (req.auth && req.auth.role === 'admin') return next();
  return res.status(403).json({ error: 'Acesso restrito a administradores.' });
};

// List users (Chatwoot account members) + app-side access + flags de vendedor. Admin only.
app.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email,
              COALESCE(NULLIF(TRIM(u.display_name), ''), NULLIF(TRIM(u.name), ''), u.email) AS name,
              au.role AS cw_role, acc.allowed_views, acc.page_permissions,
              COALESCE(acc.is_app_admin, false) AS is_app_admin,
              COALESCE(acc.is_seller, false) AS is_seller,
              acc.seller_identity, acc.seller_label
         FROM account_users au
         JOIN users u ON u.id = au.user_id
         LEFT JOIN ${APP_ACCESS_TABLE} acc ON acc.user_id = u.id
        WHERE au.account_id = $1
        ORDER BY name ASC`,
      [CHATWOOT_ACCOUNT_ID]
    );
    res.json(rows.map((r) => mapUserAccessRow(r)));
  } catch (error) {
    console.error('Error listing users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Set app admin, page permissions (view|edit), seller flags. Admin only.
app.put('/api/users/:id/access', requireAdmin, async (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Invalid id' });

  const hasViews = Array.isArray(req.body?.allowed_views);
  const views = hasViews ? req.body.allowed_views.filter(v => typeof v === 'string') : null;
  const hasPagePerms = req.body?.page_permissions && typeof req.body.page_permissions === 'object'
    && !Array.isArray(req.body.page_permissions);
  const hasAppAdmin = typeof req.body?.is_app_admin === 'boolean';
  const isAppAdminIn = hasAppAdmin ? Boolean(req.body.is_app_admin) : null;
  const hasSeller = typeof req.body?.is_seller === 'boolean';
  const isSeller = hasSeller ? Boolean(req.body.is_seller) : null;
  const hasLabel = Object.prototype.hasOwnProperty.call(req.body || {}, 'seller_label');
  const sellerLabelRaw = hasLabel
    ? (req.body.seller_label == null ? null : String(req.body.seller_label).trim() || null)
    : undefined;
  const sellerIdentity = hasLabel
    ? (isSeller === false ? null : sellerIdentityFromLabel(sellerLabelRaw))
    : undefined;

  try {
    // Carrega estado atual para merge parcial
    const { rows: existingRows } = await pool.query(
      `SELECT allowed_views, page_permissions, is_app_admin, is_seller, seller_identity, seller_label
         FROM ${APP_ACCESS_TABLE} WHERE user_id = $1`,
      [userId]
    );
    const existing = existingRows[0] || {};
    const nextIsAppAdmin = isAppAdminIn != null ? isAppAdminIn : Boolean(existing.is_app_admin);

    let nextPerms;
    if (hasPagePerms) {
      nextPerms = normalizePagePermissions(req.body.page_permissions);
      // Completa chaves faltantes com none
      for (const key of APP_PAGE_VIEWS) {
        if (!nextPerms[key]) nextPerms[key] = 'none';
      }
    } else if (views != null) {
      nextPerms = normalizePagePermissions(null, { fromAllowedViews: views });
    } else {
      nextPerms = normalizePagePermissions(existing.page_permissions, {
        fromAllowedViews: Array.isArray(existing.allowed_views) ? existing.allowed_views : null,
      });
      if (!Object.keys(nextPerms).length) {
        nextPerms = Object.fromEntries(APP_PAGE_VIEWS.map((k) => [k, 'edit']));
      }
    }
    const nextViews = pagePermissionsToAllowedViews(nextPerms);

    const nextIsSeller = isSeller != null ? isSeller : Boolean(existing.is_seller);
    let nextLabel = hasLabel ? sellerLabelRaw : (existing.seller_label || null);
    let nextIdentity = hasLabel ? sellerIdentity : (existing.seller_identity || null);
    if (!nextIsSeller) {
      nextLabel = null;
      nextIdentity = null;
    } else if (hasLabel && nextLabel) {
      nextIdentity = sellerIdentityFromLabel(nextLabel);
    }

    await pool.query(
      `INSERT INTO ${APP_ACCESS_TABLE}
         (user_id, allowed_views, page_permissions, is_app_admin, is_seller, seller_identity, seller_label, updated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7, now())
       ON CONFLICT (user_id) DO UPDATE SET
         allowed_views = EXCLUDED.allowed_views,
         page_permissions = EXCLUDED.page_permissions,
         is_app_admin = EXCLUDED.is_app_admin,
         is_seller = EXCLUDED.is_seller,
         seller_identity = EXCLUDED.seller_identity,
         seller_label = EXCLUDED.seller_label,
         updated_at = now()`,
      [
        userId,
        JSON.stringify(nextViews),
        JSON.stringify(nextPerms),
        nextIsAppAdmin,
        nextIsSeller,
        nextIdentity,
        nextLabel,
      ]
    );
    res.json({
      ok: true,
      user_id: userId,
      role: nextIsAppAdmin ? 'admin' : 'member',
      is_app_admin: nextIsAppAdmin,
      allowed_views: nextViews,
      page_permissions: nextPerms,
      is_seller: nextIsSeller,
      seller_identity: nextIdentity,
      seller_label: nextLabel,
    });
  } catch (error) {
    console.error('Error updating user access:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Lista pública de vendedores agrupados (para ritmo / divisão de meta). Qualquer autenticado.
app.get('/api/sellers', async (req, res) => {
  try {
    const groups = await getSellerGroups();
    res.json(groups.map((g) => ({
      id: g.id,
      name: g.name,
      user_ids: g.user_ids,
      identity: g.identity,
    })));
  } catch (error) {
    console.error('Error listing sellers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===================== Metas (sales goals) + Realizado (faturamento) =====================
// Metas live in our app DB (admin-editable). Realizado comes from the external
// faturamento base that n8n populates — pluggable via FATURAMENTO_DATABASE_URL.
const METAS_TABLE = 'sales_metas';

async function ensureMetasTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${METAS_TABLE} (
        id SERIAL PRIMARY KEY,
        ano INTEGER NOT NULL,
        mes INTEGER NOT NULL,
        vendedor TEXT NOT NULL DEFAULT '',
        receita_meta NUMERIC NOT NULL DEFAULT 0,
        vendas_meta INTEGER NOT NULL DEFAULT 0,
        sqls_meta INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (ano, mes, vendedor)
      )
    `);
  } catch (error) {
    console.error('ensureMetasTable failed:', error.message);
  }
}
ensureMetasTable();

// Optional separate connection to the faturamento (Sankhya->Drive->n8n->Postgres) base.
let faturamentoPool = null;
if (process.env.FATURAMENTO_DATABASE_URL) {
  try {
    faturamentoPool = new Pool({ connectionString: process.env.FATURAMENTO_DATABASE_URL });
  } catch (error) {
    console.error('faturamento pool init failed:', error.message);
  }
}

const quoteIdent = (value, fallback) => {
  const raw = String(value || fallback || '').trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(raw)) return fallback;
  return `"${raw.replace(/"/g, '""')}"`;
};

const FATURAMENTO_VENDEDOR_COLUMN = quoteIdent(process.env.FATURAMENTO_VENDEDOR_COLUMN, 'descricao_vendedor');

// Metas: source of truth is bi.metas_aerion (same table Metabase + the old page use),
// reached via faturamentoPool. Falls back to a local table when bi is not configured.
app.get('/api/metas', async (req, res) => {
  const ano = Number.parseInt(req.query.ano, 10) || new Date().getFullYear();
  try {
    if (faturamentoPool) {
      const { rows } = await faturamentoPool.query(
        `SELECT ano, mes, meta_valor::float AS receita_meta FROM metas_aerion WHERE ano = $1 ORDER BY mes ASC`,
        [ano]
      );
      return res.json(rows);
    }
    const { rows } = await pool.query(
      `SELECT ano, mes, receita_meta FROM ${METAS_TABLE} WHERE ano = $1 ORDER BY mes ASC`,
      [ano]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching metas:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/metas', requireAdmin, async (req, res) => {
  const ano = Number.parseInt(req.body?.ano, 10);
  const mes = Number.parseInt(req.body?.mes, 10);
  if (!Number.isFinite(ano) || !Number.isFinite(mes) || mes < 1 || mes > 12) {
    return res.status(400).json({ error: 'ano/mes inválidos' });
  }
  const receita = Number(req.body?.receita_meta) || 0;
  try {
    if (faturamentoPool) {
      await faturamentoPool.query(
        `INSERT INTO metas_aerion (ano, mes, meta_valor) VALUES ($1,$2,$3)
         ON CONFLICT (ano, mes) DO UPDATE SET meta_valor = EXCLUDED.meta_valor`,
        [ano, mes, receita]
      );
    } else {
      await pool.query(
        `INSERT INTO ${METAS_TABLE} (ano, mes, vendedor, receita_meta, updated_at)
         VALUES ($1,$2,'',$3, now())
         ON CONFLICT (ano, mes, vendedor) DO UPDATE SET receita_meta = EXCLUDED.receita_meta, updated_at = now()`,
        [ano, mes, receita]
      );
    }
    const mesLabel = String(mes).padStart(2, '0');
    const valorLabel = receita.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const actor = req.auth?.name || req.auth?.sub || 'Admin';
    notifyAccountUsers(pool, {
      accountId: CHATWOOT_ACCOUNT_ID,
      type: 'metas.updated',
      title: `Meta ${mesLabel}/${ano} atualizada`,
      body: `${valorLabel} · por ${actor}`,
      data: { view: 'Metas', ano, mes, receita_meta: receita },
      dedupeKey: `meta:${ano}:${mes}:${Math.round(receita)}`,
    }).catch((err) => console.warn('[metas] notify failed:', err.message));
    return res.json({ ok: true });
  } catch (error) {
    console.error('Error saving meta:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Realizado (faturamento) for a month, from bi.vendas. The exact "Aerion scope" filter
// can be overridden with FATURAMENTO_QUERY ($1=ano, $2=mes -> receita[, vendas]); the
// default uses the dashboard-34 Aerion recorte (grupo_produto 'AERION%').
app.get('/api/vendas/realizado', async (req, res) => {
  const ano = Number.parseInt(req.query.ano, 10) || new Date().getFullYear();
  const mes = Number.parseInt(req.query.mes, 10) || (new Date().getMonth() + 1);
  if (!faturamentoPool) {
    return res.json({ configured: false, ano, mes, receita: null, vendas: null });
  }
  // Aerion scope = product groups 'AERION%', value column valor_total_prod
  // (exact definition from Metabase dashboard 34, card "AE: Faturamento vs Meta Mensal").
  const query = process.env.FATURAMENTO_QUERY
    || `SELECT COALESCE(SUM(valor_total_prod),0)::float AS receita,
               COUNT(DISTINCT numero_nota)::int AS vendas
          FROM vendas
         WHERE cod_grupoprod IN (SELECT cod_grupoprod FROM grupo_produto WHERE descricao LIKE 'AERION%')
           AND ano = $1 AND mes = $2 AND natureza_nf2 = 'Venda'`;
  try {
    const { rows } = await faturamentoPool.query(query, [ano, mes]);
    const row = rows[0] || {};
    res.json({
      configured: true, ano, mes,
      receita: Number(row.receita) || 0,
      vendas: row.vendas != null ? Number(row.vendas) : null,
      scope: process.env.FATURAMENTO_QUERY ? 'custom' : 'aerion',
    });
  } catch (error) {
    console.error('Error fetching realizado:', error);
    res.status(500).json({ configured: true, error: 'Falha ao consultar faturamento' });
  }
});

// Realizado for all 12 months of a year, grouped by mes — same Aerion scope as the
// single-month route above (dashboard 34 recorte), but GROUP BY mes so the Metas page
// can plot meta x realizado in one call. Optional override: FATURAMENTO_QUERY_ANUAL ($1=ano).
app.get('/api/vendas/realizado/ano', async (req, res) => {
  const ano = Number.parseInt(req.query.ano, 10) || new Date().getFullYear();
  if (!faturamentoPool) {
    return res.json({ configured: false, ano, meses: [] });
  }
  const query = process.env.FATURAMENTO_QUERY_ANUAL
    || `SELECT mes,
               COALESCE(SUM(valor_total_prod),0)::float AS receita,
               COUNT(DISTINCT numero_nota)::int AS vendas
          FROM vendas
         WHERE cod_grupoprod IN (SELECT cod_grupoprod FROM grupo_produto WHERE descricao LIKE 'AERION%')
           AND ano = $1 AND natureza_nf2 = 'Venda'
         GROUP BY mes
         ORDER BY mes ASC`;
  try {
    const { rows } = await faturamentoPool.query(query, [ano]);
    const byMes = new Map(rows.map(r => [Number(r.mes), r]));
    const meses = Array.from({ length: 12 }, (_, i) => {
      const r = byMes.get(i + 1) || {};
      return { mes: i + 1, receita: Number(r.receita) || 0, vendas: r.vendas != null ? Number(r.vendas) : 0 };
    });
    res.json({
      configured: true, ano, meses,
      scope: process.env.FATURAMENTO_QUERY_ANUAL ? 'custom' : 'aerion',
    });
  } catch (error) {
    console.error('Error fetching realizado anual:', error);
    res.status(500).json({ configured: true, error: 'Falha ao consultar faturamento anual' });
  }
});

app.get('/api/vendas/realizado/vendedores', async (req, res) => {
  const ano = Number.parseInt(req.query.ano, 10) || new Date().getFullYear();
  const mes = Number.parseInt(req.query.mes, 10) || (new Date().getMonth() + 1);
  if (!faturamentoPool) {
    return res.json({ configured: false, ano, mes, vendedores: [] });
  }
  const query = process.env.FATURAMENTO_QUERY_VENDEDORES
    || `SELECT COALESCE(NULLIF(TRIM(${FATURAMENTO_VENDEDOR_COLUMN}::text), ''), 'Sem vendedor') AS vendedor,
               COALESCE(SUM(valor_total_prod),0)::float AS receita,
               COUNT(DISTINCT numero_nota)::int AS vendas
          FROM vendas
         WHERE cod_grupoprod IN (SELECT cod_grupoprod FROM grupo_produto WHERE descricao LIKE 'AERION%')
           AND ano = $1 AND mes = $2 AND natureza_nf2 = 'Venda'
         GROUP BY 1
         ORDER BY receita DESC`;
  try {
    const { rows } = await faturamentoPool.query(query, [ano, mes]);
    res.json({ configured: true, ano, mes, vendedores: rows });
  } catch (error) {
    console.error('Error fetching realizado vendedores:', error);
    res.status(500).json({ configured: true, error: 'Falha ao consultar faturamento por vendedor' });
  }
});

app.get('/api/vendas/realizado/vendedores/ano', async (req, res) => {
  const ano = Number.parseInt(req.query.ano, 10) || new Date().getFullYear();
  if (!faturamentoPool) {
    return res.json({ configured: false, ano, vendedores: [] });
  }
  const query = process.env.FATURAMENTO_QUERY_VENDEDORES_ANUAL
    || `SELECT COALESCE(NULLIF(TRIM(${FATURAMENTO_VENDEDOR_COLUMN}::text), ''), 'Sem vendedor') AS vendedor,
               COALESCE(SUM(valor_total_prod),0)::float AS receita,
               COUNT(DISTINCT numero_nota)::int AS vendas
          FROM vendas
         WHERE cod_grupoprod IN (SELECT cod_grupoprod FROM grupo_produto WHERE descricao LIKE 'AERION%')
           AND ano = $1 AND natureza_nf2 = 'Venda'
         GROUP BY 1
         ORDER BY receita DESC`;
  try {
    const { rows } = await faturamentoPool.query(query, [ano]);
    res.json({ configured: true, ano, vendedores: rows });
  } catch (error) {
    console.error('Error fetching realizado vendedores anual:', error);
    res.status(500).json({ configured: true, error: 'Falha ao consultar faturamento anual por vendedor' });
  }
});

// ===================== Disparo WhatsApp (via n8n) =====================
// Native dispatcher UI; the actual send is delegated to the existing n8n flow via
// webhook. Pluggable: set DISPARO_WEBHOOK_URL (+ optional DISPARO_WEBHOOK_TOKEN).
const DISPARO_LOG_TABLE = 'disparo_log';
async function ensureDisparoTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${DISPARO_LOG_TABLE} (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by TEXT,
        audience TEXT,
        recipients INTEGER NOT NULL DEFAULT 0,
        message TEXT,
        status TEXT NOT NULL DEFAULT 'queued'
      )
    `);
  } catch (error) {
    console.error('ensureDisparoTable failed:', error.message);
  }
}
ensureDisparoTable();

// Base of the existing n8n disparo flow (e.g. https://n8n.tenryu.com.br/webhook).
const disparoBase = () => String(process.env.DISPARO_WEBHOOK_URL || '').replace(/\/+$/, '');
const disparoToken = () => String(process.env.DISPARO_WEBHOOK_TOKEN || '').trim();
const disparoAllowUnverifiedSend = () => process.env.DISPARO_ALLOW_UNVERIFIED_SEND === 'true';
const disparoRequireOptIn = () => process.env.DISPARO_REQUIRE_OPT_IN === 'true';

// Os workflows legados retornam envelopes diferentes (array puro, {data: []},
// {instancias: []} ou {items: []}). Centralizar a leitura evita que uma
// alteração no Respond to Webhook faça a UI parecer sem instâncias.
const disparoArray = (value, keys = []) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
  }
  if (value.data && value.data !== value) return disparoArray(value.data, keys);
  // n8n às vezes devolve um único registro (não array) em detalhes-campanha.
  if (
    value.phone_number != null
    || value.contact_name != null
    || value.telefone != null
    || (value.status != null && (value.id != null || value.data_envio != null || value.data_erro != null))
  ) {
    return [value];
  }
  return [];
};

const disparoIdentityKeys = (item) => [...new Set([
  item?.id,
  item?.instanceId,
  item?.instance_id,
  item?.instancia_id,
  item?.name,
  item?.instanceName,
  item?.instancia_nome,
  item?.nome,
  item?.instance?.id,
  item?.instance?.instanceId,
  item?.instance?.instanceName,
].filter(value => value !== undefined && value !== null && String(value).trim() !== '')
  .map(value => String(value)))]
;

// Mesmo teto do disparo-wpp (LIMITE_POR_INSTANCIA): mensagens/dia por instância.
const DISPARO_MAX_POR_DIA_INSTANCIA = 30;

async function disparoFetch(path, { method = 'GET', body, timeoutMs = 25000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const token = disparoToken();
    const headers = {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? {
        Authorization: `Bearer ${token}`,
        'X-Webhook-Token': token,
      } : {}),
    };
    const resp = await fetch(`${disparoBase()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      const detail = data?.error || data?.message || `HTTP ${resp.status}`;
      throw new Error(`Webhook ${path}: ${detail}`);
    }
    return { ok: true, status: resp.status, data };
  } finally {
    clearTimeout(timer);
  }
}

// Inboxes do Chatwoot (Channel::Api) ↔ instâncias Evolution. Os nomes nem sempre
// coincidem (inbox "comercial_aerion" x instância "Comercial - Aerion Technologies"),
// então o match exige que todos os tokens do nome do inbox existam no da instância.
const disparoTokens = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .split(/[^a-z0-9]+/)
  .filter(Boolean);

async function disparoInboxesPorInstancia(instancias) {
  const { rows } = await pool.query(
    `SELECT id, name FROM inboxes WHERE account_id = $1 AND channel_type = 'Channel::Api'`,
    [CHATWOOT_ACCOUNT_ID]
  );
  const inboxParaInstancia = new Map();
  for (const inbox of rows) {
    const inboxTokens = disparoTokens(inbox.name);
    if (!inboxTokens.length) continue;
    const inst = instancias.find(i => {
      const instTokens = new Set([...disparoTokens(i.instancia_nome), ...disparoTokens(i.nome)]);
      return inboxTokens.every(token => instTokens.has(token));
    });
    if (inst) inboxParaInstancia.set(Number(inbox.id), inst);
  }
  return inboxParaInstancia;
}

// Junta o cadastro (/listar-instancias) com o estado real de conexão no Evolution
// (/verificar-instancias): connection_state open|close|connecting, profile_name.
async function listarInstanciasVerificadas() {
  const [lista, verificacao] = await Promise.all([
    disparoFetch('/listar-instancias'),
    disparoFetch('/verificar-instancias', { method: 'POST', body: {}, timeoutMs: 30000 }),
  ]);
  const cadastradas = disparoArray(lista.data, ['instancias', 'instances', 'items'])
    .map(item => item?.instance && typeof item.instance === 'object' ? { ...item.instance, ...item } : item)
    .filter(item => item && typeof item === 'object');
  const verificadas = disparoArray(verificacao.data, ['instancias', 'instances', 'items'])
    .map(item => item?.instance && typeof item.instance === 'object' ? { ...item.instance, ...item } : item)
    .filter(item => item && typeof item === 'object');
  const estados = new Map();
  for (const item of verificadas) {
    for (const key of disparoIdentityKeys(item)) estados.set(key, item);
  }
  const instancias = [...cadastradas];
  const known = new Set(cadastradas.flatMap(disparoIdentityKeys));
  for (const item of verificadas) {
    if (!disparoIdentityKeys(item).some(key => known.has(key))) instancias.push(item);
  }
  const findState = (item) => disparoIdentityKeys(item)
    .map(key => estados.get(key))
    .find(Boolean) || {};
  return {
    verificado: verificacao.data?.success !== false,
    instancias: instancias.map(i => ({
      ...i,
      connection_state: findState(i)?.connection_state
        ?? findState(i)?.connectionState
        ?? findState(i)?.state
        ?? i.connection_state ?? i.connectionState ?? i.status ?? null,
      profile_name: findState(i)?.profile_name
        || findState(i)?.profileName
        || i.profile_name || i.profileName || null,
      disponivel: findState(i)?.disponivel ?? null,
    })),
  };
}

app.get('/api/disparo/status', (req, res) => {
  res.json({ configured: Boolean(disparoBase()) });
});

// List Evolution instances via the n8n flow, enriched with live connection state.
app.get('/api/disparo/instancias', async (req, res) => {
  if (!disparoBase()) return res.json({ configured: false, instancias: [] });
  try {
    const { verificado, instancias } = await listarInstanciasVerificadas();
    res.json({
      configured: true,
      verificado,
      instancias,
      conectadas: instancias.filter(i => i.connection_state === 'open').length,
    });
  } catch (error) {
    console.error('listar-instancias failed:', error.message);
    res.status(502).json({ configured: true, error: 'Falha ao listar instâncias.' });
  }
});

// Campaign monitor passthroughs (same contract as the disparo-wpp SPA).
app.get('/api/disparo/campanhas', async (req, res) => {
  if (!disparoBase()) return res.json({ configured: false, campanhas: [] });
  try {
    const resp = await disparoFetch('/campanhas');
    const campanhas = disparoArray(resp.data, ['campanhas', 'items', 'data']);
    res.json({ configured: true, campanhas });
  } catch (error) {
    console.error('listar campanhas failed:', error.message);
    res.status(502).json({ configured: true, error: 'Falha ao listar campanhas.', campanhas: [] });
  }
});

// Destinatários da campanha: status, horário de envio/erro, motivo e instância.
app.get('/api/disparo/campanhas/:id', async (req, res) => {
  if (!disparoBase()) return res.json({ configured: false, envios: [] });
  if (!/^\d+$/.test(String(req.params.id))) return res.status(400).json({ error: 'ID de campanha inválido.' });
  try {
    const id = Number(req.params.id);
    let resp;
    try {
      resp = await disparoFetch(`/detalhes-campanha?campanhaId=${id}`);
    } catch (firstErr) {
      // fallback: alguns workflows aceitam POST
      resp = await disparoFetch('/detalhes-campanha', {
        method: 'POST',
        body: { campanhaId: id },
      });
    }
    const envios = disparoArray(resp.data, ['envios', 'transmissoes', 'items', 'data', 'detalhes', 'rows']);
    res.json({
      configured: true,
      campanhaId: id,
      total: envios.length,
      envios,
    });
  } catch (error) {
    console.error('detalhes campanha failed:', error.message);
    res.status(502).json({
      configured: true,
      error: error.message || 'Falha ao carregar detalhes da campanha.',
      envios: [],
    });
  }
});

app.post('/api/disparo/campanhas/:id/pausar', requireAdmin, async (req, res) => {
  if (!disparoBase()) return res.status(400).json({ configured: false, error: 'Webhook não configurado.' });
  if (!/^\d+$/.test(String(req.params.id))) return res.status(400).json({ error: 'ID de campanha inválido.' });
  try {
    const campanhaId = Number(req.params.id);
    const resp = await disparoFetch('/pausar-campanha', { method: 'POST', body: { campanhaId } });
    if (resp.ok) {
      notifyAccountUsers(pool, {
        accountId: CHATWOOT_ACCOUNT_ID,
        type: 'disparo.paused',
        title: `Campanha #${campanhaId} pausada`,
        body: req.auth?.name ? `Por ${req.auth.name}` : null,
        data: { view: 'Disparo WhatsApp', campanha_id: campanhaId },
        dedupeKey: `campanha:${campanhaId}:paused:${Date.now()}`,
      }).catch((err) => console.warn('[disparo] notify pause failed:', err.message));
    }
    res.json({ configured: true, ok: resp.ok, ...(resp.data || {}) });
  } catch (error) {
    console.error('pausar campanha failed:', error.message);
    res.status(502).json({ configured: true, error: 'Falha ao pausar campanha.' });
  }
});

app.post('/api/disparo/campanhas/:id/retomar', requireAdmin, async (req, res) => {
  if (!disparoBase()) return res.status(400).json({ configured: false, error: 'Webhook não configurado.' });
  if (!/^\d+$/.test(String(req.params.id))) return res.status(400).json({ error: 'ID de campanha inválido.' });
  try {
    const resp = await disparoFetch(`/retomar-campanha?campanhaId=${Number(req.params.id)}`);
    res.json({ configured: true, ok: resp.ok, ...(resp.data || {}) });
  } catch (error) {
    console.error('retomar campanha failed:', error.message);
    res.status(502).json({ configured: true, error: 'Falha ao retomar campanha.' });
  }
});

app.post('/api/disparo/campanhas/:id/cancelar', requireAdmin, async (req, res) => {
  if (!disparoBase()) return res.status(400).json({ configured: false, error: 'Webhook não configurado.' });
  if (!/^\d+$/.test(String(req.params.id))) return res.status(400).json({ error: 'ID de campanha inválido.' });
  try {
    const campanhaId = Number(req.params.id);
    const resp = await disparoFetch('/cancelar-campanha', { method: 'POST', body: { campanhaId } });
    if (resp.ok) {
      notifyAccountUsers(pool, {
        accountId: CHATWOOT_ACCOUNT_ID,
        type: 'disparo.cancelled',
        title: `Campanha #${campanhaId} cancelada`,
        body: req.auth?.name ? `Por ${req.auth.name}` : null,
        data: { view: 'Disparo WhatsApp', campanha_id: campanhaId },
        dedupeKey: `campanha:${campanhaId}:cancelled:${Date.now()}`,
      }).catch((err) => console.warn('[disparo] notify cancel failed:', err.message));
    }
    res.json({ configured: true, ok: resp.ok, ...(resp.data || {}) });
  } catch (error) {
    console.error('cancelar campanha failed:', error.message);
    res.status(502).json({ configured: true, error: 'Falha ao cancelar campanha.' });
  }
});

// ---------- Resolução de público + proteção anti-ban (dados do Chatwoot) ----------
const disparoDdd = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return digits.slice(2, 4);
  if (digits.length >= 10) return digits.slice(0, 2);
  return '';
};

const disparoEmbaralhar = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Personalização de template: {nome} = primeiro nome do contacts.name do Chatwoot.
// Também suporta {nome_completo} e {empresa}.
const disparoPrimeiroNome = (nome) => {
  const full = String(nome || '').trim();
  if (!full) return 'cliente';
  const first = full.split(/\s+/).filter(Boolean)[0];
  return first || full;
};

const personalizarTextoDisparo = (texto, contato) => {
  if (texto == null || texto === '') return texto;
  const nomeCompleto = String(contato?.nome_completo || contato?.nome || '').trim() || 'cliente';
  const primeiro = String(contato?.primeiro_nome || '').trim() || disparoPrimeiroNome(nomeCompleto);
  const empresa = String(contato?.empresa || '').trim() || nomeCompleto;
  return String(texto)
    .replace(/\{nome_completo\}/gi, nomeCompleto)
    .replace(/\{empresa\}/gi, empresa)
    .replace(/\{nome\}/gi, primeiro);
};

const personalizarMensagemDisparo = (msg, contato) => ({
  ...msg,
  texto: personalizarTextoDisparo(msg.texto, contato),
  legenda: personalizarTextoDisparo(msg.legenda, contato),
});

// Enriquecer contatos para o n8n: nome legível + campos já resolvidos (fallback se o
// workflow não fizer replace de {nome} no pool de mensagens).
//
// Contrato do Disparo Massivo v6 (n8n): cada item em destinatarios.contatos precisa de
// `contact_id` + `phone_number` (nodes "1. Preparar Dados" e "7b. Usar Contatos Diretos").
// Mantemos também `id`/`telefone`/`nome` para compatibilidade com o restante do app.
const enriquecerContatosDisparo = (contatos, mensagens) => contatos.map((c, i) => {
  const nomeCompleto = String(c.nome || '').trim();
  const primeiro = disparoPrimeiroNome(nomeCompleto);
  const telefone = String(c.telefone || c.phone_number || '').trim();
  const contactId = Number(c.id ?? c.contact_id);
  const ctx = {
    nome: nomeCompleto,
    nome_completo: nomeCompleto,
    primeiro_nome: primeiro,
    empresa: c.empresa || null,
  };
  const base = mensagens[i % Math.max(mensagens.length, 1)] || { tipo: 'texto', texto: null };
  const resolvida = personalizarMensagemDisparo(base, ctx);
  const textoFinal = resolvida.texto || resolvida.legenda || null;
  return {
    id: Number.isFinite(contactId) ? contactId : c.id,
    // Aliases exigidos pelo workflow n8n (sem isso a fila fica com 0 destinatários)
    contact_id: Number.isFinite(contactId) ? contactId : c.id,
    telefone,
    phone_number: telefone,
    // `nome` = primeiro nome: é o que o n8n costuma injetar em {nome}
    nome: primeiro,
    nome_completo: nomeCompleto || null,
    primeiro_nome: primeiro,
    empresa: c.empresa || null,
    // Campos pré-resolvidos (rodízio do pool) para workflows que leem do contato
    mensagem: textoFinal,
    texto: resolvida.texto,
    legenda: resolvida.legenda,
    tipo: resolvida.tipo || 'texto',
    arquivo_nome: resolvida.arquivo_nome || null,
    arquivo_tipo: resolvida.arquivo_tipo || null,
    arquivo_base64: resolvida.arquivo_base64 || null,
    // Pool inteiro já personalizado (se o n8n iterar mensagens por contato)
    mensagens: mensagens.map(m => personalizarMensagemDisparo(m, ctx)),
  };
});

// Resolve o público direto no banco do Chatwoot com os mesmos seletores da UI
// (funil/tags/canal/ddd em AND entre grupos preenchidos), deduplicado por telefone.
async function resolverPublicoDisparo(destinatarios) {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.phone_number,
            c.custom_attributes->>'Funil_Vendas' AS funil,
            TRIM(COALESCE(c.custom_attributes->>'Canal', '')) AS canal,
            c.additional_attributes->>'company_name' AS empresa,
            c.custom_attributes AS atributos,
            COALESCE(array_agg(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL), '{}') AS labels
       FROM contacts c
       LEFT JOIN taggings tg ON tg.taggable_type = 'Contact' AND tg.context = 'labels' AND tg.taggable_id = c.id
       LEFT JOIN tags t ON t.id = tg.tag_id
      WHERE c.account_id = $1 AND COALESCE(c.phone_number, '') <> ''
      GROUP BY c.id`,
    [CHATWOOT_ACCOUNT_ID]
  );
  const idsFixos = new Set((destinatarios.contatos || [])
    .map(c => Number(typeof c === 'object' && c !== null ? c.id : c))
    .filter(Number.isFinite));
  const telefonesVistos = new Set();
  const publico = [];
  for (const row of rows) {
    if (destinatarios.funil_vendas.length && !destinatarios.funil_vendas.includes(row.funil)) continue;
    if (destinatarios.tags.length && !destinatarios.tags.some(tag => (row.labels || []).includes(tag))) continue;
    if (destinatarios.canais.length && !destinatarios.canais.includes(row.canal)) continue;
    if (destinatarios.ddds.length && !destinatarios.ddds.includes(disparoDdd(row.phone_number))) continue;
    if (idsFixos.size && !idsFixos.has(Number(row.id))) continue;
    const atributos = row.atributos && typeof row.atributos === 'object' ? row.atributos : {};
    const boolAttr = (keys) => keys.some(key => ['true', '1', 'yes', 'sim'].includes(String(atributos[key]).trim().toLowerCase()));
    if (boolAttr(['whatsapp_opt_out', 'opt_out', 'nao_contatar', 'não_contatar', 'bloqueado'])) continue;
    if (disparoRequireOptIn() && !boolAttr(['whatsapp_opt_in', 'opt_in', 'consentimento_whatsapp', 'consentimento'])) continue;
    const telefone = String(row.phone_number).trim();
    const chave = telefone.replace(/\D/g, '');
    if (!chave || telefonesVistos.has(chave)) continue;
    telefonesVistos.add(chave);
    // `nome` = contacts.name do Chatwoot (pessoa ou razão social cadastrada no contato)
    publico.push({ id: Number(row.id), nome: row.name, telefone, empresa: row.empresa || null });
  }
  return publico;
}

// Filtros anti-spam ligados ao Chatwoot: cooldown de quem já recebeu mensagem
// nossa há pouco tempo e contatos com conversa aberta (já em atendimento).
async function aplicarFiltrosChatwoot(publico, { cooldownDias, pularConversasAbertas, inboxIds }) {
  const descartados = { cooldown: 0, conversas_abertas: 0 };
  const ids = publico.map(c => c.id);
  if (!ids.length || !inboxIds.length) return { publico, descartados };
  const excluir = new Set();
  if (cooldownDias > 0) {
    const { rows } = await pool.query(
      `SELECT DISTINCT conv.contact_id
         FROM messages m
         JOIN conversations conv ON conv.id = m.conversation_id
        WHERE m.account_id = $1 AND m.message_type = 1
          AND m.created_at >= NOW() - make_interval(days => $2)
          AND conv.inbox_id = ANY($3) AND conv.contact_id = ANY($4)`,
      [CHATWOOT_ACCOUNT_ID, cooldownDias, inboxIds, ids]
    );
    for (const r of rows) excluir.add(Number(r.contact_id));
    descartados.cooldown = excluir.size;
  }
  if (pularConversasAbertas) {
    const { rows } = await pool.query(
      `SELECT DISTINCT contact_id FROM conversations
        WHERE account_id = $1 AND status = 0 AND inbox_id = ANY($2) AND contact_id = ANY($3)`,
      [CHATWOOT_ACCOUNT_ID, inboxIds, ids]
    );
    for (const r of rows) {
      const id = Number(r.contact_id);
      if (!excluir.has(id)) descartados.conversas_abertas += 1;
      excluir.add(id);
    }
  }
  return { publico: publico.filter(c => !excluir.has(c.id)), descartados };
}

// Última conversa WhatsApp de cada contato → instância "dona" do lead, para que
// ele sempre receba do mesmo número entre campanhas.
async function ultimaInstanciaPorContato(ids, inboxParaInstancia) {
  if (!ids.length || !inboxParaInstancia.size) return new Map();
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (contact_id) contact_id, inbox_id,
            COALESCE(last_activity_at, updated_at, created_at) AS last_at
       FROM conversations
      WHERE account_id = $1 AND contact_id = ANY($2) AND inbox_id = ANY($3)
      ORDER BY contact_id, COALESCE(last_activity_at, updated_at, created_at) DESC`,
    [CHATWOOT_ACCOUNT_ID, ids, [...inboxParaInstancia.keys()]]
  );
  const porContato = new Map();
  for (const r of rows) {
    const inst = inboxParaInstancia.get(Number(r.inbox_id));
    if (inst) porContato.set(Number(r.contact_id), { instanciaId: inst.id, lastAt: r.last_at });
  }
  return porContato;
}

// Start a campaign via the existing n8n flow. Mirrors the full disparo-wpp
// /iniciar-disparo contract: rich destinatarios (funil/tags/canal/ddd/contatos),
// a pool of mensagens (texto/mídia) and pacing/scheduling config. Legacy single
// message + funil_vendas body is still accepted for backward compatibility.
//
// Camada anti-ban (config): fixarNumero (lead recebe sempre da instância da sua
// última conversa), cooldownDias (pula quem já recebeu mensagem há pouco tempo),
// pularConversasAbertas (não interrompe atendimento em curso), priorizarRecentes
// (leads quentes primeiro, resto embaralhado). Quando ativa, o público é resolvido
// no banco do Chatwoot e vira uma campanha em modo `contatos` por instância.
app.post('/api/disparo/send', requireAdmin, async (req, res) => {
  const body = req.body || {};
  // Messages: accept rich `mensagens` array or legacy single `message`.
  const mensagens = (Array.isArray(body.mensagens) && body.mensagens.length)
    ? body.mensagens.map(m => ({
        tipo: m.tipo || 'texto',
        texto: m.texto || null,
        legenda: m.legenda || null,
        arquivo_nome: m.arquivo_nome || null,
        arquivo_tipo: m.arquivo_tipo || null,
        arquivo_base64: m.arquivo_base64 || null,
      }))
    : (String(body.message || '').trim()
        ? [{ tipo: 'texto', texto: String(body.message).trim(), legenda: null, arquivo_nome: null, arquivo_tipo: null, arquivo_base64: null }]
        : []);
  // Recipients: accept rich `destinatarios` object or legacy funil_vendas/stage.
  let destinatarios = (body.destinatarios && typeof body.destinatarios === 'object') ? body.destinatarios : null;
  if (!destinatarios) {
    const stages = Array.isArray(body.funil_vendas) ? body.funil_vendas : (body.stage ? [body.stage] : []);
    destinatarios = { modo: 'funil', funil_vendas: stages, tags: [], canais: [], ddds: [], contatos: [], combinar: false };
  }
  destinatarios = {
    modo: destinatarios.modo || 'funil',
    funil_vendas: Array.isArray(destinatarios.funil_vendas) ? destinatarios.funil_vendas : [],
    tags: Array.isArray(destinatarios.tags) ? destinatarios.tags : [],
    canais: Array.isArray(destinatarios.canais) ? destinatarios.canais : [],
    ddds: Array.isArray(destinatarios.ddds) ? destinatarios.ddds : [],
    contatos: Array.isArray(destinatarios.contatos) ? destinatarios.contatos : [],
    combinar: Boolean(destinatarios.combinar),
  };
  const instancias = Array.isArray(body.instancias) ? body.instancias : [];
  const nomeCampanha = body.nomeCampanha ? String(body.nomeCampanha) : null;
  const cfg = (body.config && typeof body.config === 'object') ? body.config : {};
  const minInterval = Math.max(30, Number(cfg.minInterval) || 30);
  const config = {
    maxPerDay: Math.max(1, Math.min(DISPARO_MAX_POR_DIA_INSTANCIA, Number(cfg.maxPerDay) || 30)),
    minInterval,
    maxInterval: Math.max(minInterval, Number(cfg.maxInterval) || 60),
    sendPeriod: cfg.sendPeriod || 'integral',
    diasSemana: (Array.isArray(cfg.diasSemana) && cfg.diasSemana.length) ? cfg.diasSemana.map(Number) : [1, 2, 3, 4, 5],
  };
  // Lista só de contatos manuais (sem funil/tags/canal/ddd): o usuário escolheu
  // cada lead de propósito (ex.: teste para si). Anti-spam de cooldown/conversa
  // aberta é para campanhas em massa — aqui fica desligado de propósito.
  const soContatosManuais = destinatarios.contatos.length > 0
    && !destinatarios.funil_vendas.length
    && !destinatarios.tags.length
    && !destinatarios.canais.length
    && !destinatarios.ddds.length;
  const antiBan = {
    fixarNumero: cfg.fixarNumero !== false,
    priorizarRecentes: cfg.priorizarRecentes !== false,
    cooldownDias: soContatosManuais
      ? 0
      : (Number.isFinite(Number(cfg.cooldownDias)) ? Math.max(0, Math.floor(Number(cfg.cooldownDias))) : 7),
    pularConversasAbertas: soContatosManuais
      ? false
      : cfg.pularConversasAbertas !== false,
    soContatosManuais,
  };
  const hasSelector = destinatarios.funil_vendas.length || destinatarios.tags.length
    || destinatarios.canais.length || destinatarios.ddds.length || destinatarios.contatos.length;
  if (!mensagens.length || !mensagens.some(m => m.texto || m.arquivo_base64)) {
    return res.status(400).json({ error: 'Adicione ao menos uma mensagem.' });
  }
  if (!hasSelector) {
    return res.status(400).json({ error: 'Selecione ao menos um público (funil, tags, canal, DDD ou contatos).' });
  }
  if (!instancias.length) return res.status(400).json({ error: 'Selecione ao menos uma instância.' });
  const audienceLabel = `${destinatarios.modo}: ${[...destinatarios.funil_vendas, ...destinatarios.tags, ...destinatarios.canais, ...destinatarios.ddds].join(', ') || `${destinatarios.contatos.length} contato(s)`}`;
  const firstText = (mensagens.find(m => m.texto)?.texto) || '(mídia)';

  if (!disparoBase()) {
    const logId = await registrarDisparoLog(req, audienceLabel, destinatarios.contatos.length, firstText, 'unconfigured');
    return res.json({ configured: false, log_id: logId });
  }

  // 1) Estado real das instâncias: nunca disparar por número desconectado.
  let instanciasInfo = [];
  try {
    const verificado = await listarInstanciasVerificadas();
    if (!verificado.verificado && !disparoAllowUnverifiedSend()) {
      return res.status(503).json({
        configured: true,
        error: 'Não foi possível verificar o estado das instâncias. A campanha foi bloqueada por segurança.',
      });
    }
    instanciasInfo = verificado.instancias;
  } catch (error) {
    console.error('disparo send: verificação de instâncias indisponível:', error.message);
    return res.status(503).json({
      configured: true,
      error: 'Não foi possível consultar as instâncias no n8n/Evolution. A campanha foi bloqueada por segurança.',
    });
  }
  const selecionadas = instanciasInfo.filter(i =>
    instancias.some(sel => String(sel) === String(i.id) || String(sel) === String(i.instancia_nome) || String(sel) === String(i.nome)));
  const aptas = selecionadas.filter(i => i.connection_state === 'open'
    || (i.connection_state == null && disparoAllowUnverifiedSend()));
  const instanciasDescartadas = selecionadas
    .filter(i => !aptas.includes(i))
    .map(i => i.nome || i.instancia_nome || String(i.id));
  if (!selecionadas.length) {
    return res.status(409).json({
      configured: true,
      error: 'Nenhuma das instâncias selecionadas foi encontrada na resposta atual do n8n/Evolution. Atualize a lista e tente novamente.',
    });
  }
  if (!aptas.length) {
    return res.status(409).json({
      configured: true,
      error: `Nenhuma instância selecionada está conectada (${instanciasDescartadas.join(', ')}). Reconecte no Evolution antes de disparar.`,
      instancias_descartadas: instanciasDescartadas,
    });
  }

  // 2) Público resolvido no Chatwoot + filtros anti-spam + roteamento por instância.
  let plano = null;
  let resumo = null;
  if (aptas.length) {
    try {
      const inboxParaInstancia = await disparoInboxesPorInstancia(aptas);
      if (!inboxParaInstancia.size) {
        return res.status(409).json({
          configured: true,
          error: 'Não existe mapeamento seguro entre as instâncias selecionadas e os inboxes do Chatwoot. Configure o vínculo antes de disparar.',
        });
      }
      const publicoBruto = await resolverPublicoDisparo(destinatarios);
      const { publico, descartados } = await aplicarFiltrosChatwoot(publicoBruto, {
        cooldownDias: antiBan.cooldownDias,
        pularConversasAbertas: antiBan.pularConversasAbertas,
        inboxIds: [...inboxParaInstancia.keys()],
      });
      if (!publico.length) {
        const partes = [];
        if (descartados.cooldown > 0) {
          partes.push(`${descartados.cooldown} em cooldown (${antiBan.cooldownDias} dia${antiBan.cooldownDias === 1 ? '' : 's'})`);
        }
        if (descartados.conversas_abertas > 0) {
          partes.push(`${descartados.conversas_abertas} com conversa aberta`);
        }
        const detalhe = partes.length ? ` Descartados: ${partes.join('; ')}.` : '';
        const dica = antiBan.cooldownDias > 0 || antiBan.pularConversasAbertas
          ? ' Para um teste pontual, na etapa Ritmo defina cooldown = 0 e desative “Pular conversas abertas”.'
          : ' Ajuste o público e tente de novo.';
        return res.status(400).json({
          configured: true,
          error: `Nenhum contato restante após os filtros anti-spam.${detalhe}${dica}`,
          resumo: {
            publico: publicoBruto.length,
            apos_filtros: 0,
            descartados,
            filtros: {
              cooldownDias: antiBan.cooldownDias,
              pularConversasAbertas: antiBan.pularConversasAbertas,
            },
          },
        });
      }
      const historico = (antiBan.fixarNumero || antiBan.priorizarRecentes)
        ? await ultimaInstanciaPorContato(publico.map(c => c.id), inboxParaInstancia)
        : new Map();
      const grupos = new Map(aptas.map(i => [i.id, []]));
      const semDono = [];
      let fixados = 0;
      for (const contato of publico) {
        const ultimo = historico.get(contato.id);
        if (antiBan.fixarNumero && ultimo && grupos.has(ultimo.instanciaId)) {
          grupos.get(ultimo.instanciaId).push({ ...contato, lastAt: ultimo.lastAt });
          fixados += 1;
        } else {
          semDono.push({ ...contato, lastAt: ultimo ? ultimo.lastAt : null });
        }
      }
      // Sem histórico: distribui aleatório mantendo os grupos equilibrados.
      for (const contato of disparoEmbaralhar(semDono)) {
        const [, menorGrupo] = [...grupos.entries()].sort((a, b) => a[1].length - b[1].length)[0];
        menorGrupo.push(contato);
      }
      plano = aptas
        .map(inst => {
          const doGrupo = grupos.get(inst.id) || [];
          const quentes = doGrupo.filter(c => c.lastAt).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
          const frios = disparoEmbaralhar(doGrupo.filter(c => !c.lastAt));
          const ordenados = antiBan.priorizarRecentes ? [...quentes, ...frios] : disparoEmbaralhar(doGrupo);
          return { instancia: inst, contatos: ordenados.map(({ lastAt, ...c }) => c) };
        })
        .filter(g => g.contatos.length);
      resumo = {
        publico: publicoBruto.length,
        apos_filtros: publico.length,
        fixados_por_historico: fixados,
        descartados,
        so_contatos_manuais: soContatosManuais,
        filtros: {
          cooldownDias: antiBan.cooldownDias,
          pularConversasAbertas: antiBan.pularConversasAbertas,
        },
      };
    } catch (error) {
      console.error('disparo send: resolução via Chatwoot falhou:', error.message);
      return res.status(502).json({
        configured: true,
        error: 'Não foi possível aplicar os filtros do Chatwoot. A campanha foi bloqueada por segurança.',
      });
    }
  }

  const totalDestinatarios = plano
    ? plano.reduce((sum, g) => sum + g.contatos.length, 0)
    : destinatarios.contatos.length;
  const logId = await registrarDisparoLog(req, audienceLabel, totalDestinatarios, firstText, 'sent');

  try {
    // 3a) Caminho anti-ban: uma campanha em modo `contatos` por instância.
    // Contatos saem enriquecidos com nome do Chatwoot + texto já personalizado
    // ({nome} → primeiro nome). O pool `mensagens` mantém o template para o n8n
    // que ainda faz replace; os campos no contato cobrem o caso em que não faz.
    if (plano) {
      const campanhas = [];
      for (const grupo of plano) {
        const rotulo = grupo.instancia.nome || grupo.instancia.instancia_nome || String(grupo.instancia.id);
        const contatosEnriquecidos = enriquecerContatosDisparo(grupo.contatos, mensagens);
        const payload = {
          destinatarios: {
            modo: 'contatos',
            funil_vendas: [],
            tags: [],
            canais: [],
            ddds: [],
            contatos: contatosEnriquecidos,
            combinar: false,
          },
          nomeCampanha: nomeCampanha
            ? (plano.length > 1 ? `${nomeCampanha} · ${rotulo}` : nomeCampanha)
            : null,
          mensagens,
          instancias: [grupo.instancia.id],
          config,
        };
        const resp = await disparoFetch('/iniciar-disparo', { method: 'POST', body: payload, timeoutMs: 90000 });
        campanhas.push({
          instancia: rotulo,
          instancia_id: grupo.instancia.id,
          ok: resp.ok,
          campanhaId: resp.data?.campanhaId ?? null,
          totalEnfileirados: resp.data?.totalEnfileirados ?? grupo.contatos.length,
          contatos: grupo.contatos.length,
          erro: resp.ok ? null : (resp.data?.error || `HTTP ${resp.status}`),
        });
      }
      const ok = campanhas.some(c => c.ok);
      const totalEnfileirados = campanhas.reduce((sum, c) => sum + (Number(c.totalEnfileirados) || 0), 0);
      const campanhaLabel = nomeCampanha || (campanhas.length === 1 && campanhas[0].campanhaId
        ? `#${campanhas[0].campanhaId}`
        : 'Disparo WhatsApp');
      if (ok) {
        notifyAccountUsers(pool, {
          accountId: CHATWOOT_ACCOUNT_ID,
          type: 'disparo.started',
          title: `Campanha iniciada · ${String(campanhaLabel).slice(0, 60)}`,
          body: `${totalEnfileirados} destinatário(s) enfileirado(s).`,
          data: {
            view: 'Disparo WhatsApp',
            campanha_id: campanhas.length === 1 ? campanhas[0].campanhaId : null,
            total: totalEnfileirados,
          },
          dedupeKey: `disparo:start:${logId || Date.now()}`,
        }).catch((err) => console.warn('[disparo] notify start failed:', err.message));
      } else {
        notifyAccountUsers(pool, {
          accountId: CHATWOOT_ACCOUNT_ID,
          type: 'disparo.failed',
          title: `Falha no disparo · ${String(campanhaLabel).slice(0, 60)}`,
          body: campanhas.map(c => c.erro).filter(Boolean).join('; ').slice(0, 200) || 'Nenhuma instância enfileirou contatos.',
          data: { view: 'Disparo WhatsApp' },
          dedupeKey: `disparo:fail:${logId || Date.now()}`,
        }).catch((err) => console.warn('[disparo] notify fail failed:', err.message));
      }
      return res.json({
        configured: true,
        ok,
        log_id: logId,
        campanhas,
        resumo,
        instancias_descartadas: instanciasDescartadas,
        campanhaId: campanhas.length === 1 ? campanhas[0].campanhaId : undefined,
        totalEnfileirados,
      });
    }

    // 3b) Fallback: contrato original — o próprio n8n resolve o público.
    const payload = { destinatarios, nomeCampanha, mensagens, instancias, config };
    const resp = await disparoFetch('/iniciar-disparo', { method: 'POST', body: payload, timeoutMs: 90000 });
    const campanhaLabel = nomeCampanha || (resp.data?.campanhaId ? `#${resp.data.campanhaId}` : 'Disparo WhatsApp');
    if (resp.ok) {
      notifyAccountUsers(pool, {
        accountId: CHATWOOT_ACCOUNT_ID,
        type: 'disparo.started',
        title: `Campanha iniciada · ${String(campanhaLabel).slice(0, 60)}`,
        body: resp.data?.totalEnfileirados
          ? `${resp.data.totalEnfileirados} destinatário(s) enfileirado(s).`
          : null,
        data: {
          view: 'Disparo WhatsApp',
          campanha_id: resp.data?.campanhaId || null,
        },
        dedupeKey: `disparo:start:${logId || Date.now()}`,
      }).catch((err) => console.warn('[disparo] notify start failed:', err.message));
    } else {
      notifyAccountUsers(pool, {
        accountId: CHATWOOT_ACCOUNT_ID,
        type: 'disparo.failed',
        title: `Falha no disparo · ${String(campanhaLabel).slice(0, 60)}`,
        body: String(resp.data?.error || `HTTP ${resp.status}`).slice(0, 200),
        data: { view: 'Disparo WhatsApp' },
        dedupeKey: `disparo:fail:${logId || Date.now()}`,
      }).catch((err) => console.warn('[disparo] notify fail failed:', err.message));
    }
    return res.json({ configured: true, ok: resp.ok, status: resp.status, log_id: logId, ...(resp.data || {}) });
  } catch (error) {
    console.error('disparo webhook failed:', error.message);
    // Surface the real n8n/Evolution cause (aborts, HTTP status, webhook body)
    // instead of an opaque message — timeouts read as "AbortError".
    const cause = error.name === 'AbortError'
      ? 'Tempo esgotado aguardando o n8n (timeout).'
      : String(error.message || '').replace(/^Webhook\s+\/iniciar-disparo:\s*/, '');
    notifyAccountUsers(pool, {
      accountId: CHATWOOT_ACCOUNT_ID,
      type: 'disparo.failed',
      title: 'Falha ao acionar o n8n',
      body: String(cause || error.message || 'Erro desconhecido').slice(0, 200),
      data: { view: 'Disparo WhatsApp' },
      dedupeKey: `disparo:fail:ex:${Date.now()}`,
    }).catch(() => {});
    return res.status(502).json({
      configured: true,
      error: 'Falha ao acionar o n8n.',
      detail: cause || undefined,
    });
  }
});

async function registrarDisparoLog(req, audience, recipients, message, status) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO ${DISPARO_LOG_TABLE} (created_by, audience, recipients, message, status)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [req.auth?.sub || null, audience, recipients, message, status]
    );
    return rows[0]?.id ?? null;
  } catch (error) {
    console.error('disparo log failed:', error.message);
    return null;
  }
}

// Real-time campaign dashboard passthrough (read-only) from the n8n flow.
app.get('/api/disparo/dashboard', async (req, res) => {
  if (!disparoBase()) return res.json({ configured: false });
  try {
    const resp = await disparoFetch('/dashboard');
    res.json({ configured: true, ...(resp.data || {}) });
  } catch (error) {
    console.error('disparo dashboard failed:', error.message);
    res.status(502).json({ configured: true, error: 'Falha ao consultar o dashboard.' });
  }
});

const HISTORY_TABLE = 'kanban_stage_history';
const ACTIVITY_TABLE = 'app_activity_logs';
const LICITACAO_TABLE = 'licitacao_opportunities';
const LICITACAO_REQUIREMENTS_TABLE = 'licitacao_requirements';
const LICITACAO_ITEMS_TABLE = 'licitacao_items';
const LICITACAO_ITEM_REQUIREMENTS_TABLE = 'licitacao_item_requirements';
const LICITACAO_CONTACTS_TABLE = 'licitacao_contacts';
const LICITACAO_INTERMEDIARIOS_TABLE = 'licitacao_intermediarios';
const LICITACAO_WATCHLIST_TABLE = 'licitacao_watchlist';
const LICITACAO_SIGNALS_TABLE = 'licitacao_signals';
const LICITACAO_COMMENTS_TABLE = 'licitacao_comments';
const EDITAL_WATCHLIST_TABLE = 'edital_watchlist';
const EDITAL_SIGNALS_TABLE = 'edital_signals';
const WATCHLIST_NOTIFICATIONS_TABLE = 'watchlist_notifications';
const PNCP_RESULT_CACHE_TABLE = 'pncp_result_cache';
const PNCP_SEARCH_JOBS_TABLE = 'pncp_search_jobs';
const PNCP_SEARCH_JOB_RESULTS_TABLE = 'pncp_search_job_results';
const PCA_PLANOS_TABLE = 'pca_planos';
const PCA_ITENS_TABLE = 'pca_itens';
const PCA_WATCHLIST_TABLE = 'pca_watchlist';
const PCA_SIGNALS_TABLE = 'pca_signals';
const PCA_SYNC_STATE_TABLE = 'pca_sync_state';
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

  // Status só Ativo|Suspenso; encerramento fica na coluna do pipe (ex.: 13. Perdido).
  // Limpa legado + auto-move antigo que gravava status='perdido'.
  const statusFix = await pool.query(
    `
      UPDATE ${LICITACAO_TABLE}
      SET status = 'ativo', updated_at = NOW()
      WHERE LOWER(COALESCE(NULLIF(TRIM(status), ''), 'ativo')) NOT IN ('ativo', 'suspenso')
    `
  );
  if (statusFix.rowCount > 0) {
    console.log(`[licitacoes] status normalizado para ativo: ${statusFix.rowCount} card(s) (legado/auto-move)`);
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
      source TEXT NOT NULL,
      actor_id INTEGER,
      actor_name TEXT
    );
  `);
  await pool.query(`ALTER TABLE ${HISTORY_TABLE} ADD COLUMN IF NOT EXISTS actor_id INTEGER;`);
  await pool.query(`ALTER TABLE ${HISTORY_TABLE} ADD COLUMN IF NOT EXISTS actor_name TEXT;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_kanban_history_contact ON ${HISTORY_TABLE} (contact_id, changed_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_kanban_history_changed ON ${HISTORY_TABLE} (changed_at);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_kanban_history_stage ON ${HISTORY_TABLE} (to_stage, changed_at);`);
};

const createActivityTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${ACTIVITY_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      account_id INTEGER,
      actor_id INTEGER,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      entity_name TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_app_activity_logs_created ON ${ACTIVITY_TABLE} (created_at DESC);`);
};

const recordActivity = async (req, { accountId = CHATWOOT_ACCOUNT_ID, action, entityType, entityId, entityName, details = {} }) => {
  const actorId = Number.isFinite(Number(req.auth?.uid)) ? Number(req.auth.uid) : null;
  const actorName = req.auth?.name || req.auth?.sub || 'Usuario do painel';
  try {
    await pool.query(
      `INSERT INTO ${ACTIVITY_TABLE} (account_id, actor_id, actor_name, action, entity_type, entity_id, entity_name, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [accountId, actorId, actorName, action, entityType, entityId == null ? null : String(entityId), entityName || null, JSON.stringify(details)]
    );
  } catch (error) {
    console.error('recordActivity failed:', error.message);
  }
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

    // Contatos que realmente trocaram de etapa neste ciclo.
    const changed = [];
    contacts.forEach(contact => {
      const toStage = contact.custom_attributes?.Funil_Vendas || null;
      if (!toStage) {
        return;
      }
      const fromStage = lastStageMap.get(contact.id) || null;
      if (fromStage === toStage) {
        return;
      }
      changed.push({ id: contact.id, account_id: contact.account_id, fromStage, toStage });
    });

    if (changed.length === 0) {
      return;
    }

    // Atribuição: prefere o agente responsável (assignee) da conversa mais recente.
    // Contatos podem estar sem assignee quando a etapa é alterada diretamente no Chatwoot;
    // nesse caso, usa o único vendedor que enviou mensagem/nota nas últimas 24h. Se mais de
    // um vendedor atuou, mantém NULL para não creditar o movimento à pessoa errada.
    const changedIds = changed.map(c => c.id);
    const { rows: assigneeRows } = await pool.query(
      `SELECT DISTINCT ON (conv.contact_id)
              conv.contact_id,
              conv.assignee_id,
              COALESCE(NULLIF(TRIM(u.display_name), ''), NULLIF(TRIM(u.name), ''), u.email) AS actor_name
         FROM conversations conv
         LEFT JOIN users u ON u.id = conv.assignee_id
        WHERE conv.contact_id = ANY($1)
        ORDER BY conv.contact_id, conv.updated_at DESC`,
      [changedIds]
    );
    const actorMap = new Map(assigneeRows
      .filter(row => row.assignee_id != null)
      .map(row => [row.contact_id, {
        id: Number(row.assignee_id),
        name: row.actor_name || null,
      }]));

    const sellerGroups = await getSellerGroups(CHATWOOT_ACCOUNT_ID);
    const sellerIdToGroup = new Map();
    for (const group of sellerGroups) {
      for (const userId of group.user_ids) sellerIdToGroup.set(Number(userId), group);
    }
    const sellerIds = Array.from(sellerIdToGroup.keys());
    const unassignedIds = changedIds.filter(id => !actorMap.has(id));

    if (unassignedIds.length > 0 && sellerIds.length > 0) {
      const { rows: recentSellerRows } = await pool.query(
        `SELECT conv.contact_id,
                m.sender_id,
                COALESCE(NULLIF(TRIM(u.display_name), ''), NULLIF(TRIM(u.name), ''), u.email) AS actor_name,
                MAX(m.created_at) AS last_activity_at
           FROM messages m
           INNER JOIN conversations conv ON conv.id = m.conversation_id
           LEFT JOIN users u ON u.id = m.sender_id
          WHERE conv.contact_id = ANY($1)
            AND m.sender_type = 'User'
            AND m.sender_id = ANY($2::int[])
            AND m.created_at >= NOW() - INTERVAL '24 hours'
            AND (
              (m.message_type = 1 AND COALESCE(m."private", false) = false)
              OR COALESCE(m."private", false) = true
            )
          GROUP BY conv.contact_id, m.sender_id, u.display_name, u.name, u.email
          ORDER BY conv.contact_id, last_activity_at DESC`,
        [unassignedIds, sellerIds]
      );

      const candidatesByContact = new Map();
      for (const row of recentSellerRows) {
        const group = sellerIdToGroup.get(Number(row.sender_id));
        if (!group) continue;
        const current = candidatesByContact.get(row.contact_id) || new Map();
        if (!current.has(group.id)) {
          current.set(group.id, {
            id: Number(row.sender_id),
            name: row.actor_name || group.name || null,
          });
        }
        candidatesByContact.set(row.contact_id, current);
      }

      for (const [contactId, candidates] of candidatesByContact) {
        if (candidates.size === 1) actorMap.set(contactId, candidates.values().next().value);
      }
    }

    const inserts = [];
    const values = [];
    let index = 1;
    changed.forEach(({ id, account_id, fromStage, toStage }) => {
      const actor = actorMap.get(id) || null;
      values.push(id, account_id, fromStage, toStage, 'polling', actor?.id || null, actor?.name || null);
      inserts.push(`($${index}, $${index + 1}, $${index + 2}, $${index + 3}, NOW(), $${index + 4}, $${index + 5}, $${index + 6})`);
      index += 7;
    });

    await pool.query(
      `INSERT INTO ${HISTORY_TABLE} (contact_id, account_id, from_stage, to_stage, changed_at, source, actor_id, actor_name) VALUES ${inserts.join(', ')}`,
      values
    );

    // Notifica marcos/ganhos/perdas vindos de fora do kanban (Chatwoot).
    try {
      const { rows: names } = await pool.query(
        `SELECT id, name FROM contacts WHERE id = ANY($1)`,
        [changedIds]
      );
      const nameMap = new Map(names.map((r) => [r.id, r.name]));
      for (const ch of changed) {
        await notifyFunnelStageChange(pool, {
          accountId: ch.account_id || CHATWOOT_ACCOUNT_ID,
          contactId: ch.id,
          contactName: nameMap.get(ch.id),
          fromStage: ch.fromStage,
          toStage: ch.toStage,
          actorName: null,
        });
      }
    } catch (notifyErr) {
      console.warn('[funil] poll notify failed:', notifyErr.message);
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
      secao TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE ${LICITACAO_ITEM_REQUIREMENTS_TABLE} ADD COLUMN IF NOT EXISTS secao TEXT;`);

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${EDITAL_WATCHLIST_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      account_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      palavras_chave TEXT[] NOT NULL DEFAULT '{}',
      termos_negativos TEXT[] NOT NULL DEFAULT '{}',
      usar_ia BOOLEAN NOT NULL DEFAULT TRUE,
      filtros JSONB NOT NULL DEFAULT '{}'::jsonb,
      whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      whatsapp_number TEXT,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE ${EDITAL_WATCHLIST_TABLE} ADD COLUMN IF NOT EXISTS palavras_chave TEXT[] NOT NULL DEFAULT '{}';`);
  await pool.query(`ALTER TABLE ${EDITAL_WATCHLIST_TABLE} ADD COLUMN IF NOT EXISTS termos_negativos TEXT[] NOT NULL DEFAULT '{}';`);
  await pool.query(`ALTER TABLE ${EDITAL_WATCHLIST_TABLE} ADD COLUMN IF NOT EXISTS usar_ia BOOLEAN NOT NULL DEFAULT TRUE;`);
  await pool.query(`ALTER TABLE ${EDITAL_WATCHLIST_TABLE} ADD COLUMN IF NOT EXISTS filtros JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await pool.query(`ALTER TABLE ${EDITAL_WATCHLIST_TABLE} ADD COLUMN IF NOT EXISTS whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE ${EDITAL_WATCHLIST_TABLE} ADD COLUMN IF NOT EXISTS whatsapp_number TEXT;`);
  // Limiar de score p/ WhatsApp: 0=todas faixas, 38=amarela+, 68=só verde (mesmas faixas da UI).
  await pool.query(`ALTER TABLE ${EDITAL_WATCHLIST_TABLE} ADD COLUMN IF NOT EXISTS whatsapp_min_score NUMERIC NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE ${EDITAL_WATCHLIST_TABLE} ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT TRUE;`);
  await pool.query(`ALTER TABLE ${EDITAL_WATCHLIST_TABLE} ADD COLUMN IF NOT EXISTS criado_em TIMESTAMP NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE ${EDITAL_WATCHLIST_TABLE} ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP NOT NULL DEFAULT NOW();`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_edital_watchlist_account ON ${EDITAL_WATCHLIST_TABLE} (account_id);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${EDITAL_SIGNALS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      account_id INTEGER NOT NULL,
      watchlist_id BIGINT REFERENCES ${EDITAL_WATCHLIST_TABLE}(id) ON DELETE SET NULL,
      fonte TEXT NOT NULL DEFAULT 'pncp',
      chave_externa TEXT NOT NULL,
      payload JSONB NOT NULL,
      score NUMERIC(6,3),
      termos_matched TEXT[] NOT NULL DEFAULT '{}',
      termos_excluidos TEXT[] NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'novo',
      promovido_para_opportunity_id BIGINT REFERENCES ${LICITACAO_TABLE}(id) ON DELETE SET NULL,
      criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (account_id, watchlist_id, chave_externa)
    );
  `);
  await pool.query(`ALTER TABLE ${EDITAL_SIGNALS_TABLE} ADD COLUMN IF NOT EXISTS fonte TEXT NOT NULL DEFAULT 'pncp';`);
  await pool.query(`ALTER TABLE ${EDITAL_SIGNALS_TABLE} ADD COLUMN IF NOT EXISTS score NUMERIC(6,3);`);
  await pool.query(`ALTER TABLE ${EDITAL_SIGNALS_TABLE} ADD COLUMN IF NOT EXISTS termos_matched TEXT[] NOT NULL DEFAULT '{}';`);
  await pool.query(`ALTER TABLE ${EDITAL_SIGNALS_TABLE} ADD COLUMN IF NOT EXISTS termos_excluidos TEXT[] NOT NULL DEFAULT '{}';`);
  await pool.query(`ALTER TABLE ${EDITAL_SIGNALS_TABLE} ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'novo';`);
  await pool.query(`ALTER TABLE ${EDITAL_SIGNALS_TABLE} ADD COLUMN IF NOT EXISTS promovido_para_opportunity_id BIGINT REFERENCES ${LICITACAO_TABLE}(id) ON DELETE SET NULL;`);
  await pool.query(`ALTER TABLE ${EDITAL_SIGNALS_TABLE} ADD COLUMN IF NOT EXISTS criado_em TIMESTAMP NOT NULL DEFAULT NOW();`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_edital_signals_account_status ON ${EDITAL_SIGNALS_TABLE} (account_id, status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_edital_signals_watchlist_status ON ${EDITAL_SIGNALS_TABLE} (account_id, status, watchlist_id, criado_em DESC);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${WATCHLIST_NOTIFICATIONS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      watchlist_id BIGINT NOT NULL,
      signal_id BIGINT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'whatsapp',
      recipient TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      sent_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (source, signal_id, channel, recipient)
    );
  `);
  await pool.query(`ALTER TABLE ${WATCHLIST_NOTIFICATIONS_TABLE} ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp';`);
  await pool.query(`ALTER TABLE ${WATCHLIST_NOTIFICATIONS_TABLE} ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';`);
  await pool.query(`ALTER TABLE ${WATCHLIST_NOTIFICATIONS_TABLE} ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE ${WATCHLIST_NOTIFICATIONS_TABLE} ADD COLUMN IF NOT EXISTS last_error TEXT;`);
  await pool.query(`ALTER TABLE ${WATCHLIST_NOTIFICATIONS_TABLE} ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP;`);
  await pool.query(`ALTER TABLE ${WATCHLIST_NOTIFICATIONS_TABLE} ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE ${WATCHLIST_NOTIFICATIONS_TABLE} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_watchlist_notifications_pending ON ${WATCHLIST_NOTIFICATIONS_TABLE} (status, attempts, created_at);`);

  await createNotificationTables(pool);

  await pool.query(`CREATE EXTENSION IF NOT EXISTS unaccent`).catch(() => {});
  await pool.query(`
    CREATE OR REPLACE FUNCTION immutable_unaccent(text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    AS $$ SELECT public.unaccent('public.unaccent', $1) $$;
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${PNCP_RESULT_CACHE_TABLE} (
      pncp_key TEXT PRIMARY KEY,
      orgao_cnpj TEXT,
      orgao_nome TEXT,
      ano INTEGER,
      sequencial INTEGER,
      numero_controle_pncp TEXT,
      titulo TEXT,
      descricao TEXT,
      uf TEXT,
      modalidade TEXT,
      etapa_comercial TEXT,
      fornecedor_ni TEXT,
      fornecedor_nome TEXT,
      valor_estimado NUMERIC(16,2),
      valor_homologado NUMERIC(16,2),
      data_publicacao TIMESTAMP,
      data_resultado TIMESTAMP,
      data_assinatura TIMESTAMP,
      has_result BOOLEAN NOT NULL DEFAULT FALSE,
      has_contract BOOLEAN NOT NULL DEFAULT FALSE,
      has_ata BOOLEAN NOT NULL DEFAULT FALSE,
      fornecedores JSONB NOT NULL DEFAULT '[]'::jsonb,
      search_text TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      refreshed_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pncp_result_cache_search ON ${PNCP_RESULT_CACHE_TABLE} USING GIN (to_tsvector('portuguese', immutable_unaccent(coalesce(search_text,''))));`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pncp_result_cache_fornecedor ON ${PNCP_RESULT_CACHE_TABLE} (fornecedor_ni, fornecedor_nome);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pncp_result_cache_orgao ON ${PNCP_RESULT_CACHE_TABLE} (orgao_cnpj);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pncp_result_cache_refreshed ON ${PNCP_RESULT_CACHE_TABLE} (refreshed_at DESC);`);
  // Campos Lei 14.133 para filtro SQL na aba Contratos/Resultados.
  await pool.query(`ALTER TABLE ${PNCP_RESULT_CACHE_TABLE} ADD COLUMN IF NOT EXISTS srp BOOLEAN;`);
  await pool.query(`ALTER TABLE ${PNCP_RESULT_CACHE_TABLE} ADD COLUMN IF NOT EXISTS amparo_legal TEXT;`);
  await pool.query(`ALTER TABLE ${PNCP_RESULT_CACHE_TABLE} ADD COLUMN IF NOT EXISTS has_result BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE ${PNCP_RESULT_CACHE_TABLE} ADD COLUMN IF NOT EXISTS has_contract BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE ${PNCP_RESULT_CACHE_TABLE} ADD COLUMN IF NOT EXISTS has_ata BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE ${PNCP_RESULT_CACHE_TABLE} ADD COLUMN IF NOT EXISTS fornecedores JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await pool.query(`UPDATE ${PNCP_RESULT_CACHE_TABLE} SET fornecedores = '[]'::jsonb WHERE jsonb_typeof(fornecedores) IS DISTINCT FROM 'array';`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pncp_result_cache_types ON ${PNCP_RESULT_CACHE_TABLE} (has_result, has_contract, has_ata);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pncp_result_cache_fornecedores ON ${PNCP_RESULT_CACHE_TABLE} USING GIN (fornecedores);`);
  // Backfill idempotente para linhas criadas antes das flags independentes.
  await pool.query(`
    UPDATE ${PNCP_RESULT_CACHE_TABLE}
       SET has_result = has_result OR etapa_comercial = 'resulted'
          OR jsonb_array_length(CASE WHEN jsonb_typeof(payload->'resultados') = 'array' THEN payload->'resultados' ELSE '[]'::jsonb END) > 0,
           has_contract = has_contract OR etapa_comercial = 'contracted'
          OR jsonb_array_length(CASE WHEN jsonb_typeof(payload->'contratos') = 'array' THEN payload->'contratos' ELSE '[]'::jsonb END) > 0
          OR jsonb_array_length(CASE WHEN jsonb_typeof(payload->'contratos_daily') = 'array' THEN payload->'contratos_daily' ELSE '[]'::jsonb END) > 0,
           has_ata = has_ata OR etapa_comercial = 'ata_available'
          OR jsonb_array_length(CASE WHEN jsonb_typeof(payload->'atas') = 'array' THEN payload->'atas' ELSE '[]'::jsonb END) > 0
          OR jsonb_array_length(CASE WHEN jsonb_typeof(payload->'atas_daily') = 'array' THEN payload->'atas_daily' ELSE '[]'::jsonb END) > 0,
           fornecedores = CASE
             WHEN jsonb_array_length(CASE WHEN jsonb_typeof(fornecedores) = 'array' THEN fornecedores ELSE '[]'::jsonb END) = 0
              AND (fornecedor_ni IS NOT NULL OR fornecedor_nome IS NOT NULL)
             THEN jsonb_build_array(jsonb_build_object('ni', fornecedor_ni, 'nome', fornecedor_nome))
             ELSE fornecedores END
     WHERE (
          NOT has_result AND (
            etapa_comercial = 'resulted'
            OR jsonb_array_length(CASE WHEN jsonb_typeof(payload->'resultados') = 'array' THEN payload->'resultados' ELSE '[]'::jsonb END) > 0
          )
        ) OR (
          NOT has_contract AND (
            etapa_comercial = 'contracted'
            OR jsonb_array_length(CASE WHEN jsonb_typeof(payload->'contratos') = 'array' THEN payload->'contratos' ELSE '[]'::jsonb END) > 0
            OR jsonb_array_length(CASE WHEN jsonb_typeof(payload->'contratos_daily') = 'array' THEN payload->'contratos_daily' ELSE '[]'::jsonb END) > 0
          )
        ) OR (
          NOT has_ata AND (
            etapa_comercial = 'ata_available'
            OR jsonb_array_length(CASE WHEN jsonb_typeof(payload->'atas') = 'array' THEN payload->'atas' ELSE '[]'::jsonb END) > 0
            OR jsonb_array_length(CASE WHEN jsonb_typeof(payload->'atas_daily') = 'array' THEN payload->'atas_daily' ELSE '[]'::jsonb END) > 0
          )
        ) OR (
          jsonb_array_length(CASE WHEN jsonb_typeof(fornecedores) = 'array' THEN fornecedores ELSE '[]'::jsonb END) = 0
          AND (fornecedor_ni IS NOT NULL OR fornecedor_nome IS NOT NULL)
        );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${PNCP_SEARCH_JOBS_TABLE} (
      id UUID PRIMARY KEY,
      account_id INTEGER NOT NULL,
      nome TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      filters JSONB NOT NULL DEFAULT '{}'::jsonb,
      terms TEXT[] NOT NULL DEFAULT '{}',
      negative_terms TEXT[] NOT NULL DEFAULT '{}',
      accepted_positive_terms TEXT[] NOT NULL DEFAULT '{}',
      accepted_negative_terms TEXT[] NOT NULL DEFAULT '{}',
      suggested_positive_terms TEXT[] NOT NULL DEFAULT '{}',
      suggested_negative_terms TEXT[] NOT NULL DEFAULT '{}',
      progress JSONB NOT NULL DEFAULT '{}'::jsonb,
      term_runs JSONB NOT NULL DEFAULT '[]'::jsonb,
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      summary JSONB,
      query_plan JSONB,
      total INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      watchlist_id BIGINT REFERENCES ${EDITAL_WATCHLIST_TABLE}(id) ON DELETE SET NULL,
      started_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pncp_search_jobs_account_updated ON ${PNCP_SEARCH_JOBS_TABLE} (account_id, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pncp_search_jobs_status ON ${PNCP_SEARCH_JOBS_TABLE} (status);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${PNCP_SEARCH_JOB_RESULTS_TABLE} (
      job_id UUID NOT NULL REFERENCES ${PNCP_SEARCH_JOBS_TABLE}(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL,
      result_key TEXT NOT NULL,
      score NUMERIC(8,2),
      score_label TEXT,
      commercial_stage TEXT,
      deadline_at TIMESTAMP,
      value_estimated NUMERIC(16,2),
      value_matched NUMERIC(16,2),
      matched_term TEXT,
      visibility TEXT NOT NULL DEFAULT 'visible',
      payload JSONB NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (job_id, result_key)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pncp_search_job_results_page ON ${PNCP_SEARCH_JOB_RESULTS_TABLE} (job_id, visibility, score DESC, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pncp_search_job_results_account ON ${PNCP_SEARCH_JOB_RESULTS_TABLE} (account_id, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pncp_search_job_results_stage ON ${PNCP_SEARCH_JOB_RESULTS_TABLE} (job_id, commercial_stage);`);

  // ===== PCA (Plano Anual de Contratações) =====
  // Inventário público compartilhado (sem account_id em pca_planos / pca_itens).
  // Scoping por account fica em pca_watchlist e pca_signals.
  await pool.query(`CREATE EXTENSION IF NOT EXISTS unaccent`).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${PCA_PLANOS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      orgao_cnpj TEXT NOT NULL,
      orgao_razao_social TEXT,
      codigo_unidade TEXT NOT NULL,
      unidade_nome TEXT,
      ano_pca INTEGER NOT NULL,
      data_publicacao DATE,
      data_atualizacao TIMESTAMP,
      valor_total_estimado NUMERIC(16,2),
      quantidade_itens INTEGER,
      responsaveis JSONB NOT NULL DEFAULT '[]'::jsonb,
      contatos JSONB NOT NULL DEFAULT '[]'::jsonb,
      payload_raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (orgao_cnpj, codigo_unidade, ano_pca)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pca_planos_ano ON ${PCA_PLANOS_TABLE} (ano_pca);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pca_planos_orgao ON ${PCA_PLANOS_TABLE} (orgao_cnpj);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${PCA_ITENS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      plano_id BIGINT NOT NULL REFERENCES ${PCA_PLANOS_TABLE}(id) ON DELETE CASCADE,
      numero_item TEXT,
      descricao TEXT NOT NULL,
      classificacao_codigo TEXT,
      classificacao_nome TEXT,
      categoria_item TEXT,
      quantidade NUMERIC(16,3),
      unidade_medida TEXT,
      valor_unitario NUMERIC(16,4),
      valor_total NUMERIC(16,2),
      mes_previsto INTEGER,
      data_estimada_inicio DATE,
      data_estimada_conclusao DATE,
      payload_raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      descricao_tsv tsvector
        GENERATED ALWAYS AS (
          to_tsvector('portuguese', immutable_unaccent(coalesce(descricao,'')))
        ) STORED
    );
  `);
  await pool.query(`ALTER TABLE ${PCA_PLANOS_TABLE} ADD COLUMN IF NOT EXISTS id_pca_pncp TEXT;`);
  await pool.query(`ALTER TABLE ${PCA_ITENS_TABLE} ADD COLUMN IF NOT EXISTS futura_contratacao_id TEXT;`);
  await pool.query(`ALTER TABLE ${PCA_ITENS_TABLE} ADD COLUMN IF NOT EXISTS futura_contratacao_nome TEXT;`);
  await pool.query(`ALTER TABLE ${PCA_ITENS_TABLE} ADD COLUMN IF NOT EXISTS codigo_item_catalogo TEXT;`);
  await pool.query(`ALTER TABLE ${PCA_ITENS_TABLE} ADD COLUMN IF NOT EXISTS chave_estavel TEXT;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pca_itens_plano ON ${PCA_ITENS_TABLE} (plano_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pca_itens_descricao_tsv ON ${PCA_ITENS_TABLE} USING GIN (descricao_tsv);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pca_itens_mes ON ${PCA_ITENS_TABLE} (mes_previsto);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pca_itens_futura ON ${PCA_ITENS_TABLE} (futura_contratacao_id);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_pca_itens_plano_chave ON ${PCA_ITENS_TABLE} (plano_id, chave_estavel) WHERE chave_estavel IS NOT NULL;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${PCA_WATCHLIST_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      account_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      palavras_chave TEXT[] NOT NULL DEFAULT '{}',
      termos_negativos TEXT[] NOT NULL DEFAULT '{}',
      usar_ia BOOLEAN NOT NULL DEFAULT TRUE,
      valor_minimo NUMERIC(16,2),
      valor_maximo NUMERIC(16,2),
      orgao_filtros JSONB NOT NULL DEFAULT '[]'::jsonb,
      uasg_filtros JSONB NOT NULL DEFAULT '[]'::jsonb,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      criado_em TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE ${PCA_WATCHLIST_TABLE} ADD COLUMN IF NOT EXISTS whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE ${PCA_WATCHLIST_TABLE} ADD COLUMN IF NOT EXISTS whatsapp_number TEXT;`);
  await pool.query(`ALTER TABLE ${PCA_WATCHLIST_TABLE} ADD COLUMN IF NOT EXISTS whatsapp_min_score NUMERIC NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE ${PCA_WATCHLIST_TABLE} ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP NOT NULL DEFAULT NOW();`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pca_watchlist_account ON ${PCA_WATCHLIST_TABLE} (account_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pca_watchlist_account_name ON ${PCA_WATCHLIST_TABLE} (account_id, nome, id);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${PCA_SIGNALS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      account_id INTEGER NOT NULL,
      plano_id BIGINT NOT NULL REFERENCES ${PCA_PLANOS_TABLE}(id) ON DELETE CASCADE,
      item_id BIGINT NOT NULL REFERENCES ${PCA_ITENS_TABLE}(id) ON DELETE CASCADE,
      watchlist_id BIGINT REFERENCES ${PCA_WATCHLIST_TABLE}(id) ON DELETE SET NULL,
      score NUMERIC(6,3),
      termos_matched TEXT[] NOT NULL DEFAULT '{}',
      termos_excluidos TEXT[] NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'novo',
      promovido_para_opportunity_id BIGINT REFERENCES ${LICITACAO_TABLE}(id) ON DELETE SET NULL,
      criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (account_id, item_id, watchlist_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pca_signals_account_status ON ${PCA_SIGNALS_TABLE} (account_id, status);`);
  // O feed precisa encontrar primeiro a pagina recente e contar por watchlist sem
  // ordenar/juntar a tabela inteira. Esses indices evitam o plano que causava 504.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pca_signals_feed
      ON ${PCA_SIGNALS_TABLE} (account_id, status, criado_em DESC, id DESC)
      WHERE watchlist_id IS NOT NULL;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pca_signals_watchlist_count
      ON ${PCA_SIGNALS_TABLE} (account_id, status, watchlist_id)
      WHERE watchlist_id IS NOT NULL;
  `);
  await pool.query(`
    WITH ranked AS (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY account_id, item_id, COALESCE(watchlist_id, 0)
               ORDER BY criado_em DESC, id DESC
             ) AS rn
      FROM ${PCA_SIGNALS_TABLE}
    )
    DELETE FROM ${PCA_SIGNALS_TABLE}
    WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_pca_signals_account_item_watchlist_nullable
      ON ${PCA_SIGNALS_TABLE} (account_id, item_id, COALESCE(watchlist_id, 0));
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${PCA_SYNC_STATE_TABLE} (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      ultimo_sync TIMESTAMP,
      ultimo_data_fim DATE,
      bootstrap_concluido BOOLEAN NOT NULL DEFAULT FALSE,
      bootstrap_started_at TIMESTAMP,
      bootstrap_finished_at TIMESTAMP,
      bootstrap_error TEXT
    );
  `);
  await pool.query(`ALTER TABLE ${PCA_SYNC_STATE_TABLE} ADD COLUMN IF NOT EXISTS bootstrap_started_at TIMESTAMP;`);
  await pool.query(`ALTER TABLE ${PCA_SYNC_STATE_TABLE} ADD COLUMN IF NOT EXISTS bootstrap_finished_at TIMESTAMP;`);
  await pool.query(`ALTER TABLE ${PCA_SYNC_STATE_TABLE} ADD COLUMN IF NOT EXISTS bootstrap_error TEXT;`);
  await pool.query(`INSERT INTO ${PCA_SYNC_STATE_TABLE} (id) VALUES (1) ON CONFLICT DO NOTHING;`);
};

const getPrazoStatusSql = (alias = '') => `
  CASE
    WHEN ${alias}data_envio_proposta_limite IS NULL THEN 'sem_data'
    WHEN ${alias}data_envio_proposta_limite < NOW() THEN 'atrasado'
    WHEN ${alias}data_envio_proposta_limite >= date_trunc('day', NOW())
      AND ${alias}data_envio_proposta_limite < date_trunc('day', NOW()) + INTERVAL '1 day'
      THEN 'vence_hoje'
    WHEN ${alias}data_envio_proposta_limite <= NOW() + INTERVAL '48 hours' THEN 'vence_48h'
    ELSE 'em_dia'
  END
`;

/** Número da fase a partir de "13. Perdido" (prefixo numérico). */
const getLicitacaoFaseNumSql = (alias = '') =>
  `NULLIF(substring(COALESCE(${alias}fase, '') from '^[0-9]+'), '')::int`;

/**
 * Status “em aberto” (Ativo | Suspenso). Trata null/vazio como ativo.
 */
const getLicitacaoOpenStatusSql = (alias = '') =>
  `LOWER(COALESCE(NULLIF(TRIM(${alias}status), ''), 'ativo')) IN ('ativo', 'suspenso')`;

/**
 * Pipeline operacional do resumo/KPIs: Ativo|Suspenso nas fases 2–12.
 * PCA (fase 1) fica só no card “Monitoramento de PCA” — não entra nos totais de cima.
 */
const getLicitacaoOpenPipelineSql = (alias = '') => `
  ${getLicitacaoOpenStatusSql(alias)}
  AND ${getLicitacaoFaseNumSql(alias)} BETWEEN 2 AND 12
`;

/** Alias explícito (prazos / digest) — mesmo escopo operacional, sem PCA. */
const getLicitacaoOperationalPipelineSql = (alias = '') => getLicitacaoOpenPipelineSql(alias);

/**
 * Elegível para mover de fase quando o prazo de proposta venceu:
 * ainda em jogo (ativo|suspenso, fases 2–11). Fase 12 (contrato) e PCA ficam de fora.
 * - ativo → 13. Perdido — só após confirmação do usuário (não auto)
 * - suspenso → 6. Monitoramento de Edital (automático; não perde; volta a monitorar)
 */
const getLicitacaoExpiredProposalMoveSql = (alias = '') => `
  ${getLicitacaoOpenStatusSql(alias)}
  AND ${getLicitacaoFaseNumSql(alias)} BETWEEN 2 AND 11
  AND ${alias}data_envio_proposta_limite IS NOT NULL
  AND ${alias}data_envio_proposta_limite < NOW()
`;

const LICITACAO_FASE_PERDIDO = '13. Perdido';
const LICITACAO_FASE_MONITORAMENTO_EDITAL = '6. Monitoramento de Edital';

const statusNormExpr = (alias = '') =>
  `LOWER(COALESCE(NULLIF(TRIM(${alias}status), ''), 'ativo'))`;

/** Auto-only: suspenso com prazo vencido → Monitoramento de Edital. */
const runExpiredSuspensoToMonitoramento = async ({ accountId = null } = {}) => {
  const params = [LICITACAO_FASE_MONITORAMENTO_EDITAL];
  let accountClause = '';
  if (accountId != null) {
    params.push(accountId);
    accountClause = `AND account_id = $${params.length}`;
  }
  const statusExpr = statusNormExpr('');
  const { rows } = await pool.query(
    `
      UPDATE ${LICITACAO_TABLE}
      SET fase = $1, updated_at = NOW()
      WHERE ${getLicitacaoExpiredProposalMoveSql('')}
        AND ${statusExpr} = 'suspenso'
        AND fase IS DISTINCT FROM $1
        ${accountClause}
      RETURNING id, status, fase
    `,
    params
  );
  return { moved: rows.length, to_monitoramento: rows.length, to_perdido: 0 };
};

/**
 * Compat: triggers silenciosos só movem suspenso → Monitoramento.
 * Ativo → Perdido exige confirmação via API (confirm-expired-move).
 */
const runExpiredLicitacaoProposalMove = async ({ accountId = null } = {}) =>
  runExpiredSuspensoToMonitoramento({ accountId });

/** Candidatos ativo com prazo vencido ainda no funil (exclui dismiss skip_auto_perdido). */
const findExpiredLicitacaoProposalCandidates = async ({ accountId = null } = {}) => {
  const params = [LICITACAO_FASE_PERDIDO];
  let accountClause = '';
  if (accountId != null) {
    params.push(accountId);
    accountClause = `AND o.account_id = $${params.length}`;
  }
  const statusExpr = statusNormExpr('o.');
  const { rows } = await pool.query(
    `
      SELECT
        o.id,
        o.titulo,
        o.orgao,
        o.fase,
        o.status,
        o.modalidade,
        o.valor_oportunidade,
        o.data_envio_proposta_limite,
        o.numero_edital,
        o.metadados
      FROM ${LICITACAO_TABLE} o
      WHERE ${getLicitacaoExpiredProposalMoveSql('o.')}
        AND ${statusExpr} <> 'suspenso'
        AND o.fase IS DISTINCT FROM $1
        AND COALESCE((o.metadados->>'skip_auto_perdido')::boolean, false) = false
        ${accountClause}
      ORDER BY o.data_envio_proposta_limite ASC NULLS LAST, o.id ASC
    `,
    params
  );
  return rows;
};

const applyExpiredLicitacaoProposalMoveToPerdido = async ({ accountId, ids }) => {
  const idList = (Array.isArray(ids) ? ids : [])
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!idList.length) return { moved: 0, ids: [] };

  const params = [LICITACAO_FASE_PERDIDO, idList];
  let accountClause = '';
  if (accountId != null) {
    params.push(accountId);
    accountClause = `AND account_id = $${params.length}`;
  }
  const statusExpr = statusNormExpr('');
  const { rows } = await pool.query(
    `
      UPDATE ${LICITACAO_TABLE}
      SET
        fase = $1,
        metadados = COALESCE(metadados, '{}'::jsonb) - 'skip_auto_perdido',
        updated_at = NOW()
      WHERE id = ANY($2::int[])
        AND ${getLicitacaoExpiredProposalMoveSql('')}
        AND ${statusExpr} <> 'suspenso'
        AND fase IS DISTINCT FROM $1
        ${accountClause}
      RETURNING id
    `,
    params
  );
  return { moved: rows.length, ids: rows.map((r) => r.id) };
};

const dismissExpiredLicitacaoProposalCandidates = async ({ accountId, ids }) => {
  const idList = (Array.isArray(ids) ? ids : [])
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!idList.length) return { dismissed: 0, ids: [] };

  const params = [idList, LICITACAO_FASE_PERDIDO];
  let accountClause = '';
  if (accountId != null) {
    params.push(accountId);
    accountClause = `AND account_id = $${params.length}`;
  }
  const statusExpr = statusNormExpr('');
  const { rows } = await pool.query(
    `
      UPDATE ${LICITACAO_TABLE}
      SET
        metadados = COALESCE(metadados, '{}'::jsonb)
          || jsonb_build_object('skip_auto_perdido', true, 'skip_auto_perdido_at', to_jsonb(NOW()::text)),
        updated_at = NOW()
      WHERE id = ANY($1::int[])
        AND ${getLicitacaoExpiredProposalMoveSql('')}
        AND ${statusExpr} <> 'suspenso'
        AND fase IS DISTINCT FROM $2
        ${accountClause}
      RETURNING id
    `,
    params
  );
  return { dismissed: rows.length, ids: rows.map((r) => r.id) };
};

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

const normalizeWatchlistPhone = (raw) => {
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const digits = text.replace(/\D/g, '');
  if (!digits) return null;
  if (text.startsWith('+')) return digits.length >= 8 ? digits : null;
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits.length >= 8 ? digits : null;
};

// Aceita 1+ números: string (vírgula/ponto-e-vírgula/quebra de linha), array, ou valor único.
// Persistimos em whatsapp_number (TEXT) como CSV normalizado: "5511...,5519...".
const parseWatchlistPhones = (raw) => {
  if (raw == null || raw === '') return [];
  const chunks = Array.isArray(raw)
    ? raw.flatMap((part) => String(part ?? '').split(/[,;\n|]+/))
    : String(raw).split(/[,;\n|]+/);
  const out = [];
  const seen = new Set();
  for (const chunk of chunks) {
    const number = normalizeWatchlistPhone(chunk);
    if (!number || seen.has(number)) continue;
    seen.add(number);
    out.push(number);
  }
  return out;
};

const serializeWatchlistPhones = (raw) => {
  const phones = parseWatchlistPhones(raw);
  return phones.length ? phones.join(',') : null;
};

const watchlistPhonesFromRow = (row) => parseWatchlistPhones(row?.whatsapp_number);

// Faixas de score iguais à UI: vermelho <38, amarelo >=38, verde >=68.
const WATCHLIST_SCORE_MIN_ALL = 0;
const WATCHLIST_SCORE_MIN_MEDIUM = 38;
const WATCHLIST_SCORE_MIN_HIGH = 68;

const normalizeWhatsappMinScore = (raw) => {
  if (raw == null || raw === '') return WATCHLIST_SCORE_MIN_ALL;
  const band = String(raw).trim().toLowerCase();
  if (band === 'high' || band === 'alta' || band === 'verde' || band === 'green') {
    return WATCHLIST_SCORE_MIN_HIGH;
  }
  if (band === 'medium' || band === 'media' || band === 'média' || band === 'amarelo' || band === 'yellow') {
    return WATCHLIST_SCORE_MIN_MEDIUM;
  }
  if (band === 'all' || band === 'todas' || band === 'baixa' || band === 'vermelho' || band === 'red' || band === 'low') {
    return WATCHLIST_SCORE_MIN_ALL;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return WATCHLIST_SCORE_MIN_ALL;
  if (n >= WATCHLIST_SCORE_MIN_HIGH) return WATCHLIST_SCORE_MIN_HIGH;
  if (n >= WATCHLIST_SCORE_MIN_MEDIUM) return WATCHLIST_SCORE_MIN_MEDIUM;
  return WATCHLIST_SCORE_MIN_ALL;
};

const whatsappMinScoreToBand = (minScore) => {
  const n = Number(minScore) || 0;
  if (n >= WATCHLIST_SCORE_MIN_HIGH) return 'high';
  if (n >= WATCHLIST_SCORE_MIN_MEDIUM) return 'medium';
  return 'all';
};

const shouldSendWatchlistWhatsappForScore = (watch, score) => {
  if (!watch) return false;
  const enabled = watch.whatsapp_enabled === true
    || watch.whatsapp_enabled === 't'
    || watch.whatsapp_enabled === 1;
  if (!enabled) return false;
  if (!watchlistPhonesFromRow(watch).length) return false;
  const minScore = normalizeWhatsappMinScore(watch.whatsapp_min_score);
  return Number(score || 0) >= minScore;
};

const resolveWhatsappFieldsFromBody = (body = {}, { requireNumbersIfEnabled = true } = {}) => {
  const wantWhatsapp = body.whatsapp_enabled === true;
  const hasNumbersField = body.whatsapp_numbers !== undefined || body.whatsapp_number !== undefined;
  const hasMinScoreField = body.whatsapp_min_score !== undefined || body.whatsapp_score_band !== undefined;
  const phones = hasNumbersField
    ? parseWatchlistPhones(
      body.whatsapp_numbers !== undefined ? body.whatsapp_numbers : body.whatsapp_number
    )
    : null;
  if (wantWhatsapp && requireNumbersIfEnabled && hasNumbersField && (!phones || phones.length === 0)) {
    return { error: 'Informe ao menos um número de WhatsApp válido com DDD.' };
  }
  if (wantWhatsapp && requireNumbersIfEnabled && !hasNumbersField) {
    return { error: 'Informe ao menos um número de WhatsApp válido com DDD.' };
  }
  const stored = phones && phones.length ? serializeWatchlistPhones(phones) : null;
  const enabled = Boolean(wantWhatsapp && stored);
  const minScore = hasMinScoreField
    ? normalizeWhatsappMinScore(
      body.whatsapp_min_score !== undefined ? body.whatsapp_min_score : body.whatsapp_score_band
    )
    : undefined;
  return {
    whatsapp_enabled: enabled,
    whatsapp_number: enabled ? stored : null,
    whatsapp_numbers: enabled ? parseWatchlistPhones(stored) : [],
    whatsapp_min_score: minScore,
    has_min_score: hasMinScoreField,
  };
};

const decorateWatchlistWhatsapp = (row) => {
  if (!row || typeof row !== 'object') return row;
  const numbers = watchlistPhonesFromRow(row);
  const enabled = Boolean(
    (row.whatsapp_enabled === true || row.whatsapp_enabled === 't' || row.whatsapp_enabled === 1)
    && numbers.length
  );
  const minScore = normalizeWhatsappMinScore(row.whatsapp_min_score);
  return {
    ...row,
    whatsapp_enabled: enabled,
    whatsapp_number: numbers.length ? numbers.join(',') : null,
    whatsapp_numbers: numbers,
    whatsapp_min_score: minScore,
    whatsapp_score_band: whatsappMinScoreToBand(minScore),
  };
};

const enqueueWatchlistNotification = async ({ source, watchlistId, signalId, recipient }) => {
  const number = normalizeWatchlistPhone(recipient);
  if (!source || !watchlistId || !signalId || !number) return false;
  await pool.query(
    `
      INSERT INTO ${WATCHLIST_NOTIFICATIONS_TABLE}
        (source, watchlist_id, signal_id, channel, recipient)
      VALUES ($1, $2, $3, 'whatsapp', $4)
      ON CONFLICT (source, signal_id, channel, recipient) DO NOTHING
    `,
    [source, watchlistId, signalId, number]
  );
  return true;
};

const enqueueWatchlistNotificationsForRecipients = async ({ source, watchlistId, signalId, recipients }) => {
  const phones = parseWatchlistPhones(recipients);
  let enqueued = 0;
  for (const recipient of phones) {
    const ok = await enqueueWatchlistNotification({ source, watchlistId, signalId, recipient });
    if (ok) enqueued += 1;
  }
  return enqueued;
};

// Prefixo WhatsApp: [EDITAL] [DISPUTA] [PCA] [ATA] [CONTRATO] [AVISO] [RESULTADO] [CHAMAMENTO]
const resolveWatchlistNotificationTag = (source, row) => {
  if (source === 'pca') return 'PCA';

  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  const stageId = String(
    payload.commercial_stage?.id
    || payload.commercial_stage
    || payload.legal_stage?.id
    || ''
  ).toLowerCase();
  const tipoNome = normalizeSearchText(payload.tipo?.nome || payload.tipo_nome || '');
  const tipoId = String(payload.tipo?.id || payload.tipo_id || '');
  const modalidade = normalizeSearchText(payload.modalidade?.nome || payload.modalidade_licitacao_nome || '');
  const modoDisputa = normalizeSearchText(payload.modo_disputa?.nome || payload.modo_disputa_nome || '');

  if (stageId === 'contracted' || tipoNome.includes('contrato')) return 'CONTRATO';
  if (stageId === 'ata_available' || (/\bata\b/.test(tipoNome) && !tipoNome.includes('edital'))) return 'ATA';
  if (stageId === 'resulted') return 'RESULTADO';
  if (tipoId === '2' || tipoNome.includes('aviso') || tipoNome.includes('contratacao direta')) return 'AVISO';
  if (tipoId === '4' || tipoNome.includes('chamamento')) return 'CHAMAMENTO';

  // Aberta a propostas / lances: destaca como disputa (pregão, concorrência, etc.)
  const openForProposal = stageId === 'open_for_proposal'
    || Boolean(payload.commercial_stage?.open)
    || Boolean(payload.prazo_info?.open);
  const looksLikeDisputa = openForProposal && (
    modalidade.includes('pregao')
    || modalidade.includes('concorrencia')
    || modalidade.includes('leilao')
    || modoDisputa.includes('aberto')
    || modoDisputa.includes('fechado')
    || tipoNome.includes('disputa')
  );
  if (looksLikeDisputa) return 'DISPUTA';

  return 'EDITAL';
};

// Formata datas do PNCP para WhatsApp em pt-BR.
// - "2026-07-20" / meia-noite → "20/07/2026"
// - "2026-07-20T09:59" sem fuso → horário de parede (não força UTC)
// - ISO com Z/offset → converte para America/Sao_Paulo
const formatWatchlistDateTime = (raw) => {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return formatWatchlistDateFromUtcInstant(raw);
  }
  const text = String(raw).trim();
  if (!text) return null;

  // YYYY-MM-DD only
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;

  // Local wall time without timezone: 2026-07-20T09:59[:ss][.fff]
  const localWall = text.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/
  );
  if (localWall) {
    const [, y, m, d, hh, mm] = localWall;
    if (hh === '00' && mm === '00') return `${d}/${m}/${y}`;
    return `${d}/${m}/${y} ${hh}:${mm}`;
  }

  // With explicit timezone (Z or ±hh:mm) → São Paulo
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return text;
  return formatWatchlistDateFromUtcInstant(d);
};

const formatWatchlistDateFromUtcInstant = (date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const day = get('day');
  const month = get('month');
  const year = get('year');
  let hour = get('hour');
  const minute = get('minute');
  if (hour === '24') hour = '00';
  const hasTime = !(hour === '00' && minute === '00');
  const datePart = `${day}/${month}/${year}`;
  return hasTime ? `${datePart} ${hour}:${minute}` : datePart;
};

const buildWatchlistNotificationMessage = (source, row) => {
  const tag = resolveWatchlistNotificationTag(source, row);

  if (source === 'pca') {
    const mes = row.mes_previsto != null ? String(row.mes_previsto).padStart(2, '0') : null;
    const ano = row.ano_pca != null ? String(row.ano_pca) : null;
    const mesPrevisto = mes && ano ? `${mes}/${ano}` : (mes || ano || null);
    const parts = [
      `[${tag}] Nova oportunidade PCA na assinatura "${row.watchlist_nome || 'Assinatura'}"`,
      row.descricao,
      row.orgao_razao_social || row.orgao_cnpj ? `Orgao: ${row.orgao_razao_social || row.orgao_cnpj}` : null,
      row.codigo_unidade ? `UASG: ${row.codigo_unidade}${row.unidade_nome ? ` - ${row.unidade_nome}` : ''}` : null,
      row.valor_total ? `Valor: R$ ${Number(row.valor_total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : null,
      mesPrevisto ? `Mes previsto: ${mesPrevisto}` : null,
      (() => {
        if (row.score === null || row.score === undefined) return null;
        const score = scalePcaMatchScore(row.score);
        const label = getPncpScoreLabel(score);
        return `Score: ${score} (${label})`;
      })(),
      row.orgao_cnpj && row.ano_pca ? `PNCP: https://pncp.gov.br/app/pca/${row.orgao_cnpj}/${row.ano_pca}` : null,
    ];
    return parts.filter(Boolean).join('\n');
  }

  const payload = row.payload || {};
  const orgao = payload.orgao?.nome || payload.orgao_nome || payload.orgao_cnpj;
  const unidade = payload.unidade?.codigo || payload.unidade_codigo;
  const title = payload.titulo || payload.title || payload.descricao || 'Edital PNCP';
  const tipoLabel = payload.tipo?.nome || payload.tipo_nome || null;
  const modalidadeLabel = payload.modalidade?.nome || payload.modalidade_licitacao_nome || null;
  const dataPublicacao = formatWatchlistDateTime(
    payload.data_publicacao || payload.data_publicacao_pncp || payload.dataPublicacaoPncp
  );
  const dataAbertura = formatWatchlistDateTime(
    payload.data_inicio_vigencia
    || payload.data_abertura_proposta
    || payload.dataAberturaProposta
    || payload.dataAberturaPropostas
  );
  const dataEncerramento = formatWatchlistDateTime(
    payload.data_fim_vigencia
    || payload.data_encerramento_proposta
    || payload.dataEncerramentoProposta
    || payload.dataEncerramentoPropostas
  );
  const prazoRelativo = payload.prazo_info?.label || null;
  const valorEstimado = getPncpBestEstimatedValue(payload);
  const valorHomologado = (() => {
    const n = Number(payload.valor_total_homologado ?? payload.valorTotalHomologado);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const formatMoneyBr = (n) => `R$ ${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const valorLines = [];
  if (valorEstimado != null) {
    const isItens = Number(payload.valor_itens_pertinentes) > 0
      && Math.abs(Number(payload.valor_itens_pertinentes) - valorEstimado) < 0.01;
    valorLines.push(isItens
      ? `Valor (itens relevantes): ${formatMoneyBr(valorEstimado)}`
      : `Valor estimado: ${formatMoneyBr(valorEstimado)}`);
  }
  if (valorHomologado != null && (valorEstimado == null || Math.abs(valorHomologado - valorEstimado) > 0.01)) {
    valorLines.push(`Valor homologado: ${formatMoneyBr(valorHomologado)}`);
  }
  const parts = [
    `[${tag}] Nova oportunidade na assinatura "${row.watchlist_nome || 'Assinatura'}"`,
    title,
    tipoLabel ? `Tipo: ${tipoLabel}` : null,
    modalidadeLabel ? `Modalidade: ${modalidadeLabel}` : null,
    orgao ? `Orgao: ${orgao}` : null,
    unidade ? `UASG: ${unidade}${payload.unidade?.nome ? ` - ${payload.unidade.nome}` : ''}` : null,
    ...valorLines,
    dataPublicacao ? `Publicacao: ${dataPublicacao}` : null,
    dataAbertura ? `Abertura propostas: ${dataAbertura}` : null,
    dataEncerramento ? `Encerramento: ${dataEncerramento}` : null,
    prazoRelativo ? `Prazo: ${prazoRelativo}` : null,
    row.score !== null && row.score !== undefined ? `Score: ${Number(row.score).toFixed(0)}` : null,
    payload.url ? `PNCP: ${payload.url}` : null,
  ];
  return parts.filter(Boolean).join('\n');
};

/** Preenche valor/datas do edital no envio do WhatsApp se o payload da busca veio vazio. */
const enrichEditalSignalForNotification = async (sourceRow) => {
  if (!sourceRow) return sourceRow;
  const payload = sourceRow.payload && typeof sourceRow.payload === 'object'
    ? { ...sourceRow.payload }
    : {};
  let hasValue = getPncpBestEstimatedValue(payload) != null;
  const hasEnd = Boolean(payload.data_fim_vigencia || payload.data_encerramento_proposta);
  if (hasValue && hasEnd) {
    return { ...sourceRow, payload };
  }
  const ids = extractPncpCompraIdentifiers(payload);
  if (!ids?.cnpj || !ids?.ano || !ids?.sequencial) {
    return { ...sourceRow, payload };
  }
  try {
    // sync: cede a interactive (busca na tela); não usa bulk.
    const detalhe = await getPncpCompraDetalhe(ids.cnpj, ids.ano, ids.sequencial, { priority: 'sync' });
    let changed = false;
    if (detalhe) {
      if (!hasValue && detalhe.valor_total_estimado != null) {
        payload.valor_total_estimado = detalhe.valor_total_estimado;
        if (payload.valor_global == null) payload.valor_global = detalhe.valor_total_estimado;
        hasValue = true;
        changed = true;
      }
      if (detalhe.valor_total_homologado != null && payload.valor_total_homologado == null) {
        payload.valor_total_homologado = detalhe.valor_total_homologado;
        changed = true;
      }
      if (!payload.data_publicacao && !payload.data_publicacao_pncp && detalhe.data_publicacao_pncp) {
        payload.data_publicacao = detalhe.data_publicacao_pncp;
        changed = true;
      }
      if (!payload.data_inicio_vigencia && detalhe.data_abertura_proposta) {
        payload.data_inicio_vigencia = detalhe.data_abertura_proposta;
        changed = true;
      }
      if (!payload.data_fim_vigencia && detalhe.data_encerramento_proposta) {
        payload.data_fim_vigencia = detalhe.data_encerramento_proposta;
        changed = true;
      }
    }
    // Fallback: soma itens (muitas compras só têm valor nos itens).
    if (!hasValue) {
      const itens = await fetchPncpCompraItens(ids.cnpj, ids.ano, ids.sequencial, {
        pageSize: 100,
        maxPages: 3,
        priority: 'sync',
      }).catch(() => []);
      if (Array.isArray(itens) && itens.length) {
        let sum = 0;
        let any = false;
        for (const it of itens) {
          const v = Number(it?.valorTotal ?? it?.valor_total ?? it?.valorTotalEstimado);
          if (Number.isFinite(v) && v > 0) {
            sum += v;
            any = true;
          }
        }
        if (any && sum > 0) {
          payload.valor_total_estimado = Number(sum.toFixed(2));
          if (payload.valor_global == null) payload.valor_global = payload.valor_total_estimado;
          hasValue = true;
          changed = true;
        }
      }
    }
    if (changed && sourceRow.id) {
      await pool.query(
        `UPDATE ${EDITAL_SIGNALS_TABLE} SET payload = $2::jsonb WHERE id = $1`,
        [sourceRow.id, JSON.stringify(payload)]
      ).catch((err) => console.warn('[watchlist-notifications] persist enrich falhou:', err.message));
    }
  } catch (error) {
    console.warn('[watchlist-notifications] enrich edital falhou:', error.message);
  }
  return { ...sourceRow, payload };
};

const sendEvolutionTextMessage = async (number, text) => {
  const baseUrl = String(process.env.EVOLUTION_API_URL || '').replace(/\/+$/, '');
  const instance = process.env.EVOLUTION_INSTANCE;
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!baseUrl || !instance || !apiKey) {
    throw new Error('Evolution API nao configurada. Defina EVOLUTION_API_URL, EVOLUTION_INSTANCE e EVOLUTION_API_KEY.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    // Evolution v2 (Baileys) exige { number, text }. O formato legado
    // { textMessage: { text } } responde 400 "requires property text".
    // Evolution v2 auth: only lowercase `apikey`. Sending both `apikey` and
    // `ApiKey` makes undici/fetch collapse headers incorrectly and returns 401.
    const response = await fetch(`${baseUrl}/message/sendText/${encodeURIComponent(instance)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
      },
      body: JSON.stringify({
        number: String(number || '').replace(/\D/g, ''),
        text: String(text || ''),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Evolution API ${response.status}: ${body.slice(0, 300)}`);
    }
    return response.json().catch(() => ({}));
  } finally {
    clearTimeout(timeout);
  }
};

const processWatchlistNotifications = async (limit = 20) => {
  const { rows } = await pool.query(
    `
      SELECT *
      FROM ${WATCHLIST_NOTIFICATIONS_TABLE}
      WHERE status IN ('pending', 'failed') AND attempts < 3
      ORDER BY created_at ASC
      LIMIT $1
    `,
    [Math.max(1, Math.min(Number(limit) || 20, 100))]
  );
  let sent = 0;
  let failed = 0;
  for (const notification of rows) {
    try {
      let sourceRow = null;
      if (notification.source === 'pca') {
        const result = await pool.query(
          `
            SELECT s.*, i.descricao, i.valor_total, i.mes_previsto,
                   p.orgao_cnpj, p.orgao_razao_social, p.codigo_unidade, p.unidade_nome, p.ano_pca,
                   w.nome AS watchlist_nome
            FROM ${PCA_SIGNALS_TABLE} s
            JOIN ${PCA_ITENS_TABLE} i ON i.id = s.item_id
            JOIN ${PCA_PLANOS_TABLE} p ON p.id = s.plano_id
            LEFT JOIN ${PCA_WATCHLIST_TABLE} w ON w.id = s.watchlist_id
            WHERE s.id = $1
          `,
          [notification.signal_id]
        );
        sourceRow = result.rows[0];
      } else if (notification.source === 'edital') {
        const result = await pool.query(
          `
            SELECT s.*, w.nome AS watchlist_nome
            FROM ${EDITAL_SIGNALS_TABLE} s
            LEFT JOIN ${EDITAL_WATCHLIST_TABLE} w ON w.id = s.watchlist_id
            WHERE s.id = $1
          `,
          [notification.signal_id]
        );
        sourceRow = result.rows[0];
        if (sourceRow) {
          sourceRow = await enrichEditalSignalForNotification(sourceRow);
        }
      }
      if (!sourceRow) throw new Error('Signal nao encontrado para notificacao');
      await sendEvolutionTextMessage(notification.recipient, buildWatchlistNotificationMessage(notification.source, sourceRow));
      await pool.query(
        `UPDATE ${WATCHLIST_NOTIFICATIONS_TABLE}
            SET status = 'sent', attempts = attempts + 1, sent_at = NOW(), updated_at = NOW(), last_error = NULL
          WHERE id = $1`,
        [notification.id]
      );
      sent += 1;
    } catch (error) {
      await pool.query(
        `UPDATE ${WATCHLIST_NOTIFICATIONS_TABLE}
            SET status = 'failed', attempts = attempts + 1, updated_at = NOW(), last_error = $2
          WHERE id = $1`,
        [notification.id, error.message]
      );
      failed += 1;
    }
  }
  return { sent, failed, processed: rows.length };
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
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        Connection: 'close',
        'User-Agent': 'KanbanDashboard/1.0 (+https://pncp.gov.br)',
      },
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

  return fetchJsonWithCurl(url.toString(), 60);
};

// Função para buscar detalhes de uma compra específica no PNCP
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Detecta 429 / reset / timeout típicos do PNCP (cota não documentada, mas real).
const isPncpThrottleError = (errorOrText) => {
  const text = String(errorOrText?.message || errorOrText || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return /429|rate.?limit|limite|too many|reset|recv failure|econnreset|etimedout|timed out|socket hang|curl exit (22|28|52|56)/.test(text);
};

// notePncpThrottle / PNCP_GATE são definidos mais abaixo; stubs até o gate montar.
let notePncpThrottle = (reason = 'throttle', pauseMs = null) => {
  pncpDetalheRateLimitedUntil = Math.max(pncpDetalheRateLimitedUntil, Date.now() + (pauseMs || 90_000));
  console.warn(`[PNCP] throttle early (${String(reason).slice(0, 80)})`);
};

const fetchJsonWithCurl = (url, timeoutSeconds = 60) => new Promise((resolve, reject) => {
  const curlBin = process.platform === 'win32' ? 'curl.exe' : 'curl';
  const args = [
    ...(process.platform === 'win32' ? ['--ssl-no-revoke'] : []),
    '--fail',
    '--silent',
    '--show-error',
    '--location',
    '--retry', '2',
    '--retry-delay', '1',
    '--retry-all-errors',
    '--max-time', String(timeoutSeconds),
    '-H', 'Accept: application/json',
    '-H', 'Accept-Language: pt-BR,pt;q=0.9',
    '-H', 'Connection: close',
    '-H', 'User-Agent: KanbanDashboard/1.0 (+https://pncp.gov.br)',
    url,
  ];
  const child = spawn(curlBin, args, { windowsHide: true });
  let stdout = '';
  let stderr = '';

  child.stdout.on('data', chunk => {
    stdout += chunk.toString('utf8');
  });
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8');
  });
  child.on('error', reject);
  child.on('close', code => {
    if (code !== 0) {
      reject(new Error(`curl exit ${code}: ${stderr.slice(0, 300)}`));
      return;
    }
    try {
      resolve(JSON.parse(stdout));
    } catch (error) {
      reject(new Error(`curl JSON parse error: ${error.message}; body=${stdout.slice(0, 200)}`));
    }
  });
});

const describeFetchError = (error) => {
  const parts = [
    error?.message,
    error?.cause?.code,
    error?.cause?.errno,
    error?.cause?.syscall,
  ].filter(Boolean);
  return [...new Set(parts)].join(' | ') || 'erro desconhecido';
};

const fetchPncpSearchStable = async (query = {}, { retries = 3, minItemsWhenKnown = 1 } = {}) => {
  let lastError = null;
  // Se o gate já está em backoff, não martela a API com retries curtos.
  const effectiveRetries = (typeof PNCP_GATE !== 'undefined' && (Date.now() < PNCP_GATE.pausedUntil || PNCP_GATE.failStreak >= 2))
    ? Math.min(retries, 1)
    : retries;
  for (let attempt = 0; attempt <= effectiveRetries; attempt += 1) {
    try {
      const data = await fetchPncpSearch(query);
      const items = Array.isArray(data?.items) ? data.items : [];
      const total = Number(data?.total) || 0;
      if (items.length > 0 || total === 0 || items.length >= minItemsWhenKnown || attempt === effectiveRetries) {
        return data;
      }
    } catch (error) {
      lastError = error;
      const described = describeFetchError(error);
      // 429 / reset: propaga na hora (o gate global entra em pausa). Retry curto piora.
      if (isPncpThrottleError(described) || isPncpThrottleError(error)) {
        if (typeof notePncpThrottle === 'function') notePncpThrottle(described);
        throw new Error(described);
      }
      if (attempt === effectiveRetries) {
        throw new Error(described);
      }
    }
    // Backoff generoso entre tentativas (1.2s, 2.4s, 4.8s…).
    await sleep(1200 * Math.pow(2, attempt));
  }
  if (lastError) throw new Error(describeFetchError(lastError));
  return { items: [], total: 0 };
};

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
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENAI_AI_MODEL = process.env.OPENAI_AI_MODEL || 'gpt-4.1-mini';
const GROQ_AI_MODEL = process.env.GROQ_AI_MODEL || 'llama-3.3-70b-versatile';
const OPENROUTER_AI_MODEL = process.env.OPENROUTER_AI_MODEL || 'openai/gpt-4o-mini';
const AI_RELATIONS_VERSION = 'v5';

// Cache simples para termos correlatos (evita chamadas repetidas)
const termosCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas
const PNCP_SEARCH_RESPONSE_CACHE = new Map();
const PNCP_SEARCH_RESPONSE_CACHE_TTL = 10 * 60 * 1000; // 10 minutos
const PNCP_DEEP_SEARCH_JOBS = new Map();
const PNCP_DEEP_SEARCH_JOB_TTL = 60 * 60 * 1000; // 1 hora
const PNCP_DEEP_SEARCH_CANCELLED = new Set();
const PNCP_DEEP_SEARCH_RESUME_TIMERS = new Map();
// Workers async vivos (Promise). Distingue "queued no map" de "coleta de verdade".
const PNCP_DEEP_SEARCH_WORKERS = new Map();
const PNCP_RATE_LIMIT_RESUME_DELAY_MS = 6 * 60 * 1000;
// Sem update por este tempo → job live é considerado zombie (worker morto / slot preso).
const PNCP_DEEP_SEARCH_STALE_MS = Math.max(3 * 60 * 1000, Number(process.env.PNCP_DEEP_STALE_MS) || 8 * 60 * 1000);
// Bulk não pode segurar o heavy slot esperando orçamento/gate para sempre.
const PNCP_BULK_GATE_WAIT_MAX_MS = Math.max(30_000, Number(process.env.PNCP_BULK_GATE_WAIT_MAX_MS) || 90_000);
// Buscas que não viraram watchlist ficam ativas por 15 dias (contados desde started_at)
// e reexecutam diariamente; depois disso o cleanup remove do banco.
const PNCP_SEARCH_JOB_ARCHIVE_DAYS = 15;
const pncpCompraDetalheCache = new Map();
const PNCP_DETALHE_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 horas
const pncpCompraEnrichmentCache = new Map();
const PNCP_ENRICHMENT_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 horas
let pncpDetalheRateLimitedUntil = 0;
const PNCP_SCORE_HIGH_THRESHOLD = 68;
const PNCP_SCORE_MEDIUM_THRESHOLD = 38;
const getPncpScoreLabel = (score) => {
  const value = Number(score || 0);
  if (value >= PNCP_SCORE_HIGH_THRESHOLD) return 'Alta aderencia';
  if (value >= PNCP_SCORE_MEDIUM_THRESHOLD) return 'Media aderencia';
  return 'Baixa aderencia';
};

/**
 * PCA usa ts_rank (~0–1, + boost opcional). Editais usam 0–100 com faixas 38/68.
 * Converte rank cru para a mesma escala 0–100 (WhatsApp, badges, labels).
 * Valores já em 0–100 (score > 2) passam com clamp.
 */
const scalePcaMatchScore = (raw) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const onHundred = n <= 2 ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(onHundred * 10) / 10));
};

const decoratePcaScoredRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  const score = scalePcaMatchScore(row.score);
  return {
    ...row,
    score,
    score_label: getPncpScoreLabel(score),
  };
};

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

const STRONG_NEGATIVE_HINTS = [
  'servico de', 'prestacao de servico', 'assistencia tecnica', 'atendimento tecnico', 'help desk', 'service desk',
  'suporte tecnico', 'suporte emocional', 'suporte psicologico', 'suporte hospitalar', 'ambulancia', 'uti movel'
];

const POSITIVE_EVIDENCE_HINTS = [
  'material', 'equipamento', 'dispositivo', 'componente', 'peca', 'fixacao', 'vesa', 'braco articulado',
  'ergonomia', 'nr17', 'catalogo', 'codigo item', 'unidade'
];

const CONTRACT_FOCUS_PROFILES = {
  aquisicao: {
    label: 'Aquisição/compra',
    positive: [
      'aquisicao', 'aquisicao de', 'compra', 'compras', 'fornecimento', 'fornecimento de',
      'material permanente', 'material de consumo', 'equipamento', 'equipamentos', 'produto',
      'produtos', 'item', 'itens', 'unidade', 'kit', 'lote'
    ],
    negative: [
      'prestacao de servico', 'prestacao de servicos', 'contratacao de empresa especializada',
      'servico continuado', 'servicos continuados', 'mao de obra', 'manutencao preventiva',
      'manutencao corretiva', 'locacao', 'aluguel', 'obra', 'reforma'
    ],
  },
  servicos: {
    label: 'Serviços',
    positive: [
      'servico', 'servicos', 'execucao de servico', 'execucao de servicos',
      'prestacao de servico', 'prestacao de servicos', 'contratacao de empresa especializada',
      'servico continuado', 'servicos continuados', 'manutencao', 'manutencao preventiva',
      'manutencao corretiva', 'instalacao', 'suporte tecnico', 'treinamento',
      'operacao assistida', 'mao de obra'
    ],
    negative: [
      'aquisicao', 'compra', 'fornecimento de equipamento', 'fornecimento de equipamentos',
      'material permanente', 'material de consumo', 'produto', 'produtos'
    ],
  },
  obras: {
    label: 'Obras/reformas',
    positive: ['obra', 'obras', 'reforma', 'construcao', 'engenharia', 'execucao de obra', 'servicos de engenharia'],
    negative: ['aquisicao', 'compra', 'fornecimento', 'prestacao de servicos continuados'],
  },
  locacao: {
    label: 'Locação/aluguel',
    positive: ['locacao', 'aluguel', 'cessao de uso', 'comodato', 'disponibilizacao de equipamento'],
    negative: ['aquisicao', 'compra', 'fornecimento definitivo', 'material permanente'],
  },
};

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

const rankPositiveSearchTerms = (original, terms = [], limit = 5) => {
  const normalizedOriginal = normalizeSearchText(original);
  const originalTokens = new Set(tokenizeSearchTerms(original));
  const allowlist = getQuerySpecificAllowlist(original).map(term => normalizeSearchText(term));
  const acronymLike = (term) => /^[a-z0-9]{2,6}$/.test(normalizeSearchText(term).replace(/\s+/g, ''));
  const scored = sanitizeAiTerms(terms, { removeGeneric: true })
    .filter(term => normalizeSearchText(term) !== normalizedOriginal)
    .map((term, index) => {
      const normalized = normalizeSearchText(term);
      const words = tokenizeSearchTerms(term);
      const sharedTokens = words.filter(token => originalTokens.has(token)).length;
      const isSingleTerm = words.length === 1;
      const inAllowlist = allowlist.includes(normalized);
      let score = 0;
      if (inAllowlist) score += 36 - allowlist.indexOf(normalized);
      if (sharedTokens > 0) score += Math.min(12, sharedTokens * 6);
      if (isSingleTerm) score += 24;
      else if (words.length === 2) score += 14;
      else if (words.length === 3) score += 6;
      else score -= 10;
      if (acronymLike(term) && inAllowlist) score += 8;
      else if (acronymLike(term)) score += 2;
      if (normalized.includes('aeronave') || normalized.includes('quadricoptero') || normalized.includes('multirrotor')) score += 12;
      if (normalized.includes('veiculo aereo')) score += 5;
      if (OVERBROAD_POSITIVE_TERMS.has(normalized)) score -= 30;
      return { term, score, index };
    })
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));

  return scored.slice(0, limit).map(item => item.term);
};

const getPncpRawItemKey = (item = {}) => {
  const control = item.numero_controle_pncp || item.numeroControlePNCP;
  if (control) return `control:${control}`;
  const orgao = item.orgao_cnpj || item.cnpjOrgao || item.orgaoEntidade?.cnpj || item.cnpjOrgaoEntidade;
  const ano = item.ano || item.anoCompra;
  const sequencial = item.numero_sequencial || item.sequencialCompra || item.numeroSequencial;
  if (orgao && ano && sequencial) return `path:${orgao}-${ano}-${sequencial}`;
  const url = item.item_url || item.linkSistemaOrigem || item.url;
  if (url) return `url:${url}`;
  if (item.id) return `id:${item.id}`;
  return `text:${normalizeSearchText(`${item.title || item.objetoCompra || ''} ${item.orgao_nome || item.nomeOrgao || ''}`).slice(0, 160)}`;
};

const extractPncpCompraIdentifiers = (item = {}) => {
  const directCnpj = item.orgao_cnpj || item.cnpjOrgao || item.orgaoCnpj || item.orgaoEntidade?.cnpj || item.cnpjOrgaoEntidade || item.orgao?.cnpj;
  const directAno = item.ano || item.anoCompra || item.compraAno || item.year;
  const directSequencial = item.numero_sequencial || item.sequencialCompra || item.numeroSequencial || item.compraSequencial || item.sequencial;
  if (directCnpj && directAno && directSequencial) {
    return {
      cnpj: String(directCnpj).replace(/\D/g, ''),
      ano: String(directAno),
      sequencial: String(directSequencial),
    };
  }

  const url = normalizePncpItemUrl(item.item_url || item.url || item.linkSistemaOrigem || item.links_pncp);
  const match = String(url || '').match(/\/app\/editais\/(\d{14})\/(\d{4})\/(\d+)/);
  if (match) {
    return { cnpj: match[1], ano: match[2], sequencial: match[3] };
  }

  const control = String(item.numero_controle_pncp || item.numeroControlePNCP || '').trim();
  const controlMatch = control.match(/^(\d{14})-\d+-(\d+)\/(\d{4})$/);
  if (controlMatch) {
    return { cnpj: controlMatch[1], ano: controlMatch[3], sequencial: String(Number(controlMatch[2])) };
  }

  return { cnpj: '', ano: '', sequencial: '' };
};

// Número de controle PNCP de compra no formato "07854402000100-1-000001/2024".
const parsePncpCompraControlNumber = (value = '') => {
  const match = String(value).trim().match(/^(\d{14})-\d+-(\d+)\/(\d{4})$/);
  if (!match) return null;
  return { cnpj: match[1], sequencial: String(Number(match[2])), ano: match[3] };
};

const getQuerySpecificAllowlist = (query = '') => {
  const q = normalizeSearchText(query);

  if (q.includes('drone')) {
    return [
      'vant',
      'rpa',
      'uav',
      'quadricoptero',
      'aeronave remotamente pilotada',
      'aeronave nao tripulada',
      'multirrotor',
      'veiculo aereo nao tripulado',
      'arp',
      'aeronaves remotamente pilotadas',
      'aeronaves nao tripuladas',
      'uas',
      'vants',
      'rpas',
    ];
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
    negatives.push(
      'suporte hospitalar', 'suporte emocional', 'servico de suporte',
      'suporte tecnico', 'atendimento tecnico', 'assistencia tecnica',
      'help desk', 'service desk', 'ambulancia', 'uti movel'
    );
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

const containsTermStrictFlexible = (text, term) => {
  const normalizedTerm = normalizeSearchText(term).trim();
  if (!normalizedTerm) return false;
  if (containsTermStrict(text, normalizedTerm)) return true;
  const parts = normalizedTerm.split(/\s+/).filter(Boolean);
  if (parts.length === 1 && normalizedTerm.length >= 4) {
    if (normalizedTerm.endsWith('s') && containsTermStrict(text, normalizedTerm.slice(0, -1))) return true;
    if (containsTermStrict(text, `${normalizedTerm}s`)) return true;
  }
  return false;
};

const containsAnyTermStrictFlexible = (text, terms = []) => terms.some(term => containsTermStrictFlexible(text, term));

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

const getPncpCompraDetalhe = async (cnpj, ano, sequencial, { priority = 'sync' } = {}) => {
  if (!cnpj || !ano || !sequencial) {
    return null;
  }
  if (Date.now() < pncpDetalheRateLimitedUntil) {
    return null;
  }

  const cacheKey = `${cnpj}/${ano}/${sequencial}`;
  const cached = pncpCompraDetalheCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < PNCP_DETALHE_CACHE_TTL) {
    return cached.value;
  }

  try {
    const detail = await withPncpGate(() => fetchPncpConsulta(`/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}`), { priority });
    const value = {
      srp: typeof detail?.srp === 'boolean' ? detail.srp : null,
      amparo_legal: detail?.amparoLegal ? {
        codigo: detail.amparoLegal.codigo ?? null,
        nome: detail.amparoLegal.nome || null,
        descricao: detail.amparoLegal.descricao || null,
      } : null,
      modo_disputa_id: detail?.modoDisputaId ? String(detail.modoDisputaId) : null,
      modo_disputa_nome: detail?.modoDisputaNome || null,
      tipo_instrumento_convocatorio_id: detail?.tipoInstrumentoConvocatorioCodigo ? String(detail.tipoInstrumentoConvocatorioCodigo) : null,
      tipo_instrumento_convocatorio_nome: detail?.tipoInstrumentoConvocatorioNome || null,
      situacao_id: detail?.situacaoCompraId ? String(detail.situacaoCompraId) : detail?.situacaoId ? String(detail.situacaoId) : null,
      situacao_nome: detail?.situacaoCompraNome || detail?.situacaoCompraDescricao || detail?.situacaoNome || null,
      data_publicacao_pncp: detail?.dataPublicacaoPncp || detail?.dataPublicacao || null,
      data_abertura_proposta: detail?.dataAberturaProposta || detail?.dataAberturaPropostas || detail?.dataInicioProposta || detail?.dataInicioPropostas || null,
      data_encerramento_proposta: detail?.dataEncerramentoProposta || detail?.dataEncerramentoPropostas || detail?.dataFimProposta || detail?.dataFimPropostas || null,
      valor_total_estimado: Number.isFinite(Number(detail?.valorTotalEstimado)) && Number(detail?.valorTotalEstimado) > 0 ? Number(detail.valorTotalEstimado) : null,
      valor_total_homologado: Number.isFinite(Number(detail?.valorTotalHomologado)) && Number(detail?.valorTotalHomologado) > 0 ? Number(detail.valorTotalHomologado) : null,
      tem_resultado: detail?.temResultado === true || detail?.tem_resultado === true,
    };
    pncpCompraDetalheCache.set(cacheKey, { value, timestamp: Date.now() });
    return value;
  } catch (error) {
    if (isPncpThrottleError(error) || String(error?.message || '').includes('429')) {
      // O gate já registrou o throttle (notePncpThrottle) ao relançar o erro.
      return null;
    }
    if (error?.name !== 'AbortError') {
      console.error(`Erro ao consultar detalhe PNCP (${cacheKey}):`, error.message);
    }
    return null;
  }
};

const fetchPncpCompraItens = async (cnpj, ano, sequencial, options = {}) => {
  const pageSize = Math.max(1, Math.min(200, Number(options.pageSize) || 100));
  const maxPages = Math.max(1, Math.min(20, Number(options.maxPages) || 10));
  const priority = options.priority || 'sync';

  const allItems = [];
  let page = 1;

  while (page <= maxPages) {
    const itensData = await withPncpGate(() => fetchPncp(`/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}/itens`, {
      pagina: page,
      tamanhoPagina: pageSize,
    }), { priority });

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

const fetchPncpOptional = async (pathName, query = {}, { source = 'pncp', priority = 'sync' } = {}) => {
  try {
    return await withPncpGate(
      () => (source === 'consulta' ? fetchPncpConsulta(pathName, query) : fetchPncp(pathName, query)),
      { priority }
    );
  } catch (error) {
    if (String(error?.message || '').includes('404')) {
      return null;
    }
    // Throttle já registrado pelo gate ao relançar o erro.
    console.warn(`[PNCP Dossier] ${pathName} falhou: ${error.message}`);
    return null;
  }
};

const asPncpList = (value) => {
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return [value];
  return [];
};

const fetchPncpCompraResultados = async (
  cnpj,
  ano,
  sequencial,
  itens = [],
  { priority = 'sync', maxItems = 30 } = {}
) => {
  const resultRows = [];
  const safeMaxItems = Math.max(1, Math.min(60, Number(maxItems) || 30));
  for (const item of itens.slice(0, safeMaxItems)) {
    const numeroItem = item?.numeroItem ?? item?.numero_item;
    if (numeroItem === null || numeroItem === undefined || numeroItem === '') continue;
    const data = await fetchPncpOptional(`/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}/itens/${numeroItem}/resultados`, {}, { priority });
    const rows = asPncpList(data);
    rows.forEach(row => {
      resultRows.push({
        ...row,
        numeroItem,
        descricaoItem: item?.descricao || null,
        valorTotalEstimadoItem: item?.valorTotal ?? null,
      });
    });
    if (Date.now() < pncpDetalheRateLimitedUntil) break;
    await sleep(120);
  }
  return resultRows;
};

// O endpoint de contratos por contratação exige paginação (retorna 400 sem `pagina`).
const fetchPncpContratosByCompra = async (cnpj, ano, sequencial, { priority = 'sync' } = {}) => {
  const contratos = [];
  let pagina = 1;
  while (pagina <= 5) {
    const data = await fetchPncpOptional(
      `/v1/orgaos/${cnpj}/contratos/contratacao/${ano}/${sequencial}`,
      { pagina, tamanhoPagina: 50 },
      { priority }
    );
    const rows = asPncpList(data);
    if (!rows.length) break;
    contratos.push(...rows);
    const totalPaginas = Number(data?.totalPaginas) || 1;
    if (pagina >= totalPaginas) break;
    pagina += 1;
  }
  return contratos;
};

const fetchPncpCompraDossier = async (
  cnpj,
  ano,
  sequencial,
  { query = '', includeResultados = true, priority = 'sync', maxResultItems } = {}
) => {
  const compra = await fetchPncpOptional(`/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}`, {}, { source: 'consulta', priority });
  const itens = await fetchPncpCompraItens(cnpj, ano, sequencial, { pageSize: 100, maxPages: 20, priority }).catch(error => {
    console.warn(`[PNCP Dossier] itens ${cnpj}/${ano}/${sequencial} falhou: ${error.message}`);
    return [];
  });
  const normalizedQuery = normalizeSearchText(query).trim();
  const itensPertinentes = normalizedQuery
    ? itens.filter(item => isPncpCompraItemRelevantToQuery(item, normalizedQuery))
    : [];
  const resultItemBudget = Math.max(
    1,
    Math.min(60, Number(maxResultItems) || (priority === 'interactive' ? 40 : 24))
  );
  const resultItems = itensPertinentes.length
    ? [
        ...itensPertinentes,
        ...itens.filter(item => !itensPertinentes.includes(item)),
      ].slice(0, resultItemBudget)
    : itens.slice(0, resultItemBudget);
  const resultados = includeResultados
    ? await fetchPncpCompraResultados(cnpj, ano, sequencial, resultItems, { priority, maxItems: resultItemBudget })
    : [];
  const contratos = await fetchPncpContratosByCompra(cnpj, ano, sequencial, { priority });
  const atasData = await fetchPncpOptional(`/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}/atas`, {}, { priority });
  const arquivosData = await fetchPncpOptional(`/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}/arquivos`, {}, { priority });
  const atas = asPncpList(atasData);
  const arquivos = asPncpList(arquivosData);
  const valorItensPertinentes = itensPertinentes.reduce((sum, item) => {
    const value = Number(item?.valorTotal);
    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
  const valorHomologado = resultados.reduce((sum, row) => {
    const value = Number(row?.valorTotalHomologado);
    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
  const searchItem = normalizePncpItem({
    ...(compra || {}),
    orgao_cnpj: cnpj,
    ano,
    numero_sequencial: sequencial,
    title: compra?.objetoCompra || compra?.numeroControlePNCP || `Compra ${sequencial}/${ano}`,
    description: compra?.objetoCompra || '',
    numeroControlePNCP: compra?.numeroControlePNCP,
    modalidade_licitacao_nome: compra?.modalidadeNome,
    situacaoCompraNome: compra?.situacaoCompraNome,
    dataPublicacaoPncp: compra?.dataPublicacaoPncp,
    valorTotalEstimado: compra?.valorTotalEstimado,
    valorTotalHomologado: compra?.valorTotalHomologado,
    tem_resultado: resultados.length > 0 || compra?.temResultado,
    valor_itens_pertinentes: valorItensPertinentes > 0 ? Number(valorItensPertinentes.toFixed(2)) : null,
    itens_pertinentes_count: itensPertinentes.length || null,
    total_itens: itens.length,
    itens_resumo_texto: itens.map(item => item?.descricao).filter(Boolean).slice(0, 25).join(' | '),
  });
  const commercial_stage = classifyPncpCommercialStage(searchItem, { resultados, contratos, atas });
  return {
    ids: { cnpj, ano, sequencial },
    compra,
    itens,
    resultados,
    contratos,
    atas,
    arquivos,
    totais: {
      valor_estimado: Number(compra?.valorTotalEstimado) || getPncpTotalEstimatedValue(searchItem) || null,
      valor_itens_pertinentes: valorItensPertinentes > 0 ? Number(valorItensPertinentes.toFixed(2)) : null,
      valor_homologado: valorHomologado > 0 ? Number(valorHomologado.toFixed(2)) : (Number(compra?.valorTotalHomologado) || null),
      itens_pertinentes_count: itensPertinentes.length,
      total_itens: itens.length,
    },
    commercial_stage,
    normalized_item: { ...searchItem, commercial_stage },
  };
};

const collectPncpFornecedores = (dossier = {}) => {
  const fornecedores = new Map();
  const add = (row, fonte) => {
    if (!row || typeof row !== 'object') return;
    const nested = row.fornecedor && typeof row.fornecedor === 'object' ? row.fornecedor : {};
    const ni = row.niFornecedor || row.numeroDocumentoFornecedor || nested.niFornecedor
      || nested.numeroDocumentoFornecedor || null;
    const nome = row.nomeRazaoSocialFornecedor || row.razaoSocialFornecedor
      || nested.nomeRazaoSocialFornecedor || nested.razaoSocialFornecedor || null;
    if (!ni && !nome) return;
    const normalizedNi = ni ? String(ni).replace(/\D/g, '') : '';
    const normalizedNome = nome ? String(nome).trim() : '';
    const key = normalizedNi || normalizeSearchText(normalizedNome);
    if (!key) return;
    const current = fornecedores.get(key) || {};
    fornecedores.set(key, {
      ni: normalizedNi || current.ni || null,
      nome: normalizedNome || current.nome || null,
      fonte: current.fonte || fonte,
    });
  };
  (dossier.resultados || []).forEach(row => add(row, 'resultado'));
  (dossier.contratos || []).forEach(row => add(row, 'contrato'));
  (dossier.atas || []).forEach(row => add(row, 'ata'));
  (dossier.contratos_daily || []).forEach(row => add(row, 'contrato'));
  (dossier.atas_daily || []).forEach(row => add(row, 'ata'));
  return [...fornecedores.values()];
};

const buildPncpResultCachePayload = (dossier, query = '') => {
  const item = dossier?.normalized_item || {};
  const compra = dossier?.compra || {};
  const firstResult = (dossier?.resultados || [])[0] || {};
  const firstContract = (dossier?.contratos || [])[0] || {};
  const fornecedores = collectPncpFornecedores(dossier);
  const fornecedorNi = fornecedores[0]?.ni || null;
  const fornecedorNome = fornecedores[0]?.nome || null;
  const titulo = item.titulo || compra?.objetoCompra || compra?.numeroControlePNCP || `Compra ${dossier?.ids?.sequencial}/${dossier?.ids?.ano}`;
  const descricao = item.descricao || compra?.objetoCompra || '';
  const searchText = [
    titulo,
    descricao,
    item.orgao?.nome,
    item.unidade?.nome,
    ...fornecedores.flatMap(row => [row.ni, row.nome]),
    ...(dossier?.itens || []).slice(0, 50).map(row => row?.descricao),
    ...(dossier?.resultados || []).slice(0, 50).map(row => `${row?.descricaoItem || ''} ${row?.nomeRazaoSocialFornecedor || ''}`),
    ...(dossier?.contratos || []).slice(0, 20).map(row => `${row?.objetoContrato || ''} ${row?.nomeRazaoSocialFornecedor || ''}`),
  ].filter(Boolean).join(' ');
  const hasResult = (Array.isArray(dossier?.resultados) && dossier.resultados.length > 0)
    || Boolean(compra?.temResultado || item?.tem_resultado);
  const hasContract = Array.isArray(dossier?.contratos) && dossier.contratos.length > 0;
  const hasAta = Array.isArray(dossier?.atas) && dossier.atas.length > 0;
  const hasValidIds = dossier?.ids?.cnpj && dossier?.ids?.ano && dossier?.ids?.sequencial;
  return {
    pncp_key: hasValidIds ? `${dossier.ids.cnpj}/${dossier.ids.ano}/${dossier.ids.sequencial}` : null,
    orgao_cnpj: item.orgao?.cnpj || dossier?.ids?.cnpj || null,
    orgao_nome: item.orgao?.nome || compra?.orgaoEntidade?.razaoSocial || null,
    ano: Number(dossier?.ids?.ano) || null,
    sequencial: Number(dossier?.ids?.sequencial) || null,
    numero_controle_pncp: item.numero_controle_pncp || compra?.numeroControlePNCP || null,
    titulo,
    descricao,
    uf: item.uf || compra?.unidadeOrgao?.ufSigla || null,
    modalidade: item.modalidade?.nome || compra?.modalidadeNome || null,
    etapa_comercial: dossier?.commercial_stage?.id || null,
    fornecedor_ni: fornecedorNi,
    fornecedor_nome: fornecedorNome,
    valor_estimado: dossier?.totais?.valor_estimado || null,
    valor_homologado: dossier?.totais?.valor_homologado || null,
    data_publicacao: item.data_publicacao || compra?.dataPublicacaoPncp || null,
    data_resultado: firstResult?.dataResultado || null,
    data_assinatura: firstContract?.dataAssinatura || null,
    srp: typeof compra?.srp === 'boolean' ? compra.srp : (typeof item.srp === 'boolean' ? item.srp : null),
    amparo_legal: compra?.amparoLegal?.nome || item.amparo_legal?.nome || null,
    has_result: hasResult,
    has_contract: hasContract,
    has_ata: hasAta,
    fornecedores,
    search_text: searchText,
    payload: dossier,
  };
};

const upsertPncpResultCache = async (dossier, query = '') => {
  const row = buildPncpResultCachePayload(dossier, query);
  if (!row.pncp_key) return null;
  await pool.query(
    `
      INSERT INTO ${PNCP_RESULT_CACHE_TABLE}
        (pncp_key, orgao_cnpj, orgao_nome, ano, sequencial, numero_controle_pncp, titulo, descricao,
         uf, modalidade, etapa_comercial, fornecedor_ni, fornecedor_nome, valor_estimado, valor_homologado,
         data_publicacao, data_resultado, data_assinatura, srp, amparo_legal, has_result, has_contract,
         has_ata, fornecedores, search_text, payload, refreshed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb,$25,$26::jsonb,NOW())
      ON CONFLICT (pncp_key) DO UPDATE SET
        orgao_cnpj = EXCLUDED.orgao_cnpj,
        orgao_nome = EXCLUDED.orgao_nome,
        ano = EXCLUDED.ano,
        sequencial = EXCLUDED.sequencial,
        numero_controle_pncp = EXCLUDED.numero_controle_pncp,
        titulo = EXCLUDED.titulo,
        descricao = EXCLUDED.descricao,
        uf = EXCLUDED.uf,
        modalidade = EXCLUDED.modalidade,
        srp = COALESCE(EXCLUDED.srp, ${PNCP_RESULT_CACHE_TABLE}.srp),
        amparo_legal = COALESCE(EXCLUDED.amparo_legal, ${PNCP_RESULT_CACHE_TABLE}.amparo_legal),
        etapa_comercial = CASE
          WHEN EXCLUDED.etapa_comercial IN ('contracted','ata_available','resulted') THEN EXCLUDED.etapa_comercial
          WHEN ${PNCP_RESULT_CACHE_TABLE}.etapa_comercial IN ('contracted','ata_available','resulted') THEN ${PNCP_RESULT_CACHE_TABLE}.etapa_comercial
          ELSE COALESCE(EXCLUDED.etapa_comercial, ${PNCP_RESULT_CACHE_TABLE}.etapa_comercial) END,
        fornecedor_ni = COALESCE(EXCLUDED.fornecedor_ni, ${PNCP_RESULT_CACHE_TABLE}.fornecedor_ni),
        fornecedor_nome = COALESCE(EXCLUDED.fornecedor_nome, ${PNCP_RESULT_CACHE_TABLE}.fornecedor_nome),
        valor_estimado = COALESCE(EXCLUDED.valor_estimado, ${PNCP_RESULT_CACHE_TABLE}.valor_estimado),
        valor_homologado = COALESCE(EXCLUDED.valor_homologado, ${PNCP_RESULT_CACHE_TABLE}.valor_homologado),
        data_publicacao = COALESCE(EXCLUDED.data_publicacao, ${PNCP_RESULT_CACHE_TABLE}.data_publicacao),
        data_resultado = COALESCE(EXCLUDED.data_resultado, ${PNCP_RESULT_CACHE_TABLE}.data_resultado),
        data_assinatura = COALESCE(EXCLUDED.data_assinatura, ${PNCP_RESULT_CACHE_TABLE}.data_assinatura),
        has_result = ${PNCP_RESULT_CACHE_TABLE}.has_result OR EXCLUDED.has_result,
        has_contract = ${PNCP_RESULT_CACHE_TABLE}.has_contract OR EXCLUDED.has_contract,
        has_ata = ${PNCP_RESULT_CACHE_TABLE}.has_ata OR EXCLUDED.has_ata,
        fornecedores = (
          SELECT COALESCE(jsonb_agg(entry.value), '[]'::jsonb)
          FROM (
            SELECT DISTINCT ON (supplier_key) value
            FROM (
              SELECT value,
                     COALESCE(NULLIF(value->>'ni', ''), lower(NULLIF(value->>'nome', '')), value::text) AS supplier_key
                FROM jsonb_array_elements(
                  (CASE WHEN jsonb_typeof(${PNCP_RESULT_CACHE_TABLE}.fornecedores) = 'array' THEN ${PNCP_RESULT_CACHE_TABLE}.fornecedores ELSE '[]'::jsonb END)
                  || (CASE WHEN jsonb_typeof(EXCLUDED.fornecedores) = 'array' THEN EXCLUDED.fornecedores ELSE '[]'::jsonb END)
                ) merged(value)
            ) suppliers
            ORDER BY supplier_key, (value->>'nome' IS NOT NULL) DESC
          ) entry
        ),
        search_text = CASE
          WHEN EXCLUDED.search_text IS NULL OR EXCLUDED.search_text = '' THEN ${PNCP_RESULT_CACHE_TABLE}.search_text
          WHEN ${PNCP_RESULT_CACHE_TABLE}.search_text IS NULL THEN EXCLUDED.search_text
          WHEN position(EXCLUDED.search_text IN ${PNCP_RESULT_CACHE_TABLE}.search_text) > 0 THEN ${PNCP_RESULT_CACHE_TABLE}.search_text
          ELSE ${PNCP_RESULT_CACHE_TABLE}.search_text || ' ' || EXCLUDED.search_text END,
        payload = ${PNCP_RESULT_CACHE_TABLE}.payload || EXCLUDED.payload,
        refreshed_at = NOW()
    `,
    [
      row.pncp_key, row.orgao_cnpj, row.orgao_nome, row.ano, row.sequencial, row.numero_controle_pncp,
      row.titulo, row.descricao, row.uf, row.modalidade, row.etapa_comercial, row.fornecedor_ni,
      row.fornecedor_nome, row.valor_estimado, row.valor_homologado, row.data_publicacao,
      row.data_resultado, row.data_assinatura, row.srp ?? null, row.amparo_legal ?? null,
      Boolean(row.has_result), Boolean(row.has_contract), Boolean(row.has_ata),
      JSON.stringify(row.fornecedores || []), row.search_text, JSON.stringify(row.payload),
    ]
  );
  return row;
};

// Upsert gentil para linhas vindas do sync diário de contratos/atas (sem dossiê):
// só preenche o que está vazio (dado de dossiê existente vence) e faz merge do payload.
const upsertPncpResultCacheLite = async (row) => {
  if (!row?.pncp_key) return null;
  await pool.query(
    `
      INSERT INTO ${PNCP_RESULT_CACHE_TABLE}
        (pncp_key, orgao_cnpj, orgao_nome, ano, sequencial, numero_controle_pncp, titulo, descricao,
         uf, modalidade, etapa_comercial, fornecedor_ni, fornecedor_nome, valor_estimado, valor_homologado,
         data_publicacao, data_resultado, data_assinatura, srp, amparo_legal, has_result, has_contract,
         has_ata, fornecedores, search_text, payload, refreshed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb,$25,$26::jsonb,NOW())
      ON CONFLICT (pncp_key) DO UPDATE SET
        srp = COALESCE(${PNCP_RESULT_CACHE_TABLE}.srp, EXCLUDED.srp),
        amparo_legal = COALESCE(${PNCP_RESULT_CACHE_TABLE}.amparo_legal, EXCLUDED.amparo_legal),
        orgao_cnpj = COALESCE(${PNCP_RESULT_CACHE_TABLE}.orgao_cnpj, EXCLUDED.orgao_cnpj),
        orgao_nome = COALESCE(${PNCP_RESULT_CACHE_TABLE}.orgao_nome, EXCLUDED.orgao_nome),
        ano = COALESCE(${PNCP_RESULT_CACHE_TABLE}.ano, EXCLUDED.ano),
        sequencial = COALESCE(${PNCP_RESULT_CACHE_TABLE}.sequencial, EXCLUDED.sequencial),
        numero_controle_pncp = COALESCE(${PNCP_RESULT_CACHE_TABLE}.numero_controle_pncp, EXCLUDED.numero_controle_pncp),
        titulo = COALESCE(${PNCP_RESULT_CACHE_TABLE}.titulo, EXCLUDED.titulo),
        descricao = COALESCE(${PNCP_RESULT_CACHE_TABLE}.descricao, EXCLUDED.descricao),
        uf = COALESCE(${PNCP_RESULT_CACHE_TABLE}.uf, EXCLUDED.uf),
        modalidade = COALESCE(${PNCP_RESULT_CACHE_TABLE}.modalidade, EXCLUDED.modalidade),
        etapa_comercial = CASE
          WHEN EXCLUDED.etapa_comercial IN ('contracted','ata_available','resulted') THEN EXCLUDED.etapa_comercial
          ELSE COALESCE(${PNCP_RESULT_CACHE_TABLE}.etapa_comercial, EXCLUDED.etapa_comercial) END,
        fornecedor_ni = COALESCE(${PNCP_RESULT_CACHE_TABLE}.fornecedor_ni, EXCLUDED.fornecedor_ni),
        fornecedor_nome = COALESCE(${PNCP_RESULT_CACHE_TABLE}.fornecedor_nome, EXCLUDED.fornecedor_nome),
        valor_estimado = COALESCE(${PNCP_RESULT_CACHE_TABLE}.valor_estimado, EXCLUDED.valor_estimado),
        valor_homologado = COALESCE(${PNCP_RESULT_CACHE_TABLE}.valor_homologado, EXCLUDED.valor_homologado),
        data_publicacao = COALESCE(${PNCP_RESULT_CACHE_TABLE}.data_publicacao, EXCLUDED.data_publicacao),
        data_resultado = COALESCE(${PNCP_RESULT_CACHE_TABLE}.data_resultado, EXCLUDED.data_resultado),
        data_assinatura = COALESCE(${PNCP_RESULT_CACHE_TABLE}.data_assinatura, EXCLUDED.data_assinatura),
        has_result = ${PNCP_RESULT_CACHE_TABLE}.has_result OR EXCLUDED.has_result,
        has_contract = ${PNCP_RESULT_CACHE_TABLE}.has_contract OR EXCLUDED.has_contract,
        has_ata = ${PNCP_RESULT_CACHE_TABLE}.has_ata OR EXCLUDED.has_ata,
        fornecedores = (
          SELECT COALESCE(jsonb_agg(entry.value), '[]'::jsonb)
          FROM (
            SELECT DISTINCT ON (supplier_key) value
            FROM (
              SELECT value,
                     COALESCE(NULLIF(value->>'ni', ''), lower(NULLIF(value->>'nome', '')), value::text) AS supplier_key
                FROM jsonb_array_elements(
                  (CASE WHEN jsonb_typeof(${PNCP_RESULT_CACHE_TABLE}.fornecedores) = 'array' THEN ${PNCP_RESULT_CACHE_TABLE}.fornecedores ELSE '[]'::jsonb END)
                  || (CASE WHEN jsonb_typeof(EXCLUDED.fornecedores) = 'array' THEN EXCLUDED.fornecedores ELSE '[]'::jsonb END)
                ) merged(value)
            ) suppliers
            ORDER BY supplier_key, (value->>'nome' IS NOT NULL) DESC
          ) entry
        ),
        search_text = CASE
          WHEN EXCLUDED.search_text IS NULL OR EXCLUDED.search_text = '' THEN ${PNCP_RESULT_CACHE_TABLE}.search_text
          WHEN ${PNCP_RESULT_CACHE_TABLE}.search_text IS NULL THEN EXCLUDED.search_text
          WHEN position(EXCLUDED.search_text IN ${PNCP_RESULT_CACHE_TABLE}.search_text) > 0 THEN ${PNCP_RESULT_CACHE_TABLE}.search_text
          ELSE ${PNCP_RESULT_CACHE_TABLE}.search_text || ' ' || EXCLUDED.search_text END,
        payload = ${PNCP_RESULT_CACHE_TABLE}.payload || EXCLUDED.payload,
        refreshed_at = NOW()
    `,
    [
      row.pncp_key, row.orgao_cnpj || null, row.orgao_nome || null, row.ano || null, row.sequencial || null,
      row.numero_controle_pncp || null, row.titulo || null, row.descricao || null, row.uf || null,
      row.modalidade || null, row.etapa_comercial || null, row.fornecedor_ni || null, row.fornecedor_nome || null,
      row.valor_estimado || null, row.valor_homologado || null, row.data_publicacao || null,
      row.data_resultado || null, row.data_assinatura || null, row.srp ?? null, row.amparo_legal || null,
      Boolean(row.has_result || row.etapa_comercial === 'resulted'),
      Boolean(row.has_contract || row.etapa_comercial === 'contracted'),
      Boolean(row.has_ata || row.etapa_comercial === 'ata_available'),
      JSON.stringify(row.fornecedores || collectPncpFornecedores(row.payload || {})),
      row.search_text || null, JSON.stringify(row.payload || {}),
    ]
  );
  return row;
};

const normalizePncpResultCacheRow = (row) => ({
  pncp_key: row.pncp_key,
  orgao_cnpj: row.orgao_cnpj,
  orgao_nome: row.orgao_nome,
  ano: row.ano,
  sequencial: row.sequencial,
  numero_controle_pncp: row.numero_controle_pncp,
  titulo: row.titulo,
  descricao: row.descricao,
  uf: row.uf,
  modalidade: row.modalidade,
  etapa_comercial: row.etapa_comercial,
  fornecedor_ni: row.fornecedor_ni,
  fornecedor_nome: row.fornecedor_nome,
  valor_estimado: row.valor_estimado === null ? null : Number(row.valor_estimado),
  valor_homologado: row.valor_homologado === null ? null : Number(row.valor_homologado),
  data_publicacao: row.data_publicacao,
  data_resultado: row.data_resultado,
  data_assinatura: row.data_assinatura,
  srp: typeof row.srp === 'boolean' ? row.srp : null,
  amparo_legal: row.amparo_legal || null,
  has_result: Boolean(row.has_result),
  has_contract: Boolean(row.has_contract),
  has_ata: Boolean(row.has_ata),
  fornecedores: Array.isArray(row.fornecedores) ? row.fornecedores : [],
  refreshed_at: row.refreshed_at,
  dossier: row.payload || null,
  doc_type: row.payload?.live_document?.doc_type || null,
  doc_ids: row.payload?.live_document?.doc_ids || null,
  url: row.payload?.live_document?.url || (row.orgao_cnpj && row.ano && row.sequencial
    ? `https://pncp.gov.br/app/editais/${row.orgao_cnpj}/${row.ano}/${row.sequencial}`
    : null),
});

const pncpOutcomeSyncState = {
  running: false,
  status: 'idle',
  phase: null,
  processed: 0,
  total: 0,
  cached: 0,
  errors: 0,
  reason: null,
  started_at: null,
  finished_at: null,
  error: null,
  summary: null,
};
const pncpOutcomeCandidateChecks = new Map();

const getPncpOutcomeCacheStats = async () => {
  const { rows } = await pool.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE has_result)::int AS has_result,
           COUNT(*) FILTER (WHERE has_contract)::int AS has_contract,
           COUNT(*) FILTER (WHERE has_ata)::int AS has_ata,
           MAX(refreshed_at) AS last_refreshed
      FROM ${PNCP_RESULT_CACHE_TABLE}
  `);
  const row = rows[0] || {};
  return {
    total: Number(row.total) || 0,
    has_result: Number(row.has_result) || 0,
    has_contract: Number(row.has_contract) || 0,
    has_ata: Number(row.has_ata) || 0,
    last_refreshed: row.last_refreshed || null,
  };
};

const getPncpOutcomeSyncSnapshot = () => ({
  ...pncpOutcomeSyncState,
  gate: getPncpGateSnapshot(),
});

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

const getPncpCompraEnrichment = async (cnpj, ano, sequencial, query = '', options = {}) => {
  if (!cnpj || !ano || !sequencial) {
    return null;
  }

  const normalizedQuery = normalizeSearchText(query).trim();
  const priority = options.priority || 'sync';
  const maxPages = Math.max(1, Math.min(15, Number(options.maxPages) || (normalizedQuery ? 8 : 1)));
  const pageSize = Math.max(1, Math.min(100, Number(options.pageSize) || (normalizedQuery ? 100 : 50)));
  const cacheKey = `${cnpj}/${ano}/${sequencial}|q:${normalizedQuery}|p:${maxPages}`;
  const cached = pncpCompraEnrichmentCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < PNCP_ENRICHMENT_CACHE_TTL) {
    return cached.value;
  }

  try {
    const detalhe = await getPncpCompraDetalhe(cnpj, ano, sequencial, { priority });

    let itensResumoTexto = '';
    let totalItens = 0;
    let valorItensPertinentes = null;
    let itensPertinentes = [];
    try {
      const itens = await fetchPncpCompraItens(cnpj, ano, sequencial, { pageSize, maxPages, priority });
      totalItens = itens.length;
      itensResumoTexto = itens
        .map(item => `${item?.descricao || ''} ${item?.itemCategoriaNome || ''} ${item?.catalogoCodigoItem || ''} ${item?.numeroItem || ''}`.trim())
        .filter(Boolean)
        .slice(0, 20)
        .join(' | ');

      if (normalizedQuery && itens.length) {
        let pertinentes = itens.filter(item => isPncpCompraItemRelevantToQuery(item, normalizedQuery));
        // Compra de 1 item ou nenhum match estrito: usa o(s) item(ns) com valor como fallback
        // para não ficar só com o total da licitação.
        if (!pertinentes.length && itens.length === 1) {
          pertinentes = itens;
        } else if (!pertinentes.length && itens.length > 0 && itens.length <= 5) {
          // Poucos itens: se a query casa no objeto da compra, considera todos com valor.
          pertinentes = itens.filter(item => Number(item?.valorTotal) > 0);
        }
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
      } else if (!normalizedQuery && itens.length === 1) {
        const only = itens[0];
        const onlyVal = Number(only?.valorTotal);
        if (Number.isFinite(onlyVal) && onlyVal > 0) {
          valorItensPertinentes = Number(onlyVal.toFixed(2));
          itensPertinentes = [{
            numero_item: only?.numeroItem ?? null,
            descricao: only?.descricao || null,
            quantidade: Number.isFinite(Number(only?.quantidade)) ? Number(only.quantidade) : null,
            unidade: only?.unidadeMedida || null,
            valor_unitario_estimado: Number.isFinite(Number(only?.valorUnitarioEstimado)) ? Number(only.valorUnitarioEstimado) : null,
            valor_total: onlyVal,
          }];
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
      situacao_id: detalhe?.situacao_id ?? null,
      situacao_nome: detalhe?.situacao_nome ?? null,
      data_publicacao_pncp: detalhe?.data_publicacao_pncp ?? null,
      data_inicio_vigencia: detalhe?.data_abertura_proposta ?? null,
      data_fim_vigencia: detalhe?.data_encerramento_proposta ?? null,
      srp: detalhe?.srp ?? null,
      amparo_legal: detalhe?.amparo_legal ?? null,
      modo_disputa_id: detalhe?.modo_disputa_id ?? null,
      modo_disputa_nome: detalhe?.modo_disputa_nome ?? null,
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

const buildPncpEnrichmentQuery = (item, fallbackQuery = '') => {
  const parts = [
    item?.__matched_termo,
    item?.matched_termo,
    fallbackQuery,
  ].map(v => String(v || '').trim()).filter(Boolean);
  return parts[0] || '';
};

const itemHasPncpItemValue = (item) => {
  const n = Number(item?.valor_itens_pertinentes);
  return Number.isFinite(n) && n > 0;
};

/** Precisa enriquecer enquanto faltar valor dos itens pertinentes (não basta total da licitação). */
const itemNeedsPncpValueEnrichment = (item) => !itemHasPncpItemValue(item);

const getPncpTotalEstimatedValue = (item) => {
  const candidates = [
    item?.valor_total_estimado,
    item?.valorTotalEstimado,
    item?.valor_global,
    item?.valorGlobal,
    item?.valor_total_homologado,
    item?.valorTotalHomologado,
  ];
  for (const value of candidates) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return null;
};

const mergePncpDetalheIntoItem = (item, detalhe) => ({
  ...item,
  valor_total_estimado: detalhe.valor_total_estimado ?? item?.valor_total_estimado ?? null,
  valor_total_homologado: detalhe.valor_total_homologado ?? item?.valor_total_homologado ?? null,
  situacao_id: item?.situacao_id || detalhe.situacao_id,
  situacao_nome: item?.situacao_nome || detalhe.situacao_nome,
  data_publicacao_pncp: item?.data_publicacao_pncp || detalhe.data_publicacao_pncp,
  data_inicio_vigencia: item?.data_inicio_vigencia || detalhe.data_abertura_proposta,
  data_fim_vigencia: item?.data_fim_vigencia || detalhe.data_encerramento_proposta,
  modo_disputa_id: item?.modo_disputa_id || detalhe.modo_disputa_id,
  modo_disputa_nome: item?.modo_disputa_nome || detalhe.modo_disputa_nome,
  tipo_id: item?.tipo_id || detalhe.tipo_instrumento_convocatorio_id,
  tipo_nome: item?.tipo_nome || detalhe.tipo_instrumento_convocatorio_nome,
  srp: item?.srp ?? detalhe.srp ?? null,
  amparo_legal: item?.amparo_legal || detalhe.amparo_legal || null,
});

const mergePncpEnrichmentIntoRawItem = (item, enrichment) => {
  if (!enrichment) return item;
  return {
    ...mergePncpDetalheIntoItem(item, enrichment),
    valor_itens_pertinentes: enrichment.valor_itens_pertinentes ?? item?.valor_itens_pertinentes ?? null,
    itens_pertinentes: Array.isArray(enrichment.itens_pertinentes) && enrichment.itens_pertinentes.length
      ? enrichment.itens_pertinentes
      : (item?.itens_pertinentes || []),
    itens_pertinentes_count: enrichment.itens_pertinentes_count ?? item?.itens_pertinentes_count ?? null,
    itens_resumo_texto: enrichment.itens_resumo_texto || item?.itens_resumo_texto || item?.__itens_resumo_texto || '',
    total_itens: enrichment.total_itens ?? item?.total_itens ?? null,
  };
};

// Merge síncrono a partir do cache (sem rede): snapshots parciais do deep job.
const applyCachedPncpEnrichment = (items = [], fallbackQuery = '') => items.map(item => {
  if (!itemNeedsPncpValueEnrichment(item)) return item;
  const ids = extractPncpCompraIdentifiers(item);
  if (!ids.cnpj || !ids.ano || !ids.sequencial) return item;
  const q = normalizeSearchText(buildPncpEnrichmentQuery(item, fallbackQuery)).trim();
  // Tenta cache de enrichment completo (total + itens).
  for (const [key, cached] of pncpCompraEnrichmentCache.entries()) {
    if (!cached?.value || (Date.now() - cached.timestamp) >= PNCP_ENRICHMENT_CACHE_TTL) continue;
    if (key.startsWith(`${ids.cnpj}/${ids.ano}/${ids.sequencial}|q:${q}`)) {
      return mergePncpEnrichmentIntoRawItem(item, cached.value);
    }
  }
  const cached = pncpCompraDetalheCache.get(`${ids.cnpj}/${ids.ano}/${ids.sequencial}`);
  if (!cached?.value || (Date.now() - cached.timestamp) >= PNCP_DETALHE_CACHE_TTL) return item;
  return mergePncpDetalheIntoItem(item, cached.value);
});

// Preenche valor do(s) item(ns) pertinente(s) via API de itens (+ detalhe como side-effect).
// Insiste enquanto faltar valor_itens_pertinentes — total da licitação sozinho não dispensa.
const fillPncpMissingEstimatedValues = async (items = [], {
  limit = 80,
  delayMs = 250,
  rateLimitWaitMs = 0,
  query = '',
  maxPages = 8,
  priority = 'sync',
} = {}) => {
  const result = [];
  let checked = 0;
  let rateLimitWaitBudget = Math.max(0, Number(rateLimitWaitMs) || 0);
  for (const item of items) {
    if (!itemNeedsPncpValueEnrichment(item) || checked >= limit) {
      result.push(item);
      continue;
    }
    checked += 1;
    const ids = extractPncpCompraIdentifiers(item);
    if (!ids.cnpj || !ids.ano || !ids.sequencial) {
      result.push(item);
      continue;
    }
    const q = buildPncpEnrichmentQuery(item, query);
    let enrichment = await getPncpCompraEnrichment(ids.cnpj, ids.ano, ids.sequencial, q, { maxPages, priority });
    if (!enrichment && Date.now() < pncpDetalheRateLimitedUntil && rateLimitWaitBudget > 0) {
      const waitMs = Math.min(pncpDetalheRateLimitedUntil - Date.now(), rateLimitWaitBudget);
      rateLimitWaitBudget -= waitMs;
      await sleep(waitMs);
      enrichment = await getPncpCompraEnrichment(ids.cnpj, ids.ano, ids.sequencial, q, { maxPages, priority });
    }
    if (!enrichment) {
      result.push(item);
      if (Date.now() < pncpDetalheRateLimitedUntil || Date.now() < PNCP_GATE.pausedUntil) {
        result.push(...items.slice(result.length));
        break;
      }
      if (delayMs > 0) await sleep(delayMs);
      continue;
    }
    result.push(mergePncpEnrichmentIntoRawItem(item, enrichment));
    if (delayMs > 0) await sleep(delayMs);
  }
  return result;
};

const mergePncpDetalheIntoNormalizedItem = (item, detalhe) => ({
  ...item,
  valor_total_estimado: item?.valor_total_estimado ?? detalhe.valor_total_estimado ?? null,
  valor_total_homologado: item?.valor_total_homologado ?? detalhe.valor_total_homologado ?? null,
  situacao: {
    id: item?.situacao?.id || detalhe.situacao_id || null,
    nome: item?.situacao?.nome || detalhe.situacao_nome || null,
  },
  data_inicio_vigencia: item?.data_inicio_vigencia || detalhe.data_abertura_proposta || null,
  data_fim_vigencia: item?.data_fim_vigencia || detalhe.data_encerramento_proposta || null,
  modo_disputa: {
    id: item?.modo_disputa?.id || detalhe.modo_disputa_id || null,
    nome: item?.modo_disputa?.nome || detalhe.modo_disputa_nome || null,
  },
  srp: item?.srp ?? detalhe.srp ?? null,
  amparo_legal: item?.amparo_legal || detalhe.amparo_legal || null,
});

const mergePncpEnrichmentIntoNormalizedItem = (item, enrichment) => {
  if (!enrichment) return item;
  const base = mergePncpDetalheIntoNormalizedItem(item, enrichment);
  const prevMatched = Number(item?.valor_itens_pertinentes || 0);
  const nextMatched = Number(enrichment.valor_itens_pertinentes || 0);
  // Prefere valor pertinente vindo do enrich; se o item já tinha um maior, mantém.
  const valorItensPertinentes = nextMatched > 0
    ? (prevMatched > nextMatched ? prevMatched : nextMatched)
    : (prevMatched > 0 ? prevMatched : (enrichment.valor_itens_pertinentes ?? item?.valor_itens_pertinentes ?? null));
  return {
    ...base,
    valor_itens_pertinentes: valorItensPertinentes,
    itens_pertinentes: Array.isArray(enrichment.itens_pertinentes) && enrichment.itens_pertinentes.length
      ? enrichment.itens_pertinentes
      : (Array.isArray(item?.itens_pertinentes) ? item.itens_pertinentes : []),
    itens_pertinentes_count: enrichment.itens_pertinentes_count ?? item?.itens_pertinentes_count ?? null,
    itens_resumo_texto: enrichment.itens_resumo_texto || item?.itens_resumo_texto || '',
    total_itens: enrichment.total_itens ?? item?.total_itens ?? null,
  };
};

// Enriquecimento da página visível: insiste no valor do item pertinente.
const fillValuesOnNormalizedPncpItems = async (items = [], {
  limit = 20,
  rateLimitWaitMs = 8000,
  query = '',
  maxPages = 8,
  priority = 'interactive',
} = {}) => {
  const result = [];
  let checked = 0;
  let rateLimitWaitBudget = Math.max(0, Number(rateLimitWaitMs) || 0);
  for (const item of items) {
    if (!itemNeedsPncpValueEnrichment(item) || checked >= limit) {
      result.push(item);
      continue;
    }
    checked += 1;
    const ids = extractPncpCompraIdentifiers(item);
    if (!ids.cnpj || !ids.ano || !ids.sequencial) {
      result.push(item);
      continue;
    }
    const q = buildPncpEnrichmentQuery(item, query);
    let enrichment = await getPncpCompraEnrichment(ids.cnpj, ids.ano, ids.sequencial, q, { maxPages, priority });
    if (!enrichment && Date.now() < pncpDetalheRateLimitedUntil && rateLimitWaitBudget > 0) {
      const waitMs = Math.min(pncpDetalheRateLimitedUntil - Date.now(), rateLimitWaitBudget);
      rateLimitWaitBudget -= waitMs;
      await sleep(waitMs);
      enrichment = await getPncpCompraEnrichment(ids.cnpj, ids.ano, ids.sequencial, q, { maxPages, priority });
    }
    result.push(enrichment ? mergePncpEnrichmentIntoNormalizedItem(item, enrichment) : item);
  }
  return result;
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

/** Status operacional: só ativo | suspenso. Legado (ganho/perdido/…) → ativo (encerramento é a coluna). */
const normalizeLicitacaoStatus = (status) => {
  const s = String(status || '').trim().toLowerCase();
  return s === 'suspenso' ? 'suspenso' : 'ativo';
};

const normalizeOpportunityRow = (row) => {
  const links = normalizeOpportunityLinks(row?.links);
  return {
    ...row,
    status: normalizeLicitacaoStatus(row?.status),
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
- Como a busca vai usar no máximo 5 positivos, escolha os termos ABSOLUTAMENTE mais correlacionados ao termo pesquisado.
- Priorize termos únicos de alta correlação, sejam palavras ou siglas. Uma palavra maior pode ser melhor que uma sigla se for mais relevante.
- Use frases longas só quando a correlação delas for maior que a de qualquer termo único equivalente.
- Em frases multi-palavra, a ordem das palavras importa; não gere frase cuja utilidade dependa de embaralhar palavras.
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
- Como a busca vai usar no máximo 5 positivos, escolha os termos ABSOLUTAMENTE mais correlacionados ao termo pesquisado.
- Priorize termos únicos de alta correlação, sejam palavras ou siglas. Uma palavra maior pode ser melhor que uma sigla se for mais relevante.
- Use frases longas só quando a correlação delas for maior que a de qualquer termo único equivalente.
- Em frases multi-palavra, a ordem das palavras importa; não gere frase cuja utilidade dependa de embaralhar palavras.
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

const summarizePcaOpportunityTitleWithAI = async ({ futuraNome, itens = [] }) => {
  if (!Array.isArray(itens) || itens.length < 2) return null;
  const baseTitle = (futuraNome || '').toString().trim();
  const snippets = itens
    .slice(0, 8)
    .map((it, idx) => `${idx + 1}. ${(it?.descricao || '').toString().trim().slice(0, 220)}`)
    .filter(Boolean)
    .join('\n');
  if (!snippets) return null;

  const prompt = `Contexto: itens de uma mesma futura contratacao do PCA.\n\nTitulo base: ${baseTitle || 'nao informado'}\n\nItens:\n${snippets}\n\nGere um unico titulo curto (maximo 120 caracteres), objetivo e comercial para a oportunidade. Sem aspas e sem pontuacao final.`;

  const callProvider = async ({ url, key, model }, timeoutMs = 10000) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'Voce resume oportunidades de licitacao em um titulo curto e claro.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
          max_tokens: 80,
        }),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const data = await response.json();
      const text = (data?.choices?.[0]?.message?.content || '').replace(/[\r\n]+/g, ' ').trim();
      if (!text) return null;
      return text.replace(/^"+|"+$/g, '').slice(0, 120);
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  };

  if (OPENAI_API_KEY) {
    const t = await callProvider({ url: 'https://api.openai.com/v1/chat/completions', key: OPENAI_API_KEY, model: OPENAI_AI_MODEL }, 12000);
    if (t) return t;
  }
  if (GROQ_API_KEY) {
    const t = await callProvider({ url: 'https://api.groq.com/openai/v1/chat/completions', key: GROQ_API_KEY, model: GROQ_AI_MODEL }, 10000);
    if (t) return t;
  }
  return null;
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
  const profile = detectContextProfile(original);
  const aiSanitized = sanitizeAiTerms(terms, { removeGeneric: false });
  const profileNegatives = sanitizeAiTerms(profile?.negativeBoost || [], { removeGeneric: false });
  const fallbackNegatives = sanitizeAiTerms(buildFallbackNegativeTerms(original), { removeGeneric: false });
  const prioritizedPool = mergeUniqueTerms(profileNegatives, fallbackNegatives, aiSanitized);
  const negatives = [];

  for (const term of prioritizedPool) {
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
    if (negatives.length >= 10) {
      break;
    }
  }

  return negatives;
};

const buildIntelligentRelations = (original, aiResult) => {
  const profile = detectContextProfile(original);
  const aiPositivos = aiResult?.positivos || [];
  const aiNegativos = aiResult?.negativos || [];

  const positivosRaw = mergeUniqueTerms(
    getQuerySpecificAllowlist(original),
    profile?.positiveBoost || [],
    aiPositivos
  );

  const negativosRaw = mergeUniqueTerms(
    aiNegativos,
    profile?.negativeBoost || [],
    buildFallbackNegativeTerms(original)
  );

  const positivos = rankPositiveSearchTerms(original, pickHighPrecisionPositiveTerms(original, positivosRaw), 8);
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

  const hasStrongNegativeSignal = negativeTerms.some(term => {
    const normalized = normalizeSearchText(term);
    return STRONG_NEGATIVE_HINTS.some(hint => normalized.includes(hint));
  }) || STRONG_NEGATIVE_HINTS.some(hint => containsTermStrict(text, hint));

  const hasPositiveEvidence = hasExactQuery
    || hasPositiveMatch
    || POSITIVE_EVIDENCE_HINTS.some(hint => containsTermStrict(text, hint));

  if (hasStrongNegativeSignal && !hasPositiveEvidence) {
    return true;
  }

  return !hasExactQuery && !hasPositiveMatch && tokenMatches < Math.min(2, Math.max(1, queryTokens.length));
};

const pncpItemHasSemanticEvidence = (item, query, positiveTerms = []) => {
  const text = [
    item?.title,
    item?.titulo,
    item?.description,
    item?.descricao,
    item?.itens_resumo_texto,
    item?.__itens_resumo_texto,
  ].filter(Boolean).join(' ');
  const terms = mergeUniqueTerms([query], positiveTerms, getQuerySpecificAllowlist(query));
  return containsAnyTermStrictFlexible(text, terms);
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
      "SELECT c.id, c.name, c.location, c.phone_number, c.custom_attributes, c.additional_attributes, c.account_id, c.additional_attributes->>'company_name' AS company_name, c.company_id, conv.assignee_id AS agent_id, COALESCE(NULLIF(TRIM(acc.seller_label), ''), NULLIF(TRIM(u.display_name), ''), NULLIF(TRIM(u.name), ''), u.email) AS agent_name, COALESCE(jsonb_agg(DISTINCT jsonb_build_object('name', t.name, 'color', l.color)) FILTER (WHERE t.name IS NOT NULL), '[]'::jsonb) AS labels FROM contacts c LEFT JOIN LATERAL (SELECT assignee_id FROM conversations WHERE contact_id = c.id AND assignee_id IS NOT NULL ORDER BY last_activity_at DESC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC LIMIT 1) conv ON true LEFT JOIN users u ON u.id = conv.assignee_id LEFT JOIN app_user_access acc ON acc.user_id = conv.assignee_id LEFT JOIN taggings tg ON tg.taggable_type = 'Contact' AND tg.context = 'labels' AND tg.taggable_id = c.id LEFT JOIN tags t ON t.id = tg.tag_id LEFT JOIN labels l ON l.title = t.name AND l.account_id = c.account_id GROUP BY c.id, conv.assignee_id, u.display_name, u.name, u.email, acc.seller_label"
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
          created_at,
          custom_attributes->>'Funil_Vendas' AS stage,
          ${valueNumExpr()} AS value_num
        FROM contacts
      ), parsed AS (
        SELECT
          id,
          created_at,
          stage,
          value_num,
          NULLIF(TRIM(SPLIT_PART(stage, '.', 1)), '')::int AS stage_num
        FROM base
      ), month_events AS (
        SELECT
          h.contact_id,
          NULLIF(TRIM(SPLIT_PART(h.to_stage, '.', 1)), '')::int AS stage_num
        FROM ${HISTORY_TABLE} h
        WHERE h.source <> 'snapshot'
          AND h.changed_at >= (
            DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Sao_Paulo')
            AT TIME ZONE 'America/Sao_Paulo' AT TIME ZONE 'UTC'
          )
      )
      SELECT
        COUNT(*) FILTER (WHERE stage_num BETWEEN 1 AND 17) AS leads_count,
        COUNT(*) FILTER (WHERE stage_num BETWEEN 7 AND 13) AS opportunities_count,
        COUNT(*) FILTER (WHERE stage_num BETWEEN 18 AND 26) AS customers_count,
        COUNT(*) FILTER (
          WHERE created_at >= (
            DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Sao_Paulo')
            AT TIME ZONE 'America/Sao_Paulo' AT TIME ZONE 'UTC'
          )
        ) AS leads_month_count,
        (
          SELECT COUNT(DISTINCT contact_id)
          FROM month_events
          WHERE stage_num BETWEEN 7 AND 13
        ) AS opportunities_month_count,
        (
          SELECT COALESCE(SUM(p.value_num), 0)
          FROM (
            SELECT DISTINCT contact_id
            FROM month_events
            WHERE stage_num BETWEEN 7 AND 13
          ) m
          JOIN parsed p ON p.id = m.contact_id
        ) AS opportunities_month_value,
        (
          SELECT COUNT(DISTINCT contact_id)
          FROM month_events
          WHERE stage_num BETWEEN 18 AND 25
        ) AS active_customers_month_count,
        COALESCE(SUM(value_num) FILTER (WHERE stage_num BETWEEN 7 AND 13), 0) AS opportunities_value,
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

app.get('/api/labels', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const { rows } = await pool.query(
      `SELECT title, color FROM labels WHERE account_id = $1 ORDER BY title`,
      [accountId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching labels:', err.message);
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
        COUNT(*)::int AS count,
        COALESCE(SUM(${valueNumExpr()}), 0)::float AS total_value
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
    // Só vendedores (is_seller). Contas com a mesma seller_identity (ex.: Clayton) viram 1 linha.
    const { rows } = await pool.query(`
      WITH agent_contacts AS (
        SELECT
          c.id,
          ${valueNumExpr('c.')} AS value_num,
          NULLIF(TRIM(SPLIT_PART(c.custom_attributes->>'Funil_Vendas', '.', 1)), '')::int AS stage_num,
          conv.assignee_id,
          COALESCE(NULLIF(TRIM(u.display_name), ''), NULLIF(TRIM(u.name), ''), u.email) AS raw_name,
          COALESCE(acc.is_seller, false) AS is_seller,
          NULLIF(TRIM(acc.seller_identity), '') AS seller_identity,
          NULLIF(TRIM(acc.seller_label), '') AS seller_label
        FROM contacts c
        LEFT JOIN LATERAL (
          SELECT assignee_id
          FROM conversations
          WHERE contact_id = c.id AND assignee_id IS NOT NULL
          ORDER BY last_activity_at DESC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC
          LIMIT 1
        ) conv ON true
        LEFT JOIN users u ON u.id = conv.assignee_id
        LEFT JOIN ${APP_ACCESS_TABLE} acc ON acc.user_id = conv.assignee_id
        WHERE conv.assignee_id IS NOT NULL
          AND COALESCE(acc.is_seller, false) = true
      ),
      labeled AS (
        SELECT
          id,
          value_num,
          stage_num,
          assignee_id,
          COALESCE(seller_identity, 'id:' || assignee_id::text) AS group_key,
          COALESCE(seller_label, raw_name, 'Agente') AS agent_display
        FROM agent_contacts
      )
      SELECT
        agent_display AS agent,
        MIN(assignee_id)::int AS agent_id,
        COUNT(*)::int AS count,
        COALESCE(SUM(value_num) FILTER (WHERE stage_num IS DISTINCT FROM 14), 0) AS total_value
      FROM labeled
      GROUP BY group_key, agent_display
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
                 COALESCE(${valueNumExpr('c.')}, 0)::float AS value_num,
                 p.period_start,
                 p.period_start + ('1 ' || $1)::interval AS period_end
          FROM contacts c
          CROSS JOIN periods p
        ),
        latest_stage AS (
          SELECT pc.period_start,
                 pc.value_num,
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
          COUNT(*)::int AS count,
          COALESCE(SUM(value_num), 0)::float AS total_value
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

app.get('/api/overview/recent-actions', async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 30, 1), 100);
  try {
    const { rows } = await pool.query(
      `
        WITH actions AS (
          SELECT h.id::text AS id, 'platform' AS source, 'move_card' AS action,
                 COALESCE(h.actor_name, 'Chatwoot') AS actor_name,
                 COALESCE(c.name, c.email, 'Contato #' || h.contact_id) AS entity_name,
                 h.contact_id::text AS entity_id,
                 h.from_stage, h.to_stage, NULL::text AS preview, h.changed_at AS occurred_at
            FROM ${HISTORY_TABLE} h
            LEFT JOIN contacts c ON c.id = h.contact_id
           WHERE h.source <> 'snapshot' AND h.account_id = $1
          UNION ALL
          SELECT a.id::text, 'platform', a.action, a.actor_name, a.entity_name, a.entity_id,
                 NULL, NULL, NULL, a.created_at
            FROM ${ACTIVITY_TABLE} a
           WHERE a.account_id = $1
          UNION ALL
          SELECT 'conversation-' || cv.id, 'chatwoot', 'start_conversation',
                 COALESCE(starter.actor_name, NULLIF(NULLIF(COALESCE(u.display_name, u.name, u.email), 'System'), 'Sistema'), 'Chatwoot'),
                 COALESCE(c.name, c.email, 'Contato #' || cv.contact_id), cv.contact_id::text,
                 NULL, NULL, NULL, cv.created_at
            FROM conversations cv
            LEFT JOIN users u ON u.id = cv.assignee_id
            LEFT JOIN contacts c ON c.id = cv.contact_id
            LEFT JOIN LATERAL (
              SELECT COALESCE(starter_user.display_name, starter_user.name, starter_user.email) AS actor_name
                FROM messages first_message
                JOIN users starter_user ON starter_user.id = first_message.sender_id
               WHERE first_message.conversation_id = cv.id
                 AND first_message.sender_type = 'User'
                 AND LOWER(COALESCE(starter_user.display_name, starter_user.name, starter_user.email, '')) NOT IN ('system', 'sistema')
               ORDER BY first_message.created_at ASC
               LIMIT 1
            ) starter ON true
           WHERE cv.account_id = $1
          UNION ALL
          SELECT 'contact-' || c.id, 'chatwoot', 'new_contact', COALESCE(contact_starter.actor_name, 'Chatwoot'),
                 COALESCE(c.name, c.email, 'Contato #' || c.id), c.id::text,
                 NULL, NULL, NULL, c.created_at
            FROM contacts c
            LEFT JOIN LATERAL (
              SELECT COALESCE(starter_user.display_name, starter_user.name, starter_user.email) AS actor_name
                FROM conversations first_conversation
                JOIN messages first_message ON first_message.conversation_id = first_conversation.id
                JOIN users starter_user ON starter_user.id = first_message.sender_id
               WHERE first_conversation.contact_id = c.id
                 AND first_message.sender_type = 'User'
                 AND LOWER(COALESCE(starter_user.display_name, starter_user.name, starter_user.email, '')) NOT IN ('system', 'sistema')
               ORDER BY first_message.created_at ASC
               LIMIT 1
            ) contact_starter ON true
           WHERE c.account_id = $1
        )
        SELECT * FROM actions
        ORDER BY occurred_at DESC NULLS LAST
        LIMIT $2
      `,
      [CHATWOOT_ACCOUNT_ID, limit]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching recent actions:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Ritmo do funil (dia + mês + período selecionado):
 * - Contatos = mensagens públicas enviadas (WhatsApp etc.)
 *   + notas privadas na conversa (messages.private)
 *   + notas do perfil do contato (tabela notes — aba Notas no Chatwoot)
 *   (regra operacional: ligação/e-mail/visita podem ser registrados em qualquer uma das notas).
 * - SQL / Oportunidade / Proposta / Fechamento = movimentações do card no funil
 *   (kanban_stage_history → to_stage).
 * Query opcional: agent_id — filtra feito por remetente (mensagens),
 *   autor da nota de contato (notes.user_id) e actor (moves).
 * Query opcional: period = day|week|month|quarter|year (default day).
 *   Sempre devolve day + month (modal/compat). range espelha o período pedido.
 */
app.get('/api/overview/funnel-pace', async (req, res) => {
  try {
    const accountId = CHATWOOT_ACCOUNT_ID;
    const agentIdRaw = req.query.agent_id;
    const agentId = agentIdRaw != null && String(agentIdRaw).trim() !== ''
      ? Number.parseInt(agentIdRaw, 10)
      : null;
    const PACE_PERIODS = new Set(['day', 'week', 'month', 'quarter', 'year']);
    const periodRaw = String(req.query.period || 'day').trim().toLowerCase();
    const period = PACE_PERIODS.has(periodRaw) ? periodRaw : 'day';
    const sellerGroups = await getSellerGroups(accountId);
    const allSellerIds = sellerGroups.flatMap((g) => g.user_ids);
    // Individual: expande identidade (Clayton pessoal + Aerion).
    // Time: só vendedores — não-vendedores (ex.: Rebeca) não entram no feito nem na divisão de meta.
    let actorIds = null;
    let selectedAgentId = null;
    if (Number.isFinite(agentId) && agentId > 0) {
      actorIds = await resolveSellerActorIds(agentId, accountId);
      selectedAgentId = Array.isArray(actorIds) && actorIds.length
        ? Math.min(...actorIds)
        : agentId;
    } else if (allSellerIds.length > 0) {
      actorIds = allSellerIds;
    }
    const hasActorFilter = Array.isArray(actorIds) && actorIds.length > 0;

    // $1 account, $2 optional int[] de user_ids (vendedor ou time de vendedores)
    const msgAgentFilter = hasActorFilter
      ? `AND m.sender_type = 'User' AND m.sender_id = ANY($2::int[])`
      : '';
    const contactNoteAgentFilter = hasActorFilter
      ? `AND n.user_id = ANY($2::int[])`
      : '';
    // Moves: individual = só o(s) id(s) da identidade; time = vendedores (+ moves sem actor legados)
    const histAgentFilter = hasActorFilter
      ? (selectedAgentId != null
        ? `AND h.actor_id = ANY($2::int[])`
        : `AND (h.actor_id IS NULL OR h.actor_id = ANY($2::int[]))`)
      : '';
    const params = hasActorFilter ? [accountId, actorIds] : [accountId];

    // Cortes de período no fuso do negócio (America/Sao_Paulo, UTC-3), não em UTC.
    // As colunas created_at/changed_at são `timestamp without time zone` gravadas em UTC;
    // usar DATE_TRUNC('day', NOW()) puro corta à meia-noite UTC = 21h de Brasília, zerando
    // o "feito de hoje" no fim do expediente. Convertemos a meia-noite local de volta p/ UTC.
    // week = ISO (segunda). quarter/year = calendário civil em SP.
    const SP_TZ = 'America/Sao_Paulo';
    const spTruncStart = (unit) => (
      `(DATE_TRUNC('${unit}', NOW() AT TIME ZONE '${SP_TZ}') AT TIME ZONE '${SP_TZ}' AT TIME ZONE 'UTC')`
    );
    const spDayStart = spTruncStart('day');
    const spMonthStart = spTruncStart('month');
    const periodUnit = period; // day|week|month|quarter|year — válidos no DATE_TRUNC do PG
    const spRangeStart = spTruncStart(periodUnit);

    // Marcos cumulativos (escadinha): 1 contato conta 1x por marco no período.
    // Ex.: mover para 7. Agendamento Demo conta SQL + Oportunidade (sem exigir passagem pelo 6).
    // Faixa 6–13 = pipeline qualificado + ganho; 14–17 (perdido/pausa/descarte/nurture) não promovem marcos.
    const buildMilestonePaceSql = (sinceSql) => `
      WITH events AS (
        SELECT
          h.contact_id,
          NULLIF(TRIM(SPLIT_PART(h.to_stage, '.', 1)), '')::int AS stage_num,
          ${valueNumExpr('c.')} AS value_num
        FROM ${HISTORY_TABLE} h
        LEFT JOIN contacts c ON c.id = h.contact_id
        WHERE h.account_id = $1
          AND h.source <> 'snapshot'
          AND h.changed_at >= ${sinceSql}
          AND h.to_stage IS NOT NULL
          ${histAgentFilter}
      ),
      per_contact AS (
        SELECT
          contact_id,
          BOOL_OR(stage_num BETWEEN 6 AND 13) AS hit_sql,
          BOOL_OR(stage_num BETWEEN 7 AND 13) AS hit_oportunidade,
          BOOL_OR(stage_num BETWEEN 9 AND 13) AS hit_proposta,
          BOOL_OR(stage_num = 13) AS hit_fechamento,
          MAX(value_num) AS value_num
        FROM events
        WHERE stage_num IS NOT NULL
        GROUP BY contact_id
      )
      SELECT
        COUNT(*) FILTER (WHERE hit_sql)::int AS sql,
        COUNT(*) FILTER (WHERE hit_oportunidade)::int AS oportunidade,
        COUNT(*) FILTER (WHERE hit_proposta)::int AS proposta,
        COUNT(*) FILTER (WHERE hit_fechamento)::int AS fechamento,
        COALESCE(SUM(value_num) FILTER (WHERE hit_oportunidade), 0)::float AS oportunidade_value,
        COALESCE(SUM(value_num) FILTER (WHERE hit_proposta), 0)::float AS proposta_value,
        COALESCE(SUM(value_num) FILTER (WHERE hit_fechamento), 0)::float AS fechamento_value
      FROM per_contact
    `;

    // "Contatos" mede pessoas distintas alcançadas, não volume de mensagens.
    // Unifica todas as atividades válidas por contact_id para que follow-ups
    // (ou uma mensagem + uma nota) não inflem o ritmo do vendedor.
    const buildContactPaceSql = (sinceSql) => `
      WITH activity AS (
        SELECT
          conv.contact_id,
          BOOL_OR(m.message_type = 1 AND COALESCE(m."private", false) = false) AS via_message,
          BOOL_OR(COALESCE(m."private", false) = true) AS via_private_note,
          false AS via_contact_note
        FROM messages m
        INNER JOIN conversations conv ON conv.id = m.conversation_id
        WHERE m.account_id = $1
          AND m.created_at >= ${sinceSql}
          AND (
            (m.message_type = 1 AND COALESCE(m."private", false) = false)
            OR COALESCE(m."private", false) = true
          )
          ${msgAgentFilter}
        GROUP BY conv.contact_id

        UNION ALL

        SELECT
          n.contact_id,
          false AS via_message,
          false AS via_private_note,
          true AS via_contact_note
        FROM notes n
        WHERE n.account_id = $1
          AND n.created_at >= ${sinceSql}
          ${contactNoteAgentFilter}
      ),
      per_contact AS (
        SELECT
          contact_id,
          BOOL_OR(via_message) AS via_message,
          BOOL_OR(via_private_note) AS via_private_note,
          BOOL_OR(via_contact_note) AS via_contact_note
        FROM activity
        WHERE contact_id IS NOT NULL
        GROUP BY contact_id
      )
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE via_message)::int AS messages,
        COUNT(*) FILTER (WHERE via_private_note)::int AS private_notes,
        COUNT(*) FILTER (WHERE via_contact_note)::int AS contact_notes,
        COUNT(*) FILTER (WHERE via_private_note OR via_contact_note)::int AS notes
      FROM per_contact
    `;

    const buildLeadsSql = (sinceSql) => `
      SELECT COUNT(DISTINCT h.contact_id)::int AS total
      FROM ${HISTORY_TABLE} h
      WHERE h.account_id = $1
        AND h.source <> 'snapshot'
        AND h.changed_at >= ${sinceSql}
        AND NULLIF(TRIM(SPLIT_PART(h.to_stage, '.', 1)), '')::int = 1
        ${histAgentFilter}
    `;

    const needExtraRange = period !== 'day' && period !== 'month';

    const queryBundle = await Promise.all([
      pool.query(buildContactPaceSql(spDayStart), params),
      pool.query(buildContactPaceSql(spMonthStart), params),
      pool.query(buildMilestonePaceSql(spDayStart), params),
      pool.query(buildMilestonePaceSql(spMonthStart), params),
      pool.query(buildLeadsSql(spDayStart), params),
      pool.query(buildLeadsSql(spMonthStart), params),
      needExtraRange
        ? pool.query(buildContactPaceSql(spRangeStart), params)
        : Promise.resolve(null),
      needExtraRange
        ? pool.query(buildMilestonePaceSql(spRangeStart), params)
        : Promise.resolve(null),
      needExtraRange
        ? pool.query(buildLeadsSql(spRangeStart), params)
        : Promise.resolve(null),
    ]);

    const [
      contactsDay,
      contactsMonth,
      stagesDay,
      stagesMonth,
      leadsDay,
      leadsMonth,
      contactsRange,
      stagesRange,
      leadsRange,
    ] = queryBundle;

    const buildContatos = (row) => {
      const messages = Number(row?.messages) || 0;
      const privateNotes = Number(row?.private_notes) || 0;
      const contactNotes = Number(row?.contact_notes) || 0;
      const notes = Number(row?.notes) || 0;
      return {
        total: Number(row?.total) || 0,
        messages,
        notes,
        private_notes: privateNotes,
        contact_notes: contactNotes,
      };
    };

    const buildPaceBucket = (contactsRow, stagesRow, leadsRow) => {
      const c = contactsRow || {};
      const s = stagesRow || {};
      return {
        contatos: buildContatos(c),
        leads: Number(leadsRow?.total) || 0,
        sql: Number(s.sql) || 0,
        oportunidade: Number(s.oportunidade) || 0,
        proposta: Number(s.proposta) || 0,
        fechamento: Number(s.fechamento) || 0,
        // R$: soma de Valor_Oportunidade dos cards movidos à etapa no período
        value: {
          oportunidade: Number(s.oportunidade_value) || 0,
          proposta: Number(s.proposta_value) || 0,
          fechamento: Number(s.fechamento_value) || 0,
        },
      };
    };

    const day = buildPaceBucket(
      contactsDay.rows[0],
      stagesDay.rows[0],
      leadsDay.rows[0]
    );
    const month = buildPaceBucket(
      contactsMonth.rows[0],
      stagesMonth.rows[0],
      leadsMonth.rows[0]
    );
    let range;
    if (period === 'day') {
      range = day;
    } else if (period === 'month') {
      range = month;
    } else {
      range = buildPaceBucket(
        contactsRange?.rows?.[0],
        stagesRange?.rows?.[0],
        leadsRange?.rows?.[0]
      );
    }

    res.json({
      as_of: new Date().toISOString(),
      period,
      agent_id: selectedAgentId,
      // Apenas vendedores; identidades unificadas (Clayton ×2 → 1 item)
      agents: sellerGroups.map((r) => ({
        id: Number(r.id),
        name: r.name || `Agente #${r.id}`,
        user_ids: Array.isArray(r.user_ids) ? r.user_ids : [Number(r.id)],
      })),
      day,
      month,
      range,
      rules: {
        contatos: 'Contatos distintos no período com mensagem enviada ou nota registrada. Mensagens e notas adicionais para a mesma pessoa contam apenas 1×. Ligação, e-mail e visita: registrar em Notas.',
        leads: 'Contato distinto movido para Inbox / etapa 1 do funil (1× por contato no período).',
        sql: 'Marco cumulativo: 1× por contato no período ao atingir etapa ≥ 6 (SQL, demo, proposta ou ganho). Pular o 6 e ir para Agendamento Demo ainda conta como SQL. Perdido/pausa/descarte/nurture (14–17) não contam sozinhos.',
        oportunidade: 'Marco cumulativo: 1× por contato ao atingir etapa ≥ 7 (demo em diante até ganho). Em R$: Valor_Oportunidade uma vez por contato.',
        proposta: 'Marco cumulativo: 1× por contato ao atingir etapa ≥ 9 (elaborando proposta até ganho). Em R$: Valor_Oportunidade uma vez por contato.',
        fechamento: 'Card movido para 13. Fechado-Ganho (1× por contato no período). Em R$: Valor_Oportunidade das vendas ganhas.',
      },
    });
  } catch (err) {
    console.error('Error fetching funnel pace:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const getAccountId = (req) => {
  const raw = req.query.account_id ?? req.body?.account_id;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
};

// Status operacional: só Ativo | Suspenso. Encerramento (ganho/perdido/etc.) é pela coluna do pipe.
const LICITACAO_STATUS = ['ativo', 'suspenso'];
const LICITACAO_ORIGEM = ['direta', 'intermediario', 'automatica_api', 'pca_pncp'];
const LICITACAO_MODELO_INTERMEDIACAO = ['revenda', 'comissao', 'misto'];
const LICITACAO_STATUS_COMISSAO = ['pendente', 'aprovado', 'pago', 'cancelado'];
const LICITACAO_ITEM_TIPO = ['material', 'servico'];
const LICITACAO_REQUIREMENT_TIPO = ['comercial', 'tecnico'];
const LICITACAO_REQUIREMENT_STATUS = ['ok', 'nao_ok', 'pendente', 'verificar'];

app.get('/api/licitacoes/opportunities/expired-proposal-candidates', async (req, res) => {
  const accountId = getAccountId(req);
  try {
    await runExpiredSuspensoToMonitoramento({ accountId }).catch((err) => {
      console.warn('[licitacoes] auto-move suspenso→monitoramento falhou:', err.message);
    });
    const rows = await findExpiredLicitacaoProposalCandidates({ accountId });
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        titulo: r.titulo,
        orgao: r.orgao,
        fase: r.fase,
        status: r.status,
        modalidade: r.modalidade,
        valor_oportunidade: r.valor_oportunidade != null ? Number(r.valor_oportunidade) : null,
        data_envio_proposta_limite: r.data_envio_proposta_limite,
        numero_edital: r.numero_edital,
      })),
      count: rows.length,
    });
  } catch (error) {
    console.error('[licitacoes] expired-proposal-candidates:', error);
    res.status(500).json({ error: 'Erro ao listar candidatos de prazo vencido', details: error.message });
  }
});

app.post('/api/licitacoes/opportunities/confirm-expired-move', async (req, res) => {
  const accountId = getAccountId(req);
  try {
    const result = await applyExpiredLicitacaoProposalMoveToPerdido({
      accountId,
      ids: req.body?.ids,
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('[licitacoes] confirm-expired-move:', error);
    res.status(500).json({ error: 'Erro ao enviar para Perdido', details: error.message });
  }
});

app.post('/api/licitacoes/opportunities/dismiss-expired-move', async (req, res) => {
  const accountId = getAccountId(req);
  try {
    const result = await dismissExpiredLicitacaoProposalCandidates({
      accountId,
      ids: req.body?.ids,
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('[licitacoes] dismiss-expired-move:', error);
    res.status(500).json({ error: 'Erro ao manter no funil', details: error.message });
  }
});

/** Pregões eletrônicos com sessão hoje (SP) e horário ainda não passado. */
app.get('/api/licitacoes/opportunities/sessoes-hoje', async (req, res) => {
  const accountId = getAccountId(req);
  try {
    const openSql = getLicitacaoOpenPipelineSql('o.');
    const { rows } = await pool.query(
      `
        SELECT
          o.id,
          o.titulo,
          o.orgao,
          o.fase,
          o.status,
          o.modalidade,
          o.valor_oportunidade,
          o.data_sessao,
          o.numero_edital,
          o.links_pncp,
          o.links
        FROM ${LICITACAO_TABLE} o
        WHERE o.account_id = $1
          AND ${openSql}
          AND o.data_sessao IS NOT NULL
          AND o.data_sessao > NOW()
          AND (o.data_sessao AT TIME ZONE 'America/Sao_Paulo')::date
              = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
          AND (
            lower(unaccent(COALESCE(o.modalidade, ''))) LIKE '%pregao%eletr%'
            OR lower(unaccent(COALESCE(o.modalidade, ''))) LIKE '%pregao% eletron%'
            OR lower(regexp_replace(unaccent(COALESCE(o.modalidade, '')), '[^a-z0-9]+', ' ', 'g'))
               ~ 'pregao.*eletr'
          )
        ORDER BY o.data_sessao ASC NULLS LAST, o.id ASC
      `,
      [accountId]
    );
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        titulo: r.titulo,
        orgao: r.orgao,
        fase: r.fase,
        status: r.status,
        modalidade: r.modalidade,
        valor_oportunidade: r.valor_oportunidade != null ? Number(r.valor_oportunidade) : null,
        data_sessao: r.data_sessao,
        numero_edital: r.numero_edital,
        links_pncp: r.links_pncp,
        links: r.links,
      })),
      count: rows.length,
    });
  } catch (error) {
    // Fallback sem unaccent se a extensão não existir.
    if (String(error.message || '').includes('unaccent')) {
      try {
        const openSql = getLicitacaoOpenPipelineSql('o.');
        const { rows } = await pool.query(
          `
            SELECT
              o.id, o.titulo, o.orgao, o.fase, o.status, o.modalidade,
              o.valor_oportunidade, o.data_sessao, o.numero_edital, o.links_pncp, o.links
            FROM ${LICITACAO_TABLE} o
            WHERE o.account_id = $1
              AND ${openSql}
              AND o.data_sessao IS NOT NULL
              AND o.data_sessao > NOW()
              AND (o.data_sessao AT TIME ZONE 'America/Sao_Paulo')::date
                  = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
              AND lower(COALESCE(o.modalidade, '')) ~* 'preg[aã]o.*eletr'
            ORDER BY o.data_sessao ASC NULLS LAST, o.id ASC
          `,
          [accountId]
        );
        return res.json({
          items: rows.map((r) => ({
            id: r.id,
            titulo: r.titulo,
            orgao: r.orgao,
            fase: r.fase,
            status: r.status,
            modalidade: r.modalidade,
            valor_oportunidade: r.valor_oportunidade != null ? Number(r.valor_oportunidade) : null,
            data_sessao: r.data_sessao,
            numero_edital: r.numero_edital,
            links_pncp: r.links_pncp,
            links: r.links,
          })),
          count: rows.length,
        });
      } catch (fallbackErr) {
        console.error('[licitacoes] sessoes-hoje fallback:', fallbackErr);
        return res.status(500).json({ error: 'Erro ao listar sessões de hoje', details: fallbackErr.message });
      }
    }
    console.error('[licitacoes] sessoes-hoje:', error);
    res.status(500).json({ error: 'Erro ao listar sessões de hoje', details: error.message });
  }
});

app.get('/api/licitacoes/opportunities', async (req, res) => {
  const accountId = getAccountId(req);
  try {
    // On-read: só suspenso → Monitoramento (ativo → Perdido exige confirmação na UI).
    await runExpiredSuspensoToMonitoramento({ accountId }).catch((err) => {
      console.warn('[licitacoes] auto-move suspenso→monitoramento (list) falhou:', err.message);
    });

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
    await recordActivity(req, {
      accountId,
      action: 'create_opportunity',
      entityType: 'opportunity',
      entityId: created.id,
      entityName: created.titulo,
      details: { fase: created.fase },
    });
    notifyAccountUsers(pool, {
      accountId,
      type: 'pipeline.opportunity_created',
      title: `Nova oportunidade · ${String(created.titulo).slice(0, 80)}`,
      body: created.fase ? `Fase: ${created.fase}` : null,
      data: {
        view: 'Licitações',
        sub: 'board',
        opportunity_id: created.id,
      },
      dedupeKey: `opp:${created.id}`,
    }).catch((err) => console.warn('[licitacoes] notify create opp failed:', err.message));
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
    // Só aceita ativo|suspenso em escrita; legado (ganho/perdido/…) permanece se o campo não for alterado.
    let status = current.status;
    if (body.status !== undefined) {
      status = String(body.status);
      if (!LICITACAO_STATUS.includes(status)) {
        return res.status(400).json({ error: 'Status invalido (use ativo ou suspenso)' });
      }
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

    const updated = rows[0];
    await recordActivity(req, {
      accountId,
      action: current.fase !== updated.fase ? 'move_opportunity' : 'update_opportunity',
      entityType: 'opportunity',
      entityId: updated.id,
      entityName: updated.titulo,
      details: { from_stage: current.fase, to_stage: updated.fase },
    });
    res.json(normalizeOpportunityRow(updated));
  } catch (error) {
    console.error('Error updating licitacao opportunity:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/licitacoes/opportunities/:id', async (req, res) => {
  const accountId = getAccountId(req);
  const { id } = req.params;
  try {
    const existing = await pool.query(`SELECT titulo FROM ${LICITACAO_TABLE} WHERE id = $1 AND account_id = $2`, [id, accountId]);
    await pool.query(`DELETE FROM ${LICITACAO_TABLE} WHERE id = $1 AND account_id = $2`, [id, accountId]);
    if (existing.rows[0]) {
      await recordActivity(req, {
        accountId,
        action: 'delete_opportunity',
        entityType: 'opportunity',
        entityId: id,
        entityName: existing.rows[0].titulo,
      });
    }
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
        (item_id, requisito, status, observacao, valor_referencia, valor_ofertado, ordem, secao)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
        toNullableText(body.secao),
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
          secao = $7,
          updated_at = NOW()
        WHERE id = $8 AND item_id = $9
        RETURNING *
      `,
      [
        body.requisito ?? current.requisito,
        body.status ?? current.status,
        body.observacao ?? current.observacao,
        body.valor_referencia ?? current.valor_referencia,
        body.valor_ofertado ?? current.valor_ofertado,
        body.ordem ?? current.ordem,
        body.secao !== undefined ? toNullableText(body.secao) : current.secao,
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

// Bulk apply checklist requirements (replace / append / patch) + optional modelo_produto
app.post('/api/licitacoes/opportunities/:id/items/:itemId/requirements/bulk', async (req, res) => {
  const { id, itemId } = req.params;
  const body = req.body || {};
  const mode = String(body.mode || 'replace').toLowerCase();
  if (!['replace', 'append', 'patch'].includes(mode)) {
    return res.status(400).json({ error: 'mode invalido (replace|append|patch)' });
  }
  const list = Array.isArray(body.requirements) ? body.requirements : null;
  if (!list) {
    return res.status(400).json({ error: 'requirements deve ser um array' });
  }
  if (list.length > 250) {
    return res.status(400).json({ error: 'Maximo de 250 requisitos por operacao' });
  }

  const client = await pool.connect();
  try {
    const itemCheck = await client.query(
      `SELECT id, modelo_produto FROM ${LICITACAO_ITEMS_TABLE} WHERE id = $1 AND opportunity_id = $2`,
      [itemId, id]
    );
    if (!itemCheck.rows.length) {
      return res.status(404).json({ error: 'Item nao encontrado' });
    }

    await client.query('BEGIN');

    let requirements = [];
    if (mode === 'replace') {
      await client.query(`DELETE FROM ${LICITACAO_ITEM_REQUIREMENTS_TABLE} WHERE item_id = $1`, [itemId]);
      for (let i = 0; i < list.length; i += 1) {
        const raw = list[i] || {};
        const requisito = toNullableText(raw.requisito);
        if (!requisito) continue;
        const status = LICITACAO_REQUIREMENT_STATUS.includes(raw.status) ? raw.status : 'verificar';
        const { rows } = await client.query(
          `
            INSERT INTO ${LICITACAO_ITEM_REQUIREMENTS_TABLE}
            (item_id, requisito, status, observacao, valor_referencia, valor_ofertado, ordem, secao)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
          `,
          [
            itemId,
            requisito,
            status,
            toNullableText(raw.observacao),
            toNullableNumber(raw.valor_referencia),
            toNullableNumber(raw.valor_ofertado),
            toNullableNumber(raw.ordem) ?? i,
            toNullableText(raw.secao),
          ]
        );
        requirements.push(rows[0]);
      }
    } else if (mode === 'append') {
      const maxOrd = await client.query(
        `SELECT COALESCE(MAX(ordem), -1)::int AS max_ordem FROM ${LICITACAO_ITEM_REQUIREMENTS_TABLE} WHERE item_id = $1`,
        [itemId]
      );
      let nextOrdem = (maxOrd.rows[0]?.max_ordem ?? -1) + 1;
      const existing = await client.query(
        `SELECT * FROM ${LICITACAO_ITEM_REQUIREMENTS_TABLE} WHERE item_id = $1 ORDER BY ordem ASC, id ASC`,
        [itemId]
      );
      requirements = [...existing.rows];
      for (const raw of list) {
        const requisito = toNullableText(raw?.requisito);
        if (!requisito) continue;
        const status = LICITACAO_REQUIREMENT_STATUS.includes(raw.status) ? raw.status : 'verificar';
        const { rows } = await client.query(
          `
            INSERT INTO ${LICITACAO_ITEM_REQUIREMENTS_TABLE}
            (item_id, requisito, status, observacao, valor_referencia, valor_ofertado, ordem, secao)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
          `,
          [
            itemId,
            requisito,
            status,
            toNullableText(raw.observacao),
            toNullableNumber(raw.valor_referencia),
            toNullableNumber(raw.valor_ofertado),
            toNullableNumber(raw.ordem) ?? nextOrdem,
            toNullableText(raw.secao),
          ]
        );
        nextOrdem += 1;
        requirements.push(rows[0]);
      }
    } else {
      // patch by id
      for (const raw of list) {
        const reqId = toNullableNumber(raw?.id);
        if (!reqId) continue;
        const existing = await client.query(
          `SELECT * FROM ${LICITACAO_ITEM_REQUIREMENTS_TABLE} WHERE id = $1 AND item_id = $2`,
          [reqId, itemId]
        );
        if (!existing.rows.length) continue;
        const current = existing.rows[0];
        const status = raw.status !== undefined
          ? (LICITACAO_REQUIREMENT_STATUS.includes(raw.status) ? raw.status : current.status)
          : current.status;
        await client.query(
          `
            UPDATE ${LICITACAO_ITEM_REQUIREMENTS_TABLE}
            SET
              requisito = $1,
              status = $2,
              observacao = $3,
              valor_referencia = $4,
              valor_ofertado = $5,
              ordem = $6,
              secao = $7,
              updated_at = NOW()
            WHERE id = $8 AND item_id = $9
          `,
          [
            raw.requisito !== undefined ? (toNullableText(raw.requisito) || current.requisito) : current.requisito,
            status,
            raw.observacao !== undefined ? toNullableText(raw.observacao) : current.observacao,
            raw.valor_referencia !== undefined ? toNullableNumber(raw.valor_referencia) : current.valor_referencia,
            raw.valor_ofertado !== undefined ? toNullableNumber(raw.valor_ofertado) : current.valor_ofertado,
            raw.ordem !== undefined ? (toNullableNumber(raw.ordem) ?? current.ordem) : current.ordem,
            raw.secao !== undefined ? toNullableText(raw.secao) : current.secao,
            reqId,
            itemId,
          ]
        );
      }
      const { rows } = await client.query(
        `SELECT * FROM ${LICITACAO_ITEM_REQUIREMENTS_TABLE} WHERE item_id = $1 ORDER BY ordem ASC, id ASC`,
        [itemId]
      );
      requirements = rows;
    }

    let item = itemCheck.rows[0];
    if (body.modelo_produto !== undefined) {
      const modelo = toNullableText(body.modelo_produto);
      const updated = await client.query(
        `UPDATE ${LICITACAO_ITEMS_TABLE} SET modelo_produto = $1, updated_at = NOW() WHERE id = $2 AND opportunity_id = $3 RETURNING *`,
        [modelo, itemId, id]
      );
      item = updated.rows[0] || item;
    }

    await client.query('COMMIT');
    res.json({ requirements, item, mode });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    console.error('Error bulk item requirements:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Assistente IA: extrai/avalia requisitos do item (retorna prévia — não grava)
app.post('/api/licitacoes/opportunities/:id/items/:itemId/requirements/ai/chat', async (req, res) => {
  const { id, itemId } = req.params;
  const body = req.body || {};
  try {
    const itemResult = await pool.query(
      `SELECT id, opportunity_id, numero_item, descricao, modelo_produto, quantidade, valor_referencia
       FROM ${LICITACAO_ITEMS_TABLE} WHERE id = $1 AND opportunity_id = $2`,
      [itemId, id]
    );
    if (!itemResult.rows.length) {
      return res.status(404).json({ error: 'Item nao encontrado' });
    }
    const item = itemResult.rows[0];
    const { rows: currentReqs } = await pool.query(
      `SELECT id, requisito, status, observacao, valor_ofertado, ordem, secao
       FROM ${LICITACAO_ITEM_REQUIREMENTS_TABLE} WHERE item_id = $1 ORDER BY ordem ASC, id ASC`,
      [itemId]
    );

    const incomingMessages = Array.isArray(body.messages) ? body.messages : [];
    const cleanedMessages = [];
    for (const m of incomingMessages.slice(-16)) {
      if (!m || !m.content) continue;
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      let content = String(m.content);
      if (content.length > 100000) content = content.slice(0, 100000);
      cleanedMessages.push({ role, content });
    }
    if (!cleanedMessages.length) {
      return res.status(400).json({ error: 'Envie ao menos uma mensagem' });
    }

    // URLs de qualquer mensagem recente do user (nao so a ultima)
    const urls = [];
    const urlSeen = new Set();
    for (const m of cleanedMessages) {
      if (m.role !== 'user') continue;
      for (const u of extractUrlsFromText(m.content, 3)) {
        if (urlSeen.has(u)) continue;
        urlSeen.add(u);
        urls.push(u);
        if (urls.length >= 3) break;
      }
      if (urls.length >= 3) break;
    }
    const sources = [];
    const urlBlocks = [];
    for (const url of urls) {
      const fetched = await fetchPublicUrlText(url, { maxChars: 45000, timeoutMs: 25000 });
      sources.push({
        url: fetched.url || url,
        ok: !!fetched.ok,
        chars: fetched.chars || 0,
        error: fetched.error || null,
        notes: fetched.notes || [],
        accordion_collapsed: !!fetched.accordion_collapsed,
      });
      if (fetched.ok && fetched.text) {
        const noteLine = (fetched.notes || []).length
          ? `\nNOTAS_FETCH: ${(fetched.notes || []).join(' | ')}`
          : '';
        urlBlocks.push(`--- CONTEUDO DA URL ${fetched.url} (${fetched.chars} chars)${noteLine} ---\n${fetched.text}\n--- FIM URL ---`);
      }
    }

    const currentProposal = body.proposal && typeof body.proposal === 'object'
      ? normalizeChecklistAiProposal(body.proposal)
      : null;

    const intentRaw = String(body.intent || '').toLowerCase();
    const intent = intentRaw === 'evaluate' || intentRaw === 'avaliar' ? 'evaluate'
      : intentRaw === 'extract' || intentRaw === 'extrair' ? 'extract'
      : null;
    const modeloHint = toNullableText(body.modelo_produto_hint);

    const system = `Você é o assistente de checklist de itens de licitação da Aerion (drones enterprise Autel e acessórios).
Trabalha DENTRO de um item de participação em um fluxo de 2 passos:
1) EXTRAIR requisitos do edital (sem avaliar)
2) AVALIAR conformidade com o produto de referência (modelo / ficha / URL)

${AUTEL_PRODUCT_BRIEF}

## Intenção atual
${intent === 'extract'
    ? `MODO EXTRAIR/REVISAR (passo 1): extrair, revisar, adicionar ou remover requisitos.
- NÃO avalie conformidade de produto (isso é o passo 2).
- Se NÃO houver checklist/prévia: extraia do texto; status de todos = "verificar"; mode_hint "replace".
- Se JÁ houver checklist/prévia: atenda o pedido do usuário — reextrair, acrescentar, remover, reordenar, corrigir textos/seções. Mantenha "id" dos requisitos que permanecerem. mode_hint: "replace" se reextrair/reescrever a lista; "append" se só adicionar; "patch" se só editar linhas existentes.
- Em requisitos novos ou texto reescrito sem julgamento prévio: status "verificar". Pode preservar ok/nao_ok se o requisito (texto) não mudou e o usuário não pediu reavaliar.
- Mantenha ordem do edital / pedido do usuário.`
    : intent === 'evaluate'
      ? `MODO AVALIAR (passo 2): o usuário já tem prévia/checklist. NÃO reextraia o edital. NÃO invente requisitos novos. Mantenha textos, seções e ordem. Preencha status (ok/nao_ok/verificar) e observacao. mode_hint = "patch" se houver ids; senão mantenha a lista e use "replace". Modelo sugerido no item: ${modeloHint || '(não informado no campo)'}.`
      : 'Intenção não forçada: se a mensagem for edital/especificações ou pedido de revisar/adicionar/remover requisitos → EXTRAIR/REVISAR. Se pedir avaliação/comparação com modelo/ficha/URL e já houver proposal → AVALIAR.'}

## Regras de extração
- Gere requisitos ATÔMICOS: um critério mensurável por linha (evite parágrafos).
- Inclua kit/comercial: baterias (qtd), hub, hélices, dongles, mala, cabos, controle, garantia, ANATEL, manuais, etc.
- Preserve números, unidades, mín/máx, "ou equivalente".
- NÃO invente requisitos que não estão no texto do edital ou no pedido do usuário.
- Em MODO EXTRAIR (ou se só colou edital): status de todos = "verificar".

## Seções / subseções (só se existirem no texto)
- Use "secao" APENAS quando o edital tiver seções/títulos de bloco EXPLÍCITOS no texto colado:
  - com número (ex.: "4.5.1. Requisitos Mínimos da Aeronave", "4.5.7. Itens Inclusos"); ou
  - sem número, mas com cabeçalho claro de seção no documento (ex.: linha própria "Câmera Termográfica", "Bateria e Alimentação").
- PROIBIDO inventar seções temáticas quando o texto for só uma lista plana de bullets/itens.
  - Sem seções reais → "secao": null em TODOS os requisitos (a UI mostra lista plana).
- Não “agrupar por tema”, não criar "Aeronave"/"Câmeras" do zero se isso não estiver como seção no edital.
- Não crie um requisito cujo texto seja só o título da seção — o título vai em "secao", o bullet vira "requisito".
- Ignore ruído de PDF (hash, "Assinado Digitalmente", "página X/Y").

## Ordem (OBRIGATÓRIO)
- Mantenha SEMPRE a ordem original das especificações no texto do edital (de cima para baixo).
- Com seções: ordem das seções como no documento; dentro de cada seção, ordem dos bullets como no documento.
- Sem seções: a lista de requirements deve espelhar a sequência do edital, sem reordenar por tema, prioridade ou status.
- "ordem" no JSON deve ser 0, 1, 2… na mesma sequência do edital.

## Regras de avaliação (ok / nao_ok / verificar)
- Use o campo modelo do item, o que o usuário disser no chat, e o conteúdo de URLs/fichas (incluindo specs extraídas de bundle JS se houver).
- "ok": evidência clara de atendimento; "nao_ok": evidência clara de NÃO atendimento; "verificar": só quando NÃO houver base suficiente.
- Em ok/nao_ok, preencha observacao curta (1 linha) citando a fonte (ex.: "site: 42 min voo", "ficha: IP43 < IP54").
- Em verificar, observacao DEVE dizer o que falta (ex.: "peso decolagem não consta na página").
- Prioridade: texto/URL colado > specs da URL > modelo informado > resumo Autel (só apoio).
- NÃO deixe tudo em "verificar" se a página/ficha já dá números claros (ex.: 42 min ≥ 40 min → ok; IP43 vs IP54 mínimo → nao_ok; zoom híbrido 160x ≥ 100x → ok; térmica 640×512 → ok).
- Em MODO AVALIAR é OBRIGATÓRIO alterar status de todos os requisitos em que houver evidência; proibido devolver a lista intacta com 100% verificar se houver dados de produto.
- assistant_message deve incluir contagem: "N ok / N nao_ok / N verificar" e se a fonte de URL estava incompleta.

## Prévia (proposal)
- Você NÃO grava no banco. Só devolve uma prévia para o usuário revisar e clicar em Aplicar.
- Se já existir proposal na conversa, refine-a (não recomece do zero a menos que peçam reextrair).
- Se existir checklist atual e o usuário pedir só avaliar, mantenha textos/seções e preencha status/obs (mode_hint "patch" se houver ids, senão "replace").
- mode_hint: "replace" (parse novo grande), "append" (só adicionar), "patch" (só status/obs de linhas com id).

## Formato de resposta
Responda SOMENTE JSON válido (sem markdown, sem texto fora do JSON):
{
  "assistant_message": "resumo curto em PT-BR do que fez; caminho usual é lista → produto → aplicar, mas pode sugerir aplicar já ou só revisar se fizer sentido",
  "proposal": {
    "mode_hint": "replace|append|patch",
    "modelo_produto": "string ou null (se descobriu/confirmou modelo na avaliação)",
    "requirements": [
      {
        "id": null,
        "secao": "4.5.1. Requisitos Mínimos da Aeronave",
        "requisito": "texto do requisito",
        "status": "ok|nao_ok|verificar",
        "observacao": ""
      }
    ]
  }
}
Máximo 200 requisitos. ids só se reutilizar do checklist atual/proposal.
Caminho usual: (1) lista do edital (2) comparar produto (3) aplicar prévia. Nem sempre — o usuário pode pular o produto, reaplicar, ou voltar à lista.`;

    const contextParts = [
      `ITEM #${item.numero_item || item.id}`,
      `descricao: ${item.descricao || ''}`,
      `modelo_produto atual: ${item.modelo_produto || '(vazio)'}`,
      `quantidade: ${item.quantidade ?? ''}`,
      `valor_referencia: ${item.valor_referencia ?? ''}`,
      `checklist_atual (${currentReqs.length}): ${JSON.stringify(currentReqs.slice(0, 200))}`,
    ];
    if (currentProposal) {
      contextParts.push(`proposal_em_edicao: ${JSON.stringify(currentProposal)}`);
    }
    if (urlBlocks.length) {
      contextParts.push(urlBlocks.join('\n\n'));
    } else if (urls.length) {
      contextParts.push(`URLs detectadas mas sem texto util: ${JSON.stringify(sources)}`);
    }

    const messagesForAi = [
      { role: 'user', content: `CONTEXTO DO ITEM E FONTES:\n${contextParts.join('\n\n')}` },
      ...cleanedMessages,
    ];

    const reqCountHint = (currentProposal?.requirements?.length
      || currentReqs.length
      || 40);
    const ai = await chatCompletionJson({
      system,
      messages: messagesForAi,
      maxTokens: Math.min(16000, Math.max(8000, reqCountHint * 120)),
      temperature: 0.1,
      timeoutMs: 120000,
    });

    if (!ai.ok) {
      return res.status(502).json({
        error: 'Falha na IA',
        detail: ai.error,
        sources,
      });
    }

    let assistantMessage = toNullableText(ai.data?.assistant_message)
      || 'Prévia gerada. Revise e clique em Aplicar se estiver ok.';
    let proposal = normalizeChecklistAiProposal(ai.data?.proposal || ai.data);

    // Se a IA não trouxe requirements mas havia proposal, preserve
    if (!proposal.requirements.length && currentProposal?.requirements?.length) {
      proposal.requirements = currentProposal.requirements;
      proposal.mode_hint = currentProposal.mode_hint || proposal.mode_hint;
      if (!proposal.modelo_produto && currentProposal.modelo_produto) {
        proposal.modelo_produto = currentProposal.modelo_produto;
      }
    }
    // Se a IA devolveu lista sem ids mas a proposal atual tem ids, alinha por índice
    if (proposal.requirements.length && currentProposal?.requirements?.length) {
      proposal.requirements = proposal.requirements.map((r, i) => {
        const base = currentProposal.requirements[i];
        if (!base) return r;
        return {
          ...r,
          id: r.id != null ? r.id : base.id,
          secao: r.secao || base.secao,
          requisito: r.requisito || base.requisito,
          // se status ficou verificar e o item novo não trouxe status útil, mantém o que veio da IA (já normalizado)
        };
      });
    }

    // MODO AVALIAR: se a mensagem diz que avaliou mas status não mudou (bug comum da IA),
    // faz 2ª passagem só com {i,id,status,observacao} e mescla na prévia.
    let evalPassMeta = null;
    if (intent === 'evaluate') {
      let counts = countProposalStatuses(proposal.requirements);
      const decided = counts.ok + counts.nao_ok;
      const needsStatusPass = proposal.requirements.length > 0 && decided < Math.max(3, Math.ceil(proposal.requirements.length * 0.15));
      if (needsStatusPass) {
        const baseList = proposal.requirements.length
          ? proposal.requirements
          : (currentProposal?.requirements || currentReqs.map((r) => ({
            id: r.id,
            secao: r.secao,
            requisito: r.requisito,
            status: r.status || 'verificar',
            observacao: r.observacao || '',
          })));
        const productContext = [
          `modelo_hint: ${modeloHint || item.modelo_produto || ''}`,
          proposal.modelo_produto ? `modelo_proposta: ${proposal.modelo_produto}` : '',
        ].filter(Boolean).join('\n');
        const pass = await evaluateChecklistStatusesPass({
          requirements: baseList,
          modelo: proposal.modelo_produto || modeloHint || item.modelo_produto,
          productContext,
          urlBlocks: urlBlocks.join('\n\n'),
        });
        if (pass.ok) {
          proposal = {
            ...proposal,
            mode_hint: proposal.mode_hint || 'patch',
            requirements: pass.requirements,
            modelo_produto: proposal.modelo_produto || modeloHint || item.modelo_produto || null,
          };
          evalPassMeta = { provider: pass.provider, model: pass.model };
          counts = countProposalStatuses(proposal.requirements);
          assistantMessage = `${assistantMessage}\n\n✓ Avaliação aplicada na prévia (2ª passagem de status): ${counts.ok} OK · ${counts.nao_ok} X · ${counts.verificar} ?.`;
        } else {
          assistantMessage = `${assistantMessage}\n\n⚠ A IA descreveu a avaliação no texto, mas não preencheu status na prévia. 2ª passagem falhou: ${pass.error || 'erro'}. Tente de novo ou cole a ficha completa.`;
        }
      } else if (proposal.requirements.length) {
        assistantMessage = `${assistantMessage}\n\nContagem na prévia: ${counts.ok} OK · ${counts.nao_ok} X · ${counts.verificar} ?.`;
      }
    }

    const sourceNotes = sources.flatMap((s) => s.notes || []);
    if (sourceNotes.length) {
      assistantMessage = `${assistantMessage}\n\nFontes/notas de leitura: ${sourceNotes.join(' | ')}`;
    }

    res.json({
      assistant_message: assistantMessage,
      proposal,
      sources,
      provider: evalPassMeta?.provider || ai.provider,
      model: evalPassMeta?.model || ai.model,
      evaluation_pass: !!evalPassMeta,
    });
  } catch (error) {
    console.error('Error item checklist AI chat:', error);
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
const normalizePncpItem = (item, matchedTermo = null) => {
  const ids = extractPncpCompraIdentifiers(item);
  return ({
  id: item.id || getPncpRawItemKey(item),
  descricao: item.description || item.descricao || item.objetoCompra || '',
  url: normalizePncpItemUrl(item.item_url || item.url || item.linkSistemaOrigem),
  numero_controle_pncp: item.numero_controle_pncp || item.numeroControlePNCP,
  numero_sequencial: ids.sequencial || item.numero_sequencial,
  ano: ids.ano || item.ano,
  orgao_cnpj: ids.cnpj || item.orgao_cnpj || item.cnpjOrgao || item.orgaoCnpj || '',
  situacao: {
    id: item.situacao_id || item.situacaoCompraId || item.situacaoId,
    nome: item.situacao_nome || item.situacaoCompraDescricao || item.situacaoCompraNome || item.situacaoNome,
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
  data_publicacao: item.data_publicacao_pncp || item.dataPublicacaoPncp || item.data_publicacao || item.dataPublicacao,
  data_atualizacao: item.data_atualizacao_pncp || item.dataAtualizacaoPncp || item.data_atualizacao || item.dataAtualizacao,
  data_inicio_vigencia: item.data_inicio_vigencia || item.dataInicioVigencia || item.dataAberturaProposta || item.dataAberturaPropostas || item.dataInicioProposta || item.dataInicioPropostas,
  data_fim_vigencia: item.data_fim_vigencia || item.dataFimVigencia || item.dataEncerramentoProposta || item.dataEncerramentoPropostas || item.dataFimProposta || item.dataFimPropostas,
  valor_global: item.valor_global ?? item.valorGlobal ?? item.valorTotalEstimado ?? null,
  valor_itens_pertinentes: item.valor_itens_pertinentes ?? null,
  itens_pertinentes_count: item.itens_pertinentes_count ?? null,
  itens_pertinentes: Array.isArray(item.itens_pertinentes) ? item.itens_pertinentes : [],
  valor_total_estimado: item.valor_total_estimado ?? item.valorTotalEstimado ?? null,
  valor_total_homologado: item.valor_total_homologado ?? item.valorTotalHomologado ?? null,
  total_itens: item.total_itens ?? null,
  itens_resumo_texto: item.itens_resumo_texto || item.__itens_resumo_texto || '',
  cancelado: item.cancelado,
  modo_disputa: {
    id: item.modo_disputa_id || null,
    nome: item.modo_disputa_nome || null,
  },
  srp: typeof item.srp === 'boolean' ? item.srp : null,
  amparo_legal: item.amparo_legal || (item.amparoLegal ? {
    codigo: item.amparoLegal.codigo ?? null,
    nome: item.amparoLegal.nome || null,
    descricao: item.amparoLegal.descricao || null,
  } : null),
  modo_disputa_unresolved: item.modo_disputa_unresolved === true || undefined,
  titulo: item.title || item.titulo || item.objetoCompra || item.numeroControlePNCP || 'Sem titulo',
  orgao: {
    cnpj: ids.cnpj || item.orgao_cnpj || item.cnpjOrgao || item.orgaoCnpj || item.orgaoEntidade?.cnpj || '',
    nome: item.orgao_nome || item.nomeOrgao || item.orgaoNome || item.razaoSocialOrgao || item.orgaoEntidade?.razaoSocial || '',
    id: item.orgao_id || item.idOrgao || item.orgaoId || '',
  },
  unidade: {
    codigo: item.unidade_codigo || item.codigoUnidade || item.unidadeOrgaoCodigoUnidade || item.unidadeCodigo || '',
    nome: item.unidade_nome || item.nomeUnidade || item.unidadeOrgaoNomeUnidade || item.unidadeNome || item.unidadeOrgao?.nomeUnidade || '',
    id: item.unidade_id || item.idUnidade || item.unidadeId || '',
  },
  modalidade: {
    id: item.modalidade_licitacao_id || item.modalidadeId,
    nome: item.modalidade_licitacao_nome || item.modalidadeNome,
  },
  tem_resultado: item.tem_resultado ?? item.temResultado,
  matched_termo: matchedTermo, // Termo que encontrou este resultado
  });
};

// Mapeia um item da API de consulta (/v1/contratacoes/*) para o shape "raw" da
// /api/search/, permitindo mesclar as duas fontes antes do normalizePncpItem.
const mapPncpConsultaContratacaoToSearchItem = (item, matchedTermo, flags = {}) => ({
  id: item.numeroControlePNCP
    || `${item.cnpjOrgao || item.orgaoEntidade?.cnpj || ''}-${item.anoCompra}-${item.sequencialCompra}`,
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
  situacao_nome: item.situacaoCompraDescricao || item.situacaoCompraNome,
  data_publicacao_pncp: item.dataPublicacaoPncp,
  data_atualizacao_pncp: item.dataAtualizacaoPncp,
  valor_global: item.valorTotalEstimado,
  valor_total_estimado: item.valorTotalEstimado,
  valor_total_homologado: item.valorTotalHomologado,
  srp: typeof item.srp === 'boolean' ? item.srp : null,
  amparoLegal: item.amparoLegal || null,
  modo_disputa_id: item.modoDisputaId ? String(item.modoDisputaId) : null,
  modo_disputa_nome: item.modoDisputaNome || null,
  uf: item.unidadeOrgao?.ufSigla || item.ufSigla || '',
  municipio_nome: item.unidadeOrgao?.municipioNome || item.municipioNome || '',
  data_inicio_vigencia: item.dataAberturaPropostas || item.dataAberturaProposta || item.dataInicioPropostas || item.dataInicioVigencia || null,
  data_fim_vigencia: item.dataEncerramentoProposta || item.dataEncerramentoPropostas || item.dataFimPropostas || item.dataFimVigencia || null,
  __matched_termo: matchedTermo,
  ...flags,
});

// Endpoint principal de busca de editais/contratações no PNCP
const splitPncpTerms = (value = '') => String(value || '')
  .split(/[,;\n]+/)
  .map(term => term.trim())
  .filter(Boolean);

const getPncpBestEstimatedValue = (item) => {
  const candidates = [
    item?.valor_itens_pertinentes,
    item?.valor_total_estimado,
    item?.valorTotalEstimado,
    item?.valor_global,
    item?.valorGlobal,
    item?.valor_total_homologado,
    item?.valorTotalHomologado,
  ];
  for (const value of candidates) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return null;
};

const getPncpRelevantItemsValue = (item) => {
  const value = Number(item?.valor_itens_pertinentes);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const getPncpValueScore = (value, { matchedItems = false } = {}) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  const maxPoints = matchedItems ? 16 : 9;
  const minPoints = matchedItems ? 1 : 0;
  const scaled = Math.log10(numeric + 1) - 2;
  const points = Math.max(minPoints, Math.min(maxPoints, Math.round(scaled * (matchedItems ? 3.2 : 1.8))));
  return points;
};

const classifyContractFocusMatch = (item, focus = 'aquisicao') => {
  const normalizedFocus = normalizeSearchText(focus || 'aquisicao');
  if (!normalizedFocus || normalizedFocus === 'todos') {
    return null;
  }
  const profile = CONTRACT_FOCUS_PROFILES[normalizedFocus] || CONTRACT_FOCUS_PROFILES.aquisicao;
  const text = [
    item?.titulo,
    item?.descricao,
    item?.itens_resumo_texto,
    item?.modalidade?.nome,
    item?.tipo?.nome,
  ].filter(Boolean).join(' ');
  const positiveMatches = (profile.positive || []).filter(term => containsTermStrictFlexible(text, term));
  const explicitNegativeMatches = (profile.negative || []).filter(term => containsTermStrictFlexible(text, term));
  const offFocusMatches = Object.entries(CONTRACT_FOCUS_PROFILES)
    .filter(([id]) => id !== normalizedFocus)
    .flatMap(([, otherProfile]) => (otherProfile.positive || [])
      .filter(term => containsTermStrictFlexible(text, term))
      .map(term => ({ term, label: otherProfile.label })));

  if (offFocusMatches.length > 0) {
    const terms = offFocusMatches.slice(0, 3).map(match => match.term);
    const labels = [...new Set(offFocusMatches.slice(0, 3).map(match => match.label))];
    return { profile, status: 'mismatch', terms, delta: -14, offFocusLabels: labels };
  }
  if (positiveMatches.length > 0) {
    return { profile, status: 'match', terms: positiveMatches.slice(0, 3), delta: 8 };
  }
  if (explicitNegativeMatches.length > 0) {
    return { profile, status: 'mismatch', terms: explicitNegativeMatches.slice(0, 3), delta: -12 };
  }
  return { profile, status: 'unknown', terms: [], delta: -3 };
};

const getPncpDeadlineInfo = (item) => {
  const rawDate = item?.data_fim_vigencia
    || item?.data_envio_proposta_limite
    || item?.data_encerramento_proposta
    || item?.dataEncerramentoProposta
    || item?.dataEncerramentoPropostas
    || item?.dataFimProposta
    || item?.dataFimPropostas
    || item?.dataFimVigencia
    || null;
  if (!rawDate) return { days: null, label: 'Prazo n/d', urgency: 'unknown' };
  const deadline = new Date(rawDate);
  if (Number.isNaN(deadline.getTime())) return { days: null, label: 'Prazo n/d', urgency: 'unknown' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  deadline.setHours(0, 0, 0, 0);
  const days = Math.ceil((deadline.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { days, label: 'Prazo vencido', urgency: 'expired' };
  if (days === 0) return { days, label: 'Vence hoje', urgency: 'critical' };
  if (days <= 3) return { days, label: `Vence em ${days} dia(s)`, urgency: 'critical' };
  if (days <= 10) return { days, label: `Vence em ${days} dia(s)`, urgency: 'warning' };
  return { days, label: `Vence em ${days} dia(s)`, urgency: 'ok' };
};

/** Prazo de proposta a partir dos campos que a search/consulta/detalhe expõem. */
const getPncpProposalDeadlineRaw = (item) => (
  item?.data_fim_vigencia
  || item?.data_encerramento_proposta
  || item?.dataEncerramentoProposta
  || item?.dataEncerramentoPropostas
  || item?.dataFimProposta
  || item?.dataFimPropostas
  || item?.dataFimVigencia
  || item?.deadline_at
  || null
);

/** Código de situação da contratação no PNCP (1 divulgada, 2 revogada, 3 anulada, 4 suspensa). */
const getPncpSituacaoCompraId = (item) => {
  const raw = item?.situacao?.id
    ?? item?.situacao_id
    ?? item?.situacaoCompraId
    ?? item?.situacaoId
    ?? null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Situações terminais oficiais (manual PNCP 5.5) — evidência forte para tirar da lista. */
const isPncpSituacaoTerminalId = (sitId) => [2, 3, 4].includes(Number(sitId));

/**
 * Veredito para filtro "recebendo proposta" / retenção na lista.
 * - open: prazo futuro e sem sinal terminal
 * - closed: cancelado, situacao 2/3/4, texto terminal ou prazo vencido (com data válida)
 * - unknown: dados insuficientes (ex.: sem prazo ainda) — NÃO excluir; esperar enrich/detalhe
 *
 * Regra de produto: ausência de informação ≠ fechado. Só tira da lista com evidência.
 */
const getPncpReceivingProposalVerdict = (item = {}) => {
  if (item?.cancelado === true) {
    return { verdict: 'closed', reason: 'cancelado' };
  }

  const sitId = getPncpSituacaoCompraId(item);
  if (isPncpSituacaoTerminalId(sitId)) {
    return { verdict: 'closed', reason: `situacao_id_${sitId}` };
  }

  const statusText = normalizeSearchText([
    item?.situacao?.nome,
    item?.situacao_nome,
    item?.situacaoCompraDescricao,
    item?.situacaoCompraNome,
  ].filter(Boolean).join(' '));
  const terminalHints = [
    'contratad', 'homolog', 'adjudic', 'encerrad', 'finalizad', 'concluid',
    'revogad', 'anulad', 'fracassad', 'desert', 'suspens',
  ];
  if (statusText && terminalHints.some((hint) => statusText.includes(hint))) {
    return { verdict: 'closed', reason: 'situacao_texto_terminal' };
  }

  // Resultado/contrato homologado sem precisar de prazo.
  if (item?.tem_resultado === true || item?.temResultado === true) {
    return { verdict: 'closed', reason: 'tem_resultado' };
  }
  if (Number(item?.valor_total_homologado || item?.valorTotalHomologado || 0) > 0) {
    return { verdict: 'closed', reason: 'valor_homologado' };
  }

  const deadlineRaw = getPncpProposalDeadlineRaw(item);
  if (deadlineRaw) {
    const deadlineDate = new Date(deadlineRaw);
    if (Number.isNaN(deadlineDate.getTime())) {
      // Data presente mas ilegível: tratar como insuficiente, não como fechado.
      return { verdict: 'unknown', reason: 'deadline_unparseable' };
    }
    deadlineDate.setHours(23, 59, 59, 999);
    if (deadlineDate.getTime() < Date.now()) {
      return { verdict: 'closed', reason: 'deadline_expired' };
    }
    return { verdict: 'open', reason: 'deadline_future' };
  }

  // Sem prazo: ainda pode estar aberto — enrich/detalhe preenchem depois.
  return { verdict: 'unknown', reason: 'missing_deadline' };
};

/** Mantém na lista de abertos: open ou unknown (só tira se closed com evidência). */
const isPncpReceivingProposalOpen = (item) => {
  const { verdict } = getPncpReceivingProposalVerdict(item);
  return verdict !== 'closed';
};

/** Fechado com evidência — único caso seguro para demote/stale_status. */
const isPncpReceivingProposalDefinitelyClosed = (item) => (
  getPncpReceivingProposalVerdict(item).verdict === 'closed'
);

/** Aberto com prazo futuro confirmado (não inclui unknown). */
const isPncpReceivingProposalDefinitelyOpen = (item) => (
  getPncpReceivingProposalVerdict(item).verdict === 'open'
);

const classifyPncpCommercialStage = (item, dossier = {}) => {
  const text = normalizeSearchText([
    item?.situacao?.nome,
    item?.situacao_nome,
    item?.situacaoCompraNome,
    item?.tipo?.nome,
    item?.tipo_nome,
    item?.titulo,
    item?.descricao,
    item?.modalidade?.nome,
  ].filter(Boolean).join(' '));
  const hasResult = item?.tem_resultado === true
    || item?.temResultado === true
    || Number(item?.valor_total_homologado || item?.valorTotalHomologado || 0) > 0
    || text.includes('homolog')
    || text.includes('adjudic')
    || (Array.isArray(dossier?.resultados) && dossier.resultados.length > 0);
  const hasContract = (Array.isArray(dossier?.contratos) && dossier.contratos.length > 0);
  const hasAta = (Array.isArray(dossier?.atas) && dossier.atas.length > 0);
  const deadline = getPncpDeadlineInfo(item);

  if (item?.cancelado || text.includes('cancelad') || text.includes('revogad') || text.includes('anulad')) {
    return { id: 'expired_or_closed', label: 'Cancelada/revogada', tone: 'danger', open: false };
  }
  if (text.includes('suspens')) {
    return { id: 'expired_or_closed', label: 'Suspensa', tone: 'danger', open: false };
  }
  if (hasContract) {
    return { id: 'contracted', label: 'Contratada', tone: 'neutral', open: false };
  }
  if (hasAta) {
    return { id: 'ata_available', label: 'Ata disponível', tone: 'neutral', open: false };
  }
  if (hasResult) {
    return { id: 'resulted', label: 'Com resultado', tone: 'neutral', open: false };
  }
  if (text.includes('ato que autoriza a contratacao direta')) {
    return { id: 'direct_authorized', label: 'Contratação direta autorizada', tone: 'warning', open: false };
  }
  if (deadline.urgency === 'expired') {
    return { id: 'expired_or_closed', label: 'Prazo vencido', tone: 'danger', open: false };
  }
  if (deadline.days !== null && deadline.days >= 0) {
    return { id: 'open_for_proposal', label: 'Aberta', tone: 'success', open: true };
  }
  // Sem prazo: estágio "desconhecido" — o filtro de lista NÃO exclui só por isso
  // (isPncpReceivingProposalOpen trata missing_deadline como unknown e mantém o item
  // até enrich/detalhe preencher a data ou situação terminal).
  if (text.includes('homolog') || text.includes('adjudic') || text.includes('contratad') || text.includes('encerrad') || text.includes('finalizad')) {
    return { id: 'expired_or_closed', label: 'Encerrada', tone: 'neutral', open: false };
  }
  if (text.includes('aviso de contratacao direta')) {
    return { id: 'unknown_published', label: 'Aviso publicado', tone: 'warning', open: false };
  }
  return { id: 'unknown_published', label: 'Sem prazo (aguardando dados)', tone: 'warning', open: false };
};

const classifyPncpLegalStage = (item) => {
  const text = normalizeSearchText([item?.situacao?.nome, item?.tipo?.nome, item?.titulo, item?.descricao].filter(Boolean).join(' '));
  if (text.includes('plano') || text.includes('pca')) return { id: 'planejamento', label: 'Planejamento/PCA' };
  if (text.includes('dispensa') || text.includes('inexigibilidade')) return { id: 'contratacao_direta', label: 'Contratacao direta' };
  if (text.includes('recebendo') || text.includes('proposta') || text.includes('abert')) return { id: 'propostas', label: 'Propostas/lances' };
  if (text.includes('julg')) return { id: 'julgamento', label: 'Julgamento' };
  if (text.includes('habilit')) return { id: 'habilitacao', label: 'Habilitacao' };
  if (text.includes('homolog') || text.includes('adjudic')) return { id: 'homologacao', label: 'Homologacao/contrato' };
  return { id: 'edital_publicado', label: 'Edital publicado' };
};

const classifyPncpJudgement = (item) => {
  const text = normalizeSearchText(`${item?.titulo || ''} ${item?.descricao || ''} ${item?.itens_resumo_texto || ''}`);
  if (text.includes('menor preco')) return 'Menor preco';
  if (text.includes('maior desconto')) return 'Maior desconto';
  if (text.includes('tecnica e preco')) return 'Tecnica e preco';
  if (text.includes('melhor tecnica')) return 'Melhor tecnica';
  if (text.includes('maior retorno economico')) return 'Maior retorno economico';
  return null;
};

const decoratePncpSearchItem = (item, context = {}) => {
  const qText = String(context.qText || '').trim();
  const positiveTerms = (context.positiveTerms || []).filter(Boolean);
  const negativeTerms = (context.negativeTerms || []).filter(Boolean);
  const normalizedText = normalizeSearchText([
    item?.titulo,
    item?.descricao,
    item?.itens_resumo_texto,
    item?.orgao?.nome,
    item?.unidade?.nome,
    item?.modalidade?.nome,
    item?.tipo?.nome,
  ].filter(Boolean).join(' '));
  const positivePhrases = positiveTerms.filter(term => tokenizeSearchTerms(term).length >= 2);
  const singlePositiveTerms = positiveTerms.filter(term => tokenizeSearchTerms(term).length <= 1);
  const queryTokens = tokenizeSearchTerms(qText).filter(t => t.length >= 3);
  const positiveTokens = singlePositiveTerms.flatMap(term => tokenizeSearchTerms(term)).filter(t => t.length >= 3);
  const negativeTokens = negativeTerms.flatMap(term => tokenizeSearchTerms(term)).filter(t => t.length >= 3);
  const matchedQueryTokens = [...new Set(queryTokens.filter(token => containsTermStrictFlexible(normalizedText, token)))];
  const matchedPositiveTokens = [...new Set(positiveTokens.filter(token => containsTermStrictFlexible(normalizedText, token)))];
  const matchedPositivePhrases = [...new Set(positivePhrases.filter(term => containsTermStrictFlexible(normalizedText, term)))];
  const matchedNegativeTokens = [...new Set(negativeTokens.filter(token => containsTermStrictFlexible(normalizedText, token)))];
  const deadline = getPncpDeadlineInfo(item);
  const value = getPncpBestEstimatedValue(item);
  const totalEstimatedValue = getPncpTotalEstimatedValue(item);
  const relevantItemsValue = getPncpRelevantItemsValue(item);
  const itemCount = Number(item?.itens_pertinentes_count || 0);
  const legalStage = classifyPncpLegalStage(item);
  const commercialStage = classifyPncpCommercialStage(item);
  const judgement = classifyPncpJudgement(item);
  const source = item?.__from_consulta_uasg ? 'pncp_consulta' : 'pncp_search';
  const matchedTerm = String(item?.matched_termo || '').trim();
  const matchedByTechnicalTerm = matchedTerm
    && normalizeSearchText(matchedTerm) !== normalizeSearchText(qText)
    && containsTermStrictFlexible(`${item?.titulo || ''} ${item?.descricao || ''}`, matchedTerm);
  const contractFocusMatch = classifyContractFocusMatch(item, context.contractFocus || 'aquisicao');

  let score = 25;
  const reasons = [];
  const scoreBreakdown = [{ label: 'Resultado retornado pelo PNCP', value: 25 }];
  const addScore = (valueDelta, label) => {
    if (!valueDelta) {
      return;
    }
    score += valueDelta;
    scoreBreakdown.push({ label, value: valueDelta });
    reasons.push(label);
  };

  if (qText && containsTermStrictFlexible(item?.titulo || '', qText)) {
    addScore(24, 'Objeto/titulo contem a busca');
  } else if (qText && containsTermStrictFlexible(item?.descricao || '', qText)) {
    addScore(20, 'Objeto contem a busca');
  } else if (matchedByTechnicalTerm) {
    addScore(24, `Objeto contem termo tecnico: ${matchedTerm}`);
  } else if (matchedQueryTokens.length > 0) {
    addScore(Math.min(18, matchedQueryTokens.length * 6), `Termos no objeto: ${matchedQueryTokens.slice(0, 3).join(', ')}`);
  }
  if (matchedPositiveTokens.length > 0) {
    addScore(Math.min(18, matchedPositiveTokens.length * 4), `Aderencia semantica: ${matchedPositiveTokens.slice(0, 3).join(', ')}`);
  }
  if (matchedPositivePhrases.length > 0) {
    addScore(Math.min(16, matchedPositivePhrases.length * 8), `Frase tecnica exata: ${matchedPositivePhrases.slice(0, 2).join(', ')}`);
  }
  if (itemCount > 0) {
    addScore(Math.min(14, 7 + itemCount * 2), `${itemCount} item(ns) pertinente(s)`);
  }
  if (relevantItemsValue) {
    addScore(getPncpValueScore(relevantItemsValue, { matchedItems: true }), `Valor dos itens pertinentes: R$ ${relevantItemsValue.toLocaleString('pt-BR')}`);
  }
  if (deadline.urgency === 'ok') {
    addScore(8, deadline.label);
  } else if (deadline.urgency === 'warning') {
    addScore(4, deadline.label);
  } else if (deadline.urgency === 'critical') {
    addScore(-6, deadline.label);
  } else if (deadline.urgency === 'expired') {
    addScore(-24, 'Prazo vencido');
  }
  if (commercialStage.id === 'resulted' || commercialStage.id === 'contracted' || commercialStage.id === 'ata_available') {
    addScore(-22, commercialStage.label);
  } else if (commercialStage.id === 'direct_authorized') {
    addScore(-18, commercialStage.label);
  } else if (commercialStage.id === 'unknown_published') {
    addScore(-6, commercialStage.label);
  } else if (commercialStage.id === 'open_for_proposal') {
    addScore(6, 'Oportunidade aberta');
  }
  if (totalEstimatedValue) {
    addScore(getPncpValueScore(totalEstimatedValue), `Valor total estimado: R$ ${totalEstimatedValue.toLocaleString('pt-BR')}`);
  }
  if (context.orgaoFilterRaw || context.unidadeFilterRaw) {
    addScore(8, 'Filtro de orgao/UASG atendido');
  }
  if (contractFocusMatch?.status === 'match') {
    addScore(contractFocusMatch.delta, `Foco ${contractFocusMatch.profile.label}: ${contractFocusMatch.terms.join(', ')}`);
  } else if (contractFocusMatch?.status === 'mismatch') {
    addScore(contractFocusMatch.delta, `Fora do foco ${contractFocusMatch.profile.label}: ${contractFocusMatch.terms.join(', ')}`);
  } else if (contractFocusMatch?.status === 'unknown') {
    addScore(contractFocusMatch.delta, `Foco ${contractFocusMatch.profile.label} nao identificado`);
  }
  if (matchedNegativeTokens.length > 0) {
    addScore(-Math.min(25, matchedNegativeTokens.length * 8), `Possivel ruido: ${matchedNegativeTokens.slice(0, 3).join(', ')}`);
  }
  if (!reasons.length) reasons.push('Resultado PNCP relacionado aos filtros');

  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    ...item,
    source,
    legal_stage: commercialStage,
    pncp_legal_stage: legalStage,
    commercial_stage: commercialStage,
    criterio_julgamento: judgement,
    prazo_info: deadline,
    score,
    score_label: score >= PNCP_SCORE_HIGH_THRESHOLD ? 'Alta aderencia' : score >= PNCP_SCORE_MEDIUM_THRESHOLD ? 'Media aderencia' : 'Baixa aderencia',
    score_breakdown: scoreBreakdown,
    match_reasons: reasons.slice(0, 5),
    highlights: {
      termos: [...new Set([...matchedQueryTokens, ...matchedPositiveTokens])].slice(0, 8),
      frases: matchedPositivePhrases.slice(0, 5),
      negativos: matchedNegativeTokens.slice(0, 5),
    },
  };
};

const createPncpSearchSummary = (items = []) => {
  const emptyBucket = () => ({ count: 0, total_value: 0 });
  const summary = {
    count: items.length,
    total_value: 0,
    by_adherence: {
      alta: emptyBucket(),
      media: emptyBucket(),
      baixa: emptyBucket(),
    },
    by_stage: {},
    by_status: {},
    by_source: {},
    by_publication: {
      publicado: emptyBucket(),
      nao_publicado: emptyBucket(),
    },
  };

  for (const item of items) {
    // "Valor na lista" = só itens pertinentes; sem fallback para total da licitação.
    const value = getPncpRelevantItemsValue(item) || 0;
    summary.total_value += value;

    const adherence = Number(item?.score || 0) >= PNCP_SCORE_HIGH_THRESHOLD ? 'alta' : Number(item?.score || 0) >= PNCP_SCORE_MEDIUM_THRESHOLD ? 'media' : 'baixa';
    summary.by_adherence[adherence].count += 1;
    summary.by_adherence[adherence].total_value += value;

    const stageKey = item?.legal_stage?.label || 'Sem fase';
    summary.by_stage[stageKey] = summary.by_stage[stageKey] || emptyBucket();
    summary.by_stage[stageKey].count += 1;
    summary.by_stage[stageKey].total_value += value;

    const statusKey = item?.situacao?.nome || 'Status n/d';
    summary.by_status[statusKey] = summary.by_status[statusKey] || emptyBucket();
    summary.by_status[statusKey].count += 1;
    summary.by_status[statusKey].total_value += value;

    const sourceKey = item?.source === 'pncp_consulta' ? 'PNCP Consulta' : 'PNCP Search';
    summary.by_source[sourceKey] = summary.by_source[sourceKey] || emptyBucket();
    summary.by_source[sourceKey].count += 1;
    summary.by_source[sourceKey].total_value += value;

    const publicationKey = item?.data_publicacao ? 'publicado' : 'nao_publicado';
    summary.by_publication[publicationKey].count += 1;
    summary.by_publication[publicationKey].total_value += value;
  }

  return summary;
};

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
      semantic = 'true',
      negative_terms = '',
      contract_focus = 'aquisicao',
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
    const shouldApplyReceivingProposalLocally = normalizeSearchText(mappedStatus) === 'recebendo_proposta';
    if (mappedStatus && String(mappedStatus) !== 'todos' && !shouldApplyReceivingProposalLocally) {
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
    let termosNegativos = splitPncpTerms(negative_terms);
    let fonteIA = null;
    let iaPositivos = []; // Sinônimos positivos da IA — usados também no filtro local do endpoint de contratações
    const deterministicPositiveTerms = mergeUniqueTerms(
      getQuerySpecificAllowlist(qText),
      detectContextProfile(qText)?.positiveBoost || []
    );
    const iaForcada = usar_ia === 'true';
    const qTokensForAi = tokenizeSearchTerms(qText).filter(token => token.length >= 3);
    const hasEntityOnlySearch = !qText && Boolean(entityQuerySeed);
    const queryLooksSpecific = isSpecificNoticeIdentifierQuery(qText)
      || /\d{4,}/.test(qText)
      || qTokensForAi.length >= 7;
    const shouldUseAi = iaForcada
      && qText
      && qText.length >= 3
      && !hasEntityOnlySearch
      && !queryLooksSpecific;

    // Se usar_ia está ativado e há um termo de busca
    const pncpSearchCacheKey = JSON.stringify({
      version: 9,
      q: normalizeSearchText(qText),
      tipos_documento,
      status: mappedStatus,
      modalidade_licitacao_id: modalidade_licitacao_id || '',
      tipo_id: tipo_id || '',
      modo_disputa_id: modo_disputa_id || '',
      uf: uf || '',
      esfera_id: esfera_id || '',
      orgao_cnpj: orgaoFilterRaw,
      unidade_codigo: unidadeFilterRaw,
      pagina: paginaNum,
      tam: tamNum,
      ordenacao,
      usar_ia: iaForcada,
      semantic,
      negative_terms: normalizeSearchText(negative_terms),
      contract_focus: normalizeSearchText(contract_focus || 'aquisicao'),
    });
    const cachedSearch = PNCP_SEARCH_RESPONSE_CACHE.get(pncpSearchCacheKey);
    if (cachedSearch && (Date.now() - cachedSearch.timestamp) < PNCP_SEARCH_RESPONSE_CACHE_TTL) {
      return res.json({
        ...cachedSearch.payload,
        diagnostics: {
          ...(cachedSearch.payload?.diagnostics || {}),
          cacheHit: true,
        },
        query_plan: {
          ...(cachedSearch.payload?.query_plan || {}),
          cache_hit: true,
        },
      });
    }

    const termRuns = [];
    const createTermRun = (term, source, extra = {}) => ({
      term: String(term || ''),
      source,
      endpoint: extra.endpoint || 'pncp_search',
      params: {
        q: String(term || ''),
        status_sent_to_pncp: baseParams.status || null,
        tipos_documento,
        tam: extra.tam || tamNum,
      },
      pages_requested: 0,
      pages_completed: 0,
      total_reported: 0,
      items_collected: 0,
      observed_page_size: null,
      errors: [],
      stop_reason: null,
      duration_ms: 0,
    });

    if (shouldUseAi) {
      // Buscar termos correlatos com IA
      const termosResult = await getTermosCorrelatos(qText);
      fonteIA = termosResult.fonte;
      iaPositivos = rankPositiveSearchTerms(qText, mergeUniqueTerms(
        deterministicPositiveTerms,
        termosResult.positivos || termosResult.correlatos || []
      ), 5);

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

      const pncpTermPageSize = Math.max(tamNum, 100);
      const getTermSearchBudget = (term, index) => {
        const normalized = normalizeSearchText(term).trim();
        const tokens = tokenizeSearchTerms(term);
        const isPhrase = tokens.length >= 2;
        const isVerySpecificPhrase = isPhrase && (
          normalized.includes('aeronave')
          || normalized.includes('veiculo aereo')
          || normalized.includes('quadricoptero')
          || normalized.includes('multirrotor')
        );
        const broadAcronyms = new Set(['uav', 'uas', 'vant', 'vants', 'rpa', 'rpas', 'arp']);

        if (index === 0) {
          return { maxPages: 6, maxItems: 60, reason: 'termo_original_rapido' };
        }
        if (isVerySpecificPhrase) {
          return { maxPages: 8, maxItems: 80, reason: 'termo_tecnico_preciso_rapido' };
        }
        if (broadAcronyms.has(normalized)) {
          return { maxPages: 4, maxItems: 40, reason: 'sigla_ampla_rapida' };
        }
        if (isPhrase) {
          return { maxPages: 6, maxItems: 60, reason: 'frase_correlata_rapida' };
        }
        return { maxPages: 4, maxItems: 40, reason: 'termo_correlato_rapido' };
      };

      // Fazer buscas em paralelo (cada termo pode precisar de várias páginas)
      const resultados = await mapWithConcurrency(termosParaBuscar, 1, async (termo, index) => {
        const run = createTermRun(termo, index === 0 ? 'original' : 'ai_or_alias', { tam: pncpTermPageSize });
        const startedAt = Date.now();
        try {
          const budget = getTermSearchBudget(termo, index);
          const targetForTerm = budget.maxItems;
          run.max_pages = budget.maxPages;
          run.target_items = targetForTerm;
          run.budget_reason = budget.reason;

          const collected = [];
          let page = 1;
          let totalFromApi = 0;
          let observedPageSize = 0;

          while (collected.length < targetForTerm && page <= budget.maxPages) {
            run.pages_requested += 1;
            const data = await withPncpGate(() => fetchPncpSearchStable({ ...baseParams, q: termo, pagina: page, tam: pncpTermPageSize }), { priority: 'interactive' });
            run.pages_completed += 1;
            const items = Array.isArray(data?.items) ? data.items : [];
            if (page === 1) {
              totalFromApi = Number(data?.total) || 0;
              run.total_reported = totalFromApi;
            }
            if (items.length === 0) {
              run.stop_reason = 'empty_page';
              break;
            }
            if (observedPageSize === 0) {
              observedPageSize = items.length;
              run.observed_page_size = observedPageSize;
            }

            collected.push(...items.map(item => ({ ...item, __matched_termo: termo })));

            // Se retornou menos itens que o solicitado, não há mais páginas
            if (observedPageSize > 0 && items.length < observedPageSize) {
              run.stop_reason = 'short_page';
              break;
            }

            if (totalFromApi > 0 && collected.length >= totalFromApi) {
              run.stop_reason = 'total_reached';
              break;
            }

            page += 1;
          }

          if (!run.stop_reason) {
            run.stop_reason = collected.length >= targetForTerm ? 'target_reached' : 'max_pages';
          }
          run.items_collected = collected.length;
          return { items: collected, run };
        } catch (err) {
          console.error(`Erro buscando termo "${termo}":`, err.message);
          run.errors.push(err.message);
          run.stop_reason = 'error';
          return { items: [], run };
        } finally {
          run.duration_ms = Date.now() - startedAt;
        }
      });
      termRuns.push(...resultados.map(resultado => resultado.run).filter(Boolean));

      // Combinar resultados, priorizando o termo original
      const seenIds = new Set();
      for (const resultado of resultados) {
        for (const item of resultado.items || []) {
          const itemKey = getPncpRawItemKey(item);
          if (!seenIds.has(itemKey)) {
            seenIds.add(itemKey);
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
      const fetchMultiplePages = async (searchTerm, maxPages, source = 'manual') => {
        const run = createTermRun(searchTerm, source, { tam: tamNum });
        const startedAt = Date.now();
        const collected = [];
        let totalFromApi = 0;
        let apiPageSize = tamNum;
        try {
          run.pages_requested += 1;
          const firstData = await withPncpGate(() => fetchPncpSearchStable({ ...baseParams, q: searchTerm, pagina: 1, tam: tamNum }), { priority: 'interactive' });
          run.pages_completed += 1;
          const firstItems = Array.isArray(firstData?.items) ? firstData.items : [];
          totalFromApi = Number(firstData?.total) || 0;
          run.total_reported = totalFromApi;
          apiPageSize = firstItems.length > 0 ? firstItems.length : tamNum;
          collected.push(...firstItems.map(item => ({ ...item, __matched_termo: searchTerm })));
          if (firstItems.length === 0) {
            run.stop_reason = 'empty_page';
          }
          let page = 2;
          while (!run.stop_reason && page <= maxPages && ((page - 1) * apiPageSize) < totalFromApi) {
            run.pages_requested += 1;
            const nextData = await withPncpGate(() => fetchPncpSearchStable({ ...baseParams, q: searchTerm, pagina: page, tam: tamNum }), { priority: 'interactive' });
            run.pages_completed += 1;
            const nextItems = Array.isArray(nextData?.items) ? nextData.items : [];
            if (nextItems.length === 0) {
              run.stop_reason = 'empty_page';
              break;
            }
            collected.push(...nextItems.map(item => ({ ...item, __matched_termo: searchTerm })));
            if (nextItems.length < apiPageSize) {
              run.stop_reason = 'short_page';
              break;
            }
            page += 1;
          }
          if (!run.stop_reason) {
            run.stop_reason = collected.length >= totalFromApi ? 'total_reached' : 'max_pages';
          }
          return { items: collected, total: totalFromApi, run };
        } catch (err) {
          console.error(`Erro buscando termo "${searchTerm}":`, err.message);
          run.errors.push(err.message);
          run.stop_reason = 'error';
          return { items: collected, total: totalFromApi, run };
        } finally {
          run.items_collected = collected.length;
          run.duration_ms = Date.now() - startedAt;
        }
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
          return fetchMultiplePages(term, maxPagesPerSearch, term === qText ? 'original' : 'entity_combined');
        });
        const results = await Promise.all(searchPromises);
        termRuns.push(...results.map(result => result.run).filter(Boolean));

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
            const itemId = getPncpRawItemKey(item);
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
        const firstData = await withPncpGate(() => fetchPncpSearchStable({ ...baseParams, q: effectiveSearchTerm, pagina: 1, tam: tamNum }), { priority: 'interactive' });
        const firstItems = Array.isArray(firstData?.items) ? firstData.items : [];
        const totalFromApi = Number(firstData?.total) || 0;
        const apiPageSize = firstItems.length > 0 ? firstItems.length : 10;

        const startOffset = (paginaNum - 1) * tamNum;
        let apiPage = Math.floor(startOffset / apiPageSize) + 1;
        const offsetInFirstPage = startOffset % apiPageSize;
        const fetched = [];

        const pageData = apiPage === 1
          ? firstData
          : await withPncpGate(() => fetchPncpSearchStable({ ...baseParams, q: effectiveSearchTerm, pagina: apiPage, tam: tamNum }), { priority: 'interactive' });
        const pageItems = Array.isArray(pageData?.items) ? pageData.items : [];
        fetched.push(...pageItems.slice(offsetInFirstPage));

        while (fetched.length < tamNum && (startOffset + fetched.length) < totalFromApi) {
          apiPage += 1;
          const nextData = await withPncpGate(() => fetchPncpSearchStable({ ...baseParams, q: effectiveSearchTerm, pagina: apiPage, tam: tamNum }), { priority: 'interactive' });
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
        termRuns.push({
          ...createTermRun(effectiveSearchTerm, 'original', { tam: tamNum }),
          pages_requested: apiPage,
          pages_completed: apiPage,
          total_reported: totalFromApi,
          items_collected: allItems.length,
          stop_reason: fetched.length >= tamNum ? 'page_window_complete' : 'total_reached',
        });
      }
    }

    // BUSCA SUPLEMENTAR: quando UASG está ativo, consultar /v1/contratacoes/publicacao
    // que suporta codigoUnidadeOrgao nativamente. A API /api/search/ não indexa UASG
    // como campo filtrável e pode não retornar itens por diferença de terminologia
    // (ex: busca "drone" não encontra "aeronaves remotamente pilotadas").
    if (entityQuerySeed && /^\d{5,6}$/.test(entityQuerySeed)) {
      const consultaRun = createTermRun(entityQuerySeed, 'pncp_consulta_uasg', {
        endpoint: 'v1/contratacoes/publicacao',
        tam: 50,
      });
      const consultaStartedAt = Date.now();
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
          consultaRun.pages_requested += 1;
          const data = await withPncpGate(() => fetchPncp('v1/contratacoes/publicacao', {
            codigoUnidadeOrgao: entityQuerySeed,
            dataInicial: fmtDate(doisAnosAtras),
            dataFinal: fmtDate(seisM),
            pagina: consultaPage,
            tamanhoPagina: consultaPageSize,
          }), { priority: 'interactive' });
          consultaRun.pages_completed += 1;
          const items = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
          if (items.length === 0) {
            consultaRun.stop_reason = 'empty_page';
            break;
          }
          consultaRawItems.push(...items);
          consultaHasMore = items.length >= consultaPageSize;
          if (!consultaHasMore) {
            consultaRun.stop_reason = 'short_page';
          }
          consultaPage++;
        }
        if (!consultaRun.stop_reason) {
          consultaRun.stop_reason = consultaPage > maxConsultaPages ? 'max_pages' : 'total_reached';
        }
        consultaRun.items_collected = consultaRawItems.length;

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
            if (mappedStatus && mappedStatus !== 'todos' && !shouldApplyReceivingProposalLocally) {
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
            allItems.push(mapPncpConsultaContratacaoToSearchItem(item, qText || entityQuerySeed, { __from_consulta_uasg: true }));
          }

          if (addedCount > 0) {
            console.log(`[PNCP Contratações UASG ${entityQuerySeed}] +${addedCount} itens adicionados. Total: ${allItems.length}`);
          }
        }
      } catch (err) {
        console.error(`[PNCP Contratações UASG] Erro ao buscar UASG ${entityQuerySeed}:`, err.message);
        consultaRun.errors.push(err.message);
        consultaRun.stop_reason = 'error';
      } finally {
        consultaRun.duration_ms = Date.now() - consultaStartedAt;
        termRuns.push(consultaRun);
      }
    }

    if (modo_disputa_id) {
      const detailedItems = await mapWithConcurrency(allItems, 3, async (item) => {
        const ids = extractPncpCompraIdentifiers(item);
        const detalhe = await getPncpCompraDetalhe(ids.cnpj, ids.ano, ids.sequencial, { priority: 'interactive' });
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
      });

      // Mantém itens cujo modo de disputa é desconhecido (detalhe indisponível/rate limit)
      // em vez de descartá-los silenciosamente; a UI pode exibir "n/d".
      allItems = detailedItems.filter(item => {
        if (!item?.modo_disputa_id) {
          item.modo_disputa_unresolved = true;
          return true;
        }
        return String(item.modo_disputa_id) === String(modo_disputa_id);
      });
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
        const ids = extractPncpCompraIdentifiers(item);
        const enrichment = await getPncpCompraEnrichment(ids.cnpj, ids.ano, ids.sequencial, qText, { priority: 'interactive' });
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
          situacao_id: item?.situacao_id || enrichment.situacao_id,
          situacao_nome: item?.situacao_nome || enrichment.situacao_nome,
          data_publicacao_pncp: item?.data_publicacao_pncp || enrichment.data_publicacao_pncp,
          data_inicio_vigencia: item?.data_inicio_vigencia || enrichment.data_inicio_vigencia,
          data_fim_vigencia: item?.data_fim_vigencia || enrichment.data_fim_vigencia,
          total_itens: enrichment.total_itens ?? item?.total_itens ?? null,
          itens_resumo_texto: enrichment.itens_resumo_texto || item?.itens_resumo_texto || '',
          srp: item?.srp ?? enrichment.srp ?? null,
          amparo_legal: item?.amparo_legal || enrichment.amparo_legal || null,
          modo_disputa_id: item?.modo_disputa_id || enrichment.modo_disputa_id || null,
          modo_disputa_nome: item?.modo_disputa_nome || enrichment.modo_disputa_nome || null,
        };
      });
    }

    if (allItems.length > 0) {
      allItems = await fillPncpMissingEstimatedValues(allItems, {
        limit: iaRealmenteUsada ? 140 : Math.max(tamNum, 80),
        delayMs: 300,
        priority: 'interactive',
      });
    }

    allItems = allItems
      .filter(item => {
        if (!iaRealmenteUsada) {
          return true;
        }
        const matchedTermo = item?.__matched_termo;
        if (!matchedTermo || matchedTermo === qText) {
          return pncpItemHasSemanticEvidence(item, qText, termosUsados.slice(1));
        }
        if (!pncpItemHasSemanticEvidence(item, qText, termosUsados.slice(1))) {
          return false;
        }
        const contextOk = isPncpItemRelevantToQuery(item, qText);
        if (!contextOk) {
          return false;
        }

        return true;
      })
      .map(item => normalizePncpItem(item, item.__matched_termo || qText || entityQuerySeed));

    if (shouldApplyReceivingProposalLocally) {
      allItems = allItems.filter(item => isPncpReceivingProposalOpen(item));
    }

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

    const semanticEnabled = String(semantic || '').toLowerCase() !== 'false';
    allItems = allItems.map(item => decoratePncpSearchItem(item, {
      qText,
      positiveTerms: semanticEnabled ? termosUsados : [],
      negativeTerms: termosNegativos,
      contractFocus: contract_focus,
      orgaoFilterRaw,
      unidadeFilterRaw,
    }));

    const getDateSortValue = (item) => new Date(item?.data_publicacao || 0).getTime() || 0;
    // Ordenação por valor: só itens pertinentes (alinhado ao "Valor na lista").
    const getValueSortValue = (item) => {
      const matched = Number(item?.valor_itens_pertinentes);
      if (Number.isFinite(matched) && matched > 0) {
        return matched;
      }
      return -1;
    };

    if (ordenacao === 'relevancia_desc') {
      allItems.sort((a, b) => {
        const byScore = Number(b?.score || 0) - Number(a?.score || 0);
        if (byScore !== 0) return byScore;
        return getDateSortValue(b) - getDateSortValue(a);
      });
    } else if (ordenacao === 'data_asc') {
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
    const hasLocalFilterForPagination = Boolean(normalizedOrgaoTextFilter || normalizedUnidadeTextFilter || shouldApplyReceivingProposalLocally);
    if (iaRealmenteUsada || hasLocalFilterForPagination) {
      totalItems = allItems.length;
    }
    const startIndex = (paginaNum - 1) * tamNum;
    let paginatedItems = (iaRealmenteUsada || hasLocalFilterForPagination)
      ? allItems.slice(startIndex, startIndex + tamNum)
      : allItems;
    // Garante valores/situação/prazo na janela visível (cache de 6h torna
    // páginas quentes instantâneas; o gate limita a pressão sobre o PNCP).
    if (paginatedItems.length > 0) {
      paginatedItems = await fillValuesOnNormalizedPncpItems(paginatedItems, {
        limit: Math.min(paginatedItems.length, Math.max(tamNum, 20)),
        rateLimitWaitMs: 8000,
      });
    }
    const summary = createPncpSearchSummary(allItems);
    const pageSummary = createPncpSearchSummary(paginatedItems);
    const queryPlan = {
      query: qText,
      entity_seed: entityQuerySeed || null,
      status_requested: mappedStatus || null,
      pncp_status_sent: baseParams.status || null,
      local_filters: {
        receiving_proposal: shouldApplyReceivingProposalLocally,
        orgao: orgaoFilterRaw || null,
        unidade: unidadeFilterRaw || null,
        modo_disputa_id: modo_disputa_id || null,
        contract_focus: contract_focus || 'aquisicao',
      },
      terms: termosUsados,
      negative_terms: termosNegativos,
      ai: {
        requested: iaForcada,
        used: iaRealmenteUsada,
        source: iaRealmenteUsada ? fonteIA : null,
        skipped_reason: iaForcada && !iaRealmenteUsada
          ? (queryLooksSpecific ? 'consulta_especifica' : hasEntityOnlySearch ? 'busca_por_entidade' : 'sem_termo')
          : null,
      },
      term_runs: termRuns,
      mode: iaRealmenteUsada ? 'fast_sync' : 'sync',
      deep_search_available: iaRealmenteUsada,
      cache_hit: false,
    };

    const responsePayload = {
      items: paginatedItems,
      total: totalItems,
      pagina: paginaNum,
      tamanhoPagina: tamNum,
      totalPaginas: Math.ceil(totalItems / tamNum) || 1,
      termosUsados: iaRealmenteUsada ? termosUsados : [qText || entityQuerySeed || ''],
      termosNegativos: termosNegativos,
      fonteIA: iaRealmenteUsada ? fonteIA : null,
      iaDesativadaPorConsultaEspecifica: iaForcada && !iaRealmenteUsada && isSpecificNoticeIdentifierQuery(qText),
      summary,
      pageSummary,
      query_plan: queryPlan,
      diagnostics: {
        semantic: semanticEnabled,
        aiRequested: iaForcada,
        aiUsed: iaRealmenteUsada,
        aiSkippedReason: iaForcada && !iaRealmenteUsada
          ? (queryLooksSpecific ? 'consulta_especifica' : hasEntityOnlySearch ? 'busca_por_entidade' : 'sem_termo')
          : null,
        candidate_count: allItems.length,
        sources: {
          pncp_search: allItems.filter(item => item.source === 'pncp_search').length,
          pncp_consulta: allItems.filter(item => item.source === 'pncp_consulta').length,
        },
      },
    };
    PNCP_SEARCH_RESPONSE_CACHE.set(pncpSearchCacheKey, { payload: responsePayload, timestamp: Date.now() });
    res.json(responsePayload);
  } catch (error) {
    console.error('Error searching PNCP:', error);
    res.status(502).json({ error: 'Erro ao buscar licitações no PNCP', details: error.message });
  }
});

// Opções de status disponíveis para busca
// Balanceador global adaptativo do PNCP.
// O PNCP NÃO publica cota fixa; na prática responde 429 / reseta conexão quando
// o ritmo sobe. Por isso: 1 request por vez, gap generoso, freia ao menor sinal
// e só acelera de novo após sequência estável de sucesso.
const PNCP_GATE = {
  active: 0,
  // Filas por prioridade: interactive (usuário esperando na tela) fura a fila;
  // sync (watchlists/syncs agendados) no meio; bulk (deep jobs, PCA, backfill)
  // só roda com o gate saudável e orçamento folgado.
  queues: { interactive: [], sync: [], bulk: [] },
  max: 1,
  gapMs: 950,
  gapMsMin: 700,
  gapMsMax: 15_000,
  gapMsBase: 950,
  last: 0,
  successStreak: 0,
  failStreak: 0,
  totalOk: 0,
  totalThrottle: 0,
  pausedUntil: 0,
  lastThrottleAt: 0,
  lastHealAt: 0,
  // Orçamento horário agregado (token bucket): dosa o VOLUME total, não só o
  // ritmo. bulk para de consumir com <30% restante; sync com <10%; o resto
  // fica reservado para o uso interativo.
  budget: {
    capacity: Math.max(300, Number(process.env.PNCP_HOURLY_BUDGET) || 1500),
    tokens: Math.max(300, Number(process.env.PNCP_HOURLY_BUDGET) || 1500),
    lastRefill: Date.now(),
  },
};

const refillPncpBudget = () => {
  const b = PNCP_GATE.budget;
  const now = Date.now();
  if (now <= b.lastRefill) return;
  b.tokens = Math.min(b.capacity, b.tokens + ((now - b.lastRefill) * b.capacity) / 3_600_000);
  b.lastRefill = now;
};

const isPncpGateDegraded = () => PNCP_GATE.gapMs >= 4000 || PNCP_GATE.failStreak >= 2;

/**
 * Cura passiva do gate: sem request de sucesso o failStreak/gap nunca baixavam e
 * bulk ficava bloqueado para sempre (deadlock — UI só faz 304 local, não PNCP).
 */
const healPncpGatePassive = () => {
  const now = Date.now();
  if (now < PNCP_GATE.pausedUntil) return;
  if (PNCP_GATE.failStreak <= 0 && PNCP_GATE.gapMs <= PNCP_GATE.gapMsBase) return;
  const sinceThrottle = PNCP_GATE.lastThrottleAt
    ? now - PNCP_GATE.lastThrottleAt
    : Number.POSITIVE_INFINITY;
  // Só cura depois de um tempo sem novo throttle (pausa planejada + folga).
  if (Number.isFinite(sinceThrottle) && sinceThrottle < 90_000) return;
  if (PNCP_GATE.lastHealAt && now - PNCP_GATE.lastHealAt < 20_000) return;
  PNCP_GATE.lastHealAt = now;
  if (PNCP_GATE.failStreak > 0) {
    PNCP_GATE.failStreak = Math.max(0, PNCP_GATE.failStreak - 1);
  }
  if (PNCP_GATE.gapMs > PNCP_GATE.gapMsBase) {
    PNCP_GATE.gapMs = Math.max(PNCP_GATE.gapMsBase, Math.round(PNCP_GATE.gapMs * 0.82));
    console.log(
      `[PNCP Gate] heal passivo → gap=${PNCP_GATE.gapMs}ms failStreak=${PNCP_GATE.failStreak}`
    );
  }
};

const canRunPncpPriority = (priority) => {
  refillPncpBudget();
  healPncpGatePassive();
  const b = PNCP_GATE.budget;
  if (priority === 'interactive') return b.tokens >= 1;
  if (priority === 'bulk') {
    // Enquanto a pausa global (429/reset) está ativa, bulk não roda.
    if (Date.now() < PNCP_GATE.pausedUntil) return false;
    // Degradado (gap alto / failStreak) NÃO bloqueia mais o bulk: só deixa lento
    // (gapMs). Bloquear criava deadlock — sem sucesso PNCP o gate nunca curava.
    // Reserva de orçamento: bulk só com >25% (antes 30%) para interactive ainda ter folga.
    return b.tokens > b.capacity * 0.25;
  }
  return b.tokens > b.capacity * 0.1; // sync
};

const hasHigherPncpPriorityWaiter = (priority) => {
  if (priority === 'interactive') return false;
  if (priority === 'sync') return PNCP_GATE.queues.interactive.length > 0;
  return PNCP_GATE.queues.interactive.length > 0 || PNCP_GATE.queues.sync.length > 0;
};

const getPncpGateSnapshot = () => ({
  gap_ms: PNCP_GATE.gapMs,
  max_concurrent: PNCP_GATE.max,
  paused_until: PNCP_GATE.pausedUntil || null,
  paused_for_ms: Math.max(0, PNCP_GATE.pausedUntil - Date.now()),
  success_streak: PNCP_GATE.successStreak,
  fail_streak: PNCP_GATE.failStreak,
  total_ok: PNCP_GATE.totalOk,
  total_throttle: PNCP_GATE.totalThrottle,
  queue_len: PNCP_GATE.queues.interactive.length + PNCP_GATE.queues.sync.length + PNCP_GATE.queues.bulk.length,
  queue_by_priority: {
    interactive: PNCP_GATE.queues.interactive.length,
    sync: PNCP_GATE.queues.sync.length,
    bulk: PNCP_GATE.queues.bulk.length,
  },
  budget_tokens: Math.round(PNCP_GATE.budget.tokens),
  budget_capacity: PNCP_GATE.budget.capacity,
  active: PNCP_GATE.active,
});

const notePncpSuccess = () => {
  PNCP_GATE.successStreak += 1;
  PNCP_GATE.failStreak = 0;
  PNCP_GATE.totalOk += 1;
  // Acelera devagar: só após 12 sucessos seguidos, e nunca abaixo do mínimo.
  if (PNCP_GATE.successStreak >= 12 && PNCP_GATE.gapMs > PNCP_GATE.gapMsMin) {
    PNCP_GATE.gapMs = Math.max(PNCP_GATE.gapMsMin, Math.round(PNCP_GATE.gapMs * 0.9));
    PNCP_GATE.successStreak = 0;
    console.log(`[PNCP Gate] ritmo ok → gap ${PNCP_GATE.gapMs}ms`);
  }
};

notePncpThrottle = (reason = 'throttle', pauseMs = null) => {
  PNCP_GATE.failStreak += 1;
  PNCP_GATE.successStreak = 0;
  PNCP_GATE.totalThrottle += 1;
  PNCP_GATE.lastThrottleAt = Date.now();
  PNCP_GATE.max = 1;
  // Freia o gap (backoff exponencial suave).
  PNCP_GATE.gapMs = Math.min(
    PNCP_GATE.gapMsMax,
    Math.max(PNCP_GATE.gapMsBase, Math.round((PNCP_GATE.gapMs || PNCP_GATE.gapMsBase) * 1.75))
  );
  // curl 56 / Recv failure: PNCP costuma precisar de pausa mais longa que um 429 curto.
  const reasonText = String(reason || '').toLowerCase();
  const isHardReset = /curl exit 56|recv failure|econnreset|socket hang|empty reply|curl exit 52/.test(reasonText);
  const defaultPause = Math.min(6 * 60 * 1000, 50_000 * Math.min(PNCP_GATE.failStreak, 5));
  const hardPause = Math.min(8 * 60 * 1000, Math.max(120_000, defaultPause));
  const pause = Number.isFinite(pauseMs)
    ? pauseMs
    : (isHardReset ? hardPause : defaultPause);
  PNCP_GATE.pausedUntil = Math.max(PNCP_GATE.pausedUntil, Date.now() + pause);
  if (isHardReset && PNCP_GATE.gapMs < 2000) {
    PNCP_GATE.gapMs = Math.min(PNCP_GATE.gapMsMax, Math.max(2000, PNCP_GATE.gapMs));
  }
  // Alinha o pauser de detalhes com o gate global.
  pncpDetalheRateLimitedUntil = Math.max(pncpDetalheRateLimitedUntil, PNCP_GATE.pausedUntil);
  console.warn(
    `[PNCP Gate] throttle (${String(reason).slice(0, 100)}) → gap=${PNCP_GATE.gapMs}ms pause=${Math.round(pause / 1000)}s ` +
    `(failStreak=${PNCP_GATE.failStreak})`
  );
};

const isPncpBulkDeferredError = (error) => {
  if (!error) return false;
  if (error.code === 'PNCP_BULK_DEFERRED') return true;
  return /PNCP bulk (budget deferred|gate wait)/i.test(String(error.message || ''));
};

const waitForPncpGateSlot = async (priority = 'sync') => {
  const waitStarted = Date.now();
  for (;;) {
    // Espera pausa global (429/reset recente) sem spamar a API.
    while (Date.now() < PNCP_GATE.pausedUntil) {
      // Bulk: não segura o heavy slot por minutos em pause — devolve e agenda retomada.
      if (priority === 'bulk' && Date.now() - waitStarted > PNCP_BULK_GATE_WAIT_MAX_MS) {
        const err = new Error('PNCP bulk gate wait exceeded (paused)');
        err.code = 'PNCP_BULK_DEFERRED';
        throw err;
      }
      const left = PNCP_GATE.pausedUntil - Date.now();
      await sleep(Math.min(4000, Math.max(200, left)));
    }
    // Dosagem por classe: bulk/sync aguardam quando o gate está degradado ou o
    // orçamento horário está na reserva; interactive só espera repor tokens.
    if (!canRunPncpPriority(priority)) {
      if (priority === 'bulk' && Date.now() - waitStarted > PNCP_BULK_GATE_WAIT_MAX_MS) {
        const err = new Error('PNCP bulk budget deferred');
        err.code = 'PNCP_BULK_DEFERRED';
        throw err;
      }
      await sleep(priority === 'interactive' ? 500 : 3000);
      continue;
    }
    if (PNCP_GATE.active < PNCP_GATE.max && !hasHigherPncpPriorityWaiter(priority)) {
      return;
    }
    if (priority === 'bulk' && Date.now() - waitStarted > PNCP_BULK_GATE_WAIT_MAX_MS) {
      const err = new Error('PNCP bulk gate wait exceeded (queue)');
      err.code = 'PNCP_BULK_DEFERRED';
      throw err;
    }
    await new Promise(resolve => PNCP_GATE.queues[priority].push(resolve));
  }
};

const withPncpGate = async (fn, { priority = 'sync' } = {}) => {
  await waitForPncpGateSlot(priority);
  PNCP_GATE.active += 1;
  try {
    // Jitter no gap: cadência fixa parece bot para o WAF do PNCP.
    const pacedGap = Math.round(PNCP_GATE.gapMs * (0.85 + Math.random() * 0.5));
    const wait = PNCP_GATE.last + pacedGap - Date.now();
    if (wait > 0) await sleep(wait);
    // Re-checa pausa após o gap (outro worker pode ter tomado 429).
    while (Date.now() < PNCP_GATE.pausedUntil) {
      await sleep(Math.min(4000, Math.max(200, PNCP_GATE.pausedUntil - Date.now())));
    }
    PNCP_GATE.last = Date.now();
    refillPncpBudget();
    PNCP_GATE.budget.tokens = Math.max(0, PNCP_GATE.budget.tokens - 1);
    const result = await fn();
    notePncpSuccess();
    return result;
  } catch (error) {
    if (isPncpThrottleError(error)) {
      notePncpThrottle(error.message || 'error');
    }
    throw error;
  } finally {
    PNCP_GATE.active -= 1;
    const next = PNCP_GATE.queues.interactive.shift()
      || PNCP_GATE.queues.sync.shift()
      || PNCP_GATE.queues.bulk.shift();
    if (next) next();
  }
};

// Serializa os varredores pesados (deep job, PCA, sync de contratos): rodar
// mais de um ao mesmo tempo foi o que derrubou a cota do PNCP na prática.
const PNCP_HEAVY_JOB = { current: null, queue: [], since: 0 };
const getPncpHeavyJobSnapshot = () => ({
  current: PNCP_HEAVY_JOB.current,
  queue_len: PNCP_HEAVY_JOB.queue.length,
  held_for_ms: PNCP_HEAVY_JOB.current && PNCP_HEAVY_JOB.since
    ? Math.max(0, Date.now() - PNCP_HEAVY_JOB.since)
    : 0,
});
const withPncpHeavyJobSlot = async (name, work) => {
  if (PNCP_HEAVY_JOB.current) {
    console.log(`[PNCP Heavy] "${name}" aguardando "${PNCP_HEAVY_JOB.current}" terminar`);
    await new Promise(resolve => PNCP_HEAVY_JOB.queue.push(resolve));
  }
  PNCP_HEAVY_JOB.current = name;
  PNCP_HEAVY_JOB.since = Date.now();
  try {
    return await work();
  } finally {
    PNCP_HEAVY_JOB.current = null;
    PNCP_HEAVY_JOB.since = 0;
    const next = PNCP_HEAVY_JOB.queue.shift();
    if (next) next();
  }
};

/** Orçamento de enriquecimento (valores) conforme o ritmo atual do gate. */
const getPncpEnrichBudget = () => {
  const paused = Date.now() < PNCP_GATE.pausedUntil || Date.now() < pncpDetalheRateLimitedUntil;
  if (paused) return { limit: 0, delayMs: 0, rateLimitWaitMs: 0, paused: true };
  if (PNCP_GATE.gapMs >= 4000 || PNCP_GATE.failStreak >= 2) {
    return { limit: 12, delayMs: 450, rateLimitWaitMs: 0, paused: false };
  }
  if (PNCP_GATE.gapMs >= 1500) {
    return { limit: 25, delayMs: 250, rateLimitWaitMs: 4000, paused: false };
  }
  return { limit: 45, delayMs: 150, rateLimitWaitMs: 8000, paused: false };
};

const getPncpSearchJobArchiveAt = (startedAt) => {
  if (!startedAt) return null;
  const base = startedAt instanceof Date ? startedAt.getTime() : Date.parse(startedAt);
  if (!Number.isFinite(base)) return null;
  return new Date(base + PNCP_SEARCH_JOB_ARCHIVE_DAYS * 24 * 60 * 60 * 1000);
};

const getPncpSearchJobDaysUntilArchive = (startedAt, now = Date.now()) => {
  const archiveAt = getPncpSearchJobArchiveAt(startedAt);
  if (!archiveAt) return null;
  const msLeft = archiveAt.getTime() - now;
  return Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
};

const isPncpSearchJobArchivable = (job) => {
  if (!job || job.watchlist_id) return false;
  const archiveAt = getPncpSearchJobArchiveAt(job.started_at);
  if (!archiveAt) return false;
  return Date.now() >= archiveAt.getTime();
};

const cleanupPncpDeepJobs = () => {
  const now = Date.now();
  for (const [id, job] of PNCP_DEEP_SEARCH_JOBS.entries()) {
    if (now - Number(job.updated_at || job.started_at || 0) > PNCP_DEEP_SEARCH_JOB_TTL) {
      // Não limpa se ainda há worker vivo (job longo legítimo).
      if (PNCP_DEEP_SEARCH_WORKERS.has(id)) continue;
      PNCP_DEEP_SEARCH_JOBS.delete(id);
      PNCP_DEEP_SEARCH_CANCELLED.delete(id);
      PNCP_DEEP_SEARCH_WORKERS.delete(id);
    }
  }
  // Buscas antigas que não viraram watchlist somem do banco depois de 7 dias
  // (desde a criação/started_at — reexecuções diárias não estendem o prazo).
  pool.query(
    `DELETE FROM ${PNCP_SEARCH_JOBS_TABLE}
      WHERE watchlist_id IS NULL
        AND started_at < NOW() - ($1::int * INTERVAL '1 day')`,
    [PNCP_SEARCH_JOB_ARCHIVE_DAYS]
  ).catch(() => {});
};

const normalizePncpSearchJobRow = (row) => {
  if (!row) return null;
  const archiveAt = getPncpSearchJobArchiveAt(row.started_at);
  const daysUntilArchive = row.watchlist_id ? null : getPncpSearchJobDaysUntilArchive(row.started_at);
  const whatsappNumbers = parseWatchlistPhones(row.whatsapp_number);
  const whatsappEnabled = (
    row.whatsapp_enabled === true
    || row.whatsapp_enabled === 't'
    || row.whatsapp_enabled === 1
  ) && whatsappNumbers.length > 0;
  const whatsappNumber = whatsappNumbers.length ? whatsappNumbers.join(',') : null;
  const whatsappMinScore = normalizeWhatsappMinScore(row.whatsapp_min_score);
  return {
    id: row.id,
    account_id: row.account_id,
    status: row.status,
    nome: row.nome,
    filters: row.filters || {},
    terms: row.terms || [],
    negative_terms: row.negative_terms || [],
    accepted_positive_terms: row.accepted_positive_terms || [],
    accepted_negative_terms: row.accepted_negative_terms || [],
    suggested_positive_terms: row.suggested_positive_terms || [],
    suggested_negative_terms: row.suggested_negative_terms || [],
    progress: row.progress || {},
    term_runs: row.term_runs || [],
    items: row.items || [],
    summary: row.summary || null,
    query_plan: row.query_plan || null,
    total: Number(row.total || 0),
    error: row.error || null,
    watchlist_id: row.watchlist_id || null,
    // Assinatura = watchlist 1:1 ligada ao card (alertas WhatsApp).
    whatsapp_enabled: Boolean(whatsappEnabled),
    whatsapp_number: whatsappNumber,
    whatsapp_numbers: whatsappNumbers,
    whatsapp_min_score: whatsappMinScore,
    whatsapp_score_band: whatsappMinScoreToBand(whatsappMinScore),
    alerts_enabled: Boolean(whatsappEnabled),
    started_at: row.started_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
    archive_at: archiveAt ? archiveAt.toISOString() : null,
    days_until_archive: daysUntilArchive,
    archive_days: PNCP_SEARCH_JOB_ARCHIVE_DAYS,
  };
};

const stableJsonStringify = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const normalizePncpJobSignatureParts = ({ filters = {}, terms = [], negativeTerms = [] } = {}) => ({
  filters: Object.fromEntries(
    Object.entries(filters || {})
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
      .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
      .sort(([a], [b]) => a.localeCompare(b))
  ),
  terms: mergeUniqueTerms(terms).map(term => normalizeSearchText(term).trim()).filter(Boolean),
  negative_terms: mergeUniqueTerms(negativeTerms).map(term => normalizeSearchText(term).trim()).filter(Boolean),
});

const buildPncpJobSignature = (parts) => crypto
  .createHash('sha1')
  .update(stableJsonStringify(normalizePncpJobSignatureParts(parts)))
  .digest('hex');

const persistPncpDeepJob = async (job) => {
  if (!job?.id || !job?.account_id) return;
  await pool.query(
    `
      UPDATE ${PNCP_SEARCH_JOBS_TABLE}
         SET status = $2,
             progress = $3::jsonb,
             term_runs = $4::jsonb,
             items = $5::jsonb,
             summary = $6::jsonb,
             query_plan = $7::jsonb,
             total = $8,
             error = $9,
             terms = $10,
             negative_terms = $11,
             filters = COALESCE($12::jsonb, filters),
             nome = COALESCE($13, nome),
             updated_at = NOW(),
             completed_at = CASE
               WHEN $2 IN ('completed','failed','cancelled') THEN NOW()
               WHEN $2 IN ('queued','running','paused_rate_limit','cancelling') THEN NULL
               ELSE completed_at
             END
       WHERE id = $1
    `,
    [
      job.id,
      job.status || 'queued',
      JSON.stringify(job.progress || {}),
      JSON.stringify(job.term_runs || []),
      JSON.stringify(job.items || []),
      JSON.stringify(job.summary || null),
      JSON.stringify(job.query_plan || null),
      Number(job.total || 0),
      job.error || null,
      Array.isArray(job.terms) ? job.terms : [],
      Array.isArray(job.negative_terms) ? job.negative_terms : [],
      job.filters && typeof job.filters === 'object' ? JSON.stringify(job.filters) : null,
      job.nome ? String(job.nome).slice(0, 160) : null,
    ]
  ).catch(error => console.warn('[PNCP Search Job] persist falhou:', error.message));
};

const loadPncpDeepJob = async (jobId, accountId = null) => {
  const params = [jobId];
  let sql = `
    SELECT j.*, w.whatsapp_enabled, w.whatsapp_number, w.whatsapp_min_score
      FROM ${PNCP_SEARCH_JOBS_TABLE} j
      LEFT JOIN ${EDITAL_WATCHLIST_TABLE} w ON w.id = j.watchlist_id
     WHERE j.id = $1`;
  if (accountId) {
    params.push(accountId);
    sql += ' AND j.account_id = $2';
  }
  const { rows } = await pool.query(sql, params);
  return normalizePncpSearchJobRow(rows[0]);
};

const isPncpDeepSearchWorkerAlive = (jobId) => PNCP_DEEP_SEARCH_WORKERS.has(jobId);

const isPncpDeepSearchJobStale = (job, now = Date.now()) => {
  if (!job) return true;
  const updated = Number(job.updated_at || 0);
  const ts = Number.isFinite(updated) && updated > 0
    ? updated
    : (Date.parse(job.updated_at) || 0);
  if (!ts) return true;
  return (now - ts) > PNCP_DEEP_SEARCH_STALE_MS;
};

const startPersistedPncpSearchJob = async (jobOrId, opts = {}) => {
  const { force = false } = opts;
  const job = typeof jobOrId === 'string'
    ? await loadPncpDeepJob(jobOrId)
    : jobOrId;
  if (!job?.id || !job?.account_id) return false;
  if (!force && ['completed', 'cancelled', 'failed'].includes(job.status)) return false;
  const current = PNCP_DEEP_SEARCH_JOBS.get(job.id);
  const workerAlive = isPncpDeepSearchWorkerAlive(job.id);
  const liveStatuses = ['queued', 'running', 'cancelling'];
  // Só reusa se há worker de verdade e progresso recente. Antes: status queued no
  // map sem worker = zombie eterno (return true e nada rodava).
  if (
    !force
    && current
    && liveStatuses.includes(current.status)
    && workerAlive
    && !isPncpDeepSearchJobStale(current)
  ) {
    return true;
  }
  const needsCancelRestart = Boolean(
    (force && workerAlive)
    || (current && liveStatuses.includes(current.status) && (!workerAlive || isPncpDeepSearchJobStale(current)))
  );
  const prevWorker = workerAlive ? PNCP_DEEP_SEARCH_WORKERS.get(job.id) : null;
  if (needsCancelRestart) {
    console.warn(
      `[PNCP Search Job] restart ${job.id} status=${current?.status || job.status} ` +
      `worker=${workerAlive ? 'alive' : 'dead'} force=${force} stale=${current ? isPncpDeepSearchJobStale(current) : true}`
    );
    PNCP_DEEP_SEARCH_CANCELLED.add(job.id);
    // Libera a chave do map para o novo worker registrar; o antigo sai no finally.
    PNCP_DEEP_SEARCH_WORKERS.delete(job.id);
  }
  // preserveResults: default true (reexecução diária/botão/retomada).
  // Quem precisa limpar (troca de filtros) passa preserveResults: false.
  const preserveResults = Object.prototype.hasOwnProperty.call(opts, 'preserveResults')
    ? Boolean(opts.preserveResults)
    : (job.preserve_results !== false);
  // incrementalRefresh: recoleta diária — só sonda primeiras páginas (não re-lê universo).
  const incrementalRefresh = Boolean(opts.incrementalRefresh);
  const nextJob = {
    ...job,
    status: 'queued',
    error: null,
    preserve_results: preserveResults,
    incremental_refresh: incrementalRefresh,
    // Não reseta started_at: o countdown de arquivamento conta desde a criação.
    started_at: job.started_at ? new Date(job.started_at).getTime() : Date.now(),
    updated_at: Date.now(),
    progress: {
      ...(job.progress || {}),
      rate_limited: false,
      waiting_gate: false,
      waiting_for_heavy: PNCP_HEAVY_JOB.current || null,
      heavy: getPncpHeavyJobSnapshot(),
      gate: getPncpGateSnapshot(),
      incremental_refresh: incrementalRefresh,
      incremental_pages: incrementalRefresh ? PNCP_DEEP_INCREMENTAL_PAGES : null,
    },
  };
  PNCP_DEEP_SEARCH_JOBS.set(job.id, nextJob);
  await persistPncpDeepJob(nextJob);

  const kick = async () => {
    if (prevWorker) {
      try {
        await Promise.race([
          Promise.resolve(prevWorker).catch(() => null),
          sleep(2500),
        ]);
      } catch (_) { /* ignore */ }
    }
    PNCP_DEEP_SEARCH_CANCELLED.delete(job.id);
    return runPncpDeepSearchJob(job.id);
  };
  setImmediate(() => {
    kick().catch((err) => {
      console.warn(`[PNCP Search Job] worker ${job.id} falhou ao iniciar:`, err.message);
    });
  });
  return true;
};

// Reexecuta buscas ativas (sem watchlist, ainda no prazo de 7 dias) mantendo resultados.
const runDailyPncpSearchJobRefresh = async ({ limit = 8 } = {}) => {
  cleanupPncpDeepJobs();
  const { rows } = await pool.query(
    `
      SELECT *
        FROM ${PNCP_SEARCH_JOBS_TABLE}
       WHERE watchlist_id IS NULL
         AND status IN ('completed', 'failed')
         AND started_at >= NOW() - ($1::int * INTERVAL '1 day')
         AND (completed_at IS NULL OR completed_at <= NOW() - INTERVAL '18 hours')
       ORDER BY completed_at ASC NULLS FIRST, updated_at ASC
       LIMIT $2
    `,
    [PNCP_SEARCH_JOB_ARCHIVE_DAYS, Math.max(1, Math.min(20, Number(limit) || 8))]
  );
  let started = 0;
  let skipped = 0;
  for (const row of rows) {
    const job = normalizePncpSearchJobRow(row);
    if (!job?.id) continue;
    if (isPncpSearchJobArchivable(job)) {
      skipped += 1;
      continue;
    }
    const current = PNCP_DEEP_SEARCH_JOBS.get(job.id);
    if (current && ['queued', 'running', 'cancelling', 'paused_rate_limit'].includes(current.status)) {
      skipped += 1;
      continue;
    }
    // incrementalRefresh: NÃO revarre o universo já esgotado — só primeiras páginas.
    const ok = await startPersistedPncpSearchJob(job, {
      force: true,
      preserveResults: true,
      incrementalRefresh: true,
    });
    if (ok) started += 1;
    else skipped += 1;
  }
  return { candidates: rows.length, started, skipped };
};

const schedulePncpSearchResume = (jobId, delayMs = PNCP_RATE_LIMIT_RESUME_DELAY_MS) => {
  if (!jobId) return;
  const existing = PNCP_DEEP_SEARCH_RESUME_TIMERS.get(jobId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(async () => {
    PNCP_DEEP_SEARCH_RESUME_TIMERS.delete(jobId);
    try {
      const job = await loadPncpDeepJob(jobId);
      // paused_rate_limit = pausa planejada; queued sem worker = zombie pós-restart/race.
      if (job && ['paused_rate_limit', 'queued', 'running'].includes(job.status)) {
        await startPersistedPncpSearchJob(job, { force: true, preserveResults: true });
      }
    } catch (error) {
      console.warn('[PNCP Search Job] retomada agendada falhou:', error.message);
    }
  }, Math.max(30_000, Number(delayMs) || PNCP_RATE_LIMIT_RESUME_DELAY_MS));
  PNCP_DEEP_SEARCH_RESUME_TIMERS.set(jobId, timer);
};

const resumePausedPncpSearchJobs = async () => {
  try {
    // Não retoma se o gate ainda está em pausa por 429.
    if (Date.now() < PNCP_GATE.pausedUntil) {
      return;
    }
    const staleMinutes = Math.max(3, Math.ceil(PNCP_DEEP_SEARCH_STALE_MS / 60_000));
    const { rows } = await pool.query(
      `
        SELECT *
          FROM ${PNCP_SEARCH_JOBS_TABLE}
         WHERE (
                status = 'paused_rate_limit'
                AND updated_at <= NOW() - INTERVAL '6 minutes'
               )
            OR (
                status IN ('queued', 'running')
                AND updated_at <= NOW() - ($1::int * INTERVAL '1 minute')
               )
         ORDER BY updated_at ASC
         LIMIT 5
      `,
      [staleMinutes]
    );
    for (const row of rows) {
      if (PNCP_DEEP_SEARCH_RESUME_TIMERS.has(row.id)) continue;
      const mem = PNCP_DEEP_SEARCH_JOBS.get(row.id);
      // Worker vivo e progresso fresco: deixa quieto.
      if (mem && isPncpDeepSearchWorkerAlive(row.id) && !isPncpDeepSearchJobStale(mem)) {
        continue;
      }
      console.log(
        `[PNCP Search Job] recuperando ${row.id} status=${row.status} ` +
        `(updated_at stale / worker=${isPncpDeepSearchWorkerAlive(row.id) ? 'alive' : 'dead'})`
      );
      await startPersistedPncpSearchJob(normalizePncpSearchJobRow(row), {
        force: true,
        preserveResults: true,
      });
    }
  } catch (error) {
    console.warn('[PNCP Search Job] varredura de retomada falhou:', error.message);
  }
};

// Backfill resumível: insiste em valor dos itens pertinentes nos resultados de
// deep jobs recentes (orçamento do passe final / rate limit). Roda no cron de 5 min.
// Critério: falta value_matched — total da licitação sozinho NÃO basta.
const runPncpJobValueBackfill = async ({ limit = 80 } = {}) => {
  if (Date.now() < pncpDetalheRateLimitedUntil || Date.now() < PNCP_GATE.pausedUntil) {
    return { updated: 0, skipped: 'rate_limited', gate: getPncpGateSnapshot() };
  }
  const budget = getPncpEnrichBudget();
  const effectiveLimit = Math.min(limit, Math.max(8, budget.limit || 12));
  const { rows } = await pool.query(
    `
      SELECT r.job_id, r.result_key, r.payload, r.account_id
        FROM ${PNCP_SEARCH_JOB_RESULTS_TABLE} r
        JOIN ${PNCP_SEARCH_JOBS_TABLE} j ON j.id = r.job_id
       WHERE j.updated_at > NOW() - ($1::int * INTERVAL '1 day')
         AND (
           r.value_matched IS NULL
           OR COALESCE(r.value_matched, 0) <= 0
           OR COALESCE((r.payload->>'valor_itens_pertinentes')::numeric, 0) <= 0
         )
       ORDER BY j.updated_at DESC, r.score DESC NULLS LAST
       LIMIT $2
    `,
    [PNCP_SEARCH_JOB_ARCHIVE_DAYS, effectiveLimit]
  );
  let updated = 0;
  let matchedFilled = 0;
  for (const row of rows) {
    if (Date.now() < pncpDetalheRateLimitedUntil || Date.now() < PNCP_GATE.pausedUntil) break;
    if (budget.delayMs > 0 && updated > 0) await sleep(budget.delayMs);
    const item = row.payload || {};
    if (!itemNeedsPncpValueEnrichment(item)) continue;
    const ids = extractPncpCompraIdentifiers(item);
    if (!ids.cnpj || !ids.ano || !ids.sequencial) continue;
    const q = buildPncpEnrichmentQuery(item, item?.matched_termo || '');
    // maxPages maior: insistir em achar itens pertinentes em compras grandes.
    const enrichment = await getPncpCompraEnrichment(ids.cnpj, ids.ano, ids.sequencial, q, { maxPages: 8, priority: 'bulk' });
    if (!enrichment) continue;
    const merged = mergePncpEnrichmentIntoNormalizedItem(item, enrichment);
    const estimated = Number(getPncpTotalEstimatedValue(merged) || 0);
    const matched = Number(merged?.valor_itens_pertinentes || 0);
    // Sem valor de item pertinente ainda: grava o que veio (total/itens) e tenta de novo no próximo ciclo.
    await pool.query(
      `
        UPDATE ${PNCP_SEARCH_JOB_RESULTS_TABLE}
           SET value_estimated = COALESCE($3, value_estimated),
               value_matched = COALESCE($4, value_matched),
               deadline_at = COALESCE($5::timestamp, deadline_at),
               payload = $6::jsonb,
               updated_at = NOW()
         WHERE job_id = $1 AND result_key = $2
      `,
      [
        row.job_id,
        row.result_key,
        estimated > 0 ? estimated : null,
        matched > 0 ? matched : null,
        merged.data_fim_vigencia || null,
        JSON.stringify(merged),
      ]
    ).catch(error => console.warn('[PNCP Backfill] update falhou:', error.message));
    updated += 1;
    if (matched > 0) matchedFilled += 1;
  }
  return { updated, matched_filled: matchedFilled, scanned: rows.length, gate: getPncpGateSnapshot() };
};

// Enriquece a página visível sob demanda (valores vêm do detalhe da compra no PNCP,
// não da /api/search/). Insiste em valor dos itens pertinentes; total sozinho não basta.
// Grava de volta no payload para as próximas aberturas.
const enrichPncpJobResultPage = async (job, items = [], { limit = 25 } = {}) => {
  if (!job?.id || !Array.isArray(items) || !items.length) return items;
  if (Date.now() < pncpDetalheRateLimitedUntil || Date.now() < PNCP_GATE.pausedUntil) return items;
  const budget = getPncpEnrichBudget();
  if (budget.paused || budget.limit <= 0) return items;
  const missing = items.filter(itemNeedsPncpValueEnrichment);
  if (!missing.length) return items;
  const query = String(job?.filters?.q || job?.nome || (job?.terms || [])[0] || '').trim();
  const enriched = await fillValuesOnNormalizedPncpItems(items, {
    limit: Math.min(limit, budget.limit, items.length),
    rateLimitWaitMs: budget.rateLimitWaitMs,
    query,
    maxPages: 8,
    priority: 'interactive',
  });
  const improved = enriched.filter((item, idx) => {
    const beforeItem = itemHasPncpItemValue(items[idx]);
    const afterItem = itemHasPncpItemValue(item);
    // Persistimos se preencheu valor pertinente (é o que entra no "Valor na lista").
    // Também persiste se só ganhou metadados de itens (total_itens) para não re-fetch cego.
    const beforeMeta = Number(items[idx]?.total_itens || 0) > 0;
    const afterMeta = Number(item?.total_itens || 0) > 0;
    return (afterItem && !beforeItem) || (afterMeta && !beforeMeta);
  });
  if (improved.length) {
    await persistPncpJobResults(job, improved);
    // Mantém "Valor na lista" alinhado após enriquecer a página aberta.
    await refreshPncpJobSummaryTotals(job).catch(() => null);
    await persistPncpDeepJob(job).catch(() => null);
  }
  return enriched;
};

const buildDeepSearchItemsSnapshot = async ({
  rawItems,
  qText,
  terms,
  negativeTerms,
  filters,
  mappedStatus,
  shouldApplyReceivingProposalLocally,
  enrichValues = false,
  enrichLimit = 350,
  enrichDelayMs = 120,
}) => {
  const cachedItems = applyCachedPncpEnrichment(rawItems, qText);
  const budget = getPncpEnrichBudget();
  const sourceItems = enrichValues && !budget.paused
    ? await fillPncpMissingEstimatedValues(cachedItems, {
      limit: Math.min(enrichLimit, Math.max(budget.limit * 3, 30)),
      delayMs: Math.max(enrichDelayMs, budget.delayMs || 120),
      rateLimitWaitMs: budget.rateLimitWaitMs,
      query: qText,
      maxPages: 8,
      priority: 'bulk',
    })
    : cachedItems;
  let items = sourceItems.map(item => normalizePncpItem(item, item.__matched_termo || qText));
  if (shouldApplyReceivingProposalLocally) {
    items = items.filter(item => isPncpReceivingProposalOpen(item));
  }
  // Filtro local tolerante de modo de disputa: a API /api/search/ não suporta o
  // parâmetro; itens sem detalhe resolvido (id null) são mantidos e marcados.
  if (filters.modo_disputa_id) {
    items = items.filter(item => {
      const id = item?.modo_disputa?.id;
      if (!id) {
        item.modo_disputa_unresolved = true;
        return true;
      }
      return String(id) === String(filters.modo_disputa_id);
    });
  }
  items = items.map(item => decoratePncpSearchItem(item, {
    qText,
    positiveTerms: terms,
    negativeTerms,
    contractFocus: filters.contract_focus || 'aquisicao',
    orgaoFilterRaw: filters.orgao_cnpj || '',
    unidadeFilterRaw: filters.unidade_codigo || '',
  })).sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0));
  return {
    items,
    summary: createPncpSearchSummary(items),
    query_plan: {
      mode: 'deep_background',
      terms,
      negative_terms: negativeTerms,
      raw_unique_collected: rawItems.length,
      filtered_total: items.length,
      filters_applied: {
        status: mappedStatus || null,
        receiving_proposal_local: shouldApplyReceivingProposalLocally,
        contract_focus: filters.contract_focus || 'aquisicao',
      },
    },
  };
};

const getPncpSearchResultKey = (item) => getPncpRawItemKey(item) || item?.id || item?.numero_controle_pncp || item?.url || item?.item_url || crypto.createHash('sha1').update(JSON.stringify(item || {})).digest('hex');

const clearPncpJobResults = async (jobId) => {
  if (!jobId) return;
  await pool.query(`DELETE FROM ${PNCP_SEARCH_JOB_RESULTS_TABLE} WHERE job_id = $1`, [jobId]).catch(() => {});
};

/**
 * Remove da lista classificada itens cujo prazo de proposta já venceu.
 * Critério alinhado a isPncpReceivingProposalOpen: dia civil em America/Sao_Paulo
 * estritamente anterior a hoje → fora.
 * Não apaga o job; só linhas em pncp_search_job_results. Atualiza total/summary.
 */
const purgeExpiredPncpJobResults = async ({ jobId = null, accountId = null } = {}) => {
  const params = [];
  let scopeSql = '';
  if (jobId) {
    params.push(jobId);
    scopeSql += ` AND r.job_id = $${params.length}::uuid`;
  }
  if (accountId != null) {
    params.push(accountId);
    scopeSql += ` AND r.account_id = $${params.length}`;
  }

  // Data de prazo efetiva: coluna indexada ou campos do payload.
  const effectiveDeadlineSql = `
    COALESCE(
      r.deadline_at,
      NULLIF(r.payload->>'data_fim_vigencia', '')::timestamptz,
      NULLIF(r.payload->>'data_encerramento_proposta', '')::timestamptz,
      NULLIF(r.payload->>'dataEncerramentoProposta', '')::timestamptz,
      NULLIF(r.payload->>'data_envio_proposta_limite', '')::timestamptz
    )
  `;

  const sql = `
    WITH expired AS (
      SELECT r.ctid, r.job_id, r.account_id
        FROM ${PNCP_SEARCH_JOB_RESULTS_TABLE} r
       WHERE true
         ${scopeSql}
         AND (
           -- Prazo (data civil America/Sao_Paulo) já passou
           (
             ${effectiveDeadlineSql} IS NOT NULL
             AND (timezone('America/Sao_Paulo', ${effectiveDeadlineSql}))::date
                 < (timezone('America/Sao_Paulo', NOW()))::date
           )
           -- Última decoração já marcou o item como prazo vencido
           OR COALESCE(r.payload->'prazo_info'->>'urgency', '') = 'expired'
         )
    ),
    deleted AS (
      DELETE FROM ${PNCP_SEARCH_JOB_RESULTS_TABLE} r
       USING expired e
       WHERE r.ctid = e.ctid
      RETURNING r.job_id, r.account_id
    )
    SELECT job_id, account_id, COUNT(*)::int AS removed
      FROM deleted
     GROUP BY job_id, account_id
  `;

  let rows = [];
  try {
    const result = await pool.query(sql, params);
    rows = result.rows || [];
  } catch (error) {
    // Fallback mais simples se cast de data no payload falhar em alguma linha.
    console.warn('[PNCP Job Results] purge expired (sql rico) falhou, fallback:', error.message);
    const fallback = await pool.query(
      `
        WITH deleted AS (
          DELETE FROM ${PNCP_SEARCH_JOB_RESULTS_TABLE} r
           WHERE true
             ${scopeSql}
             AND r.deadline_at IS NOT NULL
             AND (timezone('America/Sao_Paulo', r.deadline_at))::date
                 < (timezone('America/Sao_Paulo', NOW()))::date
          RETURNING r.job_id, r.account_id
        )
        SELECT job_id, account_id, COUNT(*)::int AS removed
          FROM deleted
         GROUP BY job_id, account_id
      `,
      params
    ).catch((err) => {
      console.warn('[PNCP Job Results] purge expired fallback falhou:', err.message);
      return { rows: [] };
    });
    rows = fallback.rows || [];
  }

  let totalRemoved = 0;
  for (const row of rows) {
    const removed = Number(row.removed || 0);
    totalRemoved += removed;
    if (!removed || !row.job_id) continue;
    const mem = PNCP_DEEP_SEARCH_JOBS.get(row.job_id);
    let job = mem || null;
    if (!job) {
      try {
        job = await loadPncpDeepJob(row.job_id, row.account_id || accountId || null);
      } catch (_) {
        job = null;
      }
    }
    if (!job) continue;
    await refreshPncpJobSummaryTotals(job);
    job.progress = {
      ...(job.progress || {}),
      expired_purged_at: new Date().toISOString(),
      expired_purged_last: removed,
    };
    job.updated_at = Date.now();
    if (mem) PNCP_DEEP_SEARCH_JOBS.set(job.id, job);
    await persistPncpDeepJob(job).catch(() => null);
  }

  return {
    removed: totalRemoved,
    jobs_touched: rows.length,
    by_job: rows.map((r) => ({
      job_id: r.job_id,
      account_id: r.account_id,
      removed: Number(r.removed || 0),
    })),
  };
};

/** Varredura diária: limpa vencidos de todos os jobs ainda no prazo de arquivo. */
const runDailyPncpExpiredResultsPurge = async () => {
  const started = Date.now();
  const result = await purgeExpiredPncpJobResults({});
  console.log(
    `[pncp-search-jobs] purge prazos vencidos: removed=${result.removed} ` +
    `jobs=${result.jobs_touched} in ${Date.now() - started}ms`
  );
  return result;
};

// Cap de detalhes/job no reconcile diário de situação (suspensão pós-captura).
const PNCP_STATUS_RECONCILE_PER_JOB = Math.max(
  5,
  Math.min(80, Number(process.env.PNCP_STATUS_RECONCILE_PER_JOB) || 30)
);
// Fatias de /v1/contratacoes/proposta no refresh diário (reabertura sem reler search).
const PNCP_DEEP_PROPOSTA_INCREMENTAL_SLICES = Math.max(
  1,
  Math.min(12, Number(process.env.PNCP_DEEP_PROPOSTA_INCREMENTAL_SLICES) || 4)
);
// Quantos itens "duplicata" no probe atualizam situacao/datas (sem request extra).
const PNCP_DEEP_DUP_REFRESH_CAP = Math.max(
  20,
  Math.min(400, Number(process.env.PNCP_DEEP_DUP_REFRESH_CAP) || 120)
);

/**
 * Marca resultados ainda na lista ativa como fora do open (suspenso/revogado/etc.).
 * Não mexe em pipeline/hidden do usuário.
 */
const markPncpJobResultsStaleStatus = async (jobId, accountId, resultKeys = [], { reason = 'status_not_open' } = {}) => {
  const keys = [...new Set((resultKeys || []).map((k) => String(k || '').trim()).filter(Boolean))];
  if (!jobId || !keys.length) return 0;
  let updated = 0;
  for (let start = 0; start < keys.length; start += 200) {
    const chunk = keys.slice(start, start + 200);
    const result = await pool.query(
      `
        UPDATE ${PNCP_SEARCH_JOB_RESULTS_TABLE}
           SET visibility = 'stale_status',
               payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
                 'status_lifecycle', $4::text,
                 'status_checked_at', $5::text
               ),
               updated_at = NOW()
         WHERE job_id = $1
           AND account_id = $2
           AND result_key = ANY($3::text[])
           AND visibility = 'visible'
      `,
      [jobId, accountId, chunk, reason, new Date().toISOString()]
    ).catch((err) => {
      console.warn('[PNCP] mark stale_status falhou:', err.message);
      return { rowCount: 0 };
    });
    updated += Number(result.rowCount || 0);
  }
  return updated;
};

/** Reabertura: devolve à lista itens que estavam stale_status e voltaram a open. */
const restorePncpJobResultsFromStale = async (jobId, accountId, resultKeys = []) => {
  const keys = [...new Set((resultKeys || []).map((k) => String(k || '').trim()).filter(Boolean))];
  if (!jobId || !keys.length) return 0;
  let updated = 0;
  const nowIso = new Date().toISOString();
  for (let start = 0; start < keys.length; start += 200) {
    const chunk = keys.slice(start, start + 200);
    const result = await pool.query(
      `
        UPDATE ${PNCP_SEARCH_JOB_RESULTS_TABLE}
           SET visibility = 'visible',
               payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
                 'status_lifecycle', 'reopened',
                 'status_checked_at', $4::text
               ),
               updated_at = NOW()
         WHERE job_id = $1
           AND account_id = $2
           AND result_key = ANY($3::text[])
           AND visibility = 'stale_status'
      `,
      [jobId, accountId, chunk, nowIso]
    ).catch((err) => {
      console.warn('[PNCP] restore from stale_status falhou:', err.message);
      return { rowCount: 0 };
    });
    updated += Number(result.rowCount || 0);
  }
  return updated;
};

/**
 * Após probe: merge de situacao/datas em itens já vistos (sem request extra).
 * Demote só com evidência forte (closed); missing deadline NÃO tira da lista.
 */
const applyPncpDuplicateStatusRefresh = async (job, rawDupItems = [], {
  qText = '',
  terms = [],
  negativeTerms = [],
  filters = {},
  mappedStatus = null,
  shouldApplyReceivingProposalLocally = false,
} = {}) => {
  if (!job?.id || !Array.isArray(rawDupItems) || !rawDupItems.length) {
    return { refreshed: 0, stale: 0, reopened: 0, unknown: 0 };
  }
  const capped = rawDupItems.slice(0, PNCP_DEEP_DUP_REFRESH_CAP);
  const snapshot = await buildDeepSearchItemsSnapshot({
    rawItems: capped,
    qText,
    terms,
    negativeTerms,
    filters,
    mappedStatus,
    // Não filtrar: precisamos persistir também os que fecharam para rebaixar.
    shouldApplyReceivingProposalLocally: false,
    enrichValues: false,
  });
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  if (!items.length) return { refreshed: 0, stale: 0, reopened: 0, unknown: 0 };

  const nowIso = new Date().toISOString();
  const stamped = items.map((item) => {
    const v = getPncpReceivingProposalVerdict(item);
    return {
      ...item,
      status_checked_at: nowIso,
      status_lifecycle: 'probe_refresh',
      proposal_verdict: v.verdict,
      proposal_verdict_reason: v.reason,
    };
  });
  await persistPncpJobResults(job, stamped);

  let stale = 0;
  let reopened = 0;
  let unknown = 0;
  if (shouldApplyReceivingProposalLocally || normalizeSearchText(mappedStatus) === 'recebendo_proposta') {
    const closedKeys = [];
    const keepKeys = [];
    for (const item of stamped) {
      const key = getPncpSearchResultKey(item);
      if (!key) continue;
      const v = getPncpReceivingProposalVerdict(item);
      if (v.verdict === 'closed') closedKeys.push(key);
      else {
        keepKeys.push(key);
        if (v.verdict === 'unknown') unknown += 1;
      }
    }
    // Só demote com evidência (situacao terminal, prazo vencido, etc.) — nunca por falta de prazo.
    if (closedKeys.length) {
      stale = await markPncpJobResultsStaleStatus(job.id, job.account_id, closedKeys, {
        reason: 'probe_definitely_closed',
      });
    }
    if (keepKeys.length) {
      reopened = await restorePncpJobResultsFromStale(job.id, job.account_id, keepKeys);
    }
  }
  return { refreshed: stamped.length, stale, reopened, unknown };
};

/**
 * Reconsulta detalhe PNCP de um subconjunto do acervo local (visíveis) para
 * detectar suspensão/revogação sem reler o universo do índice.
 */
const reconcilePncpJobResultStatuses = async (job, { limit = PNCP_STATUS_RECONCILE_PER_JOB } = {}) => {
  if (!job?.id || !job?.account_id) return { checked: 0, stale: 0, open: 0, skipped: 0 };
  const jobStatus = normalizeSearchText(job?.filters?.status || '');
  // Só rebaixa da lista quando a busca é de abertos (recebendo proposta).
  const demoteWhenClosed = !jobStatus || jobStatus === 'recebendo_proposta' || jobStatus === 'recebendo proposta';
  const cap = Math.max(1, Math.min(80, Number(limit) || PNCP_STATUS_RECONCILE_PER_JOB));
  // Prioriza: nunca checado → score alto → prazo mais próximo.
  const { rows } = await pool.query(
    `
      SELECT result_key, payload, score, deadline_at,
             COALESCE(payload->>'status_checked_at', '') AS status_checked_at
        FROM ${PNCP_SEARCH_JOB_RESULTS_TABLE}
       WHERE job_id = $1
         AND account_id = $2
         AND visibility = 'visible'
       ORDER BY
         CASE WHEN COALESCE(payload->>'status_checked_at', '') = '' THEN 0 ELSE 1 END ASC,
         score DESC NULLS LAST,
         deadline_at ASC NULLS LAST,
         updated_at ASC
       LIMIT $3
    `,
    [job.id, job.account_id, cap]
  ).catch((err) => {
    console.warn('[PNCP] load results for status reconcile falhou:', err.message);
    return { rows: [] };
  });

  let checked = 0;
  let stale = 0;
  let open = 0;
  let skipped = 0;
  const openItems = [];
  const staleKeys = [];
  const nowIso = new Date().toISOString();

  for (const row of rows) {
    if (PNCP_DEEP_SEARCH_CANCELLED.has(job.id)) break;
    if (!canRunPncpPriority('bulk') || Date.now() < PNCP_GATE.pausedUntil) {
      skipped += rows.length - checked - skipped;
      break;
    }
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    const ids = extractPncpCompraIdentifiers(payload);
    if (!ids.cnpj || !ids.ano || !ids.sequencial) {
      skipped += 1;
      continue;
    }
    const detail = await getPncpCompraDetalhe(ids.cnpj, ids.ano, ids.sequencial, { priority: 'bulk' });
    if (!detail) {
      skipped += 1;
      continue;
    }
    checked += 1;
    const merged = {
      ...payload,
      situacao_id: detail.situacao_id ?? payload.situacao_id,
      situacao_nome: detail.situacao_nome || payload.situacao_nome,
      situacao: {
        ...(payload.situacao || {}),
        id: detail.situacao_id ?? payload.situacao?.id,
        nome: detail.situacao_nome || payload.situacao?.nome,
      },
      data_publicacao: detail.data_publicacao_pncp || payload.data_publicacao,
      data_publicacao_pncp: detail.data_publicacao_pncp || payload.data_publicacao_pncp,
      data_inicio_vigencia: detail.data_abertura_proposta || payload.data_inicio_vigencia,
      data_fim_vigencia: detail.data_encerramento_proposta || payload.data_fim_vigencia,
      data_encerramento_proposta: detail.data_encerramento_proposta || payload.data_encerramento_proposta,
      valor_total_estimado: detail.valor_total_estimado ?? payload.valor_total_estimado,
      valor_total_homologado: detail.valor_total_homologado ?? payload.valor_total_homologado,
      srp: typeof detail.srp === 'boolean' ? detail.srp : payload.srp,
      modo_disputa: {
        id: detail.modo_disputa_id || payload.modo_disputa?.id || null,
        nome: detail.modo_disputa_nome || payload.modo_disputa?.nome || null,
      },
      status_checked_at: nowIso,
      status_lifecycle: 'detail_reconcile',
    };
    const verdict = getPncpReceivingProposalVerdict(merged);
    merged.proposal_verdict = verdict.verdict;
    merged.proposal_verdict_reason = verdict.reason;
    // Demote só closed com evidência. missing_deadline após detalhe ainda é unknown → fica.
    if (verdict.verdict === 'closed' && demoteWhenClosed) {
      staleKeys.push(String(row.result_key || getPncpSearchResultKey(merged) || '').trim());
    } else if (verdict.verdict === 'open') {
      open += 1;
    }
    openItems.push(merged);
  }

  if (openItems.length) {
    await persistPncpJobResults(job, openItems);
  }
  if (staleKeys.length && demoteWhenClosed) {
    stale = await markPncpJobResultsStaleStatus(job.id, job.account_id, staleKeys, {
      reason: 'detail_definitely_closed',
    });
  }
  // Reabertura: detalhe diz open (ou unknown sem terminal) → volta do stale.
  const restoreKeys = openItems
    .filter((item) => getPncpReceivingProposalVerdict(item).verdict !== 'closed')
    .map((item) => getPncpSearchResultKey(item))
    .filter(Boolean);
  if (restoreKeys.length && demoteWhenClosed) {
    await restorePncpJobResultsFromStale(job.id, job.account_id, restoreKeys);
  }
  if (checked > 0 || stale > 0) {
    await refreshPncpJobSummaryTotals(job);
    job.progress = {
      ...(job.progress || {}),
      status_reconcile: {
        at: nowIso,
        checked,
        stale,
        open,
        skipped,
      },
    };
    await persistPncpDeepJob(job).catch(() => null);
  }
  return { checked, stale, open, skipped };
};

/** Daily: reconcile de situação nos jobs ativos (sem full re-scan do PNCP). */
const runDailyPncpStatusReconcile = async ({ limit = 10 } = {}) => {
  cleanupPncpDeepJobs();
  const { rows } = await pool.query(
    `
      SELECT *
        FROM ${PNCP_SEARCH_JOBS_TABLE}
       WHERE watchlist_id IS NULL
         AND status IN ('completed', 'failed', 'paused_rate_limit')
         AND started_at >= NOW() - ($1::int * INTERVAL '1 day')
       ORDER BY updated_at ASC
       LIMIT $2
    `,
    [PNCP_SEARCH_JOB_ARCHIVE_DAYS, Math.max(1, Math.min(20, Number(limit) || 10))]
  ).catch(() => ({ rows: [] }));

  let jobs = 0;
  let checked = 0;
  let stale = 0;
  for (const row of rows) {
    const job = normalizePncpSearchJobRow(row);
    if (!job?.id) continue;
    if (isPncpSearchJobArchivable(job)) continue;
    const live = PNCP_DEEP_SEARCH_JOBS.get(job.id);
    if (live && ['queued', 'running', 'cancelling'].includes(live.status)) continue;
    const memJob = live || job;
    PNCP_DEEP_SEARCH_JOBS.set(memJob.id, memJob);
    const result = await reconcilePncpJobResultStatuses(memJob, {
      limit: PNCP_STATUS_RECONCILE_PER_JOB,
    });
    jobs += 1;
    checked += result.checked;
    stale += result.stale;
  }
  return { jobs, checked, stale, candidates: rows.length };
};

/** Normaliza número de controle PNCP para comparação com o board. */
const normalizePncpControlId = (value) => String(value || '').trim().toLowerCase();

/** Extrai chave de path do edital PNCP (cnpj/ano/sequencial) a partir da URL. */
const extractPncpPathKey = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(text, 'https://pncp.gov.br');
    const match = parsed.pathname.match(/\/(?:app\/editais|editais|compras)\/([^/?#]+\/[^/?#]+\/[^/?#]+)/i);
    return String(match?.[1] || '').toLowerCase();
  } catch {
    return '';
  }
};

/**
 * Índice de editais já no pipeline (oportunidades do account).
 * Usado para marcar resultados de busca como visibility=pipeline e
 * tirá-los da lista ativa ("Na lista").
 */
const loadAccountPncpPipelineIndex = async (accountId) => {
  const empty = { controls: new Set(), paths: new Set(), ids: new Set() };
  if (accountId == null) return empty;
  const { rows } = await pool.query(
    `
      SELECT numero_compra, links_pncp, links, metadados
        FROM ${LICITACAO_TABLE}
       WHERE account_id = $1
    `,
    [accountId]
  ).catch(() => ({ rows: [] }));
  const index = { controls: new Set(), paths: new Set(), ids: new Set() };
  for (const row of rows) {
    const metadata = row?.metadados && typeof row.metadados === 'object' ? row.metadados : {};
    const links = row?.links && typeof row.links === 'object' ? row.links : {};
    [row?.numero_compra, metadata.pncp_numero_controle, metadata.numero_controle_pncp]
      .forEach((candidate) => {
        const normalized = normalizePncpControlId(candidate);
        if (normalized) index.controls.add(normalized);
      });
    const idCandidate = String(metadata.pncp_id || '').trim();
    if (idCandidate) index.ids.add(idCandidate);
    [row?.links_pncp, links.pncp].forEach((candidate) => {
      const pathKey = extractPncpPathKey(candidate);
      if (pathKey) index.paths.add(pathKey);
    });
  }
  return index;
};

const isPncpPayloadInPipeline = (payload, index) => {
  if (!payload || typeof payload !== 'object' || !index) return false;
  const controlId = normalizePncpControlId(
    payload.numero_controle_pncp || payload.numeroControlePNCP
  );
  if (controlId && index.controls.has(controlId)) return true;
  const pathKey = extractPncpPathKey(
    payload.url || payload.item_url || payload.linkSistemaOrigem || payload.links_pncp
  );
  if (pathKey && index.paths.has(pathKey)) return true;
  const itemId = String(payload.id || '').trim();
  if (itemId && index.ids.has(itemId)) return true;
  return false;
};

/**
 * Alinha visibility dos resultados do job com o board:
 * - no pipe → visibility='pipeline' (fora da lista ativa)
 * - saiu do pipe e estava pipeline → volta para 'visible'
 * Descartados (hidden) não são tocados.
 */
const reconcilePncpJobPipelineVisibility = async (jobId, accountId) => {
  if (!jobId || accountId == null) return { marked: 0, restored: 0 };
  const index = await loadAccountPncpPipelineIndex(accountId);
  const { rows } = await pool.query(
    `
      SELECT result_key, visibility,
             payload->>'id' AS payload_id,
             payload->>'numero_controle_pncp' AS control,
             payload->>'numeroControlePNCP' AS control_alt,
             payload->>'url' AS url,
             payload->>'item_url' AS item_url,
             payload->>'linkSistemaOrigem' AS link_origem,
             payload->>'links_pncp' AS links_pncp
        FROM ${PNCP_SEARCH_JOB_RESULTS_TABLE}
       WHERE job_id = $1
         AND account_id = $2
         AND visibility <> 'hidden'
    `,
    [jobId, accountId]
  ).catch(() => ({ rows: [] }));

  const toPipeline = [];
  const toVisible = [];
  for (const row of rows) {
    const payload = {
      id: row.payload_id,
      numero_controle_pncp: row.control || row.control_alt,
      url: row.url,
      item_url: row.item_url,
      linkSistemaOrigem: row.link_origem,
      links_pncp: row.links_pncp,
    };
    const inPipe = isPncpPayloadInPipeline(payload, index);
    const vis = String(row.visibility || 'visible');
    if (inPipe && vis !== 'pipeline') toPipeline.push(row.result_key);
    else if (!inPipe && vis === 'pipeline') toVisible.push(row.result_key);
  }

  const batchUpdate = async (keys, visibility) => {
    if (!keys.length) return 0;
    let updated = 0;
    for (let start = 0; start < keys.length; start += 500) {
      const chunk = keys.slice(start, start + 500);
      const result = await pool.query(
        `
          UPDATE ${PNCP_SEARCH_JOB_RESULTS_TABLE}
             SET visibility = $1, updated_at = NOW()
           WHERE job_id = $2
             AND account_id = $3
             AND result_key = ANY($4::text[])
        `,
        [visibility, jobId, accountId, chunk]
      ).catch(() => ({ rowCount: 0 }));
      updated += Number(result.rowCount || 0);
    }
    return updated;
  };

  const marked = await batchUpdate(toPipeline, 'pipeline');
  const restored = await batchUpdate(toVisible, 'visible');
  return { marked, restored };
};

/** Conta resultados do job. Por padrão exclui descartados e já no pipeline. */
const countPncpJobResults = async (jobId, accountId = null, { includeHidden = false, includePipeline = false } = {}) => {
  if (!jobId) return 0;
  const params = [jobId];
  let sql = `SELECT COUNT(*)::int AS total FROM ${PNCP_SEARCH_JOB_RESULTS_TABLE} WHERE job_id = $1`;
  if (accountId != null) {
    params.push(accountId);
    sql += ` AND account_id = $${params.length}`;
  }
  if (!includeHidden) {
    sql += ` AND visibility <> 'hidden'`;
    // Suspenso/revogado após captura — fora da lista aberta.
    sql += ` AND visibility <> 'stale_status'`;
  }
  if (!includePipeline) {
    sql += ` AND visibility <> 'pipeline'`;
  }
  const { rows } = await pool.query(sql, params).catch(() => ({ rows: [{ total: 0 }] }));
  return Number(rows[0]?.total || 0);
};

/**
 * Soma canônica do "Valor na lista": SOMENTE itens pertinentes (value_matched).
 * Nunca usa total da licitação (value_estimated / valor_global / homologado) —
 * se faltar valor de item, a linha não entra na soma até o enriquecimento preencher.
 * Descartados e já no pipeline não entram no valor da lista ativa.
 */
const sumPncpJobResultsValue = async (jobId, accountId = null, { includeHidden = false, includePipeline = false } = {}) => {
  if (!jobId) return 0;
  const params = [jobId];
  let sql = `
    SELECT COALESCE(SUM(
      COALESCE(
        NULLIF(value_matched, 0),
        NULLIF((payload->>'valor_itens_pertinentes')::numeric, 0),
        0
      )
    ), 0)::float AS total_value
      FROM ${PNCP_SEARCH_JOB_RESULTS_TABLE}
     WHERE job_id = $1`;
  if (accountId != null) {
    params.push(accountId);
    sql += ` AND account_id = $${params.length}`;
  }
  if (!includeHidden) {
    sql += ` AND visibility <> 'hidden'`;
    sql += ` AND visibility <> 'stale_status'`;
  }
  if (!includePipeline) {
    sql += ` AND visibility <> 'pipeline'`;
  }
  const { rows } = await pool.query(sql, params).catch(() => ({ rows: [{ total_value: 0 }] }));
  const n = Number(rows[0]?.total_value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const refreshPncpJobSummaryTotals = async (job) => {
  if (!job?.id) return job?.summary || null;
  // total/summary da lista ativa: descartados saem da contagem e do valor.
  const count = await countPncpJobResults(job.id, job.account_id, { includeHidden: false });
  const totalValue = await sumPncpJobResultsValue(job.id, job.account_id, { includeHidden: false });
  job.summary = {
    ...(job.summary && typeof job.summary === 'object' ? job.summary : {}),
    count,
    total_value: totalValue,
  };
  job.total = count || 0;
  return job.summary;
};

/**
 * Contagens por visibility (chips Na lista / Descartados / Pipeline).
 * "Na lista" = só visíveis (disponíveis para importar); pipeline fica no chip próprio.
 */
const countPncpJobResultsByVisibility = async (jobId, accountId = null, { reconcile = false } = {}) => {
  const empty = { all: 0, list: 0, visible: 0, hidden: 0, pipeline: 0, stale_status: 0 };
  if (!jobId) return empty;
  if (reconcile && accountId != null) {
    await reconcilePncpJobPipelineVisibility(jobId, accountId).catch((err) => {
      console.warn('[PNCP] reconcile pipeline visibility falhou:', err.message);
    });
  }
  const params = [jobId];
  let sql = `
    SELECT visibility, COUNT(*)::int AS cnt
      FROM ${PNCP_SEARCH_JOB_RESULTS_TABLE}
     WHERE job_id = $1`;
  if (accountId != null) {
    params.push(accountId);
    sql += ' AND account_id = $2';
  }
  sql += ' GROUP BY visibility';
  const { rows } = await pool.query(sql, params).catch(() => ({ rows: [] }));
  const counts = { ...empty };
  for (const row of rows) {
    const vis = String(row.visibility || 'visible');
    const n = Number(row.cnt || 0);
    if (vis === 'hidden') counts.hidden = n;
    else if (vis === 'pipeline') counts.pipeline = n;
    else if (vis === 'stale_status') counts.stale_status = n;
    else counts.visible += n;
    counts.all += n;
  }
  // "Na lista" = disponíveis (sem descartados, pipeline nem stale por status).
  counts.list = counts.visible;
  return counts;
};

/**
 * Contagem canônica na lista por matched_term (fonte = tabela de resultados).
 * A coluna classified_added do term_run é só incremento de fatia e fica menor
 * que o card após retomadas/preserve.
 * Descartados e já no pipeline não entram na lista ativa.
 */
const countPncpJobResultsByMatchedTerm = async (jobId, accountId = null, { includeHidden = false, includePipeline = false } = {}) => {
  if (!jobId) return { total: 0, by_term: {} };
  const params = [jobId];
  let sql = `
    SELECT COALESCE(NULLIF(TRIM(matched_term), ''),
                    NULLIF(TRIM(payload->>'matched_termo'), ''),
                    NULLIF(TRIM(payload->>'__matched_termo'), ''),
                    '(sem termo)') AS term,
           COUNT(*)::int AS cnt
      FROM ${PNCP_SEARCH_JOB_RESULTS_TABLE}
     WHERE job_id = $1`;
  if (accountId != null) {
    params.push(accountId);
    sql += ` AND account_id = $${params.length}`;
  }
  if (!includeHidden) {
    sql += ` AND visibility <> 'hidden'`;
  }
  if (!includePipeline) {
    sql += ` AND visibility <> 'pipeline'`;
  }
  sql += ' GROUP BY 1 ORDER BY cnt DESC';
  const { rows } = await pool.query(sql, params).catch(() => ({ rows: [] }));
  const byTerm = {};
  let total = 0;
  for (const row of rows) {
    const term = String(row.term || '(sem termo)');
    const n = Number(row.cnt || 0);
    byTerm[term] = n;
    total += n;
  }
  return { total, by_term: byTerm };
};

/** Chaves já persistidas — evita recontar e permite retomada sem reprocessar. */
const loadPncpJobResultKeys = async (jobId) => {
  if (!jobId) return new Set();
  const { rows } = await pool.query(
    `SELECT result_key FROM ${PNCP_SEARCH_JOB_RESULTS_TABLE} WHERE job_id = $1`,
    [jobId]
  ).catch(() => ({ rows: [] }));
  return new Set(rows.map(r => String(r.result_key || '').trim()).filter(Boolean));
};

const PNCP_TERM_RUN_DONE_STOPS = new Set([
  'total_reached', 'short_page', 'empty_page', 'target_reached', 'max_pages',
  // Probe diário concluído — não reabre o universo inteiro no próximo refresh.
  'incremental_probe_done',
]);
// slice_yield = cedeu a vez no rodízio (ainda não terminou o universo do termo).
const PNCP_TERM_RUN_RESUME_STOPS = new Set([
  'rate_limited', 'page_error', 'page_error_partial', 'slice_yield',
]);
// Páginas por fatia no rodízio: evita um termo com 4k+ resultados monopolizar a fila
// e deixar correlatos (uav, rpa…) eternamente "aguardando vez".
const PNCP_DEEP_PAGES_PER_SLICE = Math.max(3, Math.min(15, Number(process.env.PNCP_DEEP_PAGES_PER_SLICE) || 6));
// Recoleta diária de job já completo: só as primeiras N páginas de cada termo
// (novidades costumam aparecer no topo do índice). Nunca revarre 4k+ páginas.
const PNCP_DEEP_INCREMENTAL_PAGES = Math.max(1, Math.min(10, Number(process.env.PNCP_DEEP_INCREMENTAL_PAGES) || 3));

const getPreviousTermRun = (termRuns = [], term = '') => {
  const needle = normalizeSearchText(term);
  if (!needle) return null;
  // Última execução desse termo (pode haver várias se o job retomou várias vezes).
  for (let i = termRuns.length - 1; i >= 0; i -= 1) {
    const run = termRuns[i];
    if (run?.term && normalizeSearchText(run.term) === needle && run.source !== 'pncp_consulta_complement') {
      return run;
    }
  }
  return null;
};

/** Upsert do run de um termo na lista (mantém 1 entrada por termo + complementos). */
const upsertTermRun = (termRuns, run) => {
  if (!run?.term) {
    termRuns.push(run);
    return termRuns;
  }
  const needle = normalizeSearchText(run.term);
  const idx = termRuns.findIndex(
    (r) => r?.term && normalizeSearchText(r.term) === needle && r.source !== 'pncp_consulta_complement'
  );
  if (idx >= 0) termRuns[idx] = run;
  else termRuns.push(run);
  return termRuns;
};

const persistPncpJobResults = async (job, items = []) => {
  if (!job?.id || !job?.account_id || !Array.isArray(items) || !items.length) return;
  const rows = items
    .map(item => {
      const key = String(getPncpSearchResultKey(item) || '').trim();
      if (!key) return null;
      const deadlineRaw = item?.data_fim_vigencia || item?.data_encerramento_proposta || item?.dataEncerramentoProposta || null;
      const estimated = Number(getPncpTotalEstimatedValue(item) || item?.valor_total_estimado || item?.valor_global || 0);
      const matched = Number(item?.valor_itens_pertinentes || 0);
      return [
        job.id,
        job.account_id,
        key,
        Number(item?.score || 0),
        getPncpScoreLabel(item?.score),
        item?.commercial_stage?.id || classifyPncpCommercialStage(item).id,
        deadlineRaw || null,
        Number.isFinite(estimated) && estimated > 0 ? estimated : null,
        Number.isFinite(matched) && matched > 0 ? matched : null,
        item?.matched_termo || null,
        'visible',
        JSON.stringify(item),
      ];
    })
    .filter(Boolean);
  if (!rows.length) return;

  for (let start = 0; start < rows.length; start += 800) {
    const chunk = rows.slice(start, start + 800);
    const params = [];
    const valuesSql = chunk.map((row, rowIndex) => {
      const base = rowIndex * 12;
      params.push(...row);
      return `($${base + 1}::uuid,$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12}::jsonb)`;
    }).join(',');

    await pool.query(
      `
        INSERT INTO ${PNCP_SEARCH_JOB_RESULTS_TABLE}
          (job_id, account_id, result_key, score, score_label, commercial_stage, deadline_at,
           value_estimated, value_matched, matched_term, visibility, payload)
        VALUES ${valuesSql}
        ON CONFLICT (job_id, result_key) DO UPDATE SET
          score = EXCLUDED.score,
          score_label = EXCLUDED.score_label,
          commercial_stage = EXCLUDED.commercial_stage,
          deadline_at = COALESCE(EXCLUDED.deadline_at, ${PNCP_SEARCH_JOB_RESULTS_TABLE}.deadline_at),
          value_estimated = COALESCE(EXCLUDED.value_estimated, ${PNCP_SEARCH_JOB_RESULTS_TABLE}.value_estimated),
          value_matched = COALESCE(EXCLUDED.value_matched, ${PNCP_SEARCH_JOB_RESULTS_TABLE}.value_matched),
          matched_term = COALESCE(EXCLUDED.matched_term, ${PNCP_SEARCH_JOB_RESULTS_TABLE}.matched_term),
          -- Reexecução não desfaz hide/pipeline do usuário.
          visibility = ${PNCP_SEARCH_JOB_RESULTS_TABLE}.visibility,
          -- Prefer payload com mais dados de valor (item + total).
          payload = CASE
            WHEN COALESCE((EXCLUDED.payload->>'valor_itens_pertinentes')::numeric, 0) >
                 COALESCE((${PNCP_SEARCH_JOB_RESULTS_TABLE}.payload->>'valor_itens_pertinentes')::numeric, 0)
              THEN EXCLUDED.payload
            WHEN COALESCE((EXCLUDED.payload->>'valor_total_estimado')::numeric, 0) >
                 COALESCE((${PNCP_SEARCH_JOB_RESULTS_TABLE}.payload->>'valor_total_estimado')::numeric, 0)
             AND COALESCE((${PNCP_SEARCH_JOB_RESULTS_TABLE}.payload->>'valor_itens_pertinentes')::numeric, 0) = 0
              THEN EXCLUDED.payload
            WHEN ${PNCP_SEARCH_JOB_RESULTS_TABLE}.payload IS NULL THEN EXCLUDED.payload
            ELSE ${PNCP_SEARCH_JOB_RESULTS_TABLE}.payload || EXCLUDED.payload
          END,
          updated_at = NOW()
      `,
      params
    ).catch(error => console.warn('[PNCP Search Job Results] persist falhou:', error.message));
  }
};

const sortPncpJobResults = (items, ordenacao = 'relevancia_desc') => {
  const sorted = [...items];
  // Ordenação por valor usa só itens pertinentes (mesmo critério do "Valor na lista").
  const getValue = (item) => Number(item?.valor_itens_pertinentes || 0);
  const getDate = (item) => new Date(item?.data_publicacao || item?.data_fim_vigencia || 0).getTime() || 0;
  if (ordenacao === 'valor_desc_data_desc') sorted.sort((a, b) => getValue(b) - getValue(a) || getDate(b) - getDate(a));
  else if (ordenacao === 'valor_asc_data_desc') sorted.sort((a, b) => getValue(a) - getValue(b) || getDate(b) - getDate(a));
  else if (ordenacao === 'data_desc') sorted.sort((a, b) => getDate(b) - getDate(a));
  else if (ordenacao === 'data_asc') sorted.sort((a, b) => getDate(a) - getDate(b));
  else sorted.sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0) || getValue(b) - getValue(a));
  return sorted;
};

// Complemento de cobertura: varre a API de consulta por data (que não depende de
// casamento de terminologia no indexador da /api/search/) e agrega contratações
// que os termos encontram no objeto da compra. Mesma ideia do branch UASG da
// busca síncrona. Itens chegam com valores e campos Lei 14.133 já populados.
// Suporta fatias (startPage + pagesThisSlice) para intercalar cedo no deep job
// sem recomeçar do zero em retomadas.
const fetchConsultaComplementItems = async ({
  qText,
  terms = [],
  filters = {},
  mappedStatus,
  shouldApplyReceivingProposalLocally,
  seen,
  rawItems,
  dupRefreshItems = null,
  maxPages = 10,
  startPage = 1,
  pagesThisSlice = null,
  priorRun = null,
  priority = 'sync',
  // Probe diário: não grava high-water de pages_completed abaixo do prior.
  preserveHighWaterPages = false,
}) => {
  const prior = priorRun && priorRun.source === 'pncp_consulta_complement' ? priorRun : null;
  const run = {
    term: '(consulta por data)',
    source: 'pncp_consulta_complement',
    endpoint: 'pncp_consulta',
    pages_requested: prior ? Number(prior.pages_requested || 0) : 0,
    pages_completed: prior ? Number(prior.pages_completed || 0) : 0,
    total_reported: prior ? Number(prior.total_reported || 0) : 0,
    items_collected: prior ? Number(prior.items_collected || 0) : 0,
    unique_new: prior ? Number(prior.unique_new || 0) : 0,
    duplicates_skipped: prior ? Number(prior.duplicates_skipped || 0) : 0,
    classified_added: prior ? Number(prior.classified_added || 0) : 0,
    errors: Array.isArray(prior?.errors) ? [...prior.errors].slice(-8) : [],
    stop_reason: null,
    duration_ms: Number(prior?.duration_ms || 0),
    resumed_from_page: null,
    slices: Number(prior?.slices || 0) + 1,
  };
  const startedAt = Date.now();
  const textTerms = mergeUniqueTerms([qText], terms)
    .filter(t => t && String(t).trim().length >= 3 && !/^\d+$/.test(String(t).trim()));
  if (!textTerms.length) {
    run.stop_reason = 'sem_termos';
    return run;
  }
  const fmtDate = (d) => d.toISOString().split('T')[0].replace(/-/g, '');
  const hoje = new Date();
  const useProposta = shouldApplyReceivingProposalLocally || !mappedStatus || mappedStatus === 'todos';
  const params = { tamanhoPagina: 50 };
  let endpoint;
  if (useProposta) {
    endpoint = '/v1/contratacoes/proposta';
    const fim = new Date(hoje);
    fim.setDate(hoje.getDate() + 180);
    params.dataFinal = fmtDate(fim);
  } else {
    endpoint = '/v1/contratacoes/publicacao';
    if (!filters.modalidade_licitacao_id) {
      // publicacao exige codigoModalidadeContratacao; sem modalidade não há varredura.
      run.stop_reason = 'publicacao_requer_modalidade';
      return run;
    }
    const inicio = new Date(hoje);
    inicio.setDate(hoje.getDate() - 90);
    params.dataInicial = fmtDate(inicio);
    params.dataFinal = fmtDate(hoje);
  }
  if (filters.modalidade_licitacao_id) params.codigoModalidadeContratacao = filters.modalidade_licitacao_id;
  if (filters.uf) params.uf = filters.uf;
  const pageStart = Math.max(1, Number(startPage) || (Number(prior?.pages_completed || 0) + 1) || 1);
  const sliceCap = Math.max(1, Number(pagesThisSlice) || Number(maxPages) || 10);
  const hardCap = Math.max(pageStart + sliceCap - 1, Math.min(80, Number(maxPages) || 10));
  run.resumed_from_page = pageStart > 1 ? pageStart : null;
  let pagina = pageStart;
  let pagesInThisCall = 0;
  let lastPageRead = pageStart - 1;
  try {
    while (pagina <= hardCap && pagesInThisCall < sliceCap) {
      run.pages_requested += 1;
      const data = await withPncpGate(() => fetchPncpConsulta(endpoint, { ...params, pagina }), { priority });
      run.pages_completed = pagina;
      lastPageRead = pagina;
      pagesInThisCall += 1;
      const items = asPncpList(data);
      if (pagina === 1 || !run.total_reported) run.total_reported = Number(data?.totalRegistros) || run.total_reported || 0;
      const apiTotalPages = Number(data?.totalPaginas) || 0;
      if (apiTotalPages > 0) run.total_pages = Math.max(Number(run.total_pages || 0), apiTotalPages);
      if (!items.length) {
        run.stop_reason = 'empty_page';
        break;
      }
      for (const item of items) {
        const text = normalizeSearchText(`${item.objetoCompra || ''} ${item.informacaoComplementar || ''}`);
        const matched = textTerms.find(term => {
          const tokens = normalizeSearchText(term).split(/\s+/).filter(t => t.length >= 3);
          return tokens.length > 0 && tokens.some(t => text.includes(t));
        });
        if (!matched) continue;
        const mapped = mapPncpConsultaContratacaoToSearchItem(item, matched, { __from_consulta: true });
        const key = getPncpRawItemKey(mapped);
        if (!key) continue;
        if (seen.has(key)) {
          run.duplicates_skipped = Number(run.duplicates_skipped || 0) + 1;
          // Atualiza situacao/datas de itens já no acervo (payload veio de graça).
          if (Array.isArray(dupRefreshItems) && dupRefreshItems.length < PNCP_DEEP_DUP_REFRESH_CAP) {
            dupRefreshItems.push(mapped);
          }
          continue;
        }
        seen.add(key);
        rawItems.push(mapped);
        run.items_collected += 1;
        run.unique_new = Number(run.unique_new || 0) + 1;
      }
      const totalPaginas = Number(data?.totalPaginas) || 1;
      if (pagina >= totalPaginas || items.length < 50) {
        run.stop_reason = 'total_reached';
        break;
      }
      pagina += 1;
    }
  } catch (error) {
    run.errors.push(`pagina ${pagina}: ${error.message}`);
    run.errors = run.errors.slice(-12);
    if (isPncpBulkDeferredError(error)) {
      run.stop_reason = 'rate_limited';
    } else if (isPncpThrottleError(error)) {
      notePncpThrottle(error.message || 'consulta complement');
      run.stop_reason = 'rate_limited';
    } else {
      run.stop_reason = run.items_collected > 0 ? 'page_error_partial' : 'page_error';
    }
  }
  if (!run.stop_reason) {
    // Fatia parcial (ainda há páginas) vs teto desta chamada.
    run.stop_reason = pagesInThisCall >= sliceCap ? 'slice_yield' : 'max_pages';
  }
  // Cursor real da fatia (antes de eventualmente preservar high-water de varredura completa).
  run.slice_last_page = lastPageRead >= pageStart ? lastPageRead : null;
  run.slice_next_page = lastPageRead >= pageStart ? lastPageRead + 1 : pageStart;
  if (preserveHighWaterPages) {
    const priorHw = Number(prior?.pages_completed || 0);
    run.pages_completed = Math.max(priorHw, Number(run.pages_completed || 0));
    if (run.stop_reason === 'slice_yield' || run.stop_reason === 'max_pages') {
      run.stop_reason = 'incremental_probe_done';
    }
  }
  run.duration_ms = Number(run.duration_ms || 0) + (Date.now() - startedAt);
  return run;
};

const pauseDeepSearchForBulkDefer = async (job, reason = 'bulk_deferred') => {
  if (!job) return;
  const resumeIn = Math.max(45_000, PNCP_RATE_LIMIT_RESUME_DELAY_MS / 2);
  job.status = 'paused_rate_limit';
  job.error = (
    `Coletor aguardando cota/gate PNCP (${reason}). ` +
    `${Number(job.total || 0)} na lista preservados. ` +
    `Retoma em ~${Math.ceil(resumeIn / 60000)} min sem recomeçar · ` +
    `heavy=${PNCP_HEAVY_JOB.current || 'livre'} · gap ${PNCP_GATE.gapMs}ms.`
  );
  job.progress = {
    ...(job.progress || {}),
    rate_limited: true,
    waiting_gate: true,
    bulk_deferred: true,
    gate: getPncpGateSnapshot(),
    heavy: getPncpHeavyJobSnapshot(),
    resume_in_ms: resumeIn,
    checkpoint: true,
    classified_total: job.total,
  };
  job.updated_at = Date.now();
  await persistPncpDeepJob(job);
  schedulePncpSearchResume(job.id, resumeIn);
};

const runPncpDeepSearchJob = async (jobId) => {
  const job = PNCP_DEEP_SEARCH_JOBS.get(jobId);
  if (!job) return;
  if (PNCP_DEEP_SEARCH_WORKERS.has(jobId)) {
    console.log(`[PNCP Deep Search] job ${jobId} já tem worker ativo — skip`);
    return;
  }
  const label = `deep-search:${String(job.nome || jobId).slice(0, 40)}`;
  const workerPromise = (async () => {
    try {
      // Antes de pegar o heavy slot: se bulk não pode rodar, espera FORA do slot
      // (senão PCA/outro job fica atrás de um wait infinito).
      let gateWaitStarted = Date.now();
      let lastPersist = 0;
      while (
        !canRunPncpPriority('bulk')
        || Date.now() < PNCP_GATE.pausedUntil
        || PNCP_HEAVY_JOB.current
      ) {
        if (PNCP_DEEP_SEARCH_CANCELLED.has(jobId)) return;
        const mem = PNCP_DEEP_SEARCH_JOBS.get(jobId) || job;
        mem.status = 'queued';
        mem.progress = {
          ...(mem.progress || {}),
          waiting_gate: !canRunPncpPriority('bulk') || Date.now() < PNCP_GATE.pausedUntil,
          waiting_for_heavy: PNCP_HEAVY_JOB.current || null,
          heavy: getPncpHeavyJobSnapshot(),
          gate: getPncpGateSnapshot(),
        };
        mem.updated_at = Date.now();
        if (Date.now() - lastPersist > 15_000) {
          await persistPncpDeepJob(mem);
          lastPersist = Date.now();
        }
        // Se só o heavy está ocupado, espera o slot (withPncpHeavyJobSlot abaixo).
        // Se o gate bulk está bloqueado por tempo demais, pausa e libera o processo.
        if (
          (!canRunPncpPriority('bulk') || Date.now() < PNCP_GATE.pausedUntil)
          && Date.now() - gateWaitStarted > PNCP_BULK_GATE_WAIT_MAX_MS
        ) {
          await pauseDeepSearchForBulkDefer(mem, 'pre-slot');
          return;
        }
        if (PNCP_HEAVY_JOB.current && canRunPncpPriority('bulk') && Date.now() >= PNCP_GATE.pausedUntil) {
          // Gate ok — sai do loop e entra no heavy slot (pode enfileirar lá).
          break;
        }
        await sleep(3000);
      }
      return await withPncpHeavyJobSlot(label, () => runPncpDeepSearchJobUnlocked(jobId));
    } catch (error) {
      if (isPncpBulkDeferredError(error)) {
        const mem = PNCP_DEEP_SEARCH_JOBS.get(jobId) || job;
        await pauseDeepSearchForBulkDefer(mem, error.message || 'bulk_deferred');
        return;
      }
      throw error;
    } finally {
      PNCP_DEEP_SEARCH_WORKERS.delete(jobId);
    }
  })();
  PNCP_DEEP_SEARCH_WORKERS.set(jobId, workerPromise);
  return workerPromise;
};

const runPncpDeepSearchJobUnlocked = async (jobId) => {
  const job = PNCP_DEEP_SEARCH_JOBS.get(jobId);
  if (!job) return;
  const filters = job.filters || {};
  const qText = String(filters.q || '').trim();
  let terms = mergeUniqueTerms([qText], job.terms || []).filter(Boolean).slice(0, 12);
  const negativeTerms = mergeUniqueTerms(splitPncpTerms(filters.negative_terms || ''), job.negative_terms || []);
  const mappedStatus = normalizeSearchText(filters.status) === 'suspenso' ? 'suspensa' : filters.status;
  const shouldApplyReceivingProposalLocally = normalizeSearchText(mappedStatus) === 'recebendo_proposta';
  // Default: preservar acervo (reexecução diária / botão). Só limpa em troca de filtros.
  const preserveResults = job.preserve_results !== false;
  const baseParams = {
    tipos_documento: filters.tipos_documento || 'edital',
    tam: 100,
  };
  if (mappedStatus && mappedStatus !== 'todos' && !shouldApplyReceivingProposalLocally) baseParams.status = mappedStatus;
  if (filters.modalidade_licitacao_id) baseParams.modalidade_licitacao_id = filters.modalidade_licitacao_id;
  if (filters.tipo_id) baseParams.tipo_id = filters.tipo_id;
  if (filters.uf) baseParams.uf = filters.uf;
  if (filters.esfera_id) baseParams.esfera_id = filters.esfera_id;

  const maxPagesPerTerm = 1000;
  const seen = new Set();
  const rawItems = [];
  // Itens já vistos que reapareceram no probe — refresh de situacao sem request extra.
  const dupRefreshItems = [];
  // Runs anteriores (completos/parciais) — base do checkpoint de retomada.
  const priorTermRuns = Array.isArray(job.term_runs) ? [...job.term_runs] : [];
  // termRuns vira o estado vivo (1 entrada por termo); complementos entram no final.
  const termRuns = [];
  let lastSnapshotAt = 0;
  let classifiedBaseline = 0;
  // Checkpoint: NÃO re-pede páginas já lidas quando há progresso prévio.
  // Inclui jobs 100% done — a recoleta diária usa incremental (primeiras N págs),
  // não recomeça do zero o universo inteiro.
  const checkpointMode = Boolean(preserveResults && priorTermRuns.some((r) => {
    if (!r || r.source === 'pncp_consulta_complement') return false;
    if (PNCP_TERM_RUN_RESUME_STOPS.has(r.stop_reason)) return true;
    if (PNCP_TERM_RUN_DONE_STOPS.has(r.stop_reason)) return true;
    const pages = Number(r.pages_completed || 0);
    if (pages > 0) return true;
    if (Number(r.items_collected || 0) > 0) return true;
    return false;
  }));
  // Recoleta diária / flag explícita: só sonda as primeiras páginas de termos já
  // esgotados (novidades no topo do índice). Retomada mid-job NÃO usa isto.
  const incrementalRefresh = Boolean(
    preserveResults
    && checkpointMode
    && (job.incremental_refresh || job.progress?.incremental_refresh)
  );
  // Consome a flag para não grudar em restarts seguintes.
  job.incremental_refresh = false;
  if (job.progress) {
    job.progress.incremental_refresh = incrementalRefresh;
    job.progress.incremental_pages = incrementalRefresh ? PNCP_DEEP_INCREMENTAL_PAGES : null;
  }
  try {
    if (!preserveResults) {
      // Troca de filtros: zera para o total do card/popup refletir só o novo conjunto.
      await clearPncpJobResults(jobId);
      job.total = 0;
      job.items = [];
      priorTermRuns.length = 0;
    } else {
      // Mantém totais existentes enquanto novos itens vão entrando via UPSERT.
      job.total = await countPncpJobResults(jobId, job.account_id) || Number(job.total || 0);
      classifiedBaseline = job.total;
      // Seed de chaves já classificadas: retomada não regrava o mesmo acervo.
      const existingKeys = await loadPncpJobResultKeys(jobId);
      existingKeys.forEach((k) => seen.add(k));
    }

    // Estado por termo para o rodízio (round-robin por fatias de páginas).
    const buildTermState = (term, index) => {
      const prev = (preserveResults && checkpointMode) ? getPreviousTermRun(priorTermRuns, term) : null;
      const prevPages = Number(prev?.pages_completed || 0);
      const prevItems = Number(prev?.items_collected || 0);
      const prevStop = prev?.stop_reason || null;
      // short_page/total_reached com 0 páginas é estado inconsistente (ex.: uav 0/0) — não marcar done.
      const legitDone = Boolean(
        prev
        && PNCP_TERM_RUN_DONE_STOPS.has(prevStop)
        && (prevPages > 0 || prevItems > 0 || prevStop === 'empty_page')
      );
      // Termo já esgotado + recoleta diária: só primeiras N páginas (não re-lê 1..60).
      if (legitDone && incrementalRefresh) {
        return {
          term,
          index,
          done: false,
          page: 1,
          zeroUniqueStreak: 0,
          incrementalOnly: true,
          incrementalPageCap: PNCP_DEEP_INCREMENTAL_PAGES,
          priorHighWaterPages: prevPages,
          priorDoneStop: prevStop && prevStop !== 'incremental_probe_done' ? prevStop : 'total_reached',
          run: {
            term,
            source: index === 0 ? 'original_deep' : 'ai_or_alias_deep',
            endpoint: 'pncp_search',
            pages_requested: Number(prev.pages_requested || prevPages || 0),
            pages_completed: prevPages,
            total_reported: Number(prev.total_reported || 0),
            items_collected: prevItems,
            unique_new: Number(prev.unique_new || 0),
            duplicates_skipped: Number(prev.duplicates_skipped || 0),
            classified_added: Number(prev.classified_added || 0),
            observed_page_size: prev.observed_page_size || null,
            max_pages: PNCP_DEEP_INCREMENTAL_PAGES,
            target_items: Number.MAX_SAFE_INTEGER,
            budget_reason: 'incremental_daily',
            errors: Array.isArray(prev?.errors) ? [...prev.errors].slice(-8) : [],
            stop_reason: null,
            duration_ms: Number(prev?.duration_ms || 0),
            resumed_from_page: null,
            next_page: 1,
            slices: Number(prev?.slices || 0),
            incremental_probe: true,
            prior_pages_completed: prevPages,
          },
        };
      }
      // Termo já esgotado em retomada normal: não toca de novo.
      if (legitDone) {
        return {
          term,
          index,
          done: true,
          page: Math.max(1, prevPages + 1),
          zeroUniqueStreak: 0,
          incrementalOnly: false,
          incrementalPageCap: null,
          priorHighWaterPages: prevPages,
          priorDoneStop: prevStop,
          run: {
            term,
            source: index === 0 ? 'original_deep' : 'ai_or_alias_deep',
            endpoint: 'pncp_search',
            pages_requested: Number(prev.pages_requested || prevPages || 0),
            pages_completed: prevPages,
            total_reported: Number(prev.total_reported || 0),
            items_collected: prevItems,
            unique_new: Number(prev.unique_new || 0),
            duplicates_skipped: Number(prev.duplicates_skipped || 0),
            classified_added: Number(prev.classified_added || 0),
            observed_page_size: prev.observed_page_size || null,
            max_pages: maxPagesPerTerm,
            target_items: Number.MAX_SAFE_INTEGER,
            budget_reason: 'rodizio_fatias',
            errors: Array.isArray(prev?.errors) ? [...prev.errors].slice(-8) : [],
            stop_reason: prevStop || 'total_reached',
            duration_ms: Number(prev?.duration_ms || 0),
            resumed_from_page: null,
            next_page: null,
            slices: Number(prev?.slices || 0),
            resumed_skip: true,
          },
        };
      }
      const shouldResume = Boolean(
        prev
        && (
          PNCP_TERM_RUN_RESUME_STOPS.has(prevStop)
          || prevPages > 0
          || prevItems > 0
        )
      );
      // Próxima página a pedir: nunca recomeça abaixo do que já completou.
      const page = shouldResume
        ? Math.max(1, prevPages + 1, Number(prev?.next_page || 0) || 0)
        : 1;
      return {
        term,
        index,
        done: false,
        page,
        zeroUniqueStreak: 0,
        incrementalOnly: false,
        incrementalPageCap: null,
        priorHighWaterPages: shouldResume ? prevPages : 0,
        priorDoneStop: null,
        run: {
          term,
          source: index === 0 ? 'original_deep' : 'ai_or_alias_deep',
          endpoint: 'pncp_search',
          pages_requested: shouldResume ? Number(prev.pages_requested || prevPages || 0) : 0,
          pages_completed: shouldResume ? prevPages : 0,
          total_reported: shouldResume ? Number(prev.total_reported || 0) : 0,
          items_collected: shouldResume ? prevItems : 0,
          unique_new: shouldResume ? Number(prev.unique_new || 0) : 0,
          duplicates_skipped: shouldResume ? Number(prev.duplicates_skipped || 0) : 0,
          classified_added: shouldResume ? Number(prev.classified_added || 0) : 0,
          observed_page_size: shouldResume ? (prev.observed_page_size || null) : null,
          max_pages: maxPagesPerTerm,
          target_items: Number.MAX_SAFE_INTEGER,
          budget_reason: 'rodizio_fatias',
          errors: Array.isArray(prev?.errors) ? [...prev.errors].slice(-8) : [],
          stop_reason: shouldResume ? prevStop : null,
          duration_ms: Number(prev?.duration_ms || 0),
          resumed_from_page: shouldResume && page > 1 ? page : null,
          next_page: shouldResume ? page : null,
          slices: Number(prev?.slices || 0),
        },
      };
    };

    // Referência viva do complemento (atualizada por runComplementSlice).
    // syncTermRunsList precisa dela — senão regrava o prior antigo e apaga progresso.
    let liveComplementRun = priorTermRuns.find((r) => r?.source === 'pncp_consulta_complement') || null;

    const syncTermRunsList = (states) => {
      // Mantém ordem dos termos atuais + run de complemento vivo (ou prior).
      const next = [];
      states.forEach((st) => upsertTermRun(next, st.run));
      const comp = liveComplementRun
        || priorTermRuns.find((r) => r?.source === 'pncp_consulta_complement')
        || null;
      if (comp) next.push(comp);
      termRuns.length = 0;
      termRuns.push(...next);
      job.term_runs = termRuns;
    };

    const persistSliceProgress = async (states, activeRun, sessionRawFrom) => {
      const snapshotSource = rawItems.slice(sessionRawFrom);
      let classifiedThisSlice = 0;
      if (snapshotSource.length) {
        const pageSnapshot = await buildDeepSearchItemsSnapshot({
          rawItems: snapshotSource,
          qText,
          terms,
          negativeTerms,
          filters,
          mappedStatus,
          shouldApplyReceivingProposalLocally,
          enrichValues: false,
        });
        classifiedThisSlice = Array.isArray(pageSnapshot.items) ? pageSnapshot.items.length : 0;
        if (activeRun) {
          activeRun.classified_added = Number(activeRun.classified_added || 0) + classifiedThisSlice;
        }
        await persistPncpJobResults(job, pageSnapshot.items);
        job.items = pageSnapshot.items.slice(0, 200);
        job.summary = {
          ...(pageSnapshot.summary || {}),
          count: undefined,
        };
        job.query_plan = {
          ...pageSnapshot.query_plan,
          term_runs: termRuns,
          partial: true,
          raw_unique_collected: seen.size,
          schedule: 'round_robin_slices',
          pages_per_slice: PNCP_DEEP_PAGES_PER_SLICE,
          preserve_checkpoint: true,
        };
      }
      job.total = await countPncpJobResults(jobId, job.account_id) || job.total || 0;
      job.progress.classified_total = job.total;
      // Summary de valor: soma de toda a tabela (não só da fatia em memória).
      await refreshPncpJobSummaryTotals(job);
      job.progress.items_collected = Math.max(
        classifiedBaseline,
        seen.size,
        Number(job.progress.items_collected || 0)
      );
      job.progress.raw_unique_session = rawItems.length;
      job.progress.current_term = activeRun?.term || job.progress.current_term;
      job.progress.current_page = activeRun?.pages_completed || job.progress.current_page;
      job.progress.current_term_collected = activeRun?.items_collected ?? job.progress.current_term_collected;
      job.progress.current_term_total_reported = activeRun?.total_reported || job.progress.current_term_total_reported;
      job.progress.current_term_unique_new = activeRun?.unique_new ?? job.progress.current_term_unique_new;
      job.progress.current_term_duplicates = activeRun?.duplicates_skipped ?? job.progress.current_term_duplicates;
      job.progress.current_term_classified = activeRun?.classified_added ?? job.progress.current_term_classified;
      job.progress.terms_done = states.filter((s) => s.done).length;
      job.progress.terms_total = states.length;
      job.progress.schedule = 'round_robin_slices';
      job.progress.pages_per_slice = PNCP_DEEP_PAGES_PER_SLICE;
      job.progress.checkpoint = true;
      job.progress.gate = getPncpGateSnapshot();
      syncTermRunsList(states);
      job.updated_at = Date.now();
      await persistPncpDeepJob(job);
      lastSnapshotAt = Date.now();
      return classifiedThisSlice;
    };

    // Complemento consulta/proposta: intercala cedo (abertos úteis) e retoma página.
    // liveComplementRun já seedado acima a partir de priorTermRuns.
    let complementRun = liveComplementRun ? { ...liveComplementRun } : null;
    liveComplementRun = complementRun;
    const complementHighWater = Number(complementRun?.pages_completed || 0);
    let complementPage = Math.max(
      1,
      Number(complementRun?.pages_completed || 0) + 1,
      Number(complementRun?.next_page || 0) || 0
    );
    let complementDone = Boolean(
      complementRun
      && PNCP_TERM_RUN_DONE_STOPS.has(complementRun.stop_reason)
      && (Number(complementRun.pages_completed || 0) > 0 || complementRun.stop_reason === 'empty_page')
    );
    // Recoleta diária: feed /proposta em ordem pub antiga→nova (validado na API).
    // Cursor tail-first (páginas finais = mais recentes) andando para trás.
    let propostaCursorBackward = false;
    let propostaTotalPages = Number(job.progress?.proposta_total_pages || complementRun?.total_pages || 0) || 0;
    if (incrementalRefresh && shouldApplyReceivingProposalLocally) {
      complementDone = false;
      propostaCursorBackward = true;
      const savedCursor = Number(job.progress?.proposta_cursor_page || 0);
      if (savedCursor > 0) {
        complementPage = savedCursor;
      } else if (propostaTotalPages > 0) {
        complementPage = propostaTotalPages;
      } else {
        // Bootstrap: 1 request barata pega totalPaginas e salta para o fim.
        try {
          const fmtDate = (d) => d.toISOString().split('T')[0].replace(/-/g, '');
          const fim = new Date();
          fim.setDate(fim.getDate() + 180);
          const probe = await withPncpGate(
            () => fetchPncpConsulta('/v1/contratacoes/proposta', {
              dataFinal: fmtDate(fim),
              pagina: 1,
              tamanhoPagina: 50,
              ...(filters.modalidade_licitacao_id
                ? { codigoModalidadeContratacao: filters.modalidade_licitacao_id }
                : {}),
              ...(filters.uf ? { uf: filters.uf } : {}),
            }),
            { priority: 'bulk' }
          );
          propostaTotalPages = Math.max(1, Number(probe?.totalPaginas) || 1);
          job.progress.proposta_total_pages = propostaTotalPages;
          complementPage = propostaTotalPages;
          console.log(
            `[PNCP Deep Search] job ${jobId} /proposta bootstrap tail: ` +
            `totalPaginas=${propostaTotalPages} totalRegistros=${probe?.totalRegistros || '?'}`
          );
        } catch (probeErr) {
          console.warn(`[PNCP Deep Search] job ${jobId} /proposta bootstrap falhou:`, probeErr.message);
          complementPage = 1;
          propostaCursorBackward = false;
        }
      }
      if (complementRun) {
        complementRun = {
          ...complementRun,
          stop_reason: null,
          next_page: complementPage,
        };
        liveComplementRun = complementRun;
      }
      job.progress.proposta_cursor_direction = propostaCursorBackward ? 'backward' : 'forward';
    }
    const COMPLEMENT_PAGES_PER_SLICE = Math.max(1, Math.min(4, Number(process.env.PNCP_COMPLEMENT_PAGES_PER_SLICE) || 2));

    const runComplementSlice = async (states, reason = 'interleave') => {
      if (complementDone || PNCP_DEEP_SEARCH_CANCELLED.has(jobId)) return { paused: false, classified: 0 };
      if (!shouldApplyReceivingProposalLocally && mappedStatus && mappedStatus !== 'todos') {
        // Sem filtro de abertos e sem “todos”, publicacao exige modalidade — skip se não tiver.
        if (!filters.modalidade_licitacao_id) return { paused: false, classified: 0 };
      }
      const sessionRawFrom = rawItems.length;
      const sliceStartPage = complementPage;
      // Em modo backward: fatia vai de (page - N + 1) .. page, lida em ordem crescente pela API.
      let fetchStartPage = complementPage;
      if (incrementalRefresh && propostaCursorBackward) {
        fetchStartPage = Math.max(1, complementPage - COMPLEMENT_PAGES_PER_SLICE + 1);
      }
      console.log(
        `[PNCP Deep Search] job ${jobId} complemento consulta pág.${fetchStartPage}+ ` +
        `(${reason}, ${COMPLEMENT_PAGES_PER_SLICE} pág/fatia` +
        `${propostaCursorBackward ? ', tail→head' : ''})`
      );
      job.progress.current_term = '(consulta por data)';
      job.progress.current_page = fetchStartPage;
      const run = await fetchConsultaComplementItems({
        qText,
        terms,
        filters,
        mappedStatus,
        shouldApplyReceivingProposalLocally,
        seen,
        rawItems,
        dupRefreshItems,
        maxPages: 40,
        startPage: fetchStartPage,
        pagesThisSlice: COMPLEMENT_PAGES_PER_SLICE,
        priorRun: complementRun,
        priority: 'bulk',
        preserveHighWaterPages: Boolean(incrementalRefresh),
      });
      complementRun = run;
      liveComplementRun = run;
      if (Number(run.total_pages || 0) > 0) {
        propostaTotalPages = Math.max(propostaTotalPages, Number(run.total_pages));
        job.progress.proposta_total_pages = propostaTotalPages;
      }
      const terminalStops = PNCP_TERM_RUN_DONE_STOPS.has(run.stop_reason)
        || run.stop_reason === 'sem_termos'
        || run.stop_reason === 'publicacao_requer_modalidade';
      if (terminalStops && !incrementalRefresh) {
        complementDone = true;
      } else if (incrementalRefresh && propostaCursorBackward) {
        // Andou para trás: próximo cursor fica abaixo do início desta fatia.
        const nextBack = fetchStartPage - 1;
        if (nextBack < 1 || run.stop_reason === 'empty_page') {
          // Ciclo completo (ou buraco no topo): no próximo daily recomeça no tail.
          const wrapTo = Math.max(1, propostaTotalPages || Number(run.total_pages) || 1);
          complementPage = wrapTo;
          run.next_page = wrapTo;
          job.progress.proposta_cursor_page = wrapTo;
          complementDone = true;
        } else {
          complementPage = nextBack;
          run.next_page = nextBack;
          job.progress.proposta_cursor_page = nextBack;
        }
      } else if (run.stop_reason === 'total_reached' || run.stop_reason === 'empty_page') {
        if (incrementalRefresh) {
          const wrapTo = Math.max(1, propostaTotalPages || 1);
          complementPage = wrapTo;
          run.next_page = wrapTo;
          job.progress.proposta_cursor_page = wrapTo;
          complementDone = true;
        } else {
          complementDone = true;
        }
      } else {
        // Forward (varredura completa / early): avança cursor da fatia.
        const sliceNext = Number(run.slice_next_page || 0);
        const advancedTo = Number(run.pages_completed || 0);
        complementPage = Math.max(complementPage, advancedTo + 1, sliceNext || 0);
        run.next_page = complementPage;
        if (incrementalRefresh) {
          job.progress.proposta_cursor_page = complementPage;
        }
      }
      if (incrementalRefresh && complementHighWater > 0) {
        run.pages_completed = Math.max(complementHighWater, Number(run.pages_completed || 0));
      }
      const classified = await persistSliceProgress(states, run, sessionRawFrom);
      if (run.stop_reason === 'rate_limited') {
        job.status = 'paused_rate_limit';
        const pauseLeft = Math.max(0, PNCP_GATE.pausedUntil - Date.now());
        const resumeIn = Math.max(PNCP_RATE_LIMIT_RESUME_DELAY_MS, pauseLeft + 30_000);
        job.error = (
          `PNCP limitou no complemento (consulta abertos) pág.${complementPage} ` +
          `(${job.total} na lista). Pausa ~${Math.ceil(resumeIn / 60000)} min; ` +
          `retoma sem recomeçar — acervo preservado · gap ${PNCP_GATE.gapMs}ms.`
        );
        job.progress = {
          ...(job.progress || {}),
          rate_limited: true,
          gate: getPncpGateSnapshot(),
          resume_in_ms: resumeIn,
          resume_from_page: complementPage,
          proposta_cursor_page: job.progress?.proposta_cursor_page || complementPage,
          current_term: '(consulta por data)',
          classified_total: job.total,
          checkpoint: true,
        };
        await persistPncpDeepJob(job);
        schedulePncpSearchResume(job.id, resumeIn);
        return { paused: true, classified };
      }
      return { paused: false, classified };
    };

    job.status = 'running';
    job.progress = {
      ...(job.progress || {}),
      current_term: '',
      terms_done: 0,
      terms_total: terms.length,
      items_collected: preserveResults ? Number(job.progress?.items_collected || job.total || 0) : 0,
      classified_total: job.total,
      preserve_results: preserveResults,
      resumed: Boolean(preserveResults && checkpointMode),
      checkpoint_mode: Boolean(preserveResults && checkpointMode),
      checkpoint: Boolean(preserveResults && checkpointMode),
      schedule: 'round_robin_slices',
      pages_per_slice: PNCP_DEEP_PAGES_PER_SLICE,
      gate: getPncpGateSnapshot(),
    };
    await persistPncpDeepJob(job);

    // Inicializa estados; termos já concluídos ficam done (não re-pedem páginas).
    let states = terms.map((t, i) => buildTermState(t, i));
    syncTermRunsList(states);
    // Preferência de rodízio: quem tem menos páginas feitas primeiro (novos termos
    // na fila saltam na frente do monstro de 4k+ resultados). Termos com streak
    // de zero únicos novos caem no fim (diminishing returns / overlap).
    const orderForRound = () => {
      const pending = states.filter((s) => !s.done);
      pending.sort((a, b) => {
        const za = Number(a.zeroUniqueStreak || 0);
        const zb = Number(b.zeroUniqueStreak || 0);
        if (za !== zb) return za - zb;
        const pa = Number(a.run.pages_completed || 0);
        const pb = Number(b.run.pages_completed || 0);
        if (pa !== pb) return pa - pb;
        return a.index - b.index;
      });
      return pending;
    };

    console.log(
      `[PNCP Deep Search] job ${jobId} rodízio: ${states.length} termo(s), ` +
      `${PNCP_DEEP_PAGES_PER_SLICE} pág/fatia, checkpoint=${checkpointMode}, ` +
      `incremental=${incrementalRefresh}${incrementalRefresh ? ` (probe ${PNCP_DEEP_INCREMENTAL_PAGES} pág/termo)` : ''}, ` +
      `preserve=${preserveResults}, lista=${job.total}`
    );

    // Fatia inicial de consulta/proposta: enche a lista com abertos cedo.
    // Em recoleta incremental: várias fatias a partir do cursor rotativo
    // (/proposta) para achar reaberturas sem reler o search 1..K.
    if (shouldApplyReceivingProposalLocally && !complementDone) {
      if (incrementalRefresh) {
        const maxSlices = PNCP_DEEP_PROPOSTA_INCREMENTAL_SLICES;
        console.log(
          `[PNCP Deep Search] job ${jobId} delta /proposta: cursor pág.${complementPage}, ` +
          `até ${maxSlices} fatia(s) × ${COMPLEMENT_PAGES_PER_SLICE} pág`
        );
        for (let sliceIdx = 0; sliceIdx < maxSlices && !complementDone; sliceIdx += 1) {
          if (PNCP_DEEP_SEARCH_CANCELLED.has(jobId)) break;
          const early = await runComplementSlice(states, `incremental_${sliceIdx + 1}`);
          if (early?.paused) return;
          if (complementDone) break;
          // Rate-limit / terminal já tratados; slice_yield → próxima fatia.
          if (
            complementRun?.stop_reason
            && !['slice_yield', 'incremental_probe_done', 'max_pages'].includes(complementRun.stop_reason)
            && complementRun.stop_reason !== 'rate_limited'
          ) {
            break;
          }
        }
        complementDone = true;
        if (complementRun && !PNCP_TERM_RUN_DONE_STOPS.has(complementRun.stop_reason)) {
          complementRun.stop_reason = 'incremental_probe_done';
          liveComplementRun = complementRun;
        }
        job.progress.proposta_cursor_page = complementPage;
        job.progress.proposta_slices_ran = PNCP_DEEP_PROPOSTA_INCREMENTAL_SLICES;
      } else {
        const early = await runComplementSlice(states, 'early');
        if (early?.paused) return;
      }
    }

    // Loop de rodízio até todos terminarem ou rate-limit.
    let safetyRounds = 0;
    const maxRounds = Math.max(50, states.length * Math.ceil(maxPagesPerTerm / PNCP_DEEP_PAGES_PER_SLICE) + 10);
    while (states.some((s) => !s.done) && safetyRounds < maxRounds) {
      if (PNCP_DEEP_SEARCH_CANCELLED.has(jobId)) throw new Error('cancelled');
      // Termos anexados no meio da corrida entram no rodízio.
      terms = mergeUniqueTerms([qText], job.terms || []).filter(Boolean).slice(0, 12);
      const known = new Set(states.map((s) => normalizeSearchText(s.term)));
      terms.forEach((t, i) => {
        const key = normalizeSearchText(t);
        if (!known.has(key)) {
          states.push(buildTermState(t, states.length || i));
          known.add(key);
        }
      });
      job.progress.terms_total = states.length;

      const round = orderForRound();
      if (!round.length) break;
      safetyRounds += 1;
      let progressedThisRound = false;

      for (const st of round) {
        if (PNCP_DEEP_SEARCH_CANCELLED.has(jobId)) throw new Error('cancelled');
        if (st.done) continue;

        const run = st.run;
        const sessionRawFrom = rawItems.length;
        const sliceStartPage = st.page;
        let pagesThisSlice = 0;
        let observedPageSize = Number(run.observed_page_size || 0);
        let totalFromApi = Number(run.total_reported || 0);
        const sliceStartedAt = Date.now();
        run.stop_reason = null;
        run.next_page = st.page;
        job.progress.current_term = st.term;
        job.progress.current_page = st.page;
        job.progress.resume_from_page = sliceStartPage > 1 ? sliceStartPage : null;
        job.progress.slice_pages = PNCP_DEEP_PAGES_PER_SLICE;
        job.progress.checkpoint = true;

        if (sliceStartPage > 1) {
          console.log(
            `[PNCP Deep Search] job ${jobId} fatia "${st.term}" pág.${sliceStartPage}+ ` +
            `(${run.items_collected}/${run.total_reported || '?'} brutos, ` +
            `únicos=${run.unique_new || 0}, lista=${job.total}) — sem recomeçar`
          );
        }

        const pageCap = st.incrementalOnly
          ? Math.min(maxPagesPerTerm, Number(st.incrementalPageCap || PNCP_DEEP_INCREMENTAL_PAGES))
          : maxPagesPerTerm;
        const sliceCap = st.incrementalOnly
          ? pageCap
          : PNCP_DEEP_PAGES_PER_SLICE;
        while (
          pagesThisSlice < sliceCap
          && st.page <= pageCap
          && !st.done
        ) {
          if (PNCP_DEEP_SEARCH_CANCELLED.has(jobId)) throw new Error('cancelled');
          const page = st.page;
          run.pages_requested += 1;
          let data;
          try {
            // retries: 0 — retry imediato em 56/reset piora o throttle; o gate pausa e retoma.
            data = await withPncpGate(
              () => fetchPncpSearchStable({ ...baseParams, q: st.term, pagina: page }, { retries: 0 }),
              { priority: 'bulk' }
            );
          } catch (error) {
            run.errors.push(`pagina ${page}: ${error.message}`);
            run.errors = run.errors.slice(-12);
            run.next_page = page; // mesma página na retomada (não pular)
            if (isPncpBulkDeferredError(error)) {
              // Gate/orçamento bulk esgotado — libera heavy slot via pause (não é throttle do IP).
              run.stop_reason = 'rate_limited';
            } else if (isPncpThrottleError(error)) {
              notePncpThrottle(error.message || 'search page');
              run.stop_reason = 'rate_limited';
            } else {
              run.stop_reason = run.items_collected > 0 ? 'page_error_partial' : 'page_error';
            }
            break;
          }

          // Probe incremental: mantém high-water de páginas do varredura completa.
          if (st.incrementalOnly) {
            run.pages_completed = Math.max(Number(st.priorHighWaterPages || 0), Number(run.pages_completed || 0), page);
          } else {
            run.pages_completed = page;
          }
          st.page = page;
          const items = Array.isArray(data?.items) ? data.items : [];
          if (page === 1 || !totalFromApi) {
            totalFromApi = Number(data?.total) || totalFromApi || 0;
            run.total_reported = totalFromApi;
          }
          if (!items.length) {
            run.stop_reason = 'empty_page';
            st.done = true;
            break;
          }
          if (!observedPageSize) {
            observedPageSize = items.length;
            run.observed_page_size = observedPageSize;
          }
          let newUnique = 0;
          let dups = 0;
          items.forEach((item) => {
            const key = getPncpRawItemKey(item);
            if (!key) return;
            if (seen.has(key)) {
              dups += 1;
              if (dupRefreshItems.length < PNCP_DEEP_DUP_REFRESH_CAP) {
                dupRefreshItems.push({ ...item, __matched_termo: st.term });
              }
              return;
            }
            seen.add(key);
            rawItems.push({ ...item, __matched_termo: st.term });
            newUnique += 1;
          });
          // Probe diário: não reinfla items_collected com páginas já contadas no varredura.
          // Parte de prevItems e só soma chaves novas desta sonda.
          if (st.incrementalOnly) {
            run.items_collected = Number(run.items_collected || 0) + newUnique;
          } else {
            run.items_collected += items.length;
          }
          run.unique_new = Number(run.unique_new || 0) + newUnique;
          run.duplicates_skipped = Number(run.duplicates_skipped || 0) + dups;
          if (newUnique === 0) st.zeroUniqueStreak = Number(st.zeroUniqueStreak || 0) + 1;
          else st.zeroUniqueStreak = 0;
          pagesThisSlice += 1;
          progressedThisRound = true;
          job.progress.items_collected = Math.max(classifiedBaseline, seen.size, Number(job.progress.items_collected || 0));
          job.progress.raw_unique_session = rawItems.length;
          job.progress.current_page = page;
          job.progress.current_term_collected = run.items_collected;
          job.progress.current_term_total_reported = totalFromApi || null;
          job.progress.new_unique_last_page = newUnique;
          job.progress.current_term_unique_new = run.unique_new;
          job.progress.current_term_duplicates = run.duplicates_skipped;
          job.progress.incremental_probe = Boolean(st.incrementalOnly);
          job.updated_at = Date.now();

          if (
            (page === 1 || page === sliceStartPage || page % 2 === 0 || Date.now() - lastSnapshotAt > 2500)
            && rawItems.length > sessionRawFrom
          ) {
            syncTermRunsList(states);
            await persistSliceProgress(states, run, sessionRawFrom);
          }

          if (items.length < observedPageSize) {
            run.stop_reason = st.incrementalOnly
              ? (st.priorDoneStop || 'incremental_probe_done')
              : 'short_page';
            st.done = true;
            break;
          }
          if (!st.incrementalOnly && totalFromApi > 0 && run.items_collected >= totalFromApi) {
            run.stop_reason = 'total_reached';
            st.done = true;
            break;
          }
          // Probe diário: esgotou as N primeiras páginas → fim (não continua o universo).
          if (st.incrementalOnly && page >= pageCap) {
            run.stop_reason = st.priorDoneStop || 'incremental_probe_done';
            run.next_page = null;
            st.done = true;
            break;
          }
          // Overlap alto: 3 páginas seguidas sem único novo → cede a vez (não marca done).
          // No probe incremental, zero unique é esperado (já vistos) — não aborta cedo.
          if (!st.incrementalOnly && st.zeroUniqueStreak >= 3 && pagesThisSlice >= 2) {
            run.stop_reason = 'slice_yield';
            st.page = page + 1;
            run.next_page = st.page;
            break;
          }
          st.page = page + 1;
          run.next_page = st.page;
          // Folga entre páginas (além do gap do gate).
          if (!PNCP_DEEP_SEARCH_CANCELLED.has(jobId) && pagesThisSlice < sliceCap) {
            const pagePause = Math.min(1500, Math.max(250, Math.round(PNCP_GATE.gapMs * 0.4)));
            if (pagePause > 0) await sleep(pagePause);
          }
        }

        run.slices = Number(run.slices || 0) + 1;
        run.duration_ms = Number(run.duration_ms || 0) + (Date.now() - sliceStartedAt);

        if (run.stop_reason === 'rate_limited' || run.stop_reason === 'page_error' || run.stop_reason === 'page_error_partial') {
          // Checkpoint e pausa — lista e páginas já lidas ficam; retoma da próxima página.
          syncTermRunsList(states);
          await persistSliceProgress(states, run, sessionRawFrom);
          if (run.stop_reason === 'rate_limited') {
            job.status = 'paused_rate_limit';
            const pauseLeft = Math.max(0, PNCP_GATE.pausedUntil - Date.now());
            const resumeIn = Math.max(PNCP_RATE_LIMIT_RESUME_DELAY_MS, pauseLeft + 30_000);
            const nextPage = Number(run.next_page || (Number(run.pages_completed || 0) + 1));
            run.next_page = nextPage;
            const pendingNames = states.filter((s) => !s.done && s.term !== st.term).map((s) => s.term).slice(0, 4);
            job.error = (
              `PNCP limitou em “${st.term}” pág.${nextPage} ` +
              `(${run.items_collected}/${run.total_reported || '?'} brutos · ${job.total} na lista preservada). ` +
              `Pausa ~${Math.ceil(resumeIn / 60000)} min; retoma da pág.${nextPage} sem recomeçar` +
              (pendingNames.length ? ` · também: ${pendingNames.join(', ')}` : '') +
              ` · gap ${PNCP_GATE.gapMs}ms.`
            );
            job.progress = {
              ...(job.progress || {}),
              rate_limited: true,
              gate: getPncpGateSnapshot(),
              resume_in_ms: resumeIn,
              resume_from_page: nextPage,
              current_term: st.term,
              current_page: run.pages_completed,
              current_term_collected: run.items_collected,
              current_term_total_reported: run.total_reported || null,
              current_term_unique_new: run.unique_new,
              current_term_duplicates: run.duplicates_skipped,
              current_term_classified: run.classified_added,
              classified_total: job.total,
              schedule: 'round_robin_slices',
              pages_per_slice: PNCP_DEEP_PAGES_PER_SLICE,
              terms_done: states.filter((s) => s.done).length,
              terms_total: states.length,
              checkpoint: true,
            };
            await persistPncpDeepJob(job);
            schedulePncpSearchResume(job.id, resumeIn);
            return;
          }
          // Erro não-throttle: cede a vez; tenta a mesma/próxima página em outra rodada.
          run.stop_reason = 'slice_yield';
          st.page = Math.max(st.page, Number(run.next_page || 0), Number(run.pages_completed || 0) + 1);
          run.next_page = st.page;
        } else if (!st.done) {
          // Fatia esgotada sem terminar o universo → cede a vez aos outros termos.
          run.stop_reason = 'slice_yield';
          run.next_page = st.page;
        }

        syncTermRunsList(states);
        await persistSliceProgress(states, run, sessionRawFrom);

        // Pausa leve entre frentes do rodízio.
        if (!PNCP_DEEP_SEARCH_CANCELLED.has(jobId) && states.some((s) => !s.done)) {
          await sleep(Math.min(2000, Math.max(300, Math.round(PNCP_GATE.gapMs * 0.5))));
        }
      }

      // Intercala complemento de abertos entre rodadas (lista útil cresce cedo).
      if (!complementDone && !PNCP_DEEP_SEARCH_CANCELLED.has(jobId) && shouldApplyReceivingProposalLocally) {
        const mid = await runComplementSlice(states, `round_${safetyRounds}`);
        if (mid?.paused) return;
        if (mid?.classified > 0) progressedThisRound = true;
      }

      if (!progressedThisRound) {
        // Nenhum termo avançou (todos erro/vazio): evita loop quente.
        // NÃO marca done permanente se ainda há páginas — pausa e retoma.
        console.warn(`[PNCP Deep Search] job ${jobId} rodada sem progresso — pausando para retomar (acervo preservado)`);
        states.forEach((s) => {
          if (!s.done) {
            s.run.stop_reason = s.run.stop_reason || 'slice_yield';
            s.run.next_page = Math.max(s.page, Number(s.run.pages_completed || 0) + 1);
          }
        });
        syncTermRunsList(states);
        job.status = 'paused_rate_limit';
        const resumeIn = Math.max(60_000, PNCP_RATE_LIMIT_RESUME_DELAY_MS);
        job.error = (
          `Sem progresso nesta rodada (PNCP lento ou throttle). ` +
          `${job.total} na lista preservados. Retoma em ~${Math.ceil(resumeIn / 60000)} min sem recomeçar.`
        );
        job.progress = {
          ...(job.progress || {}),
          rate_limited: true,
          gate: getPncpGateSnapshot(),
          resume_in_ms: resumeIn,
          checkpoint: true,
          classified_total: job.total,
        };
        await persistPncpDeepJob(job);
        schedulePncpSearchResume(job.id, resumeIn);
        return;
      }
    }

    // Marca fatias abertas como concluídas se o safety cortou (não deveria).
    states.forEach((s) => {
      if (!s.done && s.run.stop_reason === 'slice_yield') {
        // Ainda havia páginas — se saímos do while por maxRounds, deixa como partial via slice_yield
        // e NÃO marca completed globalmente sem terminar.
      }
    });
    const allDone = states.every((s) => s.done);
    if (!allDone) {
      // Ainda há fatias pendentes: pausa curta e retoma (evita travar o heavy slot por horas).
      states.forEach((s) => {
        if (!s.done && !PNCP_TERM_RUN_DONE_STOPS.has(s.run.stop_reason)) {
          s.run.stop_reason = 'slice_yield';
        }
      });
      syncTermRunsList(states);
      job.status = 'paused_rate_limit';
      const resumeIn = Math.max(45_000, PNCP_RATE_LIMIT_RESUME_DELAY_MS / 2);
      job.error = (
        `Rodízio parcial: ainda há frentes incompletas · ${job.total} na lista preservados. ` +
        `Retoma em ~${Math.ceil(resumeIn / 60000)} min sem recomeçar as páginas já lidas.`
      );
      job.progress = {
        ...(job.progress || {}),
        rate_limited: false,
        slice_yield_pause: true,
        resume_in_ms: resumeIn,
        schedule: 'round_robin_slices',
        terms_done: states.filter((s) => s.done).length,
        terms_total: states.length,
        classified_total: job.total,
        checkpoint: true,
        gate: getPncpGateSnapshot(),
      };
      await persistPncpDeepJob(job);
      schedulePncpSearchResume(job.id, resumeIn);
      return;
    }

    // Complemento final: esgota páginas restantes da consulta (já intercalado antes).
    // Não recomeça do zero — continua de complementPage / priorRun.
    // Incremental diário: já rodou fatias no cursor — não esgota o endpoint.
    if (incrementalRefresh) {
      complementDone = true;
      job.progress.proposta_cursor_page = Number(job.progress?.proposta_cursor_page || complementPage || 1);
    }
    if (!PNCP_DEEP_SEARCH_CANCELLED.has(jobId) && !complementDone) {
      let complementGuard = 0;
      while (!complementDone && !PNCP_DEEP_SEARCH_CANCELLED.has(jobId) && complementGuard < 25) {
        complementGuard += 1;
        const fin = await runComplementSlice(states, 'final');
        if (fin?.paused) return;
        if (complementDone) break;
        if (complementRun?.stop_reason === 'slice_yield') continue;
        // rate_limited já retornou; demais stops encerram o complemento.
        break;
      }
      job.progress.items_collected = Math.max(classifiedBaseline, seen.size, rawItems.length);
    }
    if (complementRun) {
      const withoutComp = termRuns.filter((r) => r?.source !== 'pncp_consulta_complement');
      termRuns.length = 0;
      termRuns.push(...withoutComp, complementRun);
      job.term_runs = termRuns;
    }

    // Refresh de situacao/datas em itens que reapareceram no probe (já estavam no acervo).
    if (dupRefreshItems.length && !PNCP_DEEP_SEARCH_CANCELLED.has(jobId)) {
      try {
        const dupStats = await applyPncpDuplicateStatusRefresh(job, dupRefreshItems, {
          qText,
          terms,
          negativeTerms,
          filters,
          mappedStatus,
          shouldApplyReceivingProposalLocally,
        });
        job.progress.dup_status_refresh = dupStats;
        if (dupStats.stale > 0 || dupStats.reopened > 0) {
          await refreshPncpJobSummaryTotals(job);
        }
        console.log(
          `[PNCP Deep Search] job ${jobId} dup-refresh: ` +
          `refreshed=${dupStats.refreshed} stale=${dupStats.stale} reopened=${dupStats.reopened || 0}`
        );
      } catch (dupErr) {
        console.warn(`[PNCP Deep Search] job ${jobId} dup-refresh falhou:`, dupErr.message);
      }
    }

    // Snapshot final só dos itens brutos desta execução (acervo antigo já está no DB).
    const finalSnapshot = rawItems.length
      ? await buildDeepSearchItemsSnapshot({
        rawItems,
        qText,
        negativeTerms,
        terms,
        filters,
        mappedStatus,
        shouldApplyReceivingProposalLocally,
        enrichValues: true,
        enrichLimit: 500,
        enrichDelayMs: 100,
        // maxPages do enrich interno: via fillPncpMissingEstimatedValues default 8
      })
      : { items: [], summary: createPncpSearchSummary([]), query_plan: { mode: 'deep_background', terms } };
    job.status = 'completed';
    if (!preserveResults) {
      // Snapshot final substitui o conjunto (filtros novos): limpa órfãos e grava de novo.
      await clearPncpJobResults(jobId);
    }
    // Com preserve: UPSERT só acrescenta/atualiza; resultados antigos permanecem.
    if (finalSnapshot.items.length) {
      await persistPncpJobResults(job, finalSnapshot.items);
    }
    job.items = finalSnapshot.items.slice(0, 200);
    // Total canônico = o que está na tabela de resultados (mesma fonte do popup).
    await refreshPncpJobSummaryTotals(job);
    job.total = Number(job.summary?.count || job.total || finalSnapshot.items.length);
    job.summary = {
      ...finalSnapshot.summary,
      ...job.summary,
      count: job.total,
      run_count: finalSnapshot.summary?.count ?? finalSnapshot.items.length,
      total_value: Number(job.summary?.total_value || finalSnapshot.summary?.total_value || 0),
    };
    job.term_runs = termRuns;
    job.progress = {
      ...(job.progress || {}),
      classified_total: job.total,
      items_collected: Math.max(classifiedBaseline, seen.size, job.total),
      rate_limited: false,
      resume_from_page: null,
      checkpoint: false,
      incremental_refresh: false,
      last_run_incremental: Boolean(incrementalRefresh),
      // Cursor rotativo de /proposta sobrevive entre dailies (reaberturas).
      proposta_cursor_page: Number(
        job.progress?.proposta_cursor_page || (incrementalRefresh ? complementPage : 0) || 0
      ) || undefined,
      gate: getPncpGateSnapshot(),
    };
    job.query_plan = {
      ...finalSnapshot.query_plan,
      terms,
      term_runs: termRuns,
      terms_planned: terms,
      terms_executed: termRuns.filter(r => r?.term && r?.source !== 'pncp_consulta_complement').map(r => r.term),
      partial: false,
      results_persisted: job.total,
      preserve_results: preserveResults,
      sequential: false,
      schedule: incrementalRefresh ? 'incremental_daily' : 'round_robin_slices',
      pages_per_slice: incrementalRefresh ? PNCP_DEEP_INCREMENTAL_PAGES : PNCP_DEEP_PAGES_PER_SLICE,
      raw_unique_collected: seen.size,
      filtered_total: job.total,
      incremental_refresh: Boolean(incrementalRefresh),
      proposta_cursor_page: job.progress?.proposta_cursor_page || null,
      dup_status_refresh: job.progress?.dup_status_refresh || null,
    };
    job.preserve_results = true;
    job.error = null;
    job.updated_at = Date.now();

    // No daily: amostra o acervo local para pegar suspensões que o probe não viu.
    if (incrementalRefresh && shouldApplyReceivingProposalLocally && !PNCP_DEEP_SEARCH_CANCELLED.has(jobId)) {
      try {
        const rec = await reconcilePncpJobResultStatuses(job, {
          limit: Math.min(PNCP_STATUS_RECONCILE_PER_JOB, 20),
        });
        job.progress = { ...(job.progress || {}), status_reconcile: rec };
        if (rec.stale > 0) {
          await refreshPncpJobSummaryTotals(job);
        }
        console.log(
          `[PNCP Deep Search] job ${jobId} status-reconcile: ` +
          `checked=${rec.checked} stale=${rec.stale} open=${rec.open}`
        );
      } catch (recErr) {
        console.warn(`[PNCP Deep Search] job ${jobId} status-reconcile falhou:`, recErr.message);
      }
    }

    await persistPncpDeepJob(job);
    const jobLabel = job.nome || job.filters?.q || 'PNCP';
    const totalResults = Number(job.total || 0);
    await notifyAccountUsers(pool, {
      accountId: job.account_id || CHATWOOT_ACCOUNT_ID,
      type: 'search.job_completed',
      title: `Busca concluída · "${String(jobLabel).slice(0, 60)}"`,
      body: `${totalResults.toLocaleString('pt-BR')} resultado${totalResults === 1 ? '' : 's'} encontrados.`,
      data: {
        view: 'Licitações',
        sub: 'editais',
        job_id: jobId,
      },
      dedupeKey: `job:${jobId}:completed`,
    }).catch((err) => console.warn('[pncp-job] push/inbox falhou:', err.message));
  } catch (error) {
    job.status = error.message === 'cancelled' ? 'cancelled' : 'failed';
    job.error = error.message === 'cancelled' ? null : error.message;
    job.updated_at = Date.now();
    await persistPncpDeepJob(job);
  } finally {
    PNCP_DEEP_SEARCH_CANCELLED.delete(jobId);
  }
};

app.get('/api/licitacoes/pncp/search/jobs', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const { rows } = await pool.query(
      `SELECT j.id, j.nome, j.status, j.filters, j.terms, j.negative_terms, j.accepted_positive_terms, j.accepted_negative_terms,
              j.suggested_positive_terms, j.suggested_negative_terms, j.progress, j.term_runs, j.summary,
              COALESCE(rc.cnt, j.total, 0)::int AS total,
              j.error, j.watchlist_id, j.started_at, j.updated_at, j.completed_at,
              w.whatsapp_enabled, w.whatsapp_number, w.whatsapp_min_score
         FROM ${PNCP_SEARCH_JOBS_TABLE} j
         LEFT JOIN (
           SELECT job_id, COUNT(*)::int AS cnt
             FROM ${PNCP_SEARCH_JOB_RESULTS_TABLE}
            GROUP BY job_id
         ) rc ON rc.job_id = j.id
         LEFT JOIN ${EDITAL_WATCHLIST_TABLE} w ON w.id = j.watchlist_id
        WHERE j.account_id = $1
        ORDER BY j.updated_at DESC
        LIMIT 20`,
      [accountId]
    );
    res.json(rows.map(normalizePncpSearchJobRow));
  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar pesquisas PNCP', details: error.message });
  }
});

app.post('/api/licitacoes/pncp/search/deep-start', async (req, res) => {
  cleanupPncpDeepJobs();
  const accountId = getAccountId(req);
  const filters = req.body?.filters || {};
  const acceptedPositive = Array.isArray(req.body?.accepted_positive_terms) ? req.body.accepted_positive_terms : [];
  const acceptedNegative = Array.isArray(req.body?.accepted_negative_terms) ? req.body.accepted_negative_terms : [];
  const suggestedPositive = Array.isArray(req.body?.suggested_positive_terms) ? req.body.suggested_positive_terms : [];
  const suggestedNegative = Array.isArray(req.body?.suggested_negative_terms) ? req.body.suggested_negative_terms : [];
  const terms = mergeUniqueTerms([filters.q], req.body?.terms || [], acceptedPositive).filter(Boolean).slice(0, 12);
  const negativeTerms = mergeUniqueTerms(splitPncpTerms(filters.negative_terms || ''), acceptedNegative);
  const signature = buildPncpJobSignature({ filters, terms, negativeTerms });
  const { rows: recentRows } = await pool.query(
    `SELECT *
       FROM ${PNCP_SEARCH_JOBS_TABLE}
      WHERE account_id = $1
        AND status NOT IN ('failed', 'cancelled')
        AND progress->>'signature' = $2
      ORDER BY updated_at DESC
      LIMIT 1`,
    [accountId, signature]
  );
  const existingJob = normalizePncpSearchJobRow(recentRows[0]);
  if (existingJob) {
    if (['queued', 'running', 'paused_rate_limit'].includes(existingJob.status)) {
      await startPersistedPncpSearchJob(existingJob);
    }
    return res.json({ job_id: existingJob.id, status: existingJob.status, reused: true });
  }

  const jobId = crypto.randomUUID();
  const job = {
    id: jobId,
    account_id: accountId,
    status: 'queued',
    filters,
    terms,
    negative_terms: negativeTerms,
    accepted_positive_terms: acceptedPositive,
    accepted_negative_terms: acceptedNegative,
    suggested_positive_terms: suggestedPositive,
    suggested_negative_terms: suggestedNegative,
    items: [],
    total: 0,
    progress: { current_term: '', terms_done: 0, terms_total: terms.length, items_collected: 0, signature },
    term_runs: [],
    started_at: Date.now(),
    updated_at: Date.now(),
  };
  await pool.query(
    `INSERT INTO ${PNCP_SEARCH_JOBS_TABLE}
       (id, account_id, nome, status, filters, terms, negative_terms, accepted_positive_terms,
        accepted_negative_terms, suggested_positive_terms, suggested_negative_terms, progress)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
    [
      jobId,
      accountId,
      String(filters.q || 'Busca PNCP').trim().slice(0, 160),
      'queued',
      JSON.stringify(filters),
      terms,
      negativeTerms,
      acceptedPositive,
      acceptedNegative,
      suggestedPositive,
      suggestedNegative,
      JSON.stringify(job.progress),
    ]
  );
  PNCP_DEEP_SEARCH_JOBS.set(jobId, job);
  setImmediate(() => runPncpDeepSearchJob(jobId));
  res.json({ job_id: jobId, status: 'queued' });
});

app.get('/api/licitacoes/pncp/search/deep/:jobId', async (req, res) => {
  cleanupPncpDeepJobs();
  const memoryJob = PNCP_DEEP_SEARCH_JOBS.get(req.params.jobId);
  const dbJob = memoryJob ? null : await loadPncpDeepJob(req.params.jobId, getAccountId(req));
  const job = memoryJob || dbJob;
  if (!job) return res.status(404).json({ error: 'Busca profunda não encontrada ou expirada' });
  // Job órfão: ficou queued/running no banco mas o worker (em memória) morreu num
  // restart. Ao abrir o job, retoma o processamento de onde parou (idempotente).
  if (!memoryJob && ['queued', 'running', 'paused_rate_limit'].includes(job.status)) {
    startPersistedPncpSearchJob(job, { force: true, preserveResults: true })
      .catch(err => console.warn('[PNCP Search Job] resume on open falhou:', err.message));
  }
  // Zombie em memória: status live no map sem worker, ou sem progresso há STALE_MS.
  if (
    memoryJob
    && ['queued', 'running'].includes(memoryJob.status)
    && (!isPncpDeepSearchWorkerAlive(memoryJob.id) || isPncpDeepSearchJobStale(memoryJob))
  ) {
    startPersistedPncpSearchJob(memoryJob, { force: true, preserveResults: true })
      .catch(err => console.warn('[PNCP Search Job] resume zombie on open falhou:', err.message));
  }
  // Job "concluído" mas com coleta parcial (conexão resetada/rate limit no meio):
  // retoma automaticamente para completar o que faltou.
  if (!memoryJob && job.status === 'completed') {
    const partialRun = (job.term_runs || []).find(run =>
      ['rate_limited', 'page_error', 'page_error_partial'].includes(run?.stop_reason)
      && Number(run?.total_reported || 0) > Number(run?.items_collected || 0)
    );
    if (partialRun) {
      console.log(`[PNCP Search Job] ${job.id} concluiu parcial (${partialRun.stop_reason}) — retomando coleta.`);
      startPersistedPncpSearchJob(job, { force: true }).catch(err => console.warn('[PNCP Search Job] resume parcial falhou:', err.message));
    }
  }
  const archiveAt = getPncpSearchJobArchiveAt(job.started_at);
  const accountId = getAccountId(req);
  // Total canônico da lista ativa (sem descartados e sem já no pipeline) + contagem por termo.
  let listTotal = Number(job.total || 0);
  let listByTerm = {};
  let visibilityCounts = null;
  try {
    const aid = accountId || job.account_id || null;
    // Reconcile com o board antes de contar (marca visibility=pipeline).
    const vis = await countPncpJobResultsByVisibility(job.id, aid, { reconcile: true });
    const byTerm = await countPncpJobResultsByMatchedTerm(job.id, aid, { includeHidden: false, includePipeline: false });
    visibilityCounts = vis;
    // "Na lista" / total do card = disponíveis (sem descartados / sem pipeline).
    listTotal = Number(vis.list ?? byTerm.total ?? listTotal ?? 0);
    listByTerm = byTerm.by_term || {};
  } catch (err) {
    console.warn('[PNCP Search Job] contagem por termo falhou:', err.message);
  }
  res.json({
    id: job.id,
    status: job.status,
    filters: job.filters || {},
    terms: job.terms || [],
    negative_terms: job.negative_terms || [],
    accepted_positive_terms: job.accepted_positive_terms || [],
    accepted_negative_terms: job.accepted_negative_terms || [],
    suggested_positive_terms: job.suggested_positive_terms || [],
    suggested_negative_terms: job.suggested_negative_terms || [],
    progress: job.progress,
    // Preferir contagem da tabela (lista ativa, sem descartados).
    total: listTotal || job.total,
    visibility_counts: visibilityCounts,
    // Inclui 'queued': entre retomadas o status vira queued por um instante; o UI
    // não deve apagar a lista (itens/total vêm do último snapshot + tabela).
    items: ['queued', 'running', 'completed', 'paused_rate_limit', 'failed', 'cancelled'].includes(job.status)
      ? (job.items || [])
      : [],
    summary: job.summary || null,
    term_runs: job.term_runs || job.query_plan?.term_runs || [],
    // Contagem real na lista por matched_term (não o classified_added de fatia).
    list_by_term: listByTerm,
    list_total: listTotal,
    query_plan: {
      mode: 'deep_background',
      sequential: true,
      terms: job.terms || [],
      terms_planned: job.terms || [],
      terms_executed: (job.term_runs || job.query_plan?.term_runs || [])
        .filter(r => r?.term && r?.source !== 'pncp_consulta_complement')
        .map(r => r.term),
      ...(job.query_plan || {}),
      term_runs: job.term_runs || job.query_plan?.term_runs || [],
      list_by_term: listByTerm,
      list_total: listTotal,
    },
    error: job.error || null,
    watchlist_id: job.watchlist_id || null,
    started_at: job.started_at,
    updated_at: job.updated_at,
    completed_at: job.completed_at,
    archive_at: archiveAt ? archiveAt.toISOString() : null,
    days_until_archive: job.watchlist_id ? null : getPncpSearchJobDaysUntilArchive(job.started_at),
    archive_days: PNCP_SEARCH_JOB_ARCHIVE_DAYS,
  });
});

app.get('/api/licitacoes/pncp/search/deep/:jobId/results', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    let job = await loadPncpDeepJob(req.params.jobId, accountId);
    if (!job) return res.status(404).json({ error: 'Busca profunda nao encontrada' });

    // Garante lista sem prazos vencidos mesmo antes do cron diário.
    try {
      const purged = await purgeExpiredPncpJobResults({ jobId: job.id, accountId });
      if (purged.removed > 0) {
        job = PNCP_DEEP_SEARCH_JOBS.get(job.id) || await loadPncpDeepJob(job.id, accountId) || job;
      }
    } catch (purgeErr) {
      console.warn('[PNCP Job Results] purge on read falhou:', purgeErr.message);
    }

    const pagina = Math.max(1, Number(req.query.pagina || 1) || 1);
    const tam = Math.max(5, Math.min(100, Number(req.query.tam || 25) || 25));
    const offset = (pagina - 1) * tam;
    const ordenacao = String(req.query.ordenacao || job.filters?.ordenacao || 'relevancia_desc');
    // list (default) = disponíveis (sem descartados e sem já no pipeline);
    // pipeline = já no board; hidden = só descartados; everything = tudo no DB.
    const scope = String(req.query.scope || 'list').toLowerCase();
    const orderSql = ordenacao === 'valor_desc_data_desc'
      ? 'COALESCE(value_matched, value_estimated, 0) DESC, updated_at DESC'
      : ordenacao === 'valor_asc_data_desc'
        ? 'COALESCE(value_matched, value_estimated, 0) ASC, updated_at DESC'
        : ordenacao === 'data_desc'
          ? 'deadline_at DESC NULLS LAST, updated_at DESC'
          : ordenacao === 'data_asc'
            ? 'deadline_at ASC NULLS LAST, updated_at DESC'
            : 'score DESC NULLS LAST, COALESCE(value_matched, value_estimated, 0) DESC, updated_at DESC';
    // Reconcile board → visibility=pipeline antes de paginar/contar.
    const visibilityCounts = await countPncpJobResultsByVisibility(job.id, accountId, { reconcile: true });
    // list/all/active/visible: só visibility=visible; pipeline: já no board;
    // hidden/descartados: só hidden; everything: inclui tudo (debug).
    const visibilityClause = (scope === 'hidden' || scope === 'descartados' || scope === 'discarded')
      ? ` AND visibility = 'hidden'`
      : scope === 'pipeline'
        ? ` AND visibility = 'pipeline'`
        : (scope === 'everything' || scope === 'with_hidden')
          ? ''
          : ` AND visibility = 'visible'`; // list | all | active | visible | default

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM ${PNCP_SEARCH_JOB_RESULTS_TABLE} WHERE job_id = $1 AND account_id = $2${visibilityClause}`,
      [job.id, accountId]
    );
    const total = Number(countResult.rows[0]?.total || 0);
    const listTotalCanonical = Number(visibilityCounts.list || 0);
    if (total > 0 || visibilityCounts.all > 0) {
      const { rows } = total > 0
        ? await pool.query(
          `SELECT payload, visibility, result_key
             FROM ${PNCP_SEARCH_JOB_RESULTS_TABLE}
            WHERE job_id = $1 AND account_id = $2${visibilityClause}
            ORDER BY ${orderSql}
            LIMIT $3 OFFSET $4`,
          [job.id, accountId, tam, offset]
        )
        : { rows: [] };
      let pageItems = rows.map(row => {
        const payload = row.payload && typeof row.payload === 'object' ? { ...row.payload } : row.payload;
        if (payload && typeof payload === 'object') {
          payload.__visibility_db = row.visibility || 'visible';
          payload.__result_key = row.result_key || null;
        }
        return payload;
      }).filter(Boolean);
      // Valores de item não vêm da busca textual — insiste em enriquecer se faltar
      // valor_itens_pertinentes (total da licitação sozinho NÃO dispensa o enrich).
      const enrichOnRead = String(req.query.enrich || 'true') !== 'false';
      if (enrichOnRead && pageItems.some(itemNeedsPncpValueEnrichment)) {
        // Prazo curto: com o gate lento (job pesado coletando), responde com o que
        // tem e deixa o enriquecimento terminar em background — ele persiste os
        // valores e a próxima carga da página já os traz.
        const enrichPromise = enrichPncpJobResultPage(job, pageItems, { limit: tam })
          .catch(err => {
            console.warn('[PNCP Job Results] enrich on read falhou:', err.message);
            return null;
          });
        const enriched = await Promise.race([
          enrichPromise,
          new Promise(resolve => setTimeout(resolve, 3500, null)),
        ]);
        if (enriched) {
          // Reanexa metadados de visibility/result_key após o enrich (payload puro).
          const metaByKey = new Map(
            rows.map(r => [String(r.result_key || ''), { visibility: r.visibility, result_key: r.result_key }])
          );
          pageItems = enriched.map((item) => {
            if (!item || typeof item !== 'object') return item;
            const key = String(item.__result_key || getPncpSearchResultKey(item) || '');
            const meta = metaByKey.get(key);
            return {
              ...item,
              __visibility_db: item.__visibility_db || meta?.visibility || 'visible',
              __result_key: item.__result_key || meta?.result_key || key || null,
            };
          });
        }
      }
      // Soma/contagem da lista ativa (descartados fora do valor e do "na lista").
      const [listTotalValue, listByTerm] = await Promise.all([
        sumPncpJobResultsValue(job.id, accountId, { includeHidden: false }),
        countPncpJobResultsByMatchedTerm(job.id, accountId, { includeHidden: false }),
      ]);
      // Para aba descartados, count do response = do scope; summary do job mantém lista ativa.
      const summaryCount = (scope === 'hidden' || scope === 'descartados' || scope === 'discarded')
        ? total
        : (listTotalCanonical || total);
      const summary = {
        ...(job.summary && typeof job.summary === 'object' ? job.summary : {}),
        count: summaryCount,
        total_value: listTotalValue,
      };
      // Se enriquecemos a página, o SUM já pode ter subido; persiste no job p/ o card.
      if (listTotalValue > 0 && Number(job.summary?.total_value || 0) !== listTotalValue
          && scope !== 'hidden' && scope !== 'descartados' && scope !== 'discarded') {
        job.summary = summary;
        job.total = summaryCount;
        persistPncpDeepJob(job).catch(() => null);
      }
      return res.json({
        items: pageItems,
        total,
        pagina,
        tamanhoPagina: tam,
        totalPaginas: Math.max(1, Math.ceil((total || 1) / tam)),
        summary,
        values_enriched_on_read: enrichOnRead,
        visibility_counts: visibilityCounts,
        list_by_term: listByTerm.by_term || {},
        list_total: Number(listByTerm.total || listTotalCanonical || 0),
        // Progresso da coleta (auditoria/UI): brutos da API ≠ classificados no filtro.
        // classified = lista ativa (sem descartados e sem já no pipeline).
        collection: {
          classified: listTotalCanonical,
          discarded: Number(visibilityCounts.hidden || 0),
          pipeline: Number(visibilityCounts.pipeline || 0),
          current_term: job.progress?.current_term || null,
          current_page: job.progress?.current_page || null,
          resume_from_page: job.progress?.resume_from_page || null,
          term_collected: job.progress?.current_term_collected || null,
          term_total_api: job.progress?.current_term_total_reported || null,
          list_by_term: listByTerm.by_term || {},
          list_total: Number(listByTerm.total || listTotalCanonical || 0),
        },
      });
    }

    const fallbackItems = sortPncpJobResults(job.items || [], ordenacao);
    const fallbackTotal = fallbackItems.length;
    const fallbackSummary = createPncpSearchSummary(fallbackItems);
    res.json({
      items: fallbackItems.slice(offset, offset + tam),
      total: fallbackTotal,
      pagina,
      tamanhoPagina: tam,
      totalPaginas: Math.max(1, Math.ceil(fallbackTotal / tam)),
      summary: {
        ...(job.summary && typeof job.summary === 'object' ? job.summary : {}),
        ...fallbackSummary,
        count: fallbackTotal,
        total_value: Math.max(
          Number(job.summary?.total_value || 0),
          Number(fallbackSummary.total_value || 0)
        ),
      },
      visibility_counts: {
        all: fallbackTotal,
        list: fallbackTotal,
        visible: fallbackTotal,
        hidden: 0,
        pipeline: 0,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao paginar resultados da busca PNCP', details: error.message });
  }
});

// Descartar / restaurar item da lista de resultados do job (visibility hidden|visible).
// Descartados saem da lista ativa e da contagem; permanecem na aba Descartados até
// restaurar ou até o purge de prazo vencido removê-los do job.
app.patch('/api/licitacoes/pncp/search/deep/:jobId/results/visibility', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const job = await loadPncpDeepJob(req.params.jobId, accountId);
    if (!job) return res.status(404).json({ error: 'Busca profunda nao encontrada' });

    const rawVis = String(req.body?.visibility || '').toLowerCase().trim();
    const visibility = (rawVis === 'hidden' || rawVis === 'descartado' || rawVis === 'discarded')
      ? 'hidden'
      : (rawVis === 'visible' || rawVis === 'restore' || rawVis === 'restaurar' || rawVis === 'list')
        ? 'visible'
        : null;
    if (!visibility) {
      return res.status(400).json({ error: 'visibility deve ser hidden (descartar) ou visible (restaurar)' });
    }

    const item = req.body?.item && typeof req.body.item === 'object' ? req.body.item : {};
    const resultKey = String(
      req.body?.result_key
      || item.__result_key
      || getPncpSearchResultKey(item)
      || ''
    ).trim();
    const itemId = String(req.body?.item_id || item.id || '').trim();
    if (!resultKey && !itemId) {
      return res.status(400).json({ error: 'Informe result_key ou item' });
    }

    let updated = null;
    if (resultKey) {
      const byKey = await pool.query(
        `UPDATE ${PNCP_SEARCH_JOB_RESULTS_TABLE}
            SET visibility = $1, updated_at = NOW()
          WHERE job_id = $2 AND account_id = $3 AND result_key = $4
          RETURNING result_key, visibility`,
        [visibility, job.id, accountId, resultKey]
      );
      updated = byKey.rows[0] || null;
    }
    // Fallback: casar por id no payload (itens legados / chave divergente).
    if (!updated && itemId) {
      const byId = await pool.query(
        `UPDATE ${PNCP_SEARCH_JOB_RESULTS_TABLE}
            SET visibility = $1, updated_at = NOW()
          WHERE job_id = $2 AND account_id = $3
            AND (
              payload->>'id' = $4
              OR result_key = $4
              OR result_key = ('id:' || $4)
            )
          RETURNING result_key, visibility`,
        [visibility, job.id, accountId, itemId]
      );
      updated = byId.rows[0] || null;
    }
    if (!updated) {
      return res.status(404).json({ error: 'Resultado nao encontrado neste job' });
    }

    await refreshPncpJobSummaryTotals(job);
    job.updated_at = Date.now();
    if (PNCP_DEEP_SEARCH_JOBS.has(job.id)) PNCP_DEEP_SEARCH_JOBS.set(job.id, job);
    await persistPncpDeepJob(job).catch(() => null);

    const visibilityCounts = await countPncpJobResultsByVisibility(job.id, accountId);
    res.json({
      ok: true,
      result_key: updated.result_key,
      visibility: updated.visibility,
      visibility_counts: visibilityCounts,
      total: Number(visibilityCounts.list || 0),
      summary: job.summary || null,
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar visibility do resultado', details: error.message });
  }
});

// Restaurar todos os descartados do job de volta para a lista ativa.
app.post('/api/licitacoes/pncp/search/deep/:jobId/results/restore-discarded', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const job = await loadPncpDeepJob(req.params.jobId, accountId);
    if (!job) return res.status(404).json({ error: 'Busca profunda nao encontrada' });

    const { rowCount } = await pool.query(
      `UPDATE ${PNCP_SEARCH_JOB_RESULTS_TABLE}
          SET visibility = 'visible', updated_at = NOW()
        WHERE job_id = $1 AND account_id = $2 AND visibility = 'hidden'`,
      [job.id, accountId]
    );

    await refreshPncpJobSummaryTotals(job);
    job.updated_at = Date.now();
    if (PNCP_DEEP_SEARCH_JOBS.has(job.id)) PNCP_DEEP_SEARCH_JOBS.set(job.id, job);
    await persistPncpDeepJob(job).catch(() => null);

    const visibilityCounts = await countPncpJobResultsByVisibility(job.id, accountId);
    res.json({
      ok: true,
      restored: Number(rowCount || 0),
      visibility_counts: visibilityCounts,
      total: Number(visibilityCounts.list || 0),
      summary: job.summary || null,
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao restaurar descartados', details: error.message });
  }
});

// Excluir uma busca (quadro): cancela o worker se estiver rodando e apaga do banco.
app.delete('/api/licitacoes/pncp/search/deep/:jobId', async (req, res) => {
  try {
    const jobId = req.params.jobId;
    PNCP_DEEP_SEARCH_CANCELLED.add(jobId);
    PNCP_DEEP_SEARCH_JOBS.delete(jobId);
    const timer = PNCP_DEEP_SEARCH_RESUME_TIMERS.get(jobId);
    if (timer) { clearTimeout(timer); PNCP_DEEP_SEARCH_RESUME_TIMERS.delete(jobId); }
    await pool.query(`DELETE FROM ${PNCP_SEARCH_JOB_RESULTS_TABLE} WHERE job_id = $1`, [jobId]).catch(() => {});
    await pool.query(`DELETE FROM ${PNCP_SEARCH_JOBS_TABLE} WHERE id = $1 AND account_id = $2`, [jobId, getAccountId(req)]);
    res.json({ deleted: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir a busca', details: error.message });
  }
});

app.post('/api/licitacoes/pncp/search/deep/:jobId/cancel', async (req, res) => {
  const job = PNCP_DEEP_SEARCH_JOBS.get(req.params.jobId);
  if (job) {
    PNCP_DEEP_SEARCH_CANCELLED.add(req.params.jobId);
    job.status = 'cancelling';
    job.updated_at = Date.now();
    await persistPncpDeepJob(job);
    return res.json({ ok: true, status: job.status });
  }
  await pool.query(
    `UPDATE ${PNCP_SEARCH_JOBS_TABLE} SET status = 'cancelled', updated_at = NOW(), completed_at = NOW() WHERE id = $1 AND account_id = $2`,
    [req.params.jobId, getAccountId(req)]
  );
  res.json({ ok: true, status: 'cancelled' });
});

const handlePncpSearchJobTerms = async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const memoryJob = PNCP_DEEP_SEARCH_JOBS.get(req.params.jobId);
    const dbJob = memoryJob ? null : await loadPncpDeepJob(req.params.jobId, accountId);
    // Preferir memória se existir (job ao vivo), senão DB.
    const job = memoryJob || dbJob;
    if (!job) return res.status(404).json({ error: 'Pesquisa nao encontrada' });
    if (job.account_id && Number(job.account_id) !== Number(accountId)) {
      return res.status(404).json({ error: 'Pesquisa nao encontrada' });
    }

    const positiveTerms = mergeUniqueTerms(req.body?.terms || [], req.body?.positive_terms || [])
      .map(term => String(term || '').trim())
      .filter(term => term.length >= 2);
    const negativeTerms = mergeUniqueTerms(req.body?.negative_terms || [])
      .map(term => String(term || '').trim())
      .filter(term => term.length >= 2);
    if (!positiveTerms.length && !negativeTerms.length) {
      return res.status(400).json({ error: 'Informe ao menos um termo' });
    }

    const prevTerms = [...(job.terms || [])];
    const prevNeg = [...(job.negative_terms || [])];
    job.terms = mergeUniqueTerms(job.terms || [], positiveTerms).slice(0, 12);
    job.negative_terms = mergeUniqueTerms(job.negative_terms || [], negativeTerms);
    const addedPositive = job.terms.filter(t => !prevTerms.some(p => normalizeSearchText(p) === normalizeSearchText(t)));
    const addedNegative = job.negative_terms.filter(t => !prevNeg.some(p => normalizeSearchText(p) === normalizeSearchText(t)));
    if (!addedPositive.length && !addedNegative.length) {
      return res.json({
        ...normalizePncpSearchJobRow(job),
        unchanged: true,
        message: 'Termo(s) já estavam neste job',
      });
    }

    const signature = buildPncpJobSignature({ filters: job.filters || {}, terms: job.terms, negativeTerms: job.negative_terms });
    const wasLive = ['queued', 'running', 'paused_rate_limit', 'cancelling'].includes(job.status);
    const termsDone = Number(job.progress?.terms_done || 0);
    const workerAlive = Boolean(memoryJob && ['queued', 'running', 'cancelling', 'paused_rate_limit'].includes(memoryJob.status));
    // No meio do loop o worker re-lê job.terms a cada termo — basta atualizar a memória.
    // Se já esgotou as frentes, worker morreu, pausou ou job terminou → reenfileira.
    const canAbsorbInRunningLoop = workerAlive
      && job.status === 'running'
      && termsDone < Math.max(prevTerms.length, 1);
    const needsRestart = !canAbsorbInRunningLoop;

    job.progress = {
      ...(job.progress || {}),
      signature,
      terms_total: job.terms.length,
      ...(needsRestart && !wasLive ? { terms_done: 0, current_term: '' } : {}),
    };
    job.preserve_results = true;
    job.error = null;
    job.updated_at = Date.now();

    // Grava termos no banco de imediato (antes o persist ignorava terms e o chip sumia).
    await pool.query(
      `UPDATE ${PNCP_SEARCH_JOBS_TABLE}
          SET terms = $2,
              negative_terms = $3,
              progress = $4::jsonb,
              updated_at = NOW()
        WHERE id = $1 AND account_id = $5`,
      [
        job.id,
        job.terms,
        job.negative_terms,
        JSON.stringify(job.progress || {}),
        accountId,
      ]
    );

    // Atualiza o objeto do worker ao vivo (mesma referência) + mapa.
    if (memoryJob) {
      memoryJob.terms = job.terms;
      memoryJob.negative_terms = job.negative_terms;
      memoryJob.progress = job.progress;
      memoryJob.preserve_results = true;
      memoryJob.updated_at = job.updated_at;
    }
    PNCP_DEEP_SEARCH_JOBS.set(job.id, memoryJob || job);
    await persistPncpDeepJob(memoryJob || job);

    let restarted = false;
    if (needsRestart) {
      if (workerAlive && ['running', 'cancelling', 'queued'].includes(job.status)) {
        PNCP_DEEP_SEARCH_CANCELLED.add(job.id);
        setTimeout(() => {
          PNCP_DEEP_SEARCH_CANCELLED.delete(job.id);
          startPersistedPncpSearchJob(job, { force: true, preserveResults: true }).catch(err =>
            console.warn('[PNCP Search Job] restart apos novos termos falhou:', err.message)
          );
        }, 400);
        restarted = true;
      } else {
        await startPersistedPncpSearchJob(job, { force: true, preserveResults: true });
        restarted = true;
      }
    }

    const fresh = PNCP_DEEP_SEARCH_JOBS.get(job.id) || job;
    res.json({
      ...normalizePncpSearchJobRow(fresh),
      added_terms: addedPositive,
      added_negative_terms: addedNegative,
      restarted,
      preserve_results: true,
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar termos da pesquisa', details: error.message });
  }
};

app.post('/api/licitacoes/pncp/search/deep-terms/:jobId', handlePncpSearchJobTerms);
app.post('/api/licitacoes/pncp/search/deep/:jobId/terms', handlePncpSearchJobTerms);

// Atualiza filtros de partida do job e reenfileira a coleta.
app.post('/api/licitacoes/pncp/search/deep/:jobId/filters', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const memoryJob = PNCP_DEEP_SEARCH_JOBS.get(req.params.jobId);
    const dbJob = memoryJob ? null : await loadPncpDeepJob(req.params.jobId, accountId);
    const job = memoryJob || dbJob;
    if (!job) return res.status(404).json({ error: 'Pesquisa nao encontrada' });
    if (job.account_id && Number(job.account_id) !== Number(accountId)) {
      return res.status(404).json({ error: 'Pesquisa nao encontrada' });
    }

    const incoming = req.body?.filters && typeof req.body.filters === 'object' ? req.body.filters : {};
    const nextFilters = {
      ...(job.filters || {}),
      ...incoming,
    };
    // Normaliza strings vazias
    Object.keys(nextFilters).forEach((key) => {
      if (nextFilters[key] === undefined || nextFilters[key] === null) delete nextFilters[key];
      else if (typeof nextFilters[key] === 'string') nextFilters[key] = nextFilters[key].trim();
    });

    // Termos negativos do formulário de partida entram no job
    if (Object.prototype.hasOwnProperty.call(incoming, 'negative_terms')) {
      const fromFilter = splitPncpTerms(incoming.negative_terms || '');
      const extra = Array.isArray(req.body?.negative_terms) ? req.body.negative_terms : [];
      job.negative_terms = mergeUniqueTerms(fromFilter, extra);
    }

    job.filters = nextFilters;
    if (nextFilters.q && String(nextFilters.q).trim()) {
      job.nome = String(nextFilters.q).trim().slice(0, 160);
      // Garante que o termo principal exista nas frentes
      job.terms = mergeUniqueTerms([nextFilters.q], job.terms || []).slice(0, 12);
    }

    const signature = buildPncpJobSignature({
      filters: job.filters || {},
      terms: job.terms || [],
      negativeTerms: job.negative_terms || [],
    });
    job.progress = {
      ...(job.progress || {}),
      signature,
      terms_total: (job.terms || []).length,
      terms_done: 0,
      current_term: '',
      items_collected: 0,
    };
    job.error = null;
    job.completed_at = null;
    job.updated_at = Date.now();
    // Troca de filtros = novo conjunto de resultados (não preserva o acervo antigo).
    job.preserve_results = false;

    // Se estiver rodando, pede cancelamento e recomeça com os novos filtros
    if (['running', 'cancelling', 'queued', 'paused_rate_limit'].includes(job.status)) {
      PNCP_DEEP_SEARCH_CANCELLED.add(job.id);
    }
    job.status = 'queued';
    job.total = 0;
    job.items = [];
    await clearPncpJobResults(job.id);

    await pool.query(
      `UPDATE ${PNCP_SEARCH_JOBS_TABLE}
          SET filters = $2::jsonb,
              terms = $3,
              negative_terms = $4,
              nome = $5,
              status = 'queued',
              progress = $6::jsonb,
              total = 0,
              items = '[]'::jsonb,
              error = NULL,
              completed_at = NULL,
              updated_at = NOW()
        WHERE id = $1 AND account_id = $7`,
      [
        job.id,
        JSON.stringify(job.filters || {}),
        job.terms || [],
        job.negative_terms || [],
        job.nome || String(job.filters?.q || 'Busca PNCP').slice(0, 160),
        JSON.stringify(job.progress || {}),
        accountId,
      ]
    );

    PNCP_DEEP_SEARCH_JOBS.set(job.id, job);
    // Pequeno delay se estava cancelando, para o worker antigo soltar
    setTimeout(() => {
      PNCP_DEEP_SEARCH_CANCELLED.delete(job.id);
      startPersistedPncpSearchJob(job, { force: true, preserveResults: false }).catch(err =>
        console.warn('[PNCP Search Job] restart apos filtros falhou:', err.message)
      );
    }, 400);

    res.json(normalizePncpSearchJobRow(job));
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar filtros da pesquisa', details: error.message });
  }
});

// Reexecuta a coleta mantendo o que já foi encontrado (UPSERT). Não estende o prazo de arquivo.
app.post('/api/licitacoes/pncp/search/deep/:jobId/rerun', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const memoryJob = PNCP_DEEP_SEARCH_JOBS.get(req.params.jobId);
    const dbJob = memoryJob ? null : await loadPncpDeepJob(req.params.jobId, accountId);
    const job = memoryJob || dbJob;
    if (!job) return res.status(404).json({ error: 'Pesquisa não encontrada' });
    if (job.account_id && Number(job.account_id) !== Number(accountId)) {
      return res.status(404).json({ error: 'Pesquisa não encontrada' });
    }
    if (['queued', 'running', 'cancelling', 'paused_rate_limit'].includes(job.status)) {
      return res.status(409).json({
        error: 'Esta busca já está em coleta. Aguarde terminar ou use Parar.',
        status: job.status,
      });
    }
    if (isPncpSearchJobArchivable(job)) {
      return res.status(410).json({
        error: 'Esta busca expirou e será arquivada. Crie uma nova ou transforme em watchlist antes de expirar.',
        archive_at: getPncpSearchJobArchiveAt(job.started_at)?.toISOString() || null,
      });
    }

    const ok = await startPersistedPncpSearchJob(job, { force: true, preserveResults: true });
    if (!ok) {
      return res.status(500).json({ error: 'Não foi possível reexecutar a busca' });
    }
    const fresh = PNCP_DEEP_SEARCH_JOBS.get(job.id) || await loadPncpDeepJob(job.id, accountId);
    res.json({
      ok: true,
      job_id: job.id,
      status: fresh?.status || 'queued',
      preserve_results: true,
      total: Number(fresh?.total || job.total || 0),
      archive_at: getPncpSearchJobArchiveAt(job.started_at)?.toISOString() || null,
      days_until_archive: getPncpSearchJobDaysUntilArchive(job.started_at),
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao reexecutar a busca', details: error.message });
  }
});

// O card de busca É a assinatura: cria/atualiza watchlist 1:1 + alertas WhatsApp.
// Não notifica o acervo histórico — só sinais *novos* do matcher (dedupe por chave).
app.post('/api/licitacoes/pncp/search/deep/:jobId/watchlist', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const job = await loadPncpDeepJob(req.params.jobId, accountId);
    if (!job) return res.status(404).json({ error: 'Pesquisa não encontrada' });
    const name = String(req.body?.nome || job.nome || job.filters?.q || 'Busca PNCP').trim().slice(0, 200);
    const wa = resolveWhatsappFieldsFromBody({
      whatsapp_enabled: req.body?.whatsapp_enabled === true,
      whatsapp_number: req.body?.whatsapp_number,
      whatsapp_numbers: req.body?.whatsapp_numbers,
      whatsapp_min_score: req.body?.whatsapp_min_score,
      whatsapp_score_band: req.body?.whatsapp_score_band,
    }, { requireNumbersIfEnabled: req.body?.whatsapp_enabled === true });
    if (wa.error) {
      return res.status(400).json({ error: wa.error });
    }
    const waMinScore = wa.whatsapp_min_score !== undefined ? wa.whatsapp_min_score : WATCHLIST_SCORE_MIN_ALL;

    let watchlistRow = null;
    if (job.watchlist_id) {
      const { rows } = await pool.query(
        `
          UPDATE ${EDITAL_WATCHLIST_TABLE}
             SET nome = $1,
                 palavras_chave = $2,
                 termos_negativos = $3,
                 filtros = $4::jsonb,
                 whatsapp_enabled = $5,
                 whatsapp_number = $6,
                 whatsapp_min_score = $7,
                 ativo = TRUE,
                 atualizado_em = NOW()
           WHERE id = $8 AND account_id = $9
           RETURNING *
        `,
        [
          name,
          job.terms || [],
          job.negative_terms || [],
          JSON.stringify(job.filters || {}),
          wa.whatsapp_enabled,
          wa.whatsapp_number,
          waMinScore,
          job.watchlist_id,
          accountId,
        ]
      );
      watchlistRow = rows[0];
    }
    if (!watchlistRow) {
      const { rows } = await pool.query(
        `INSERT INTO ${EDITAL_WATCHLIST_TABLE}
           (account_id, nome, palavras_chave, termos_negativos, usar_ia, filtros, whatsapp_enabled, whatsapp_number, whatsapp_min_score)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
         RETURNING *`,
        [
          accountId,
          name,
          job.terms || [],
          job.negative_terms || [],
          true,
          JSON.stringify(job.filters || {}),
          wa.whatsapp_enabled,
          wa.whatsapp_number,
          waMinScore,
        ]
      );
      watchlistRow = rows[0];
      await pool.query(
        `UPDATE ${PNCP_SEARCH_JOBS_TABLE} SET watchlist_id = $2, updated_at = NOW() WHERE id = $1 AND account_id = $3`,
        [job.id, watchlistRow.id, accountId]
      );
    }

    // Card deixa de ser “temporário 15 dias” — assinatura ligada à watchlist.
    const decorated = decorateWatchlistWhatsapp(watchlistRow);
    res.json({
      ...decorated,
      job_id: job.id,
      alerts_enabled: Boolean(decorated.whatsapp_enabled),
      note: 'Alertas valem para oportunidades *novas* (matcher diário). O acervo já classificado nesta busca não gera WhatsApp retroativo.',
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao ativar assinatura/alertas da busca', details: error.message });
  }
});

// Atalho: só liga/desliga WhatsApp no card (cria watchlist se ainda não existir).
app.patch('/api/licitacoes/pncp/search/deep/:jobId/alerts', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const job = await loadPncpDeepJob(req.params.jobId, accountId);
    if (!job) return res.status(404).json({ error: 'Pesquisa não encontrada' });
    // Reutiliza o endpoint de watchlist com body de alertas.
    req.body = {
      nome: req.body?.nome || job.nome || job.filters?.q,
      whatsapp_enabled: req.body?.whatsapp_enabled === true,
      whatsapp_number: req.body?.whatsapp_number,
      whatsapp_numbers: req.body?.whatsapp_numbers,
      whatsapp_min_score: req.body?.whatsapp_min_score,
      whatsapp_score_band: req.body?.whatsapp_score_band,
    };
    // Inline call would recurse awkwardly; duplicate minimal path:
    const name = String(req.body.nome || job.nome || job.filters?.q || 'Busca PNCP').trim().slice(0, 200);
    const wa = resolveWhatsappFieldsFromBody({
      whatsapp_enabled: req.body.whatsapp_enabled === true,
      whatsapp_number: req.body.whatsapp_number,
      whatsapp_numbers: req.body.whatsapp_numbers,
      whatsapp_min_score: req.body.whatsapp_min_score,
      whatsapp_score_band: req.body.whatsapp_score_band,
    }, { requireNumbersIfEnabled: req.body.whatsapp_enabled === true });
    if (wa.error) {
      return res.status(400).json({ error: wa.error });
    }
    const waMinScore = wa.whatsapp_min_score !== undefined ? wa.whatsapp_min_score : WATCHLIST_SCORE_MIN_ALL;
    let watchlistRow = null;
    if (job.watchlist_id) {
      const { rows } = await pool.query(
        `UPDATE ${EDITAL_WATCHLIST_TABLE}
            SET nome = COALESCE(NULLIF($1, ''), nome),
                whatsapp_enabled = $2,
                whatsapp_number = $3,
                whatsapp_min_score = $4,
                ativo = TRUE,
                atualizado_em = NOW()
          WHERE id = $5 AND account_id = $6
          RETURNING *`,
        [name, wa.whatsapp_enabled, wa.whatsapp_number, waMinScore, job.watchlist_id, accountId]
      );
      watchlistRow = rows[0];
    } else {
      const { rows } = await pool.query(
        `INSERT INTO ${EDITAL_WATCHLIST_TABLE}
           (account_id, nome, palavras_chave, termos_negativos, usar_ia, filtros, whatsapp_enabled, whatsapp_number, whatsapp_min_score)
         VALUES ($1,$2,$3,$4,TRUE,$5::jsonb,$6,$7,$8)
         RETURNING *`,
        [
          accountId,
          name,
          job.terms || [],
          job.negative_terms || [],
          JSON.stringify(job.filters || {}),
          wa.whatsapp_enabled,
          wa.whatsapp_number,
          waMinScore,
        ]
      );
      watchlistRow = rows[0];
      await pool.query(
        `UPDATE ${PNCP_SEARCH_JOBS_TABLE} SET watchlist_id = $2, updated_at = NOW() WHERE id = $1 AND account_id = $3`,
        [job.id, watchlistRow.id, accountId]
      );
    }
    const decorated = decorateWatchlistWhatsapp(watchlistRow);
    res.json({
      ...decorated,
      job_id: job.id,
      alerts_enabled: Boolean(decorated?.whatsapp_enabled),
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar alertas da busca', details: error.message });
  }
});

 app.post('/api/licitacoes/pncp/search/deep-start', (req, res) => {
  cleanupPncpDeepJobs();
  const jobId = crypto.randomUUID();
  PNCP_DEEP_SEARCH_JOBS.set(jobId, {
    id: jobId,
    status: 'queued',
    filters: req.body?.filters || {},
    terms: Array.isArray(req.body?.terms) ? req.body.terms : [],
    negative_terms: Array.isArray(req.body?.negative_terms) ? req.body.negative_terms : [],
    items: [],
    total: 0,
    progress: { current_term: '', terms_done: 0, terms_total: 0, items_collected: 0 },
    term_runs: [],
    started_at: Date.now(),
    updated_at: Date.now(),
  });
  setImmediate(() => runPncpDeepSearchJob(jobId));
  res.json({ job_id: jobId, status: 'queued' });
});

app.get('/api/licitacoes/pncp/search/deep/:jobId', (req, res) => {
  cleanupPncpDeepJobs();
  const job = PNCP_DEEP_SEARCH_JOBS.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Busca profunda não encontrada ou expirada' });
  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    total: job.total,
    items: ['running', 'completed'].includes(job.status) ? (job.items || []) : [],
    summary: job.summary || null,
    query_plan: job.query_plan || { mode: 'deep_background', term_runs: job.term_runs || [] },
    error: job.error || null,
  });
});

app.post('/api/licitacoes/pncp/search/deep/:jobId/cancel', (req, res) => {
  const job = PNCP_DEEP_SEARCH_JOBS.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Busca profunda não encontrada' });
  PNCP_DEEP_SEARCH_CANCELLED.add(req.params.jobId);
  job.status = 'cancelling';
  job.updated_at = Date.now();
  res.json({ ok: true, status: job.status });
});

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

const classifyPncpInstrumentType = (name = '') => {
  const text = normalizeSearchText(name);

  if (text.includes('ato que autoriza') && text.includes('contratacao direta')) {
    return {
      bucket: 'resultado',
      open_default: false,
      hint: 'Normalmente indica contratacao direta ja autorizada ou homologada; use para inteligencia historica e resultados.',
    };
  }

  if (text.includes('aviso de contratacao direta')) {
    return {
      bucket: 'oportunidade',
      open_default: true,
      hint: 'Pode indicar dispensa ainda em fase de aviso/recebimento de propostas, dependendo do prazo e do resultado.',
    };
  }

  if (text.includes('edital') || text.includes('chamamento')) {
    return {
      bucket: 'oportunidade',
      open_default: true,
      hint: 'Instrumento tipico de oportunidade, sujeito a prazo, resultado e situacao retornados pelo PNCP.',
    };
  }

  return {
    bucket: 'neutro',
    open_default: true,
    hint: null,
  };
};

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
      .map(item => {
        const nome = item.nome || item.descricao || `Tipo ${item.id}`;
        return {
          id: String(item.id),
          nome,
          ...classifyPncpInstrumentType(nome),
        };
      })
      .sort((a, b) => {
        const bucketOrder = { oportunidade: 0, neutro: 1, resultado: 2 };
        const bucketDiff = (bucketOrder[a.bucket] ?? 1) - (bucketOrder[b.bucket] ?? 1);
        return bucketDiff || a.nome.localeCompare(b.nome, 'pt-BR');
      });
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

// Dossiê: acervo primeiro (resposta imediata), ao vivo com prazo. Se o gate do
// PNCP estiver lento a montagem continua em background e alimenta o acervo — o
// "Tentar novamente" do popup resolve do cache em vez de estourar o proxy (504).
const PNCP_DOSSIER_ROUTE_TIMEOUT_MS = 45_000;
const pncpDossierInFlight = new Map(); // `${cnpj}/${ano}/${seq}` -> Promise

app.get('/api/licitacoes/pncp/compra/:cnpj/:ano/:sequencial/dossier', async (req, res) => {
  try {
    const cnpj = String(req.params.cnpj || '').replace(/\D/g, '');
    const ano = String(req.params.ano || '').replace(/\D/g, '');
    const sequencial = String(Number(req.params.sequencial) || '');
    if (!cnpj || !ano || !sequencial) {
      return res.status(400).json({ error: 'Identificadores da compra inválidos' });
    }
    const query = req.query.q || '';
    const includeResultados = String(req.query.include_resultados || 'true') !== 'false';
    const wantsRefresh = String(req.query.refresh || 'false') === 'true';
    const dossierKey = `${cnpj}/${ano}/${sequencial}`;

    if (!wantsRefresh) {
      const cachedRow = await pool.query(
        `SELECT payload, refreshed_at FROM ${PNCP_RESULT_CACHE_TABLE}
          WHERE orgao_cnpj = $1 AND ano = $2 AND sequencial = $3
          LIMIT 1`,
        [cnpj, Number(ano), Number(sequencial)]
      );
      const payload = cachedRow.rows[0]?.payload;
      // Só serve payload que é um dossiê completo (linhas "lite" não têm totais).
      if (payload?.ids?.cnpj && payload?.totais) {
        const ageMs = Date.now() - new Date(cachedRow.rows[0].refreshed_at || 0).getTime();
        if (ageMs > 6 * 60 * 60 * 1000 && !pncpDossierInFlight.has(dossierKey)) {
          const refreshPromise = fetchPncpCompraDossier(cnpj, ano, sequencial, { query, includeResultados, priority: 'sync' })
            .then(dossier => upsertPncpResultCache(dossier, query))
            .catch(error => console.warn('[PNCP Dossier] refresh em background falhou:', error.message))
            .finally(() => pncpDossierInFlight.delete(dossierKey));
          pncpDossierInFlight.set(dossierKey, refreshPromise);
        }
        return res.json({ ...payload, from_cache: true });
      }
    }

    let live = pncpDossierInFlight.get(dossierKey);
    if (!live) {
      live = fetchPncpCompraDossier(cnpj, ano, sequencial, { query, includeResultados, priority: 'interactive' })
        .then(async (dossier) => {
          await upsertPncpResultCache(dossier, query).catch(error => {
            console.warn('[PNCP Dossier] cache falhou:', error.message);
          });
          return dossier;
        })
        .finally(() => pncpDossierInFlight.delete(dossierKey));
      pncpDossierInFlight.set(dossierKey, live);
    }
    const timed = await Promise.race([
      live,
      new Promise(resolve => setTimeout(resolve, PNCP_DOSSIER_ROUTE_TIMEOUT_MS, '__timeout__')),
    ]);
    if (timed === '__timeout__') {
      live.catch(() => {}); // segue em background e alimenta o acervo
      return res.status(503).json({
        error: 'O PNCP está limitando as consultas e o dossiê ainda está sendo montado em segundo plano. Tente novamente em alguns instantes.',
        retry_in_ms: 15000,
      });
    }
    res.json(timed);
  } catch (error) {
    console.error('Error fetching PNCP dossier:', error);
    res.status(502).json({ error: 'Erro ao montar dossiê PNCP', details: error.message });
  }
});

// ===== Aba Contratos/Resultados: página de BUSCA de licitações finalizadas =====
// Independente da busca de editais: busca ao vivo no índice textual do PNCP
// (tipos contrato/ata — o índice cobre objeto E fornecedor), sempre com
// priority 'interactive' no gate: os jobs de editais (bulk) esperam.
// tipo=resultado consulta o cache local (homologações vindas dos dossiês).

const PNCP_CONTRATO_DETALHE_TTL_MS = 6 * 60 * 60 * 1000;
const pncpContratoDetalheCache = new Map(); // `${cnpj}/${ano}/${seq}` -> { at, data }

const getPncpContratoDetalhe = async (cnpj, ano, sequencial, { priority = 'interactive' } = {}) => {
  const key = `${cnpj}/${ano}/${Number(sequencial)}`;
  const cached = pncpContratoDetalheCache.get(key);
  if (cached && Date.now() - cached.at < PNCP_CONTRATO_DETALHE_TTL_MS) return cached.data;
  const data = await withPncpGate(
    () => fetchPncp(`v1/orgaos/${cnpj}/contratos/${ano}/${Number(sequencial)}`),
    { priority }
  );
  pncpContratoDetalheCache.set(key, { at: Date.now(), data });
  if (pncpContratoDetalheCache.size > 2000) {
    pncpContratoDetalheCache.delete(pncpContratoDetalheCache.keys().next().value);
  }
  return data;
};

// Documento da /api/search/ (contrato|ata) -> mesmo shape das linhas do cache.
// ano/sequencial ficam nulos até o detalhe revelar a COMPRA de origem (dossiê).
const mapPncpOutcomeSearchDoc = (raw) => {
  const docType = String(raw?.document_type || '').toLowerCase();
  const cnpj = String(raw?.orgao_cnpj || '').replace(/\D/g, '');
  const docIds = cnpj && raw?.ano && raw?.numero_sequencial
    ? { cnpj, ano: String(raw.ano), sequencial: String(raw.numero_sequencial) }
    : null;
  const documentKey = docIds ? `documento:${docType}:${docIds.cnpj}/${docIds.ano}/${Number(docIds.sequencial)}` : null;
  const hasResult = raw?.tem_resultado === true || raw?.temResultado === true || raw?.possui_resultado === true;
  return {
    // A chave do documento permite persistir imediatamente contratos e atas,
    // antes de conhecermos a compra de origem pelo endpoint de detalhe.
    pncp_key: documentKey,
    doc_type: docType,
    doc_ids: docIds,
    orgao_cnpj: cnpj || null,
    orgao_nome: raw?.orgao_nome || null,
    ano: null,
    sequencial: null,
    numero_controle_pncp: raw?.numero_controle_pncp || null,
    titulo: raw?.title || null,
    descricao: raw?.description || null,
    uf: raw?.uf || null,
    modalidade: raw?.modalidade_licitacao_nome || null,
    etapa_comercial: docType === 'ata' ? 'ata_available' : 'contracted',
    fornecedor_ni: null,
    fornecedor_nome: null,
    valor_estimado: null,
    valor_homologado: Number(raw?.valor_global) > 0 ? Number(raw.valor_global) : null,
    data_publicacao: raw?.data_publicacao_pncp || null,
    data_resultado: null,
    data_assinatura: raw?.data_assinatura || null,
    data_inicio_vigencia: raw?.data_inicio_vigencia || null,
    data_fim_vigencia: raw?.data_fim_vigencia || null,
    srp: null,
    amparo_legal: null,
    has_result: hasResult,
    has_contract: docType === 'contrato',
    has_ata: docType === 'ata',
    fornecedores: [],
    refreshed_at: raw?.data_atualizacao_pncp || null,
    dossier: null,
    url: raw?.item_url ? `https://pncp.gov.br${raw.item_url}` : null,
    live: true,
  };
};

const persistPncpOutcomeLiveItem = async (item) => {
  if (!item?.pncp_key) return null;
  return upsertPncpResultCacheLite({
    pncp_key: item.pncp_key,
    orgao_cnpj: item.orgao_cnpj,
    orgao_nome: item.orgao_nome,
    // ano/sequencial abaixo pertencem à compra. Os ids do documento ficam no
    // payload até o enriquecimento revelar a contratação de origem.
    ano: item.ano,
    sequencial: item.sequencial,
    numero_controle_pncp: item.numero_controle_pncp,
    titulo: item.titulo,
    descricao: item.descricao,
    uf: item.uf,
    modalidade: item.modalidade,
    etapa_comercial: item.etapa_comercial,
    fornecedor_ni: item.fornecedor_ni,
    fornecedor_nome: item.fornecedor_nome,
    valor_estimado: item.valor_estimado,
    valor_homologado: item.valor_homologado,
    data_publicacao: item.data_publicacao,
    data_resultado: item.data_resultado,
    data_assinatura: item.data_assinatura,
    has_result: item.has_result,
    has_contract: item.has_contract,
    has_ata: item.has_ata,
    fornecedores: item.fornecedores || [],
    search_text: [item.titulo, item.descricao, item.orgao_nome, item.fornecedor_nome, item.fornecedor_ni].filter(Boolean).join(' '),
    payload: {
      source: 'resultados_live_search',
      live_document: {
        doc_type: item.doc_type,
        doc_ids: item.doc_ids,
        url: item.url,
      },
    },
  });
};

const summarizePncpOutcomeItems = (items) => items.reduce((acc, item) => {
  const value = Number(item.valor_homologado || item.valor_estimado || 0);
  acc.total_value += Number.isFinite(value) ? value : 0;
  const key = item.etapa_comercial || 'sem_etapa';
  acc.by_stage[key] = acc.by_stage[key] || { count: 0, total_value: 0 };
  acc.by_stage[key].count += 1;
  acc.by_stage[key].total_value += Number.isFinite(value) ? value : 0;
  return acc;
}, { count: items.length, total_value: 0, by_stage: {} });

// Preenche fornecedor/valores (e o vínculo com a compra, para o dossiê) nos
// contratos da página visível. Time-box: devolve o que der no prazo; o cache
// de detalhe (6h) torna as próximas cargas instantâneas.
// Detalhe de um contrato -> bundle de campos que enriquecem o item da busca
// (fornecedor, valores, vínculo com a compra) + upsert no acervo em background.
const buildPncpOutcomeContratoEnrichment = async ({ cnpj, ano, sequencial }, baseItem = {}) => {
  const detalhe = await getPncpContratoDetalhe(cnpj, ano, sequencial);
  if (!detalhe) return null;
  const fields = {
    fornecedor_ni: detalhe.niFornecedor || null,
    fornecedor_nome: detalhe.nomeRazaoSocialFornecedor || null,
  };
  if (fields.fornecedor_ni || fields.fornecedor_nome) {
    fields.fornecedores = [{ ni: fields.fornecedor_ni, nome: fields.fornecedor_nome }];
  }
  if (Number(detalhe.valorInicial) > 0) fields.valor_estimado = Number(detalhe.valorInicial);
  if (Number(detalhe.valorGlobal) > 0) fields.valor_homologado = Number(detalhe.valorGlobal);
  if (detalhe.dataAssinatura) fields.data_assinatura = detalhe.dataAssinatura;
  const compraIds = parsePncpCompraControlNumber(detalhe.numeroControlePncpCompra || detalhe.numeroControlePNCPCompra);
  if (compraIds) {
    fields.ano = Number(compraIds.ano) || null;
    fields.sequencial = Number(compraIds.sequencial) || null;
    fields.numero_controle_pncp = detalhe.numeroControlePncpCompra || detalhe.numeroControlePNCPCompra;
    fields.pncp_key = baseItem.pncp_key || `${compraIds.cnpj}/${compraIds.ano}/${Number(compraIds.sequencial)}`;
    const compraDetalhe = await getPncpCompraDetalhe(compraIds.cnpj, compraIds.ano, compraIds.sequencial, { priority: 'interactive' });
    if (compraDetalhe) {
      fields.has_result = compraDetalhe.tem_resultado === true;
      fields.srp = compraDetalhe.srp;
      fields.amparo_legal = compraDetalhe.amparo_legal?.nome || null;
      if (!fields.valor_estimado && compraDetalhe.valor_total_estimado) fields.valor_estimado = compraDetalhe.valor_total_estimado;
      if (!fields.valor_homologado && compraDetalhe.valor_total_homologado) fields.valor_homologado = compraDetalhe.valor_total_homologado;
    }
    // Alimenta o acervo (chave da compra) sem travar a resposta.
    upsertPncpResultCacheLite({
      pncp_key: fields.pncp_key,
      orgao_cnpj: compraIds.cnpj,
      orgao_nome: baseItem.orgao_nome || null,
      ano: fields.ano,
      sequencial: fields.sequencial,
      numero_controle_pncp: fields.numero_controle_pncp,
      titulo: baseItem.titulo || null,
      descricao: baseItem.descricao || null,
      uf: baseItem.uf || null,
      modalidade: baseItem.modalidade || null,
      etapa_comercial: 'contracted',
      fornecedor_ni: fields.fornecedor_ni,
      fornecedor_nome: fields.fornecedor_nome,
      valor_estimado: fields.valor_estimado || null,
      valor_homologado: fields.valor_homologado || null,
      data_publicacao: baseItem.data_publicacao || null,
      data_assinatura: fields.data_assinatura || null,
      srp: fields.srp ?? null,
      amparo_legal: fields.amparo_legal || null,
      has_result: fields.has_result === true,
      has_contract: true,
      fornecedores: fields.fornecedores || [],
      search_text: [baseItem.titulo, baseItem.descricao, fields.fornecedor_nome, fields.fornecedor_ni, baseItem.orgao_nome].filter(Boolean).join(' '),
      payload: { source: 'resultados_live_search', contrato_detalhe: detalhe },
    }).catch(err => console.warn('[resultados] upsert live falhou:', err.message));
  }
  return fields;
};

const enrichPncpOutcomeLiveItems = async (items, { deadlineMs = 3500, maxDetails = 10 } = {}) => {
  const deadline = Date.now() + deadlineMs;
  let fetched = 0;
  for (const item of items) {
    if (item.doc_type !== 'contrato' || !item.doc_ids) continue;
    if (fetched >= maxDetails || Date.now() >= deadline) break;
    try {
      const { cnpj, ano, sequencial } = item.doc_ids;
      const wasCached = pncpContratoDetalheCache.has(`${cnpj}/${ano}/${Number(sequencial)}`);
      const fields = await buildPncpOutcomeContratoEnrichment(item.doc_ids, item);
      if (!wasCached) fetched += 1;
      if (fields) Object.assign(item, fields);
    } catch (error) {
      if (Date.now() < PNCP_GATE.pausedUntil) break; // gate pausou: não insiste
    }
  }
  return items;
};

app.get('/api/licitacoes/pncp/resultados/search', async (req, res) => {
  try {
    const qText = String(req.query.q || '').trim();
    const fornecedor = String(req.query.fornecedor || '').trim();
    const fornecedorNi = String(req.query.fornecedor_ni || '').replace(/\D/g, '');
    const orgaoCnpj = String(req.query.orgao_cnpj || '').replace(/\D/g, '');
    const uf = String(req.query.uf || '').trim().toUpperCase();
    const tipo = normalizeSearchText(req.query.tipo || 'todos');
    const ordenacao = normalizeSearchText(req.query.ordenacao || 'data_desc');
    const enrichOnRead = String(req.query.enrich || 'true') !== 'false';
    const pagina = Math.max(1, Number(req.query.pagina) || 1);
    const tam = Math.max(1, Math.min(50, Number(req.query.tam) || 20));
    const offset = (pagina - 1) * tam;

    // Página de busca, não acervo: sem critério nenhum não despeja o cache
    // (que é abastecido pelos jobs de editais — outro contexto).
    const hasCriteria = Boolean(qText || fornecedor || fornecedorNi || orgaoCnpj || uf || (tipo && tipo !== 'todos'));
    if (!hasCriteria) {
      return res.json({
        items: [],
        total: 0,
        pagina,
        tamanhoPagina: tam,
        totalPaginas: 1,
        summary: { count: 0, total_value: 0, by_stage: {} },
        requires_query: true,
        live_fetch_used: false,
        cache: await getPncpOutcomeCacheStats(),
        sync: getPncpOutcomeSyncSnapshot(),
      });
    }

    // Busca ao vivo (contratos/atas) — resultado imediato, prioridade máxima no gate.
    let liveError = null;
    const livePref = String(req.query.live || 'true') !== 'false';
    if (livePref && tipo !== 'resultado') {
      try {
        const liveQ = [qText, fornecedor, fornecedorNi].filter(Boolean).join(' ').trim();
        const tiposDocumento = tipo === 'contrato' ? ['contrato'] : tipo === 'ata' ? ['ata'] : ['contrato', 'ata'];
        const sources = [];
        for (const tipoDoc of tiposDocumento) {
          const data = await withPncpGate(() => fetchPncpSearchStable({
            q: liveQ,
            tipos_documento: tipoDoc,
            // O índice do PNCP só ordena por data/relevância; valor é ordenado
            // localmente (na página) pelo frontend.
            ordenacao: ordenacao === 'data_asc' ? 'data' : ordenacao === 'relevancia' ? 'relevancia' : '-data',
            pagina,
            tam_pagina: tam,
            ...(uf ? { uf } : {}),
          }, { retries: 1 }), { priority: 'interactive' });
          sources.push(data);
        }
        let liveItems = sources.flatMap(data => (Array.isArray(data?.items) ? data.items : []).map(mapPncpOutcomeSearchDoc));
        if (orgaoCnpj) {
          liveItems = liveItems.filter(item => String(item.orgao_cnpj || '').includes(orgaoCnpj));
        }
        if (ordenacao !== 'relevancia') {
          liveItems.sort((a, b) => ordenacao === 'data_asc'
            ? new Date(a.data_publicacao || 0) - new Date(b.data_publicacao || 0)
            : new Date(b.data_publicacao || 0) - new Date(a.data_publicacao || 0));
        }
        if (enrichOnRead) await enrichPncpOutcomeLiveItems(liveItems);
        if (fornecedorNi) {
          // Só descarta quando o NI é conhecido e não bate; desconhecido fica
          // (a busca textual já restringiu pelos dígitos).
          liveItems = liveItems.filter(item => !item.fornecedor_ni
            || String(item.fornecedor_ni).replace(/\D/g, '').includes(fornecedorNi));
        }
        // Materializa tudo que veio da busca ao vivo. Assim atas e contratos
        // continuam disponíveis se o PNCP oscilar ao trocar/voltar de página.
        await Promise.allSettled(liveItems.map(item => persistPncpOutcomeLiveItem(item)));
        const total = sources.reduce((acc, data) => acc + (Number(data?.total) || 0), 0);
        const totalPaginas = Math.max(1, ...sources.map(data => Math.ceil((Number(data?.total) || 0) / tam)));
        return res.json({
          items: liveItems,
          total,
          pagina,
          tamanhoPagina: tam,
          totalPaginas,
          summary: summarizePncpOutcomeItems(liveItems),
          live_fetch_used: true,
          gate: getPncpGateSnapshot(),
          cache: await getPncpOutcomeCacheStats(),
          sync: getPncpOutcomeSyncSnapshot(),
        });
      } catch (error) {
        const isThrottle = isPncpThrottleError(error);
        // live_only=true: a carga progressiva do frontend não pode cair no
        // cache (página N do índice ≠ página N do acervo local). Devolve
        // 503/502 estruturado para o cliente pausar e retomar a MESMA página.
        const liveOnly = String(req.query.live_only || '') === 'true';
        if (isThrottle || liveOnly) {
          if (isThrottle) notePncpThrottle(error.message || 'resultados live');
          const pauseLeft = Math.max(0, PNCP_GATE.pausedUntil - Date.now());
          const retryAfter = Math.max(
            15_000,
            pauseLeft > 0 ? pauseLeft + 5_000 : (isThrottle ? 45_000 : 8_000)
          );
          console.warn(
            `[resultados] busca ao vivo ${isThrottle ? 'rate-limited' : 'falhou'} ` +
            `(p=${pagina}, live_only=${liveOnly}): ${error.message}`
          );
          return res.status(isThrottle ? 503 : 502).json({
            error: isThrottle
              ? 'PNCP limitou as requisições — pausando e retomando automaticamente'
              : 'Erro ao consultar o PNCP',
            details: error.message,
            rate_limited: isThrottle,
            retry_after_ms: retryAfter,
            gate: getPncpGateSnapshot(),
            live_fetch_used: false,
            pagina,
          });
        }
        console.warn('[resultados] busca ao vivo falhou, caindo para o cache:', error.message);
        liveError = error.message;
      }
    }

    const values = [];
    const clauses = [];
    const addValue = (value) => {
      values.push(value);
      return `$${values.length}`;
    };
    // Só finalizadas: resultado homologado, contrato ou ata (a aba é das concluídas).
    clauses.push('(has_result = TRUE OR has_contract = TRUE OR has_ata = TRUE)');
    if (qText) {
      const p = addValue(qText);
      clauses.push(`to_tsvector('portuguese', immutable_unaccent(coalesce(search_text,''))) @@ plainto_tsquery('portuguese', immutable_unaccent(${p}))`);
    }
    if (fornecedor) {
      const p = addValue(`%${fornecedor}%`);
      clauses.push(`(fornecedor_nome ILIKE ${p} OR fornecedores::text ILIKE ${p})`);
    }
    if (fornecedorNi) {
      const p = addValue(`%${fornecedorNi}%`);
      clauses.push(`(
        regexp_replace(coalesce(fornecedor_ni,''), '\\D', '', 'g') LIKE ${p}
        OR regexp_replace(fornecedores::text, '\\D', '', 'g') LIKE ${p}
      )`);
    }
    if (orgaoCnpj) {
      const p = addValue(`%${orgaoCnpj}%`);
      clauses.push(`regexp_replace(coalesce(orgao_cnpj,''), '\\D', '', 'g') LIKE ${p}`);
    }
    if (uf) {
      clauses.push(`uf = ${addValue(uf)}`);
    }
    if (tipo && tipo !== 'todos') {
      if (tipo === 'resultado') clauses.push('has_result = TRUE');
      else if (tipo === 'contrato') clauses.push('has_contract = TRUE');
      else if (tipo === 'ata') clauses.push('has_ata = TRUE');
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const orderSql = ordenacao === 'valor_desc'
      ? 'COALESCE(valor_homologado, valor_estimado, 0) DESC, refreshed_at DESC'
      : ordenacao === 'valor_asc'
        ? 'COALESCE(valor_homologado, valor_estimado, 0) ASC, refreshed_at DESC'
        : ordenacao === 'data_asc'
          ? 'COALESCE(data_resultado, data_assinatura, data_publicacao) ASC NULLS LAST, refreshed_at ASC'
          : 'COALESCE(data_resultado, data_assinatura, data_publicacao) DESC NULLS LAST, refreshed_at DESC';
    const cached = await pool.query(
      `
        SELECT *, COUNT(*) OVER()::int AS total_count
        FROM ${PNCP_RESULT_CACHE_TABLE}
        ${where}
        ORDER BY ${orderSql}
        LIMIT ${addValue(tam)} OFFSET ${addValue(offset)}
      `,
      values
    );
    const items = cached.rows.map(normalizePncpResultCacheRow);
    const total = Number(cached.rows[0]?.total_count || items.length);

    res.json({
      items,
      total,
      pagina,
      tamanhoPagina: tam,
      totalPaginas: Math.max(1, Math.ceil(total / tam)),
      summary: summarizePncpOutcomeItems(items),
      live_fetch_used: false,
      ...(liveError ? { live_error: liveError } : {}),
      gate: getPncpGateSnapshot(),
      cache: await getPncpOutcomeCacheStats(),
      sync: getPncpOutcomeSyncSnapshot(),
    });
  } catch (error) {
    console.error('Error searching PNCP resultados:', error);
    const isThrottle = isPncpThrottleError(error);
    if (isThrottle) notePncpThrottle(error.message || 'resultados search');
    const pauseLeft = Math.max(0, PNCP_GATE.pausedUntil - Date.now());
    res.status(isThrottle ? 503 : 502).json({
      error: isThrottle
        ? 'PNCP limitou as requisições — pausando e retomando automaticamente'
        : 'Erro ao buscar resultados/contratos PNCP',
      details: error.message,
      rate_limited: isThrottle,
      retry_after_ms: Math.max(15_000, pauseLeft > 0 ? pauseLeft + 5_000 : 30_000),
      gate: getPncpGateSnapshot(),
    });
  }
});

// Enriquecimento progressivo da aba Contratos/Resultados: o frontend manda
// lotes de contratos da página visível e vai preenchendo fornecedor/valores
// conforme o gate permite. Sempre 'interactive'.
app.post('/api/licitacoes/pncp/resultados/enrich', async (req, res) => {
  try {
    const contratos = Array.isArray(req.body?.contratos) ? req.body.contratos.slice(0, 20) : [];
    const budgetMs = Math.max(1000, Math.min(8000, Number(req.body?.budget_ms) || 4000));
    const deadline = Date.now() + budgetMs;
    const enriched = {};
    const wanted = [];
    for (const entry of contratos) {
      const cnpj = String(entry?.cnpj || '').replace(/\D/g, '');
      const ano = String(entry?.ano || '').replace(/\D/g, '');
      const sequencial = String(entry?.sequencial || '').replace(/\D/g, '');
      if (!/^\d{14}$/.test(cnpj) || !/^\d{4}$/.test(ano) || !sequencial) continue;
      wanted.push({ key: `${cnpj}/${ano}/${Number(sequencial)}`, ids: { cnpj, ano, sequencial }, entry });
    }
    for (const item of wanted) {
      const isCached = pncpContratoDetalheCache.has(item.key);
      // Sem cache e sem prazo/gate: fica pendente para a próxima rodada do frontend.
      if (!isCached && (Date.now() >= deadline || Date.now() < PNCP_GATE.pausedUntil)) continue;
      try {
        const fields = await buildPncpOutcomeContratoEnrichment(item.ids, item.entry);
        if (fields) enriched[item.key] = fields;
      } catch (error) {
        if (Date.now() < PNCP_GATE.pausedUntil) break;
      }
    }
    res.json({
      enriched,
      pending: wanted.filter(item => !enriched[item.key]).map(item => item.key),
      gate_paused_ms: Math.max(0, PNCP_GATE.pausedUntil - Date.now()),
      gate: getPncpGateSnapshot(),
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao enriquecer contratos', details: error.message });
  }
});

app.get('/api/licitacoes/pncp/resultados/status', async (req, res) => {
  try {
    res.json({
      state: getPncpOutcomeSyncSnapshot(),
      cache: await getPncpOutcomeCacheStats(),
    });
  } catch (error) {
    console.error('Error fetching PNCP resultados status:', error);
    res.status(500).json({ error: 'Erro ao consultar o status da atualização PNCP', details: error.message });
  }
});

app.post('/api/licitacoes/pncp/resultados/sync', requireAdmin, async (req, res) => {
  try {
    const start = startPncpOutcomeSync({ reason: 'manual' });
    res.status(start.started ? 202 : 200).json(start);
  } catch (error) {
    console.error('Error starting PNCP resultados sync:', error);
    res.status(500).json({ error: 'Erro ao iniciar a atualização PNCP', details: error.message });
  }
});

const buildEditalWatchlistFilters = (value) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const filters = {};
  [
    'tipos_documento', 'status', 'modalidade_licitacao_id', 'tipo_id',
    'modo_disputa_id', 'uf', 'esfera_id', 'orgao_cnpj', 'unidade_codigo',
    'ordenacao',
  ].forEach(key => {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
      filters[key] = String(source[key]);
    }
  });
  filters.tipos_documento = filters.tipos_documento || 'edital';
  filters.status = filters.status || 'recebendo_proposta';
  filters.ordenacao = filters.ordenacao || 'relevancia_desc';
  return filters;
};

const matchesWatchlistEntityFilters = (normalized, filters = {}) => {
  const orgaoFilter = String(filters.orgao_cnpj || '').trim();
  const unidadeFilter = String(filters.unidade_codigo || '').trim();
  if (orgaoFilter) {
    const orgaoDigits = orgaoFilter.replace(/\D/g, '');
    const itemCnpj = String(normalized.orgao?.cnpj || '').replace(/\D/g, '');
    const orgaoText = normalizeSearchText(orgaoFilter);
    const itemOrgaoText = normalizeSearchText(normalized.orgao?.nome || '');
    if (!((orgaoDigits.length >= 3 && itemCnpj.includes(orgaoDigits)) || itemOrgaoText.includes(orgaoText))) {
      return false;
    }
  }
  if (unidadeFilter) {
    const unidadeDigits = unidadeFilter.replace(/\D/g, '');
    const itemUnidadeDigits = String(normalized.unidade?.codigo || '').replace(/\D/g, '');
    const unidadeText = normalizeSearchText(unidadeFilter);
    const itemUnidadeText = normalizeSearchText(`${normalized.unidade?.codigo || ''} ${normalized.unidade?.nome || ''}`);
    if (!((unidadeDigits.length >= 4 && itemUnidadeDigits.includes(unidadeDigits)) || itemUnidadeText.includes(unidadeText))) {
      return false;
    }
  }
  return true;
};

const listEditalSignalsQuery = `
  SELECT s.*, w.nome AS watchlist_nome, w.whatsapp_enabled, w.whatsapp_number, w.whatsapp_min_score,
         COUNT(*) OVER(PARTITION BY s.watchlist_id)::int AS watchlist_total_count
  FROM ${EDITAL_SIGNALS_TABLE} s
  LEFT JOIN ${EDITAL_WATCHLIST_TABLE} w ON w.id = s.watchlist_id
  WHERE s.account_id = $1 AND s.status = $2 AND s.watchlist_id IS NOT NULL
    AND ($5::bigint IS NULL OR s.watchlist_id = $5)
  ORDER BY w.nome ASC NULLS LAST, s.score DESC NULLS LAST, s.criado_em DESC
  LIMIT $3 OFFSET $4
`;

const runEditalWatchlistMatching = async () => {
  const { rows: watches } = await pool.query(
    `SELECT * FROM ${EDITAL_WATCHLIST_TABLE} WHERE ativo = TRUE`
  );
  let inserted = 0;
  for (const watch of watches) {
    let positivos = Array.isArray(watch.palavras_chave) ? [...watch.palavras_chave] : [];
    let negativos = Array.isArray(watch.termos_negativos) ? [...watch.termos_negativos] : [];
    if (watch.usar_ia && positivos[0]) {
      try {
        const r = await getTermosCorrelatos(positivos[0]);
        positivos = Array.from(new Set([...positivos, ...(r.positivos || r.correlatos || [])])).slice(0, 8);
      } catch (e) {
        console.warn('[editais] IA falhou para watchlist', watch.id, e.message);
      }
    }
    positivos = positivos.filter(Boolean);
    if (!positivos.length) continue;

    const filters = buildEditalWatchlistFilters(watch.filtros || {});
    const baseParams = {
      tipos_documento: filters.tipos_documento,
      status: filters.status === 'todos' ? undefined : filters.status,
      modalidade_licitacao_id: filters.modalidade_licitacao_id,
      tipo_id: filters.tipo_id,
      uf: filters.uf,
      esfera_id: filters.esfera_id,
      tam: 50,
    };
    const seen = new Set();
    const processEditalCandidate = async (raw, term, key) => {
      const normalized = normalizePncpItem(raw, term);

      if (!matchesWatchlistEntityFilters(normalized, filters)) return;
      // modo_disputa não é suportado pela /api/search/: resolve via detalhe só
      // para itens que já passaram nos demais filtros; desconhecido não descarta.
      if (filters.modo_disputa_id && !normalized.modo_disputa?.id) {
        const ids = extractPncpCompraIdentifiers(normalized);
        const detalhe = await getPncpCompraDetalhe(ids.cnpj, ids.ano, ids.sequencial);
        if (detalhe?.modo_disputa_id && String(detalhe.modo_disputa_id) !== String(filters.modo_disputa_id)) {
          return;
        }
        if (detalhe) {
          normalized.modo_disputa = { id: detalhe.modo_disputa_id, nome: detalhe.modo_disputa_nome };
        }
      } else if (filters.modo_disputa_id && normalized.modo_disputa?.id
        && String(normalized.modo_disputa.id) !== String(filters.modo_disputa_id)) {
        return;
      }
      const decorated = decoratePncpSearchItem(normalized, {
        qText: term,
        positiveTerms: positivos,
        negativeTerms: negativos,
        orgaoFilterRaw: filters.orgao_cnpj,
        unidadeFilterRaw: filters.unidade_codigo,
      });
      const r = await pool.query(
        `
          INSERT INTO ${EDITAL_SIGNALS_TABLE}
            (account_id, watchlist_id, fonte, chave_externa, payload, score, termos_matched, termos_excluidos)
          VALUES ($1,$2,'pncp',$3,$4::jsonb,$5,$6,$7)
          ON CONFLICT (account_id, watchlist_id, chave_externa) DO NOTHING
          RETURNING id
        `,
        [watch.account_id, watch.id, key, JSON.stringify(decorated), Number(decorated.score) || 0, positivos.slice(0, 8), negativos.slice(0, 8)]
      );
      if (r.rowCount > 0) {
        inserted += 1;
        if (shouldSendWatchlistWhatsappForScore(watch, decorated?.score)) {
          await enqueueWatchlistNotificationsForRecipients({
            source: 'edital',
            watchlistId: watch.id,
            signalId: r.rows[0].id,
            recipients: watch.whatsapp_number,
          });
        }
        const signalTitle = decorated?.titulo || decorated?.title || decorated?.orgao?.nome || 'Edital PNCP';
        await notifyAccountUsers(pool, {
          accountId: watch.account_id || CHATWOOT_ACCOUNT_ID,
          type: 'watchlist.edital_match',
          title: `Novo edital · ${watch.nome || 'Assinatura'}`,
          body: String(signalTitle).slice(0, 180),
          data: {
            view: 'Licitações',
            sub: 'editais',
            watchlist_id: watch.id,
            signal_id: r.rows[0].id,
            url: decorated?.url || null,
          },
          dedupeKey: `edital:${r.rows[0].id}`,
        }).catch((err) => console.warn('[editais] push/inbox falhou:', err.message));
      }
    };

    for (const term of positivos.slice(0, 6)) {
      let data;
      try {
        data = await withPncpGate(() => fetchPncpSearchStable({ ...baseParams, q: term, pagina: 1, tam: 50 }), { priority: 'sync' });
      } catch (e) {
        console.warn('[editais] busca PNCP falhou para watchlist', watch.id, e.message);
        continue;
      }
      const rawItems = Array.isArray(data?.items) ? data.items : [];
      for (const raw of rawItems) {
        const key = getPncpRawItemKey(raw);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        await processEditalCandidate(raw, term, key);
      }
    }

    // Complemento por data: contratações abertas cujo objeto casa com os termos
    // mas que a /api/search/ não retorna por diferença de terminologia.
    const complementItems = [];
    const complementRun = await fetchConsultaComplementItems({
      qText: positivos[0],
      terms: positivos,
      filters,
      mappedStatus: filters.status === 'todos' ? null : filters.status,
      shouldApplyReceivingProposalLocally: filters.status === 'recebendo_proposta',
      seen,
      rawItems: complementItems,
      maxPages: 4,
    });
    if (complementRun.errors.length) {
      console.warn('[editais] complemento consulta falhou para watchlist', watch.id, complementRun.errors.join('; '));
    }
    for (const raw of complementItems) {
      const key = getPncpRawItemKey(raw);
      if (!key) continue;
      await processEditalCandidate(raw, raw.__matched_termo || positivos[0], key);
    }
  }
  const notifications = await processWatchlistNotifications().catch(error => {
    console.warn('[editais] notificacoes falharam:', error.message);
    return { sent: 0, failed: 0, processed: 0 };
  });
  return { watchlist_count: watches.length, signals_inserted: inserted, notifications };
};

app.post('/api/licitacoes/editais/sync', async (req, res) => {
  try {
    const result = await runEditalWatchlistMatching();
    res.json(result);
  } catch (error) {
    console.error('Error syncing edital watchlists:', error);
    res.status(500).json({ error: 'Erro ao sincronizar watchlists de editais', details: error.message });
  }
});

// ===== Sync diário de contratos e atas publicados no PNCP (aba Contratos/Resultados) =====

const extractPncpOutcomeCandidateIds = (source = {}) => {
  const links = source.links && typeof source.links === 'object' ? source.links : {};
  const metadados = source.metadados && typeof source.metadados === 'object' ? source.metadados : {};
  const payload = source.payload && typeof source.payload === 'object' ? source.payload : {};
  const merged = {
    ...source,
    ...metadados,
    ...payload,
    orgao_cnpj: payload.orgao_cnpj || source.orgao_cnpj || metadados.orgao_cnpj,
    numero_controle_pncp: payload.numero_controle_pncp || payload.numeroControlePNCP
      || source.numero_controle_pncp || source.numero_compra
      || metadados.pncp_numero_controle || metadados.numero_controle_pncp,
    links_pncp: payload.links_pncp || payload.url || source.url || links.pncp
      || links.pncp_url || metadados.pncp_url,
  };
  let ids = extractPncpCompraIdentifiers(merged);
  if (ids.cnpj && ids.ano && ids.sequencial) return ids;

  const serialized = JSON.stringify({ links, metadados, payload, numero_compra: source.numero_compra });
  const urlMatch = serialized.match(/\/app\/editais\/(\d{14})\/(\d{4})\/(\d+)/);
  if (urlMatch) return { cnpj: urlMatch[1], ano: urlMatch[2], sequencial: urlMatch[3] };
  const controlMatch = serialized.match(/(\d{14}-\d+-(\d+)\/(\d{4}))/);
  if (controlMatch) return parsePncpCompraControlNumber(controlMatch[1]) || { cnpj: '', ano: '', sequencial: '' };
  return { cnpj: '', ano: '', sequencial: '' };
};

const collectPncpOutcomeCandidates = async ({ limit = 20 } = {}) => {
  const safeLimit = Math.max(5, Math.min(80, Number(limit) || 20));
  const [jobsResult, opportunitiesResult] = await Promise.all([
    pool.query(
      `
        SELECT r.payload, r.matched_term, r.commercial_stage, r.score, r.updated_at,
               j.filters, j.terms
          FROM ${PNCP_SEARCH_JOB_RESULTS_TABLE} r
          JOIN ${PNCP_SEARCH_JOBS_TABLE} j ON j.id = r.job_id
         WHERE r.visibility = 'visible'
           AND r.updated_at > NOW() - INTERVAL '180 days'
         ORDER BY (r.commercial_stage IN ('resulted','contracted','ata_available')) DESC,
                  r.score DESC NULLS LAST,
                  r.updated_at DESC
         LIMIT $1
      `,
      [safeLimit * 2]
    ),
    pool.query(
      `
        SELECT titulo, fase, status, orgao_cnpj, numero_compra, palavras_chave,
               links, metadados, updated_at
          FROM ${LICITACAO_TABLE}
         WHERE updated_at > NOW() - INTERVAL '365 days'
           AND (
             numero_compra ~ '^\\d{14}-\\d+-\\d+/\\d{4}$'
             OR links::text LIKE '%/app/editais/%'
             OR metadados::text ILIKE '%pncp%'
           )
         ORDER BY updated_at DESC
         LIMIT $1
      `,
      [safeLimit * 2]
    ),
  ]);

  const candidates = new Map();
  const add = (source, metadata = {}) => {
    const ids = extractPncpOutcomeCandidateIds(source);
    if (!/^\d{14}$/.test(String(ids.cnpj || '')) || !/^\d{4}$/.test(String(ids.ano || ''))
      || !/^\d+$/.test(String(ids.sequencial || ''))) return;
    const key = `${ids.cnpj}/${ids.ano}/${Number(ids.sequencial)}`;
    const existing = candidates.get(key);
    const next = {
      pncp_key: key,
      ids: { cnpj: ids.cnpj, ano: ids.ano, sequencial: String(Number(ids.sequencial)) },
      query: metadata.query || '',
      commercial_stage: metadata.commercial_stage || null,
      source: metadata.source || 'unknown',
    };
    if (!existing || (
      ['resulted', 'contracted', 'ata_available'].includes(next.commercial_stage)
      && !['resulted', 'contracted', 'ata_available'].includes(existing.commercial_stage)
    )) candidates.set(key, next);
  };

  jobsResult.rows.forEach(row => add(row, {
    source: 'search_job',
    commercial_stage: row.commercial_stage || row.payload?.commercial_stage?.id || row.payload?.commercial_stage,
    query: row.matched_term || row.filters?.q || row.terms?.[0] || '',
  }));
  opportunitiesResult.rows.forEach(row => add(row, {
    source: 'pipeline',
    commercial_stage: String(row.fase || '').startsWith('12.') ? 'contracted' : null,
    query: row.palavras_chave?.[0] || row.titulo || '',
  }));

  const candidateList = [...candidates.values()];
  const { rows: cachedRows } = candidateList.length
    ? await pool.query(
        `SELECT pncp_key FROM ${PNCP_RESULT_CACHE_TABLE}
          WHERE pncp_key = ANY($1::text[])
            AND refreshed_at > NOW() - INTERVAL '6 hours'`,
        [candidateList.map(candidate => candidate.pncp_key)]
      )
    : { rows: [] };
  const recentlyCached = new Set(cachedRows.map(row => row.pncp_key));
  const recentlyCheckedCutoff = Date.now() - (6 * 60 * 60 * 1000);

  return candidateList
    .sort((a, b) => {
      const aRecent = recentlyCached.has(a.pncp_key)
        || Number(pncpOutcomeCandidateChecks.get(a.pncp_key) || 0) > recentlyCheckedCutoff;
      const bRecent = recentlyCached.has(b.pncp_key)
        || Number(pncpOutcomeCandidateChecks.get(b.pncp_key) || 0) > recentlyCheckedCutoff;
      if (aRecent !== bRecent) return Number(aRecent) - Number(bRecent);
      const stagePriority = Number(['resulted', 'contracted', 'ata_available'].includes(b.commercial_stage))
        - Number(['resulted', 'contracted', 'ata_available'].includes(a.commercial_stage));
      if (stagePriority !== 0) return stagePriority;
      return Number(b.source === 'pipeline') - Number(a.source === 'pipeline');
    })
    .slice(0, safeLimit);
};

const runPncpOutcomeCandidateSync = async ({ limit = 20 } = {}) => {
  const candidates = await collectPncpOutcomeCandidates({ limit });
  const summary = { candidates: candidates.length, processed: 0, cached: 0, without_outcome: 0, errors: [] };
  pncpOutcomeSyncState.phase = 'candidates';
  pncpOutcomeSyncState.total = candidates.length;

  for (const candidate of candidates) {
    try {
      const { cnpj, ano, sequencial } = candidate.ids;
      const [compra, contratos, atasData] = await Promise.all([
        fetchPncpOptional(`/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}`, {}, { source: 'consulta', priority: 'sync' }),
        fetchPncpContratosByCompra(cnpj, ano, sequencial, { priority: 'sync' }),
        fetchPncpOptional(`/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}/atas`, {}, { priority: 'sync' }),
      ]);
      const atas = asPncpList(atasData);
      const firstContract = contratos[0] || {};
      const firstAta = atas[0] || {};
      const normalized = normalizePncpItem({
        ...(compra || {}),
        orgao_cnpj: cnpj,
        ano,
        numero_sequencial: sequencial,
        numeroControlePNCP: compra?.numeroControlePNCP,
        title: compra?.objetoCompra || compra?.numeroControlePNCP || `Compra ${sequencial}/${ano}`,
        description: compra?.objetoCompra || '',
        tem_resultado: compra?.temResultado,
      });
      const hasResult = Boolean(compra?.temResultado || normalized?.tem_resultado || candidate.commercial_stage === 'resulted');
      const hasContract = contratos.length > 0;
      const hasAta = atas.length > 0;
      const hasOutcome = hasResult || hasContract || hasAta;
      if (hasOutcome) {
        const fornecedores = collectPncpFornecedores({ contratos, atas });
        const fornecedor = fornecedores[0] || {};
        await upsertPncpResultCacheLite({
          pncp_key: `${cnpj}/${ano}/${sequencial}`,
          orgao_cnpj: normalized?.orgao?.cnpj || compra?.orgaoEntidade?.cnpj || cnpj,
          orgao_nome: normalized?.orgao?.nome || compra?.orgaoEntidade?.razaoSocial
            || firstContract?.orgaoEntidade?.razaoSocial || firstAta?.nomeOrgao || null,
          ano: Number(ano) || null,
          sequencial: Number(sequencial) || null,
          numero_controle_pncp: normalized?.numero_controle_pncp || compra?.numeroControlePNCP
            || firstContract?.numeroControlePncpCompra || firstAta?.numeroControlePNCPCompra || null,
          titulo: normalized?.titulo || compra?.objetoCompra || firstContract?.objetoContrato
            || firstAta?.objetoContratacao || `Compra ${sequencial}/${ano}`,
          descricao: normalized?.descricao || compra?.objetoCompra || firstContract?.objetoContrato || null,
          uf: normalized?.uf || compra?.unidadeOrgao?.ufSigla || firstContract?.unidadeOrgao?.ufSigla || null,
          modalidade: normalized?.modalidade?.nome || compra?.modalidadeNome || null,
          etapa_comercial: hasContract ? 'contracted' : hasAta ? 'ata_available' : 'resulted',
          fornecedor_ni: fornecedor.ni || null,
          fornecedor_nome: fornecedor.nome || null,
          fornecedores,
          valor_estimado: Number(compra?.valorTotalEstimado) || Number(firstContract?.valorInicial) || null,
          valor_homologado: Number(compra?.valorTotalHomologado) || Number(firstContract?.valorGlobal) || null,
          data_publicacao: compra?.dataPublicacaoPncp || firstContract?.dataPublicacaoPncp || firstAta?.dataPublicacaoPncp || null,
          data_assinatura: firstContract?.dataAssinatura || firstAta?.dataAssinatura || null,
          srp: typeof compra?.srp === 'boolean' ? compra.srp : null,
          amparo_legal: compra?.amparoLegal?.nome || null,
          has_result: hasResult,
          has_contract: hasContract,
          has_ata: hasAta,
          search_text: [
            normalized?.titulo, normalized?.descricao, normalized?.orgao?.nome,
            ...fornecedores.flatMap(row => [row.ni, row.nome]),
            ...contratos.slice(0, 10).map(row => row?.objetoContrato),
            ...atas.slice(0, 10).map(row => row?.objetoContratacao || row?.objetoCompra),
          ].filter(Boolean).join(' '),
          payload: {
            source: 'candidate_sync',
            compra: compra || null,
            contratos_daily: contratos.slice(0, 20),
            atas_daily: atas.slice(0, 20),
          },
        });
        summary.cached += 1;
      } else {
        summary.without_outcome += 1;
      }
    } catch (error) {
      summary.errors.push(`${candidate.ids.cnpj}/${candidate.ids.ano}/${candidate.ids.sequencial}: ${error.message}`);
    }
    summary.processed += 1;
    pncpOutcomeCandidateChecks.set(candidate.pncp_key, Date.now());
    pncpOutcomeSyncState.processed = summary.processed;
    pncpOutcomeSyncState.cached = summary.cached;
    pncpOutcomeSyncState.errors = summary.errors.length;
    if (Date.now() < pncpDetalheRateLimitedUntil) break;
  }
  return summary;
};

const collectActiveWatchlistTerms = async () => {
  const [{ rows }, { rows: jobRows }, { rows: opportunityRows }] = await Promise.all([
    pool.query(`SELECT palavras_chave, usar_ia FROM ${EDITAL_WATCHLIST_TABLE} WHERE ativo = TRUE`),
    pool.query(`
      SELECT terms, filters
        FROM ${PNCP_SEARCH_JOBS_TABLE}
       WHERE updated_at > NOW() - INTERVAL '180 days'
       ORDER BY updated_at DESC
       LIMIT 30
    `),
    pool.query(`
      SELECT palavras_chave
        FROM ${LICITACAO_TABLE}
       WHERE updated_at > NOW() - INTERVAL '365 days'
       ORDER BY updated_at DESC
       LIMIT 40
    `),
  ]);
  const terms = new Set();
  for (const row of rows) {
    const palavras = Array.isArray(row.palavras_chave) ? row.palavras_chave.filter(Boolean) : [];
    palavras.forEach(p => terms.add(String(p)));
    if (row.usar_ia && palavras[0]) {
      try {
        const r = await getTermosCorrelatos(palavras[0]);
        (r.positivos || r.correlatos || []).slice(0, 6).forEach(p => terms.add(String(p)));
      } catch (error) {
        console.warn('[contratos-sync] IA falhou para termos correlatos:', error.message);
      }
    }
  }
  jobRows.forEach(row => {
    (Array.isArray(row.terms) ? row.terms : []).slice(0, 8).forEach(term => terms.add(String(term)));
    if (row.filters?.q) terms.add(String(row.filters.q));
  });
  opportunityRows.forEach(row => {
    (Array.isArray(row.palavras_chave) ? row.palavras_chave : []).slice(0, 5).forEach(term => terms.add(String(term)));
  });
  return [...terms]
    .map(term => term.trim())
    .filter(term => term.length >= 3 && !/^\d+$/.test(term))
    .slice(0, 40);
};

const pncpTextMatchesTerms = (text, terms) => {
  const normalized = normalizeSearchText(text || '');
  if (!normalized) return null;
  for (const term of terms) {
    const tokens = normalizeSearchText(term).split(/\s+/).filter(t => t.length >= 3);
    if (tokens.length && tokens.some(t => normalized.includes(t))) return term;
  }
  return null;
};

// Varre contratos (/v1/contratos) e atas (/v1/atas/atualizacao) publicados na janela,
// casa localmente com os termos das watchlists ativas e alimenta o pncp_result_cache.
// Só matches entram no banco; top N ganham dossiê completo.
const runPncpContratosAtasSync = async (opts = {}) =>
  withPncpHeavyJobSlot('contratos-atas-sync', () => runPncpContratosAtasSyncUnlocked(opts));

const runPncpContratosAtasSyncUnlocked = async ({ windowDays = 2, maxPages = 40, dossierBudget = 15 } = {}) => {
  const summary = { contratos_scanned: 0, atas_scanned: 0, matched: 0, upserted: 0, dossiers: 0, errors: [] };
  const terms = await collectActiveWatchlistTerms();
  summary.terms = terms.length;
  if (!terms.length) {
    summary.skipped = 'sem_watchlists_ativas';
    return summary;
  }
  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(hoje.getDate() - windowDays);
  const fmtDate = (d) => d.toISOString().split('T')[0].replace(/-/g, '');
  const dataInicial = fmtDate(inicio);
  const dataFinal = fmtDate(hoje);
  const matchesByKey = new Map();

  const sweep = async (endpoint, onItem) => {
    let pagina = 1;
    while (pagina <= maxPages) {
      let data;
      try {
        data = await withPncpGate(() => fetchPncpConsulta(endpoint, {
          dataInicial, dataFinal, pagina, tamanhoPagina: 50,
        }), { priority: 'sync' });
      } catch (error) {
        summary.errors.push(`${endpoint} p${pagina}: ${error.message}`);
        break;
      }
      const rows = asPncpList(data);
      if (!rows.length) break;
      rows.forEach(onItem);
      const totalPaginas = Number(data?.totalPaginas) || 1;
      if (pagina >= totalPaginas || rows.length < 50) break;
      pagina += 1;
    }
  };

  await sweep('/v1/contratos', (raw) => {
    summary.contratos_scanned += 1;
    const texto = `${raw?.objetoContrato || ''} ${raw?.nomeRazaoSocialFornecedor || ''} ${raw?.orgaoEntidade?.razaoSocial || ''}`;
    const matchedTerm = pncpTextMatchesTerms(texto, terms);
    if (!matchedTerm) return;
    const ids = parsePncpCompraControlNumber(raw?.numeroControlePncpCompra || raw?.numeroControlePNCPCompra);
    if (!ids) return;
    const pncpKey = `${ids.cnpj}/${ids.ano}/${ids.sequencial}`;
    const entry = matchesByKey.get(pncpKey) || { ids, matchedTerm, contratos: [], atas: [] };
    entry.contratos.push(raw);
    matchesByKey.set(pncpKey, entry);
  });

  await sweep('/v1/atas/atualizacao', (raw) => {
    summary.atas_scanned += 1;
    const texto = `${raw?.objetoContratacao || raw?.objetoCompra || ''} ${raw?.nomeOrgao || raw?.orgao?.razaoSocial || raw?.orgaoEntidade?.razaoSocial || ''}`;
    const matchedTerm = pncpTextMatchesTerms(texto, terms);
    if (!matchedTerm) return;
    const ids = parsePncpCompraControlNumber(raw?.numeroControlePNCPCompra || raw?.numeroControlePncpCompra);
    if (!ids) return;
    const pncpKey = `${ids.cnpj}/${ids.ano}/${ids.sequencial}`;
    const entry = matchesByKey.get(pncpKey) || { ids, matchedTerm, contratos: [], atas: [] };
    entry.atas.push(raw);
    matchesByKey.set(pncpKey, entry);
  });

  summary.matched = matchesByKey.size;

  for (const [pncpKey, entry] of matchesByKey) {
    const contrato = entry.contratos[0] || null;
    const ata = entry.atas[0] || null;
    const row = {
      pncp_key: pncpKey,
      orgao_cnpj: contrato?.orgaoEntidade?.cnpj || entry.ids.cnpj,
      orgao_nome: contrato?.orgaoEntidade?.razaoSocial || ata?.nomeOrgao || null,
      ano: Number(entry.ids.ano) || null,
      sequencial: Number(entry.ids.sequencial) || null,
      numero_controle_pncp: contrato?.numeroControlePncpCompra || contrato?.numeroControlePNCPCompra
        || ata?.numeroControlePNCPCompra || ata?.numeroControlePncpCompra || null,
      titulo: contrato?.objetoContrato || ata?.objetoContratacao || ata?.objetoCompra || null,
      descricao: contrato?.objetoContrato || ata?.objetoContratacao || null,
      uf: contrato?.unidadeOrgao?.ufSigla || null,
      modalidade: null,
      etapa_comercial: entry.contratos.length ? 'contracted' : 'ata_available',
      fornecedor_ni: contrato?.niFornecedor || null,
      fornecedor_nome: contrato?.nomeRazaoSocialFornecedor || null,
      valor_estimado: Number(contrato?.valorInicial) > 0 ? Number(contrato.valorInicial) : null,
      valor_homologado: Number(contrato?.valorGlobal) > 0 ? Number(contrato.valorGlobal) : null,
      data_publicacao: contrato?.dataPublicacaoPncp || ata?.dataPublicacaoPncp || null,
      data_assinatura: contrato?.dataAssinatura || ata?.dataAssinatura || null,
      has_result: false,
      has_contract: entry.contratos.length > 0,
      has_ata: entry.atas.length > 0,
      fornecedores: collectPncpFornecedores({ contratos: entry.contratos, atas: entry.atas }),
      search_text: [
        ...entry.contratos.slice(0, 10).flatMap(item => [
          item?.objetoContrato, item?.nomeRazaoSocialFornecedor, item?.niFornecedor,
          item?.orgaoEntidade?.razaoSocial,
        ]),
        ...entry.atas.slice(0, 10).flatMap(item => [item?.objetoContratacao, item?.objetoCompra, item?.nomeOrgao]),
      ].filter(Boolean).join(' '),
      payload: {
        source: 'contratos_daily_sync',
        contratos_daily: entry.contratos.slice(0, 10),
        atas_daily: entry.atas.slice(0, 10),
      },
    };
    try {
      await upsertPncpResultCacheLite(row);
      summary.upserted += 1;
    } catch (error) {
      summary.errors.push(`upsert ${pncpKey}: ${error.message}`);
    }
  }

  // Dossiê completo para os primeiros N matches (enriquece com itens/resultados).
  for (const [, entry] of [...matchesByKey].slice(0, dossierBudget)) {
    if (Date.now() < pncpDetalheRateLimitedUntil) {
      summary.errors.push('dossiers interrompidos por rate limit');
      break;
    }
    try {
      const dossier = await fetchPncpCompraDossier(entry.ids.cnpj, entry.ids.ano, entry.ids.sequencial, {
        query: entry.matchedTerm,
        priority: 'sync',
      });
      await upsertPncpResultCache(dossier, entry.matchedTerm);
      summary.dossiers += 1;
    } catch (error) {
      summary.errors.push(`dossier ${entry.ids.cnpj}/${entry.ids.ano}/${entry.ids.sequencial}: ${error.message}`);
    }
  }

  console.log('[contratos-sync] resumo:', JSON.stringify(summary));
  return summary;
};

const runPncpOutcomeSync = async () => {
  const candidates = await runPncpOutcomeCandidateSync({ limit: 20 });
  let daily = { skipped: 'rate_limited' };
  if (Date.now() >= pncpDetalheRateLimitedUntil && Date.now() >= PNCP_GATE.pausedUntil) {
    pncpOutcomeSyncState.phase = 'recent_publications';
    daily = await runPncpContratosAtasSync({ windowDays: 7, maxPages: 8, dossierBudget: 4 });
  }
  return { candidates, recent_publications: daily, cache: await getPncpOutcomeCacheStats() };
};

const startPncpOutcomeSync = ({ reason = 'manual' } = {}) => {
  if (pncpOutcomeSyncState.running) {
    return { started: false, reason: 'already_running', state: getPncpOutcomeSyncSnapshot() };
  }
  Object.assign(pncpOutcomeSyncState, {
    running: true,
    status: 'running',
    phase: 'preparing',
    processed: 0,
    total: 0,
    cached: 0,
    errors: 0,
    reason,
    started_at: new Date().toISOString(),
    finished_at: null,
    error: null,
    summary: null,
  });

  setImmediate(async () => {
    try {
      const summary = await runPncpOutcomeSync();
      Object.assign(pncpOutcomeSyncState, {
        running: false,
        status: 'completed',
        phase: 'completed',
        finished_at: new Date().toISOString(),
        summary,
      });
      console.log('[pncp-outcomes] sync concluído:', JSON.stringify(summary));
    } catch (error) {
      Object.assign(pncpOutcomeSyncState, {
        running: false,
        status: 'failed',
        phase: 'failed',
        finished_at: new Date().toISOString(),
        error: error.message,
      });
      console.error('[pncp-outcomes] sync falhou:', error);
    }
  });
  return { started: true, state: getPncpOutcomeSyncSnapshot() };
};

const ensurePncpOutcomeBootstrap = async () => {
  if (pncpOutcomeSyncState.running) return { started: false, reason: 'already_running' };
  const cache = await getPncpOutcomeCacheStats();
  const lastRefresh = cache.last_refreshed ? new Date(cache.last_refreshed).getTime() : 0;
  const stale = !lastRefresh || (Date.now() - lastRefresh) > (24 * 60 * 60 * 1000);
  if (cache.total > 0 && !stale) return { started: false, reason: 'up_to_date', cache };
  return { ...startPncpOutcomeSync({ reason: cache.total === 0 ? 'startup_empty' : 'startup_stale' }), cache };
};

app.post('/api/licitacoes/pncp/contratos/sync', requireAdmin, async (req, res) => {
  try {
    const start = startPncpOutcomeSync({ reason: 'legacy_manual' });
    res.status(start.started ? 202 : 200).json(start);
  } catch (error) {
    console.error('Error syncing PNCP contratos/atas:', error);
    res.status(500).json({ error: 'Erro ao sincronizar contratos/atas do PNCP', details: error.message });
  }
});

app.get('/api/licitacoes/editais/watchlist', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const { rows } = await pool.query(
      `SELECT w.*,
              COALESCE(sc.novo_count, 0)::int AS sinais_novos,
              COALESCE(sc.total_count, 0)::int AS sinais_total
         FROM ${EDITAL_WATCHLIST_TABLE} w
         LEFT JOIN (
           SELECT watchlist_id,
                  COUNT(*) FILTER (WHERE status = 'novo')::int AS novo_count,
                  COUNT(*)::int AS total_count
             FROM ${EDITAL_SIGNALS_TABLE}
            WHERE account_id = $1 AND watchlist_id IS NOT NULL
            GROUP BY watchlist_id
         ) sc ON sc.watchlist_id = w.id
        WHERE w.account_id = $1
        ORDER BY w.criado_em DESC`,
      [accountId]
    );
    res.json(rows.map(decorateWatchlistWhatsapp));
  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar watchlists de editais', details: error.message });
  }
});

app.post('/api/licitacoes/editais/watchlist', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const b = req.body || {};
    const filtros = buildEditalWatchlistFilters(b.filtros || b);
    const nome = String(b.nome || filtros.q || 'Watchlist de editais').slice(0, 200);
    let waEnabled = b.whatsapp_enabled === true;
    let waNumber = null;
    let waMinScore = WATCHLIST_SCORE_MIN_ALL;
    if (b.whatsapp_enabled === true || b.whatsapp_number !== undefined || b.whatsapp_numbers !== undefined
      || b.whatsapp_min_score !== undefined || b.whatsapp_score_band !== undefined) {
      const wa = resolveWhatsappFieldsFromBody(b, { requireNumbersIfEnabled: b.whatsapp_enabled === true });
      if (wa.error) return res.status(400).json({ error: wa.error });
      waEnabled = wa.whatsapp_enabled;
      waNumber = wa.whatsapp_number;
      if (wa.whatsapp_min_score !== undefined) waMinScore = wa.whatsapp_min_score;
    }
    const { rows } = await pool.query(
      `
        INSERT INTO ${EDITAL_WATCHLIST_TABLE}
          (account_id, nome, palavras_chave, termos_negativos, usar_ia, filtros,
           whatsapp_enabled, whatsapp_number, whatsapp_min_score, ativo)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
        RETURNING *
      `,
      [
        accountId,
        nome,
        asTextArray(b.palavras_chave || b.q || filtros.q),
        asTextArray(b.termos_negativos || b.negative_terms),
        b.usar_ia !== false,
        JSON.stringify(filtros),
        waEnabled,
        waNumber,
        waMinScore,
        b.ativo !== false,
      ]
    );
    res.status(201).json(decorateWatchlistWhatsapp(rows[0]));
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar watchlist de editais', details: error.message });
  }
});

app.put('/api/licitacoes/editais/watchlist/:id', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const id = toIntOrNull(req.params.id);
    const b = req.body || {};
    const filtros = b.filtros ? buildEditalWatchlistFilters(b.filtros) : null;
    const touchingWhatsapp = typeof b.whatsapp_enabled === 'boolean'
      || b.whatsapp_number !== undefined
      || b.whatsapp_numbers !== undefined
      || b.whatsapp_min_score !== undefined
      || b.whatsapp_score_band !== undefined;
    let waEnabled = null;
    let waNumber = null;
    let waMinScore = null;
    if (touchingWhatsapp) {
      const wa = resolveWhatsappFieldsFromBody({
        whatsapp_enabled: b.whatsapp_enabled === true,
        whatsapp_number: b.whatsapp_number,
        whatsapp_numbers: b.whatsapp_numbers,
        whatsapp_min_score: b.whatsapp_min_score,
        whatsapp_score_band: b.whatsapp_score_band,
      }, { requireNumbersIfEnabled: b.whatsapp_enabled === true });
      if (wa.error) return res.status(400).json({ error: wa.error });
      waEnabled = wa.whatsapp_enabled;
      waNumber = wa.whatsapp_number;
      waMinScore = wa.whatsapp_min_score !== undefined ? wa.whatsapp_min_score : WATCHLIST_SCORE_MIN_ALL;
    }
    const { rows } = await pool.query(
      `
        UPDATE ${EDITAL_WATCHLIST_TABLE}
           SET nome = COALESCE($1, nome),
               palavras_chave = COALESCE($2, palavras_chave),
               termos_negativos = COALESCE($3, termos_negativos),
               usar_ia = COALESCE($4, usar_ia),
               filtros = COALESCE($5::jsonb, filtros),
               whatsapp_enabled = COALESCE($6, whatsapp_enabled),
               whatsapp_number = CASE WHEN $11::boolean THEN $7 ELSE whatsapp_number END,
               whatsapp_min_score = CASE WHEN $11::boolean THEN $12 ELSE whatsapp_min_score END,
               ativo = COALESCE($8, ativo),
               atualizado_em = NOW()
         WHERE id = $9 AND account_id = $10
         RETURNING *
      `,
      [
        b.nome ?? null,
        b.palavras_chave !== undefined ? asTextArray(b.palavras_chave) : null,
        b.termos_negativos !== undefined ? asTextArray(b.termos_negativos) : null,
        typeof b.usar_ia === 'boolean' ? b.usar_ia : null,
        filtros ? JSON.stringify(filtros) : null,
        waEnabled,
        waNumber,
        typeof b.ativo === 'boolean' ? b.ativo : null,
        id,
        accountId,
        touchingWhatsapp,
        waMinScore,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'nao encontrado' });
    res.json(decorateWatchlistWhatsapp(rows[0]));
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar watchlist de editais', details: error.message });
  }
});

app.delete('/api/licitacoes/editais/watchlist/:id', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const id = toIntOrNull(req.params.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM ${WATCHLIST_NOTIFICATIONS_TABLE} WHERE source = 'edital' AND watchlist_id = $1`,
        [id]
      );
      await client.query(`DELETE FROM ${EDITAL_SIGNALS_TABLE} WHERE watchlist_id = $1 AND account_id = $2`, [id, accountId]);
      await client.query(`DELETE FROM ${EDITAL_WATCHLIST_TABLE} WHERE id = $1 AND account_id = $2`, [id, accountId]);
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir watchlist de editais', details: error.message });
  }
});

app.get('/api/licitacoes/editais/signals', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const status = req.query.status || 'novo';
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 1000, 1), 2000);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const watchlistId = toIntOrNull(req.query.watchlist_id);
    const [signalsResult, countResult] = await Promise.all([
      pool.query(listEditalSignalsQuery, [accountId, status, limit, offset, watchlistId]),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM ${EDITAL_SIGNALS_TABLE}
          WHERE account_id = $1 AND status = $2 AND watchlist_id IS NOT NULL
            AND ($3::bigint IS NULL OR watchlist_id = $3)`,
        [accountId, status, watchlistId]
      ),
    ]);
    const rows = signalsResult.rows;
    const total = Number(countResult.rows[0]?.total) || 0;
    const data = rows;
    res.json({ data, total, limit, offset, has_more: offset + data.length < total });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar sinais de editais', details: error.message });
  }
});

app.get('/api/licitacoes/editais/signals/stats', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const { rows } = await pool.query(
      `SELECT status, COUNT(*)::int AS total FROM ${EDITAL_SIGNALS_TABLE} WHERE account_id = $1 AND watchlist_id IS NOT NULL GROUP BY status`,
      [accountId]
    );
    const base = { novo: 0, visto: 0, promovido: 0, descartado: 0 };
    rows.forEach(row => {
      if (Object.prototype.hasOwnProperty.call(base, row.status)) base[row.status] = Number(row.total) || 0;
    });
    res.json(base);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao contar sinais de editais', details: error.message });
  }
});

app.put('/api/licitacoes/editais/signals/:id/status', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const id = toIntOrNull(req.params.id);
    const status = ['novo', 'visto', 'promovido', 'descartado'].includes(req.body?.status) ? req.body.status : null;
    if (!id || !status) return res.status(400).json({ error: 'id/status invalidos' });
    const promotedId = toIntOrNull(req.body?.promovido_para_opportunity_id);
    const { rows } = await pool.query(
      `
        UPDATE ${EDITAL_SIGNALS_TABLE}
           SET status = $1,
               promovido_para_opportunity_id = COALESCE($2, promovido_para_opportunity_id)
         WHERE id = $3 AND account_id = $4
         RETURNING *
      `,
      [status, promotedId, id, accountId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'sinal nao encontrado' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar sinal de edital', details: error.message });
  }
});

app.post('/api/licitacoes/editais/signals/batch', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const ids = Array.isArray(req.body?.signal_ids) ? req.body.signal_ids.map(toIntOrNull).filter(Boolean) : [];
    const status = ['novo', 'visto', 'promovido', 'descartado'].includes(req.body?.status) ? req.body.status : null;
    if (!ids.length || !status) return res.status(400).json({ error: 'signal_ids/status invalidos' });
    const { rows } = await pool.query(
      `UPDATE ${EDITAL_SIGNALS_TABLE} SET status = $1 WHERE account_id = $2 AND id = ANY($3::bigint[]) RETURNING id`,
      [status, accountId, ids]
    );
    res.json({ updated: rows.length });
  } catch (error) {
    res.status(500).json({ error: 'Erro na acao em lote de sinais de editais', details: error.message });
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

// ============ PCA — Plano Anual de Contratações (PNCP) ============

const pickFirst = (obj, keys) => {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
};

const normalizeForTsQuery = (term) => {
  if (!term) return '';
  const cleaned = String(term)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const tokens = cleaned.split(' ').filter(Boolean);
  if (!tokens.length) return '';
  return tokens.map(t => `${t}:*`).join(' & ');
};

const buildTsQuery = (terms) => {
  const parts = (terms || []).map(normalizeForTsQuery).filter(Boolean);
  if (!parts.length) return '';
  return parts.map(p => `(${p})`).join(' | ');
};

const parseAtoOuArray = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const j = JSON.parse(raw); return Array.isArray(j) ? j : [j]; }
    catch { return raw.split(',').map(s => s.trim()).filter(Boolean); }
  }
  if (typeof raw === 'object') return [raw];
  return [];
};

const toIntOrNull = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

const toDateOrNull = (v) => {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

const normalizeItemKeyPart = (v) => String(v || '')
  .trim()
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .slice(0, 240);

const buildPcaItemStableKey = (item) => {
  const byCodigo = normalizeItemKeyPart(pickFirst(item, ['codigoItem', 'codigoItemCatalogo']));
  if (byCodigo) return `cod:${byCodigo}`;

  const byFutura = normalizeItemKeyPart(pickFirst(item, [
    'grupoContratacaoCodigo', 'identificadorFuturaContratacao', 'futuraContratacaoId',
  ]));
  const numero = normalizeItemKeyPart(pickFirst(item, ['numeroItem', 'numero']));
  const descricao = normalizeItemKeyPart(pickFirst(item, ['descricao', 'descricaoItem', 'descricaoServico']));

  if (byFutura || numero || descricao) {
    return `grp:${byFutura}|num:${numero}|desc:${descricao}`;
  }

  return null;
};

// Upsert de um plano PCA do PNCP. Aceita nomes de campos variados
// (a API ainda evolui; persistimos payload_raw como fonte canônica).
const upsertPcaPlano = async (planoRaw) => {
  const orgaoCnpj = String(pickFirst(planoRaw, [
    'orgaoEntidadeCnpj', 'cnpjOrgao', 'orgaoCnpj',
  ]) || '').replace(/\D/g, '');
  const codigoUnidade = String(pickFirst(planoRaw, [
    'codigoUnidade', 'unidadeCodigo', 'codigoUnidadeOrgao', 'codigoUasg',
  ]) || '');
  const anoPca = toIntOrNull(pickFirst(planoRaw, ['anoPca', 'ano']));
  if (!orgaoCnpj || !codigoUnidade || !anoPca) {
    return { plano: null, itensInseridos: 0 };
  }
  const orgaoRazao = pickFirst(planoRaw, [
    'orgaoEntidadeRazaoSocial', 'razaoSocialOrgao', 'orgaoNome', 'nomeOrgao',
  ]);
  const unidadeNome = pickFirst(planoRaw, [
    'unidadeNome', 'nomeUnidade', 'unidadeOrgaoNome',
  ]);
  const dataPublicacao = toDateOrNull(pickFirst(planoRaw, [
    'dataPublicacaoPNCP', 'dataPublicacaoPncp', 'dataPublicacao',
  ]));
  const dataAtualizacao = pickFirst(planoRaw, [
    'dataAtualizacaoGlobalPCA', 'dataAtualizacaoPNCP', 'dataAtualizacaoPncp', 'dataAtualizacao',
  ]) || null;
  const idPcaPncp = pickFirst(planoRaw, ['idPcaPncp', 'idPCAPncp', 'idPncp']);
  const responsaveis = pickFirst(planoRaw, ['responsaveis', 'responsavel']) || [];
  const contatos = pickFirst(planoRaw, ['contatos', 'contato']) || [];
  const itensRaw = pickFirst(planoRaw, ['itens', 'itensPca', 'planosItens']) || [];
  const quantidadeItens = Array.isArray(itensRaw) ? itensRaw.length : null;
  // valor_total não vem no plano — soma dos itens (quando disponível).
  const valorTotal = Array.isArray(itensRaw)
    ? itensRaw.reduce((acc, it) => {
        const v = toNullableNumber(pickFirst(it, [
          'valorTotal', 'valorTotalEstimado', 'valorOrcamentoExercicio',
        ]));
        return v ? acc + Number(v) : acc;
      }, 0) || null
    : null;

  const { rows } = await pool.query(
    `
      INSERT INTO ${PCA_PLANOS_TABLE}
        (orgao_cnpj, orgao_razao_social, codigo_unidade, unidade_nome, ano_pca,
         data_publicacao, data_atualizacao, valor_total_estimado, quantidade_itens,
         responsaveis, contatos, id_pca_pncp, payload_raw, atualizado_em)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13::jsonb, NOW())
      ON CONFLICT (orgao_cnpj, codigo_unidade, ano_pca) DO UPDATE SET
        orgao_razao_social = EXCLUDED.orgao_razao_social,
        unidade_nome = EXCLUDED.unidade_nome,
        data_publicacao = EXCLUDED.data_publicacao,
        data_atualizacao = EXCLUDED.data_atualizacao,
        valor_total_estimado = EXCLUDED.valor_total_estimado,
        quantidade_itens = EXCLUDED.quantidade_itens,
        responsaveis = EXCLUDED.responsaveis,
        contatos = EXCLUDED.contatos,
        id_pca_pncp = EXCLUDED.id_pca_pncp,
        payload_raw = EXCLUDED.payload_raw,
        atualizado_em = NOW()
      RETURNING id
    `,
    [
      orgaoCnpj, orgaoRazao, codigoUnidade, unidadeNome, anoPca,
      dataPublicacao, dataAtualizacao, valorTotal, quantidadeItens,
      JSON.stringify(Array.isArray(responsaveis) ? responsaveis : [responsaveis]),
      JSON.stringify(Array.isArray(contatos) ? contatos : [contatos]),
      idPcaPncp,
      JSON.stringify(planoRaw),
    ]
  );
  const planoId = rows[0]?.id;
  if (!planoId) return { plano: null, itensInseridos: 0 };

  const itens = Array.isArray(itensRaw) ? itensRaw : [];
  let inseridos = 0;
  for (const item of itens) {
    const descricao = pickFirst(item, ['descricao', 'descricaoItem', 'descricaoServico']);
    if (!descricao) continue;
    const chaveEstavel = buildPcaItemStableKey(item);
    await pool.query(
      `
        INSERT INTO ${PCA_ITENS_TABLE}
          (plano_id, numero_item, descricao, classificacao_codigo, classificacao_nome,
           categoria_item, quantidade, unidade_medida, valor_unitario, valor_total,
           mes_previsto, data_estimada_inicio, data_estimada_conclusao,
           futura_contratacao_id, futura_contratacao_nome, codigo_item_catalogo, chave_estavel, payload_raw)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)
        ON CONFLICT (plano_id, chave_estavel)
        WHERE chave_estavel IS NOT NULL
        DO UPDATE SET
          numero_item = EXCLUDED.numero_item,
          descricao = EXCLUDED.descricao,
          classificacao_codigo = EXCLUDED.classificacao_codigo,
          classificacao_nome = EXCLUDED.classificacao_nome,
          categoria_item = EXCLUDED.categoria_item,
          quantidade = EXCLUDED.quantidade,
          unidade_medida = EXCLUDED.unidade_medida,
          valor_unitario = EXCLUDED.valor_unitario,
          valor_total = EXCLUDED.valor_total,
          mes_previsto = EXCLUDED.mes_previsto,
          data_estimada_inicio = EXCLUDED.data_estimada_inicio,
          data_estimada_conclusao = EXCLUDED.data_estimada_conclusao,
          futura_contratacao_id = EXCLUDED.futura_contratacao_id,
          futura_contratacao_nome = EXCLUDED.futura_contratacao_nome,
          codigo_item_catalogo = EXCLUDED.codigo_item_catalogo,
          payload_raw = EXCLUDED.payload_raw
      `,
      [
        planoId,
        pickFirst(item, ['numeroItem', 'numero']),
        descricao,
        pickFirst(item, ['classificacaoSuperiorCodigo', 'classificacaoCatalogoCodigo', 'codigoClassificacao']),
        pickFirst(item, ['classificacaoSuperiorNome', 'nomeClassificacaoCatalogo', 'classificacaoCatalogoNome']),
        pickFirst(item, ['categoriaItemPcaNome', 'categoriaItemPca', 'categoriaItem', 'categoria']),
        toNullableNumber(pickFirst(item, ['quantidadeEstimada', 'quantidade'])),
        pickFirst(item, ['unidadeFornecimento', 'unidadeMedida', 'unidade']),
        toNullableNumber(pickFirst(item, ['valorUnitarioEstimado', 'valorUnitario'])),
        toNullableNumber(pickFirst(item, ['valorTotal', 'valorTotalEstimado', 'valorOrcamentoExercicio'])),
        // mes_previsto: derivar de dataDesejada (mês 1-12).
        (() => {
          const explicit = toIntOrNull(pickFirst(item, ['mesPrevistoContratacao', 'mesContratacao', 'mesPrevisto']));
          if (explicit) return explicit;
          const d = pickFirst(item, ['dataDesejada', 'dataInicioEstimada']);
          if (!d) return null;
          const m = parseInt(String(d).slice(5, 7), 10);
          return Number.isFinite(m) ? m : null;
        })(),
        toDateOrNull(pickFirst(item, ['dataDesejada', 'dataInicioEstimada', 'dataEstimadaInicio'])),
        toDateOrNull(pickFirst(item, ['dataEstimadaConclusao', 'dataFimEstimada'])),
        // Identificador da Futura Contratação (CSV) = grupoContratacaoCodigo (JSON)
        pickFirst(item, ['grupoContratacaoCodigo', 'identificadorFuturaContratacao', 'futuraContratacaoId']),
        pickFirst(item, ['grupoContratacaoNome', 'nomeFuturaContratacao', 'futuraContratacaoNome']),
        pickFirst(item, ['codigoItem', 'codigoItemCatalogo']),
        chaveEstavel,
        JSON.stringify(item),
      ]
    );
    inseridos += 1;
  }

  return { plano: planoId, itensInseridos: inseridos };
};

// Match: roda tsquery sobre pca_itens com positivos/negativos + filtros opcionais.
const matchPcaItens = async ({
  positivos = [],
  negativos = [],
  filtros = {},
  pagina = 1,
  tam = 50,
  termoOriginal = '',
  accountId = null,
}) => {
  const tsPos = buildTsQuery(positivos);
  if (!tsPos) {
    return { items: [], total: 0 };
  }
  const tsNeg = buildTsQuery(negativos);
  const params = [tsPos, tsNeg];
  let where = `i.descricao_tsv @@ to_tsquery('portuguese', $1)
    AND ($2 = '' OR NOT (i.descricao_tsv @@ to_tsquery('portuguese', $2)))`;

  if (filtros.ano_pca) { params.push(toIntOrNull(filtros.ano_pca)); where += ` AND p.ano_pca = $${params.length}`; }
  if (filtros.valor_min) { params.push(toNullableNumber(filtros.valor_min)); where += ` AND i.valor_total >= $${params.length}`; }
  if (filtros.valor_max) { params.push(toNullableNumber(filtros.valor_max)); where += ` AND i.valor_total <= $${params.length}`; }
  if (filtros.mes_previsto) { params.push(toIntOrNull(filtros.mes_previsto)); where += ` AND i.mes_previsto = $${params.length}`; }
  if (filtros.orgao_cnpj) { params.push(String(filtros.orgao_cnpj).replace(/\D/g, '')); where += ` AND p.orgao_cnpj = $${params.length}`; }
  if (filtros.unidade_codigo) { params.push(String(filtros.unidade_codigo)); where += ` AND p.codigo_unidade = $${params.length}`; }

  // accountId entra no WHERE (exclui já no pipe) e nos subselects de status.
  const accountIdNum = toIntOrNull(accountId) || -1;
  params.push(accountIdNum);
  const accountSignalParam = params.length;

  // Itens já promovidos ao pipeline (signal ou opportunity com pca_item_ids) não entram na busca.
  where += `
    AND NOT EXISTS (
      SELECT 1
        FROM ${PCA_SIGNALS_TABLE} s_pipe
       WHERE s_pipe.account_id = $${accountSignalParam}
         AND s_pipe.item_id = i.id
         AND s_pipe.status = 'promovido'
         AND s_pipe.promovido_para_opportunity_id IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1
        FROM ${LICITACAO_TABLE} o_pipe
       WHERE o_pipe.account_id = $${accountSignalParam}
         AND o_pipe.metadados->'pca_item_ids' @> to_jsonb(i.id)
    )`;

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  const offset = Math.max(0, (toIntOrNull(pagina) || 1) - 1) * (toIntOrNull(tam) || 50);
  params.push(toIntOrNull(tam) || 50, offset);

  const boostExpr = termoOriginal
    ? `(CASE WHEN immutable_unaccent(lower(i.descricao)) ILIKE immutable_unaccent(lower($${params.length + 1}))
              THEN 0.5 ELSE 0 END)`
    : '0';
  if (termoOriginal) params.push(`%${termoOriginal}%`);

  const sql = `
    SELECT i.id AS item_id, i.descricao, i.valor_total, i.valor_unitario, i.quantidade,
           i.unidade_medida, i.mes_previsto, i.numero_item, i.categoria_item,
           i.futura_contratacao_id, i.futura_contratacao_nome, i.codigo_item_catalogo,
           i.classificacao_nome, i.data_estimada_inicio,
           p.id AS plano_id, p.id_pca_pncp, p.orgao_cnpj, p.orgao_razao_social,
           p.codigo_unidade, p.unidade_nome, p.ano_pca, p.data_publicacao,
           p.data_atualizacao, p.responsaveis, p.contatos,
           FALSE AS ja_promovido,
           NULL::bigint AS promovido_para_opportunity_id,
           (
             SELECT s2.status
             FROM ${PCA_SIGNALS_TABLE} s2
             WHERE s2.account_id = $${accountSignalParam}
               AND s2.item_id = i.id
             ORDER BY s2.criado_em DESC
             LIMIT 1
           ) AS signal_status,
           -- Escala 0–100 (igual editais): ts_rank ~0–1 → *100; boost ILIKE +50 pts.
           LEAST(100::numeric, ROUND(
             ((ts_rank(i.descricao_tsv, to_tsquery('portuguese', $1)) + ${boostExpr}) * 100)::numeric
           , 1)) AS score
    FROM ${PCA_ITENS_TABLE} i
    JOIN ${PCA_PLANOS_TABLE} p ON p.id = i.plano_id
    WHERE ${where}
    ORDER BY score DESC, i.id ASC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  // countParams: tsPos, tsNeg, filtros opcionais, accountId (sem limit/offset/boost ILIKE).
  const countParams = params.slice(0, accountSignalParam);

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM ${PCA_ITENS_TABLE} i
    JOIN ${PCA_PLANOS_TABLE} p ON p.id = i.plano_id
    WHERE ${where}
  `;

  const [rowsResult, countResult] = await Promise.all([
    pool.query(sql, params),
    pool.query(countSql, countParams),
  ]);

  const items = rowsResult.rows.map((row) => decoratePcaScoredRow(row));
  return { items, total: countResult.rows[0]?.total || 0 };
};

// fetchPncpConsulta com retry (PNCP costuma timeoutar; sem retry o sync inteiro morre na 1ª falha).
const fetchPncpPcaPagina = async ({ dataInicio, dataFim, pagina, tamanhoPagina = 500 }, maxRetries = 4) => {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await withPncpGate(() => fetchPncpConsulta('/v1/pca/atualizacao', { dataInicio, dataFim, pagina, tamanhoPagina }), { priority: 'bulk' });
    } catch (e) {
      lastErr = e;
      const wait = Math.min(2000 * attempt, 15000);
      console.warn(`[pca] retry ${attempt}/${maxRetries} dataInicio=${dataInicio} pagina=${pagina}: ${e.message} — aguardando ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
};

// Um lock no Postgres cobre também cenários com mais de uma réplica do backend.
// Mantemos uma conexão dedicada apenas para segurar o lock; o trabalho usa o pool.
const PCA_SYNC_ADVISORY_LOCK = 524341;
const withPcaSyncLock = async (work) => {
  const lockClient = await pool.connect();
  let locked = false;
  try {
    const { rows } = await lockClient.query(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [PCA_SYNC_ADVISORY_LOCK]
    );
    locked = rows[0]?.locked === true;
    if (!locked) {
      return { skipped: true, reason: 'pca_sync_already_running' };
    }
    return await work(lockClient);
  } finally {
    if (locked) {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [PCA_SYNC_ADVISORY_LOCK]).catch((error) => {
        console.warn('[pca] falha ao liberar advisory lock:', error.message);
      });
    }
    lockClient.release();
  }
};

const PCA_READ_TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.PCA_READ_TIMEOUT_MS || '20000', 10) || 20000
);
const PCA_LOCK_TIMEOUT_MS = Math.min(5000, PCA_READ_TIMEOUT_MS);

const withPcaReadTimeout = async (work) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${PCA_READ_TIMEOUT_MS}`);
    await client.query(`SET LOCAL lock_timeout = ${PCA_LOCK_TIMEOUT_MS}`);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const pcaReadErrorResponse = (res, error, fallback) => {
  const transient = ['57014', '55P03', '53300'].includes(error?.code)
    || /timeout|connection terminated|connect/i.test(error?.message || '');
  if (transient) {
    return res.status(503).json({
      error: 'A base PCA está ocupada no momento. A tela tentará novamente automaticamente.',
    });
  }
  return res.status(500).json({ error: fallback, details: error.message });
};

// Daily sync: pega delta entre o último cursor e hoje.
// onProgress(diffPlanos, diffItens) chamado após cada página upsertada (uso pelo bootstrap pra atualizar UI live).
const runPcaDailySyncUnlocked = async (opts = {}, onProgress = null) => {
  const { rows: stateRows } = await pool.query(
    `SELECT * FROM ${PCA_SYNC_STATE_TABLE} WHERE id = 1`
  );
  const state = stateRows[0] || {};
  const today = new Date();
  const yyyymmdd = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  };
  const cursorDate = state.ultimo_data_fim
    ? new Date(state.ultimo_data_fim.getTime() - 24 * 60 * 60 * 1000)
    : new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const dataInicio = opts.dataInicio || yyyymmdd(cursorDate);
  const dataFim = opts.dataFim || yyyymmdd(today);

  let pagina = 1;
  let totalPaginas = 1;
  let planosUpserted = 0;
  let itensUpserted = 0;

  let paginasComFalha = 0;
  while (pagina <= totalPaginas) {
    let body;
    try {
      body = await fetchPncpPcaPagina({ dataInicio, dataFim, pagina });
    } catch (e) {
      paginasComFalha += 1;
      console.error(`[pca] página ${pagina}/${totalPaginas} falhou após retries (${e.message}) — pulando`);
      pagina += 1;
      continue;
    }
    const data = Array.isArray(body?.data) ? body.data
              : Array.isArray(body?.resultado) ? body.resultado
              : Array.isArray(body) ? body : [];
    totalPaginas = toIntOrNull(body?.totalPaginas) || toIntOrNull(body?.totalPages) || 1;

    let pagePlanos = 0;
    let pageItens = 0;
    for (const plano of data) {
      const r = await upsertPcaPlano(plano);
      if (r.plano) {
        pagePlanos += 1;
        pageItens += r.itensInseridos;
      }
    }
    planosUpserted += pagePlanos;
    itensUpserted += pageItens;
    if (onProgress) onProgress(pagePlanos, pageItens, { pagina, totalPaginas, dataInicio, dataFim });
    pagina += 1;
  }

  // Nunca avança o cursor se uma página ficou para trás. Assim o próximo ciclo
  // tenta novamente em vez de transformar uma falha transitória em perda de dados.
  // Matching das assinaturas roda mesmo com falha parcial: usa o que já está na base.
  if (paginasComFalha === 0 && opts.updateCursor !== false) {
    await pool.query(
      `UPDATE ${PCA_SYNC_STATE_TABLE} SET ultimo_sync = NOW(), ultimo_data_fim = $1::date WHERE id = 1`,
      [`${dataFim.slice(0, 4)}-${dataFim.slice(4, 6)}-${dataFim.slice(6, 8)}`]
    );
  } else if (paginasComFalha > 0) {
    console.warn(
      `[pca] ${paginasComFalha} página(s) do PNCP falharam; cursor preservado. ` +
      `planos=${planosUpserted} itens=${itensUpserted} — seguindo com matching das assinaturas.`
    );
    await pool.query(
      `UPDATE ${PCA_SYNC_STATE_TABLE} SET ultimo_sync = NOW() WHERE id = 1`
    ).catch(() => {});
  }

  let matchResult = { signals_inserted: 0 };
  if (opts.matchWatchlists !== false) {
    matchResult = await runPcaWatchlistMatching();
  }

  if (paginasComFalha > 0) {
    const err = new Error(
      `${paginasComFalha} página(s) do PNCP falharam; cursor preservado para nova tentativa`
    );
    err.partial = {
      dataInicio,
      dataFim,
      planos_upserted: planosUpserted,
      itens_upserted: itensUpserted,
      signals_inserted: matchResult.signals_inserted,
      notifications: matchResult.notifications,
      paginas_com_falha: paginasComFalha,
    };
    throw err;
  }

  return {
    dataInicio, dataFim,
    planos_upserted: planosUpserted,
    itens_upserted: itensUpserted,
    signals_inserted: matchResult.signals_inserted,
    notifications: matchResult.notifications,
    paginas_com_falha: paginasComFalha,
  };
};

const runPcaDailySync = async (opts = {}, onProgress = null) => {
  if (opts.lockAlreadyHeld) {
    return withPncpHeavyJobSlot('pca-sync', () => runPcaDailySyncUnlocked(opts, onProgress));
  }
  return withPcaSyncLock(() => withPncpHeavyJobSlot('pca-sync', () => runPcaDailySyncUnlocked(opts, onProgress)));
};

// Estado in-memory do bootstrap — sobrevive a desconexões do client mas
// reseta se o backend reiniciar (aceitável: bootstrap é re-executável).
const pcaBootstrapState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  ano: null,
  mes_atual: null,
  mes_total: null,
  planos_upserted: 0,
  itens_upserted: 0,
  error: null,
};

const runPcaBootstrap = async (ano) => {
  const targetAno = toIntOrNull(ano) || new Date().getFullYear();
  const currentYear = new Date().getFullYear();
  if (targetAno !== currentYear) {
    throw new Error(`A preparação inicial aceita somente o ano corrente (${currentYear})`);
  }
  pcaBootstrapState.running = true;
  pcaBootstrapState.startedAt = new Date().toISOString();
  pcaBootstrapState.finishedAt = null;
  pcaBootstrapState.ano = targetAno;
  pcaBootstrapState.mes_atual = null;
  pcaBootstrapState.mes_total = null;
  pcaBootstrapState.planos_upserted = 0;
  pcaBootstrapState.itens_upserted = 0;
  pcaBootstrapState.error = null;

  const work = (async () => {
    const result = await withPcaSyncLock(async () => {
    const today = new Date();
    const currentYear = today.getFullYear();
    const lastMonth = targetAno < currentYear ? 12 : (targetAno === currentYear ? today.getMonth() + 1 : 0);
    const monthErrors = [];
    let matchingResult = { signals_inserted: 0 };

    if (!lastMonth) {
      throw new Error(`Não há atualizações do PNCP para o ano futuro ${targetAno}`);
    }

    pcaBootstrapState.mes_total = lastMonth;
    await pool.query(
      `UPDATE ${PCA_SYNC_STATE_TABLE}
          SET bootstrap_concluido = FALSE,
              bootstrap_started_at = NOW(),
              bootstrap_finished_at = NULL,
              bootstrap_error = NULL
        WHERE id = 1`
    );

    for (let mes = 1; mes <= lastMonth; mes += 1) {
      pcaBootstrapState.mes_atual = mes;
      const inicio = new Date(targetAno, mes - 1, 1);
      const fimDoMes = new Date(targetAno, mes, 0);
      const fim = targetAno === currentYear && mes === lastMonth ? today : fimDoMes;
      const fmt = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      try {
        await runPcaDailySync(
          {
            dataInicio: fmt(inicio),
            dataFim: fmt(fim),
            matchWatchlists: false,
            updateCursor: false,
            lockAlreadyHeld: true,
          },
          (dPlanos, dItens) => {
            pcaBootstrapState.planos_upserted += dPlanos;
            pcaBootstrapState.itens_upserted += dItens;
          }
        );
      } catch (error) {
        monthErrors.push(`mês ${mes}: ${error.message}`);
        console.error(`[pca] mês ${mes}/${targetAno} falhou: ${error.message}`);
      }
    }

    // O matching é global e caro: roda uma única vez depois de toda a carga, não
    // uma vez por janela mensal (antes podia repetir até 12 vezes).
    try {
      matchingResult = await runPcaWatchlistMatching();
    } catch (error) {
      console.error('[pca] matching final das watchlists falhou:', error.message);
      // A ingestão pode estar íntegra mesmo se o matching falhar. Não invalida a
      // base nem força outro bootstrap de milhões de itens; tenta só o matching.
      setTimeout(() => runPcaWatchlistMatching().catch((retryError) => {
        console.error('[pca] retry do matching das watchlists falhou:', retryError.message);
      }), 5 * 60 * 1000);
    }

    if (monthErrors.length > 0) {
      throw new Error(monthErrors.join(' | '));
    }

    await pool.query(
      `UPDATE ${PCA_SYNC_STATE_TABLE}
          SET bootstrap_concluido = TRUE,
              bootstrap_finished_at = NOW(),
              bootstrap_error = NULL,
              ultimo_sync = NOW(),
              ultimo_data_fim = CURRENT_DATE
        WHERE id = 1`
    );

    return {
      ano: targetAno,
      planos_upserted: pcaBootstrapState.planos_upserted,
      itens_upserted: pcaBootstrapState.itens_upserted,
      signals_inserted: matchingResult.signals_inserted,
    };
    });

    if (result?.skipped) console.log('[pca] preparação não iniciada: outra sincronização possui o lock');
    return result;
  })();

  return finishPcaBootstrapState(work);
};

const finishPcaBootstrapState = async (promise) => {
  try {
    return await promise;
  } catch (error) {
    pcaBootstrapState.error = error.message;
    console.error('[pca] bootstrap error:', error);
    await pool.query(
      `UPDATE ${PCA_SYNC_STATE_TABLE}
          SET bootstrap_concluido = FALSE,
              bootstrap_finished_at = NOW(),
              bootstrap_error = $1
        WHERE id = 1`,
      [error.message.slice(0, 2000)]
    ).catch((stateError) => console.warn('[pca] falha ao persistir erro do bootstrap:', stateError.message));
    throw error;
  } finally {
    pcaBootstrapState.running = false;
    pcaBootstrapState.finishedAt = new Date().toISOString();
    pcaBootstrapState.mes_atual = null;
  }
};

const executePcaWatchlistMatching = async ({ watchlistId = null } = {}) => {
  const params = [];
  let where = 'ativo = TRUE';
  if (watchlistId) {
    params.push(watchlistId);
    where += ` AND id = $${params.length}`;
  }
  const { rows: watches } = await pool.query(
    `SELECT * FROM ${PCA_WATCHLIST_TABLE} WHERE ${where}`,
    params
  );
  let inserted = 0;
  for (const watch of watches) {
    let positivos = Array.isArray(watch.palavras_chave) ? [...watch.palavras_chave] : [];
    let negativos = Array.isArray(watch.termos_negativos) ? [...watch.termos_negativos] : [];

    if (watch.usar_ia && positivos[0]) {
      try {
        const r = await getTermosCorrelatos(positivos[0]);
        positivos = Array.from(new Set([...positivos, ...(r.positivos || [])]));
      } catch (e) {
        console.warn('[pca] IA falhou para watchlist', watch.id, e.message);
      }
    }
    if (!positivos.length) continue;

    const filtros = {};
    if (watch.valor_minimo) filtros.valor_min = watch.valor_minimo;
    if (watch.valor_maximo) filtros.valor_max = watch.valor_maximo;

    const { items } = await matchPcaItens({
      positivos,
      negativos,
      filtros,
      pagina: 1,
      tam: 500,
      termoOriginal: positivos[0] || '',
      // Exclui itens já no pipeline desta conta (não gera sinal novo de promovido).
      accountId: watch.account_id,
    });
    for (const item of items) {
      const r = await pool.query(
        `
          INSERT INTO ${PCA_SIGNALS_TABLE}
            (account_id, plano_id, item_id, watchlist_id, score, termos_matched, termos_excluidos)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (account_id, item_id, watchlist_id) DO NOTHING
          RETURNING id
        `,
        [watch.account_id, item.plano_id, item.item_id, watch.id,
         scalePcaMatchScore(item.score), positivos.slice(0, 8), negativos.slice(0, 8)]
      );
      if (r.rowCount > 0) {
        inserted += 1;
        if (shouldSendWatchlistWhatsappForScore(watch, scalePcaMatchScore(item.score))) {
          await enqueueWatchlistNotificationsForRecipients({
            source: 'pca',
            watchlistId: watch.id,
            signalId: r.rows[0].id,
            recipients: watch.whatsapp_number,
          });
        }
        await notifyAccountUsers(pool, {
          accountId: watch.account_id || CHATWOOT_ACCOUNT_ID,
          type: 'watchlist.pca_match',
          title: `Novo PCA · ${watch.nome || 'Assinatura'}`,
          body: String(item.descricao || item.orgao_razao_social || 'Item de PCA').slice(0, 180),
          data: {
            view: 'Licitações',
            sub: 'pca',
            watchlist_id: watch.id,
            signal_id: r.rows[0].id,
          },
          dedupeKey: `pca:${r.rows[0].id}`,
        }).catch((err) => console.warn('[pca] push/inbox falhou:', err.message));
      }
    }
  }
  const notifications = await processWatchlistNotifications().catch(error => {
    console.warn('[pca] notificacoes falharam:', error.message);
    return { sent: 0, failed: 0, processed: 0 };
  });
  return { signals_inserted: inserted, notifications };
};

// Serializa matching global e matching direcionado (criação/reativação de regra)
// para que duas varreduras caras não disputem o banco no mesmo processo.
let pcaWatchlistMatchingQueue = Promise.resolve();
const runPcaWatchlistMatching = (options = {}) => {
  const job = pcaWatchlistMatchingQueue.then(() => executePcaWatchlistMatching(options));
  pcaWatchlistMatchingQueue = job.catch(() => {});
  return job;
};

let pcaBootstrapCheckRunning = false;
const ensurePcaBootstrap = async () => {
  if (pcaBootstrapState.running || pcaBootstrapCheckRunning) {
    return { started: false, reason: 'already_running' };
  }
  pcaBootstrapCheckRunning = true;
  try {
    const [{ rows: stateRows }, { rows: countRows }] = await Promise.all([
      pool.query(
        `SELECT bootstrap_concluido, bootstrap_started_at, bootstrap_finished_at, bootstrap_error
           FROM ${PCA_SYNC_STATE_TABLE}
          WHERE id = 1`
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM ${PCA_PLANOS_TABLE}`),
    ]);
    const state = stateRows[0] || {};
    const totalPlanos = Number(countRows[0]?.total) || 0;
    const interrupted = Boolean(state.bootstrap_started_at && !state.bootstrap_finished_at);
    // Falha concluída com dados parciais não pode reprocessar milhões de itens a
    // cada 30 minutos. O delta diário cobre novidades; retry integral automático
    // fica restrito a base vazia ou execução interrompida por restart.
    const shouldStart = !state.bootstrap_concluido && (totalPlanos === 0 || interrupted);

    if (!shouldStart) {
      return { started: false, reason: state.bootstrap_concluido ? 'complete' : 'existing_data' };
    }

    console.log('[pca] iniciando preparação automática da base');
    runPcaBootstrap(new Date().getFullYear()).catch((error) => {
      console.error('[pca] preparação automática falhou:', error.message);
    });
    return { started: true };
  } finally {
    pcaBootstrapCheckRunning = false;
  }
};

const catchUpPcaSyncIfStale = async ({ deferIfDeepJobs = true, attempt = 0 } = {}) => {
  if (pcaBootstrapState.running) return { started: false, reason: 'bootstrap_running' };
  const { rows } = await pool.query(
    `SELECT bootstrap_concluido,
            (ultimo_sync IS NULL OR ultimo_sync::date < CURRENT_DATE) AS stale
       FROM ${PCA_SYNC_STATE_TABLE}
      WHERE id = 1`
  );
  if (!rows[0]?.bootstrap_concluido || rows[0]?.stale !== true) {
    return { started: false, reason: 'up_to_date_or_not_initialized' };
  }
  // Deep jobs de editais têm prioridade prática: catch-up de PCA no boot roubava o
  // único heavy slot e deixava buscas em "Na fila" por horas.
  if (deferIfDeepJobs) {
    const live = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM ${PNCP_SEARCH_JOBS_TABLE}
        WHERE status IN ('queued', 'running', 'paused_rate_limit', 'cancelling')`
    );
    const liveN = Number(live.rows[0]?.n || 0);
    if (liveN > 0 && attempt < 12) {
      const delayMs = Math.min(60 * 60 * 1000, 15 * 60 * 1000 * Math.max(1, attempt + 1));
      console.log(
        `[pca] catch-up adiado: ${liveN} deep job(s) ativo(s) — retry em ~${Math.round(delayMs / 60000)} min`
      );
      setTimeout(() => {
        catchUpPcaSyncIfStale({ deferIfDeepJobs: true, attempt: attempt + 1 }).catch((err) => {
          console.warn('[pca] catch-up adiado falhou:', err.message);
        });
      }, delayMs);
      return { started: false, reason: 'deferred_deep_jobs', live_jobs: liveN, retry_in_ms: delayMs };
    }
  }
  console.log('[pca] sincronização atrasada detectada; iniciando catch-up');
  const result = await runPcaDailySync();
  console.log('[pca] catch-up concluído:', result);
  return { started: !result?.skipped, result };
};

// ============ ENDPOINTS PCA ============

app.post('/api/licitacoes/pca/sync', requireAdmin, async (req, res) => {
  if (pcaBootstrapState.running) {
    return res.status(409).json({ error: 'A base PCA já está sendo preparada.' });
  }
  try {
    const { dataInicio, dataFim } = req.body || {};
    const result = await runPcaDailySync({ dataInicio, dataFim });
    res.json(result);
  } catch (error) {
    console.error('Error syncing PCA:', error);
    res.status(500).json({ error: 'Erro ao sincronizar PCA', details: error.message });
  }
});

app.post('/api/licitacoes/pca/bootstrap', requireAdmin, async (req, res) => {
  if (pcaBootstrapState.running) {
    return res.status(409).json({
      error: 'Bootstrap já em andamento',
      state: pcaBootstrapState,
    });
  }
  const ano = toIntOrNull(req.body?.ano) || new Date().getFullYear();
  if (ano !== new Date().getFullYear()) {
    return res.status(400).json({ error: 'A preparação inicial usa somente o ano corrente.' });
  }
  // Dispara em background — cliente recebe 202 imediato e faz polling em /status.
  runPcaBootstrap(ano).catch(err => console.error('[pca] bootstrap async error:', err));
  res.status(202).json({
    accepted: true,
    ano,
    state: pcaBootstrapState,
  });
});

app.post('/api/licitacoes/pca/reset', requireAdmin, async (_req, res) => {
  if (pcaBootstrapState.running) {
    return res.status(409).json({ error: 'Bootstrap em andamento — aguarde ou reinicie o backend.' });
  }
  try {
    const resetResult = await withPcaSyncLock(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(`TRUNCATE ${PCA_PLANOS_TABLE} RESTART IDENTITY CASCADE`);
        await client.query(
          `UPDATE ${PCA_SYNC_STATE_TABLE}
              SET ultimo_sync = NULL,
                  ultimo_data_fim = NULL,
                  bootstrap_concluido = FALSE,
                  bootstrap_started_at = NULL,
                  bootstrap_finished_at = NULL,
                  bootstrap_error = NULL
            WHERE id = 1`
        );
        await client.query('COMMIT');
        return { ok: true };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
    });
    if (resetResult?.skipped) {
      return res.status(409).json({ error: 'Há uma sincronização PCA em andamento.' });
    }
    pcaBootstrapState.running = false;
    pcaBootstrapState.startedAt = null;
    pcaBootstrapState.finishedAt = null;
    pcaBootstrapState.ano = null;
    pcaBootstrapState.mes_atual = null;
    pcaBootstrapState.mes_total = null;
    pcaBootstrapState.planos_upserted = 0;
    pcaBootstrapState.itens_upserted = 0;
    pcaBootstrapState.error = null;
    res.json({ ok: true, message: 'Base PCA esvaziada. A reconstrução automática será iniciada.' });
    setImmediate(() => ensurePcaBootstrap().catch((error) => {
      console.error('[pca] falha ao iniciar reconstrução após reset:', error.message);
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/licitacoes/pca/bootstrap/status', async (_req, res) => {
  try {
    const { planoCount, syncRows } = await withPcaReadTimeout(async (client) => {
      const { rows: counts } = await client.query(
        `SELECT COUNT(*)::int AS planos, COALESCE(SUM(quantidade_itens),0)::int AS itens FROM ${PCA_PLANOS_TABLE}`
      );
      // Sinal persistente: o estado em memória zera em cada restart.
      const { rows: sync } = await client.query(
        `SELECT bootstrap_concluido, ultimo_sync, ultimo_data_fim,
                bootstrap_started_at, bootstrap_finished_at, bootstrap_error
           FROM ${PCA_SYNC_STATE_TABLE}
          WHERE id = 1`
      );
      return { planoCount: counts, syncRows: sync };
    });
    const persistentRunning = Boolean(
      syncRows[0]?.bootstrap_started_at && !syncRows[0]?.bootstrap_finished_at
    );
    res.json({
      ...pcaBootstrapState,
      running: pcaBootstrapState.running || persistentRunning,
      bootstrap_concluido: syncRows[0]?.bootstrap_concluido === true,
      ultimo_sync: syncRows[0]?.ultimo_sync || null,
      ultimo_data_fim: syncRows[0]?.ultimo_data_fim || null,
      bootstrap_started_at: syncRows[0]?.bootstrap_started_at || null,
      bootstrap_finished_at: syncRows[0]?.bootstrap_finished_at || null,
      error: pcaBootstrapState.error || syncRows[0]?.bootstrap_error || null,
      total_planos_db: planoCount[0]?.planos || 0,
      total_itens_db: planoCount[0]?.itens || 0,
    });
  } catch (error) {
    pcaReadErrorResponse(res, error, 'Erro ao consultar o estado da base PCA');
  }
});

app.get('/api/licitacoes/pca/search', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const q = String(req.query.q || '').trim();
    const usarIa = String(req.query.usar_ia ?? 'true') !== 'false';
    let positivos = [];
    let negativos = [];
    let fonte = null;

    if (req.query.positivos_override) {
      try { positivos = JSON.parse(req.query.positivos_override); } catch { positivos = []; }
      try { negativos = JSON.parse(req.query.negativos_override || '[]'); } catch { negativos = []; }
      fonte = 'override';
    } else if (usarIa && q.length >= 3) {
      const r = await getTermosCorrelatos(q);
      positivos = Array.from(new Set([q, ...(r.positivos || [])])).filter(Boolean);
      fonte = r.fonte;
    } else if (q) {
      positivos = [q];
    }

    const { items, total } = await matchPcaItens({
      positivos, negativos,
      filtros: {
        ano_pca: req.query.ano_pca,
        valor_min: req.query.valor_min,
        valor_max: req.query.valor_max,
        mes_previsto: req.query.mes_previsto,
        orgao_cnpj: req.query.orgao_cnpj,
        unidade_codigo: req.query.unidade_codigo,
      },
      pagina: req.query.pagina || 1,
      tam: req.query.tam || 50,
      termoOriginal: q,
      accountId,
    });

    res.json({ q, positivos, negativos, fonte_ia: fonte, total, items });
  } catch (error) {
    console.error('Error searching PCA:', error);
    res.status(500).json({ error: 'Erro na busca PCA', details: error.message });
  }
});

app.get('/api/licitacoes/pca/planos/:id', async (req, res) => {
  try {
    const planoId = toIntOrNull(req.params.id);
    if (!planoId) return res.status(400).json({ error: 'id inválido' });
    const { rows: pRows } = await pool.query(
      `SELECT * FROM ${PCA_PLANOS_TABLE} WHERE id = $1`, [planoId]
    );
    if (!pRows[0]) return res.status(404).json({ error: 'plano não encontrado' });
    const { rows: iRows } = await pool.query(
      `SELECT * FROM ${PCA_ITENS_TABLE} WHERE plano_id = $1 ORDER BY id ASC`, [planoId]
    );
    res.json({ plano: pRows[0], itens: iRows });
  } catch (error) {
    console.error('Error fetching PCA plano:', error);
    res.status(500).json({ error: 'Erro ao buscar plano' });
  }
});

app.get('/api/licitacoes/pca/signals', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const status = ['novo', 'visto', 'promovido', 'descartado'].includes(req.query.status)
      ? req.query.status
      : 'novo';
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const requestedOffset = Number.parseInt(req.query.offset, 10);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 200, 1), 500);
    const offset = Math.max(Number.isFinite(requestedOffset) ? requestedOffset : 0, 0);
    const watchlistId = toIntOrNull(req.query.watchlist_id);
    const params = [accountId, status, limit, offset, watchlistId];
    const { pageResult, countResult } = await withPcaReadTimeout(async (client) => {
      const page = await client.query(
        `
        WITH paged AS MATERIALIZED (
          SELECT s.*
          FROM ${PCA_SIGNALS_TABLE} s
          WHERE s.account_id = $1 AND s.status = $2 AND s.watchlist_id IS NOT NULL
            AND ($5::bigint IS NULL OR s.watchlist_id = $5)
          ORDER BY s.criado_em DESC, s.id DESC
          LIMIT $3 OFFSET $4
        )
        SELECT s.*, i.descricao, i.valor_total, i.mes_previsto, i.numero_item,
               i.quantidade, i.unidade_medida, i.futura_contratacao_id, i.futura_contratacao_nome,
               p.id_pca_pncp, p.orgao_cnpj, p.orgao_razao_social, p.codigo_unidade, p.unidade_nome, p.ano_pca,
               p.responsaveis, p.contatos, w.nome AS watchlist_nome
        FROM paged s
        JOIN ${PCA_ITENS_TABLE} i ON i.id = s.item_id
        JOIN ${PCA_PLANOS_TABLE} p ON p.id = s.plano_id
        LEFT JOIN ${PCA_WATCHLIST_TABLE} w ON w.id = s.watchlist_id
        ORDER BY w.nome ASC NULLS LAST, p.orgao_razao_social ASC NULLS LAST, p.ano_pca DESC,
                 p.id ASC, i.valor_total DESC NULLS LAST, s.score DESC NULLS LAST, s.criado_em DESC
        `,
        params
      );
      const counts = await client.query(
        `
          SELECT watchlist_id, COUNT(*)::int AS total
          FROM ${PCA_SIGNALS_TABLE}
          WHERE account_id = $1 AND status = $2 AND watchlist_id IS NOT NULL
            AND ($3::bigint IS NULL OR watchlist_id = $3)
          GROUP BY watchlist_id
        `,
        [accountId, status, watchlistId]
      );
      return { pageResult: page, countResult: counts };
    });
    const countsByWatchlist = new Map(
      countResult.rows.map((row) => [String(row.watchlist_id), Number(row.total) || 0])
    );
    const total = countResult.rows.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
    const data = pageResult.rows.map((row) => ({
      ...decoratePcaScoredRow(row),
      watchlist_total_count: countsByWatchlist.get(String(row.watchlist_id)) || 0,
    }));
    res.json({ data, total, limit, offset, has_more: offset + data.length < total });
  } catch (error) {
    console.error('Error listing PCA signals:', error);
    pcaReadErrorResponse(res, error, 'Erro ao listar sinais PCA');
  }
});

app.get('/api/licitacoes/pca/signals/stats', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const { rows } = await withPcaReadTimeout((client) => client.query(
        `
          SELECT status, COUNT(*)::int AS total
          FROM ${PCA_SIGNALS_TABLE}
          WHERE account_id = $1 AND watchlist_id IS NOT NULL
          GROUP BY status
        `,
        [accountId]
      ));

    const base = { novo: 0, visto: 0, promovido: 0, descartado: 0 };
    for (const row of rows) {
      if (Object.prototype.hasOwnProperty.call(base, row.status)) {
        base[row.status] = Number(row.total) || 0;
      }
    }
    res.json(base);
  } catch (error) {
    console.error('Error counting PCA signals:', error);
    pcaReadErrorResponse(res, error, 'Erro ao contar sinais PCA');
  }
});

const promotePcaSignalToOpportunity = async (signalId, accountId) => {
  const { rows: sigRows } = await pool.query(
    `
      SELECT s.*, i.descricao, i.valor_total, i.valor_unitario, i.quantidade, i.unidade_medida,
             i.numero_item, i.mes_previsto,
             p.orgao_cnpj, p.orgao_razao_social, p.codigo_unidade, p.unidade_nome,
             p.ano_pca, p.data_publicacao, p.contatos, p.responsaveis
      FROM ${PCA_SIGNALS_TABLE} s
      JOIN ${PCA_ITENS_TABLE} i ON i.id = s.item_id
      JOIN ${PCA_PLANOS_TABLE} p ON p.id = s.plano_id
      WHERE s.id = $1 AND s.account_id = $2
    `, [signalId, accountId]
  );
  const sig = sigRows[0];
  if (!sig) return null;
  if (sig.promovido_para_opportunity_id) {
    const { rows } = await pool.query(
      `SELECT * FROM ${LICITACAO_TABLE} WHERE id = $1`, [sig.promovido_para_opportunity_id]
    );
    return rows[0] || null;
  }

    const { rows: existingOppRows } = await pool.query(
      `
        SELECT *
        FROM ${LICITACAO_TABLE}
        WHERE account_id = $1
          AND origem_oportunidade = 'pca_pncp'
          AND metadados->>'pca_plano_id' = $2
        ORDER BY id DESC
        LIMIT 1
      `,
    [accountId, String(sig.plano_id)]
  );
  if (existingOppRows[0]) {
    const opp = existingOppRows[0];
    const metadados = opp.metadados || {};
    const itemIds = new Set([
      ...(Array.isArray(metadados.pca_item_ids) ? metadados.pca_item_ids.map(String) : []),
      ...(metadados.pca_item_id ? [String(metadados.pca_item_id)] : []),
    ]);

    if (!itemIds.has(String(sig.item_id))) {
      await pool.query(
        `
          INSERT INTO ${LICITACAO_ITEMS_TABLE}
            (opportunity_id, numero_item, descricao, quantidade, unidade,
             valor_referencia, custo_total_item)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
        `,
        [opp.id, sig.numero_item, sig.descricao, sig.quantidade, sig.unidade_medida,
         sig.valor_unitario, sig.valor_total]
      );
      itemIds.add(String(sig.item_id));
      await pool.query(
        `
          UPDATE ${LICITACAO_TABLE}
             SET valor_oportunidade = COALESCE(valor_oportunidade, 0) + COALESCE($1::numeric, 0),
                 metadados = $2::jsonb,
                 updated_at = NOW()
           WHERE id = $3
        `,
        [sig.valor_total, JSON.stringify({
          ...metadados,
          pca_item_ids: Array.from(itemIds),
        }), opp.id]
      );
    }
    await pool.query(
      `UPDATE ${PCA_SIGNALS_TABLE}
          SET status = 'promovido', promovido_para_opportunity_id = $1
        WHERE id = $2`,
      [opp.id, signalId]
    );
    return opp;
  }

  const titulo = (sig.descricao || 'PCA').slice(0, 200);
  const metadados = {
    pca_plano_id: sig.plano_id,
    pca_item_id: sig.item_id,
    pca_item_ids: [sig.item_id],
    pca_signal_id: sig.id,
    pca_ano: sig.ano_pca,
    pca_mes_previsto: sig.mes_previsto,
    pca_numero_item: sig.numero_item,
    pca_responsaveis: sig.responsaveis,
    pca_contatos: sig.contatos,
  };
  const { rows: oppRows } = await pool.query(
    `
      INSERT INTO ${LICITACAO_TABLE}
        (account_id, titulo, fase, status, origem_oportunidade, orgao_nome, orgao_cnpj,
         uasg_codigo, uasg_nome, valor_oportunidade, data_publicacao, links, metadados)
      VALUES ($1,$2,$3,'ativo','pca_pncp',$4,$5,$6,$7,$8,$9,'{}'::jsonb,$10::jsonb)
      RETURNING *
    `,
    [accountId, titulo, '1. Monitoramento de PCA',
     sig.orgao_razao_social, sig.orgao_cnpj, sig.codigo_unidade, sig.unidade_nome,
     sig.valor_total, sig.data_publicacao, JSON.stringify(metadados)]
  );
  const opp = oppRows[0];
  await pool.query(
    `
      INSERT INTO ${LICITACAO_ITEMS_TABLE}
        (opportunity_id, numero_item, descricao, quantidade, unidade,
         valor_referencia, custo_total_item)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    `,
    [opp.id, sig.numero_item, sig.descricao, sig.quantidade, sig.unidade_medida,
     sig.valor_unitario, sig.valor_total]
  );
  await pool.query(
    `UPDATE ${PCA_SIGNALS_TABLE}
       SET status = 'promovido', promovido_para_opportunity_id = $1
     WHERE id = $2`,
    [opp.id, sig.id]
  );
  return opp;
};

app.post('/api/licitacoes/pca/signals/:id/promote', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const opp = await promotePcaSignalToOpportunity(toIntOrNull(req.params.id), accountId);
    if (!opp) return res.status(404).json({ error: 'signal não encontrado' });
    res.json(opp);
  } catch (error) {
    console.error('Error promoting PCA signal:', error);
    res.status(500).json({ error: 'Erro ao promover signal', details: error.message });
  }
});

app.post('/api/licitacoes/pca/signals/:id/unpromote', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const signalId = toIntOrNull(req.params.id);
    if (!signalId) return res.status(400).json({ error: 'id inválido' });

    const { rows } = await pool.query(
      `
        UPDATE ${PCA_SIGNALS_TABLE}
           SET status = 'visto', promovido_para_opportunity_id = NULL
         WHERE id = $1
           AND account_id = $2
           AND status = 'promovido'
         RETURNING id, status
      `,
      [signalId, accountId]
    );

    if (!rows[0]) return res.status(404).json({ error: 'signal promovido não encontrado' });
    res.json({ ...rows[0], note: 'O card já criado no board não foi removido.' });
  } catch (error) {
    console.error('Error unpromoting PCA signal:', error);
    res.status(500).json({ error: 'Erro ao despromover signal', details: error.message });
  }
});

// Promove uma Futura Contratação inteira (ou um subset de itens dela) para o board.
// Cria UMA licitacao_opportunity + N licitacao_items (um por item selecionado),
// e atualiza pca_signals para refletir o promovido.
app.post('/api/licitacoes/pca/contratacoes/promote', async (req, res) => {
  const accountId = getAccountId(req);
  const planoId = toIntOrNull(req.body?.plano_id);
  const itemIds = Array.isArray(req.body?.item_ids) ? req.body.item_ids.map(toIntOrNull).filter(Boolean) : [];
  const tituloOverride = (req.body?.titulo || '').toString().trim();
  if (!planoId || !itemIds.length) {
    return res.status(400).json({ error: 'plano_id e item_ids são obrigatórios' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: pRows } = await client.query(
      `SELECT * FROM ${PCA_PLANOS_TABLE} WHERE id = $1`, [planoId]
    );
    const plano = pRows[0];
    if (!plano) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'plano não encontrado' });
    }
    const { rows: iRows } = await client.query(
      `SELECT * FROM ${PCA_ITENS_TABLE} WHERE plano_id = $1 AND id = ANY($2::bigint[])`,
      [planoId, itemIds]
    );
    if (!iRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'nenhum item válido' });
    }
    const futuraId = iRows[0].futura_contratacao_id;
    const futuraNome = iRows[0].futura_contratacao_nome;
    let titulo = (tituloOverride
      || futuraNome
      || (futuraId ? `Contratação ${futuraId}` : (iRows[0].descricao || 'PCA').slice(0, 200))
    ).slice(0, 200);
    if (!tituloOverride && iRows.length > 1) {
      const aiTitulo = await summarizePcaOpportunityTitleWithAI({ futuraNome, itens: iRows });
      if (aiTitulo) titulo = aiTitulo;
    }
    // URL pública canônica do PCA no PNCP.
    // Alguns ids retornados pela API vêm em formatos variantes (ex.: com sufixos),
    // então fixamos no padrão estável /app/pca/{cnpj}/{ano}.
    const pncpPcaUrl = `https://pncp.gov.br/app/pca/${plano.orgao_cnpj}/${plano.ano_pca}`;
    const linksPayload = { pncp: pncpPcaUrl };
    const metadados = {
      pca_plano_id: plano.id,
      pca_id_pncp: plano.id_pca_pncp,
      pca_futura_contratacao_id: futuraId,
      pca_futura_contratacao_nome: futuraNome,
      pca_ano: plano.ano_pca,
      pca_codigo_unidade: plano.codigo_unidade,
      pca_unidade_nome: plano.unidade_nome,
      pca_item_ids: iRows.map(i => i.id),
      pca_responsaveis: plano.responsaveis,
      pca_contatos: plano.contatos,
    };
    const { rows: existingOppRows } = await client.query(
      `
        SELECT *
        FROM ${LICITACAO_TABLE}
        WHERE account_id = $1
          AND origem_oportunidade = 'pca_pncp'
          AND metadados->>'pca_plano_id' = $2
        ORDER BY id DESC
        LIMIT 1
      `,
      [accountId, String(plano.id)]
    );

    let opp = existingOppRows[0] || null;
    const createdNewOpp = !opp;
    const currentMeta = opp?.metadados || {};
    const promotedItemIds = new Set(
      Array.isArray(currentMeta.pca_item_ids)
        ? currentMeta.pca_item_ids.map(v => String(v))
        : []
    );

    if (!opp) {
      const valorTotal = iRows.reduce((acc, it) => acc + (Number(it.valor_total) || 0), 0);
      const { rows: oppRows } = await client.query(
      `
        INSERT INTO ${LICITACAO_TABLE}
          (account_id, titulo, fase, status, origem_oportunidade, orgao_nome, orgao_cnpj,
           uasg_codigo, uasg_nome, numero_compra, valor_oportunidade, data_publicacao,
           links, metadados)
        VALUES ($1,$2,$3,'ativo','pca_pncp',$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)
        RETURNING *
      `,
      [accountId, titulo, '1. Monitoramento de PCA',
       plano.orgao_razao_social, plano.orgao_cnpj,
       plano.codigo_unidade, plano.unidade_nome,
       futuraId || null,
       valorTotal || null, plano.data_publicacao,
       JSON.stringify(linksPayload), JSON.stringify(metadados)]
      );
      opp = oppRows[0];
    }

    let valorIncremento = 0;
    let itensPromovidos = 0;
    for (const it of iRows) {
      if (promotedItemIds.has(String(it.id))) {
        continue;
      }
      await client.query(
        `
          INSERT INTO ${LICITACAO_ITEMS_TABLE}
            (opportunity_id, numero_item, descricao, quantidade, unidade,
             valor_referencia, custo_total_item)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
        `,
        [opp.id, it.numero_item, it.descricao, it.quantidade, it.unidade_medida,
         it.valor_unitario, it.valor_total]
      );
      promotedItemIds.add(String(it.id));
      if (!createdNewOpp) {
        valorIncremento += Number(it.valor_total) || 0;
      }
      itensPromovidos += 1;
      await client.query(
        `
          UPDATE ${PCA_SIGNALS_TABLE}
             SET status = 'promovido', promovido_para_opportunity_id = $4
           WHERE account_id = $1 AND plano_id = $2 AND item_id = $3 AND watchlist_id IS NULL
        `,
        [accountId, planoId, it.id, opp.id]
      );
      await client.query(
        `
          INSERT INTO ${PCA_SIGNALS_TABLE}
            (account_id, plano_id, item_id, watchlist_id, score, status, promovido_para_opportunity_id)
          SELECT $1,$2,$3,NULL,0,'promovido',$4
          WHERE NOT EXISTS (
            SELECT 1 FROM ${PCA_SIGNALS_TABLE}
             WHERE account_id = $1 AND plano_id = $2 AND item_id = $3 AND watchlist_id IS NULL
          )
        `,
        [accountId, planoId, it.id, opp.id]
      );
    }

    const currentFuturaId = currentMeta?.pca_futura_contratacao_id ? String(currentMeta.pca_futura_contratacao_id) : null;
    const incomingFuturaId = futuraId ? String(futuraId) : null;
    const mixedFuturas = Boolean(currentFuturaId && incomingFuturaId && currentFuturaId !== incomingFuturaId);

    await client.query(
      `
        UPDATE ${LICITACAO_TABLE}
           SET metadados = $1::jsonb,
               valor_oportunidade = COALESCE(valor_oportunidade, 0) + COALESCE($2::numeric, 0),
               updated_at = NOW()
         WHERE id = $3
      `,
      [
        JSON.stringify({
          ...currentMeta,
          ...metadados,
          pca_futura_contratacao_id: mixedFuturas
            ? null
            : (currentMeta?.pca_futura_contratacao_id ?? metadados.pca_futura_contratacao_id),
          pca_futura_contratacao_nome: mixedFuturas
            ? 'Múltiplas contratações'
            : (currentMeta?.pca_futura_contratacao_nome ?? metadados.pca_futura_contratacao_nome),
          pca_item_ids: Array.from(promotedItemIds),
        }),
        valorIncremento,
        opp.id,
      ]
    );
    await client.query('COMMIT');
    const { rows: refreshedOppRows } = await client.query(
      `SELECT * FROM ${LICITACAO_TABLE} WHERE id = $1`,
      [opp.id]
    );
    res.json({ ...(refreshedOppRows[0] || opp), itens_promovidos: itensPromovidos });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error promoting PCA contratacao:', error);
    res.status(500).json({ error: 'Erro ao promover contratação', details: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/licitacoes/pca/signals/promote-item', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const itemId = toIntOrNull(req.body?.item_id);
    const watchlistId = toIntOrNull(req.body?.watchlist_id);
    if (!itemId) return res.status(400).json({ error: 'item_id obrigatório' });

    const { rows: itemRows } = await pool.query(
      `SELECT plano_id FROM ${PCA_ITENS_TABLE} WHERE id = $1`, [itemId]
    );
    const planoId = itemRows[0]?.plano_id;
    if (!planoId) return res.status(404).json({ error: 'item não encontrado' });

    const sigUpdate = await pool.query(
      `
        UPDATE ${PCA_SIGNALS_TABLE}
           SET status = CASE WHEN status = 'descartado' THEN 'novo' ELSE status END
         WHERE account_id = $1 AND plano_id = $2 AND item_id = $3
           AND ((watchlist_id = $4) OR (watchlist_id IS NULL AND $4 IS NULL))
         RETURNING id
      `,
      [accountId, planoId, itemId, watchlistId || null]
    );
    const sigInsert = sigUpdate.rows[0]
      ? { rows: sigUpdate.rows }
      : await pool.query(
        `
          INSERT INTO ${PCA_SIGNALS_TABLE}
            (account_id, plano_id, item_id, watchlist_id, score, termos_matched, status)
          VALUES ($1,$2,$3,$4,$5,$6,'novo')
          RETURNING id
        `,
        [accountId, planoId, itemId, watchlistId,
         Number(req.body?.score) || 0,
         Array.isArray(req.body?.termos_matched) ? req.body.termos_matched : []]
      );
    const signalId = sigInsert.rows[0]?.id;
    const opp = await promotePcaSignalToOpportunity(signalId, accountId);
    res.json(opp);
  } catch (error) {
    console.error('Error promoting PCA item:', error);
    res.status(500).json({ error: 'Erro ao promover item', details: error.message });
  }
});

app.put('/api/licitacoes/pca/items/:itemId/status', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const itemId = toIntOrNull(req.params.itemId);
    const nextStatus = String(req.body?.status || '').trim().toLowerCase();
    const allowed = new Set(['novo', 'visto', 'descartado']);
    if (!itemId) return res.status(400).json({ error: 'item_id inválido' });
    if (!allowed.has(nextStatus)) return res.status(400).json({ error: 'status inválido' });

    const { rows: itemRows } = await pool.query(
      `SELECT plano_id FROM ${PCA_ITENS_TABLE} WHERE id = $1`,
      [itemId]
    );
    const planoId = itemRows[0]?.plano_id;
    if (!planoId) return res.status(404).json({ error: 'item não encontrado' });

    const { rows: updatedRows } = await pool.query(
      `
        UPDATE ${PCA_SIGNALS_TABLE}
           SET status = $4
         WHERE account_id = $1
           AND plano_id = $2
           AND item_id = $3
           AND watchlist_id IS NULL
         RETURNING id, status
      `,
      [accountId, planoId, itemId, nextStatus]
    );

    if (updatedRows[0]) {
      return res.json(updatedRows[0]);
    }

    const { rows: insertedRows } = await pool.query(
      `
        INSERT INTO ${PCA_SIGNALS_TABLE}
          (account_id, plano_id, item_id, watchlist_id, score, status)
        VALUES ($1,$2,$3,NULL,0,$4)
        RETURNING id, status
      `,
      [accountId, planoId, itemId, nextStatus]
    );

    res.json(insertedRows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar status do item PCA', details: error.message });
  }
});

app.post('/api/licitacoes/pca/signals/:id/dismiss', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    await pool.query(
      `UPDATE ${PCA_SIGNALS_TABLE} SET status = 'descartado' WHERE id = $1 AND account_id = $2`,
      [toIntOrNull(req.params.id), accountId]
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao dispensar', details: error.message });
  }
});

app.post('/api/licitacoes/pca/signals/:id/seen', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    await pool.query(
      `UPDATE ${PCA_SIGNALS_TABLE} SET status = 'visto' WHERE id = $1 AND account_id = $2 AND status = 'novo'`,
      [toIntOrNull(req.params.id), accountId]
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao marcar como visto', details: error.message });
  }
});

app.put('/api/licitacoes/pca/signals/:id/status', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const signalId = toIntOrNull(req.params.id);
    const nextStatus = String(req.body?.status || '').trim().toLowerCase();
    const allowed = new Set(['novo', 'visto', 'descartado']);

    if (!signalId) return res.status(400).json({ error: 'id inválido' });
    if (!allowed.has(nextStatus)) return res.status(400).json({ error: 'status inválido' });

    const { rows } = await pool.query(
      `
        UPDATE ${PCA_SIGNALS_TABLE}
           SET status = $1
         WHERE id = $2
           AND account_id = $3
         RETURNING id, status
      `,
      [nextStatus, signalId, accountId]
    );

    if (!rows[0]) return res.status(404).json({ error: 'signal não encontrado' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar status do signal', details: error.message });
  }
});

app.post('/api/licitacoes/pca/signals/batch', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const action = String(req.body?.action || '').trim().toLowerCase();
    const signalIds = Array.isArray(req.body?.signal_ids)
      ? req.body.signal_ids.map(toIntOrNull).filter(Boolean)
      : [];

    if (!signalIds.length) return res.status(400).json({ error: 'signal_ids obrigatório' });

    if (action === 'promote') {
      let promoted = 0;
      const opportunities = [];
      for (const signalId of signalIds) {
        const opp = await promotePcaSignalToOpportunity(signalId, accountId);
        if (opp) {
          promoted += 1;
          opportunities.push(opp.id);
        }
      }
      return res.json({ ok: true, affected: promoted, opportunity_ids: Array.from(new Set(opportunities)) });
    }

    if (action === 'status') {
      const nextStatus = String(req.body?.status || '').trim().toLowerCase();
      const allowed = new Set(['novo', 'visto', 'descartado']);
      if (!allowed.has(nextStatus)) return res.status(400).json({ error: 'status inválido' });

      const { rowCount } = await pool.query(
        `
          UPDATE ${PCA_SIGNALS_TABLE}
             SET status = $1
           WHERE account_id = $2
             AND id = ANY($3::bigint[])
        `,
        [nextStatus, accountId, signalIds]
      );
      return res.json({ ok: true, affected: rowCount || 0 });
    }

    return res.status(400).json({ error: 'action inválida' });
  } catch (error) {
    res.status(500).json({ error: 'Erro na ação em lote de signals', details: error.message });
  }
});

app.get('/api/licitacoes/pca/watchlist', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const { rows } = await withPcaReadTimeout((client) => client.query(
        `SELECT w.*,
                COALESCE(sc.novo_count, 0)::int AS sinais_novos,
                COALESCE(sc.total_count, 0)::int AS sinais_total
           FROM ${PCA_WATCHLIST_TABLE} w
           LEFT JOIN (
             SELECT watchlist_id,
                    COUNT(*) FILTER (WHERE status = 'novo')::int AS novo_count,
                    COUNT(*)::int AS total_count
               FROM ${PCA_SIGNALS_TABLE}
              WHERE account_id = $1 AND watchlist_id IS NOT NULL
              GROUP BY watchlist_id
           ) sc ON sc.watchlist_id = w.id
          WHERE w.account_id = $1
          ORDER BY w.criado_em DESC`,
        [accountId]
      ));
    res.json(rows.map(decorateWatchlistWhatsapp));
  } catch (error) {
    pcaReadErrorResponse(res, error, 'Erro ao listar watchlists PCA');
  }
});

app.post('/api/licitacoes/pca/watchlist', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const b = req.body || {};
    let waEnabled = b.whatsapp_enabled === true;
    let waNumber = null;
    let waMinScore = WATCHLIST_SCORE_MIN_ALL;
    if (b.whatsapp_enabled === true || b.whatsapp_number !== undefined || b.whatsapp_numbers !== undefined
      || b.whatsapp_min_score !== undefined || b.whatsapp_score_band !== undefined) {
      const wa = resolveWhatsappFieldsFromBody(b, { requireNumbersIfEnabled: b.whatsapp_enabled === true });
      if (wa.error) return res.status(400).json({ error: wa.error });
      waEnabled = wa.whatsapp_enabled;
      waNumber = wa.whatsapp_number;
      if (wa.whatsapp_min_score !== undefined) waMinScore = wa.whatsapp_min_score;
    }
    const { rows } = await pool.query(
      `
        INSERT INTO ${PCA_WATCHLIST_TABLE}
          (account_id, nome, palavras_chave, termos_negativos, usar_ia,
           valor_minimo, valor_maximo, orgao_filtros, uasg_filtros,
           whatsapp_enabled, whatsapp_number, whatsapp_min_score, ativo)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13)
        RETURNING *
      `,
      [accountId,
       String(b.nome || 'Sem nome').slice(0, 200),
       asTextArray(b.palavras_chave),
       asTextArray(b.termos_negativos),
       b.usar_ia !== false,
       toNullableNumber(b.valor_minimo),
       toNullableNumber(b.valor_maximo),
       JSON.stringify(b.orgao_filtros || []),
       JSON.stringify(b.uasg_filtros || []),
       waEnabled,
       waNumber,
       waMinScore,
       b.ativo !== false]
    );
    const created = decorateWatchlistWhatsapp(rows[0]);
    res.status(201).json(created);
    if (created?.ativo && !pcaBootstrapState.running) {
      setImmediate(() => runPcaWatchlistMatching({ watchlistId: created.id }).catch((error) => {
        console.error(`[pca] matching inicial da watchlist ${created.id} falhou:`, error.message);
      }));
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar watchlist', details: error.message });
  }
});

app.put('/api/licitacoes/pca/watchlist/:id', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const id = toIntOrNull(req.params.id);
    const b = req.body || {};
    const touchingWhatsapp = typeof b.whatsapp_enabled === 'boolean'
      || b.whatsapp_number !== undefined
      || b.whatsapp_numbers !== undefined
      || b.whatsapp_min_score !== undefined
      || b.whatsapp_score_band !== undefined;
    let waEnabled = null;
    let waNumber = null;
    let waMinScore = null;
    if (touchingWhatsapp) {
      const wa = resolveWhatsappFieldsFromBody({
        whatsapp_enabled: b.whatsapp_enabled === true,
        whatsapp_number: b.whatsapp_number,
        whatsapp_numbers: b.whatsapp_numbers,
        whatsapp_min_score: b.whatsapp_min_score,
        whatsapp_score_band: b.whatsapp_score_band,
      }, { requireNumbersIfEnabled: b.whatsapp_enabled === true });
      if (wa.error) return res.status(400).json({ error: wa.error });
      waEnabled = wa.whatsapp_enabled;
      waNumber = wa.whatsapp_number;
      waMinScore = wa.whatsapp_min_score !== undefined ? wa.whatsapp_min_score : WATCHLIST_SCORE_MIN_ALL;
    }
    const { rows } = await pool.query(
      `
        UPDATE ${PCA_WATCHLIST_TABLE}
           SET nome = COALESCE($1, nome),
               palavras_chave = COALESCE($2, palavras_chave),
               termos_negativos = COALESCE($3, termos_negativos),
               usar_ia = COALESCE($4, usar_ia),
               valor_minimo = $5,
               valor_maximo = $6,
               orgao_filtros = COALESCE($7::jsonb, orgao_filtros),
               uasg_filtros = COALESCE($8::jsonb, uasg_filtros),
               whatsapp_enabled = COALESCE($9, whatsapp_enabled),
               whatsapp_number = CASE WHEN $14::boolean THEN $10 ELSE whatsapp_number END,
               whatsapp_min_score = CASE WHEN $14::boolean THEN $15 ELSE whatsapp_min_score END,
               ativo = COALESCE($11, ativo),
               atualizado_em = NOW()
         WHERE id = $12 AND account_id = $13
         RETURNING *
      `,
      [b.nome ?? null,
       b.palavras_chave ? asTextArray(b.palavras_chave) : null,
       b.termos_negativos ? asTextArray(b.termos_negativos) : null,
       typeof b.usar_ia === 'boolean' ? b.usar_ia : null,
       toNullableNumber(b.valor_minimo),
       toNullableNumber(b.valor_maximo),
       b.orgao_filtros ? JSON.stringify(b.orgao_filtros) : null,
       b.uasg_filtros ? JSON.stringify(b.uasg_filtros) : null,
       waEnabled,
       waNumber,
       typeof b.ativo === 'boolean' ? b.ativo : null,
       id, accountId,
       touchingWhatsapp,
       waMinScore]
    );
    if (!rows[0]) return res.status(404).json({ error: 'não encontrado' });
    const updated = decorateWatchlistWhatsapp(rows[0]);
    res.json(updated);
    const matchingRelevant = ['ativo', 'palavras_chave', 'termos_negativos', 'usar_ia',
      'valor_minimo', 'valor_maximo', 'orgao_filtros', 'uasg_filtros']
      .some((key) => Object.prototype.hasOwnProperty.call(b, key));
    if (updated.ativo && matchingRelevant && !pcaBootstrapState.running) {
      setImmediate(() => runPcaWatchlistMatching({ watchlistId: updated.id }).catch((error) => {
        console.error(`[pca] rematching da watchlist ${updated.id} falhou:`, error.message);
      }));
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar watchlist', details: error.message });
  }
});

app.delete('/api/licitacoes/pca/watchlist/:id', async (req, res) => {
  try {
    const accountId = getAccountId(req);
    const watchlistId = toIntOrNull(req.params.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM ${WATCHLIST_NOTIFICATIONS_TABLE} WHERE source = 'pca' AND watchlist_id = $1`,
        [watchlistId]
      );
      await client.query(
        `DELETE FROM ${PCA_SIGNALS_TABLE} WHERE watchlist_id = $1 AND account_id = $2`,
        [watchlistId, accountId]
      );
      await client.query(
        `DELETE FROM ${PCA_WATCHLIST_TABLE} WHERE id = $1 AND account_id = $2`,
        [watchlistId, accountId]
      );
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro ao remover watchlist', details: error.message });
  }
});

// ============ FIM PCA ============

app.get('/api/licitacoes/overview/summary', async (req, res) => {
  const accountId = getAccountId(req);
  try {
    // Só suspenso → Monitoramento automático; ativo com prazo vencido fica no funil até confirmar.
    await runExpiredSuspensoToMonitoramento({ accountId }).catch((err) => {
      console.warn('[licitacoes] auto-move suspenso→monitoramento (summary) falhou:', err.message);
    });

    // KPIs de cima: só pipeline operacional 2–12 (sem PCA).
    // Prazos críticos (3 d.ú. BR): proposta, impugnação (art. 164 auto ou explícita) e recurso.
    const openSql = getLicitacaoOpenPipelineSql('');
    const statusNorm = `LOWER(COALESCE(NULLIF(TRIM(status), ''), 'ativo'))`;
    const { rows } = await pool.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE ${openSql})::int AS opportunities_count,
          COALESCE(SUM(valor_oportunidade) FILTER (WHERE ${openSql}), 0)::float AS total_value,
          COUNT(*) FILTER (
            WHERE ${openSql} AND ${statusNorm} = 'ativo'
          )::int AS ativo_count,
          COALESCE(SUM(valor_oportunidade) FILTER (
            WHERE ${openSql} AND ${statusNorm} = 'ativo'
          ), 0)::float AS ativo_value,
          COUNT(*) FILTER (
            WHERE ${openSql} AND ${statusNorm} = 'suspenso'
          )::int AS suspenso_count,
          COALESCE(SUM(valor_oportunidade) FILTER (
            WHERE ${openSql} AND ${statusNorm} = 'suspenso'
          ), 0)::float AS suspenso_value,
          COUNT(*) FILTER (WHERE status = 'ganho')::int AS won_count,
          COUNT(*) FILTER (WHERE status = 'perdido' OR status = 'nao_atendido')::int AS lost_count,
          COALESCE(SUM(comissao_valor_previsto), 0) AS comissao_prevista,
          COALESCE(SUM(comissao_valor_real) FILTER (WHERE status_comissao = 'pago'), 0) AS comissao_paga
        FROM ${LICITACAO_TABLE}
        WHERE account_id = $1
      `,
      [accountId]
    );
    const { rows: openRows } = await pool.query(
      `
        SELECT
          id, titulo, numero_edital, fase, status, valor_oportunidade,
          data_envio_proposta_limite, data_impugnacao_limite, data_recurso_limite,
          data_esclarecimento_limite
        FROM ${LICITACAO_TABLE}
        WHERE account_id = $1
          AND ${openSql}
      `,
      [accountId]
    );
    const deadlines = analyzeLicitacaoDeadlineSummary(openRows);
    const row = rows[0] || {};
    res.json({
      opportunities_count: Number(row.opportunities_count) || 0,
      total_value: Number(row.total_value) || 0,
      by_status: {
        ativo: {
          count: Number(row.ativo_count) || 0,
          total_value: Number(row.ativo_value) || 0,
        },
        suspenso: {
          count: Number(row.suspenso_count) || 0,
          total_value: Number(row.suspenso_value) || 0,
        },
      },
      won_count: Number(row.won_count) || 0,
      lost_count: Number(row.lost_count) || 0,
      // Vencimento real (proposta) no dia de hoje.
      due_today: deadlines.due_today,
      due_proposta_3bd: deadlines.due_proposta_3bd,
      due_impugnacao_3bd: deadlines.due_impugnacao_3bd,
      // Recurso pós-julgamento (só se data_recurso_limite preenchida).
      due_recurso_3bd: deadlines.due_recurso_3bd,
      // Oportunidades únicas com qualquer prazo crítico na janela.
      due_critical_3bd: deadlines.due_critical_3bd,
      // Alias legado (KPI antigo "48h" / "recurso 3 d.ú.").
      due_48h: deadlines.due_critical_3bd,
      overdue_count: 0,
      comissao_prevista: row.comissao_prevista,
      comissao_paga: row.comissao_paga,
      upcoming_deadlines: deadlines.upcoming_deadlines,
      deadline_stats: deadlines.stats,
      recurso_window: {
        business_days: deadlines.window.business_days,
        start: deadlines.window.start,
        end: deadlines.window.end,
        nth_business_day: deadlines.window.nth_business_day,
      },
    });
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
            'SELECT name, email, custom_attributes, account_id FROM contacts WHERE id = $1',
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
          const actorName = req.auth?.name || req.auth?.sub || 'Usuario do painel';
          await pool.query(
            `INSERT INTO ${HISTORY_TABLE} (contact_id, account_id, from_stage, to_stage, changed_at, source, actor_id, actor_name)
             VALUES ($1, $2, $3, $4, NOW(), 'kanban', $5, $6)`,
            [id, rows[0].account_id, previousStage, Funil_Vendas, req.auth?.uid || null, actorName]
          );
          notifyFunnelStageChange(pool, {
            accountId: rows[0].account_id || CHATWOOT_ACCOUNT_ID,
            contactId: Number(id),
            contactName: rows[0].name,
            fromStage: previousStage,
            toStage: Funil_Vendas,
            actorName,
          }).catch((err) => console.warn('[funil] notify stage failed:', err.message));
        }

        res.json({ message: 'Contact updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// ============================================================
// BUSCA LEADS — CNPJ
// ============================================================

const CNPJ_CACHE_TABLE = 'cnpj_cache';

const createCNPJCacheTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${CNPJ_CACHE_TABLE} (
      cnpj CHAR(14) PRIMARY KEY,
      data JSONB NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
};

const normalizeCNPJ = (value) => String(value || '').replace(/[^\d]/g, '').slice(-14).padStart(14, '0');

// E.164 com prefixo BR — Chatwoot só renderiza phone_number com +.
// Se já tem +, preserva. Senão, infere prefixo Brasil baseado no comprimento.
const normalizeBRPhone = (raw) => {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.startsWith('+')) {
    const digits = s.slice(1).replace(/\D/g, '');
    return digits.length >= 8 ? ('+' + digits).slice(0, 20) : null;
  }
  const d = s.replace(/\D/g, '');
  if (!d) return null;
  if (d.length >= 12 && d.startsWith('55')) return ('+' + d).slice(0, 20);
  if (d.length === 10 || d.length === 11) return ('+55' + d).slice(0, 20);
  return ('+' + d).slice(0, 20);
};

const normalizeCNPJData = (raw) => {
  if (!raw) return null;

  // publica.cnpj.ws — formato aninhado com chave "estabelecimento"
  if (raw.estabelecimento) {
    const e = raw.estabelecimento;
    const phone1 = e.ddd1 && e.telefone1 ? `(${e.ddd1}) ${e.telefone1}` : '';
    const phone2 = e.ddd2 && e.telefone2 ? `(${e.ddd2}) ${e.telefone2}` : '';
    return {
      cnpj: e.cnpj || '',
      razao_social: raw.razao_social || '',
      nome_fantasia: e.nome_fantasia || '',
      descricao_situacao_cadastral: e.situacao_cadastral || '',
      data_situacao_cadastral: e.data_situacao_cadastral || '',
      data_inicio_atividade: e.data_inicio_atividade || '',
      cnae_fiscal: e.atividade_principal?.id || '',
      cnae_fiscal_descricao: e.atividade_principal?.descricao || '',
      cnaes_secundarios: (e.atividades_secundarias || []).map(a => ({ codigo: a.id, descricao: a.descricao })),
      logradouro: [e.tipo_logradouro, e.logradouro].filter(Boolean).join(' '),
      numero: e.numero || '',
      complemento: e.complemento || '',
      bairro: e.bairro || '',
      cep: e.cep || '',
      municipio: e.cidade?.nome || '',
      uf: e.estado?.sigla || '',
      ddd_telefone_1: phone1,
      ddd_telefone_2: phone2,
      email: e.email || '',
      capital_social: Number(raw.capital_social) || 0,
      descricao_porte: raw.porte?.descricao || raw.porte?.id || '',
      natureza_juridica: raw.natureza_juridica?.descricao || '',
      opcao_pelo_simples: raw.simples?.simples || false,
      opcao_pelo_mei: raw.simples?.mei || false,
      tipo: e.tipo || 'Matriz',
      qsa: (raw.socios || []).map(s => ({
        nome_socio: s.nome || '',
        qualificacao: s.qualificacao_socio?.descricao || '',
        faixa_etaria: s.faixa_etaria || '',
        data_entrada_sociedade: s.data_entrada || '',
      })),
      _source: 'cnpj_ws',
    };
  }

  // BrasilAPI / formato flat
  return {
    cnpj: raw.cnpj || '',
    razao_social: raw.razao_social || '',
    nome_fantasia: raw.nome_fantasia || '',
    descricao_situacao_cadastral: raw.descricao_situacao_cadastral || String(raw.situacao_cadastral || ''),
    data_situacao_cadastral: raw.data_situacao_cadastral || '',
    data_inicio_atividade: raw.data_inicio_atividade || '',
    cnae_fiscal: raw.cnae_fiscal || '',
    cnae_fiscal_descricao: raw.cnae_fiscal_descricao || '',
    cnaes_secundarios: (raw.cnaes_secundarios || []).map(a => ({ codigo: a.codigo, descricao: a.descricao })),
    logradouro: raw.logradouro || '',
    numero: raw.numero || '',
    complemento: raw.complemento || '',
    bairro: raw.bairro || '',
    cep: raw.cep || '',
    municipio: raw.municipio || '',
    uf: raw.uf || '',
    ddd_telefone_1: raw.ddd_telefone_1 || '',
    ddd_telefone_2: raw.ddd_telefone_2 || '',
    email: raw.email || '',
    capital_social: Number(raw.capital_social) || 0,
    descricao_porte: raw.descricao_porte || '',
    natureza_juridica: raw.natureza_juridica_descricao || '',
    opcao_pelo_simples: raw.opcao_pelo_simples || false,
    opcao_pelo_mei: raw.opcao_pelo_mei || false,
    tipo: raw.descricao_matriz_filial || 'Matriz',
    qsa: (raw.qsa || []).map(s => ({
      nome_socio: s.nome_socio || '',
      qualificacao: s.qualificacao_socio_descricao || '',
      faixa_etaria: s.faixa_etaria || '',
      data_entrada_sociedade: s.data_entrada_sociedade || '',
    })),
    _source: 'brasilapi',
  };
};

const fetchCNPJFromAPI = async (cnpj) => {
  const clean = normalizeCNPJ(cnpj);
  if (!clean || clean.replace(/0/g, '').length === 0) throw new Error('CNPJ inválido');

  // Checar cache (7 dias)
  const cached = await pool.query(
    `SELECT data FROM ${CNPJ_CACHE_TABLE} WHERE cnpj = $1 AND fetched_at > NOW() - INTERVAL '7 days'`,
    [clean]
  );
  if (cached.rows.length > 0) return cached.rows[0].data;

  let raw = null;
  let lastError = null;

  // Tentar publica.cnpj.ws primeiro (tem email)
  try {
    const res = await fetch(`https://publica.cnpj.ws/cnpj/${clean}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'kanban-dashboard/1.0' },
    });
    if (res.ok) raw = await res.json();
    else lastError = `cnpj.ws: ${res.status}`;
  } catch (e) {
    lastError = e.message;
  }

  // Fallback: BrasilAPI
  if (!raw) {
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${clean}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'kanban-dashboard/1.0' },
      });
      if (res.ok) raw = await res.json();
      else lastError = `brasilapi: ${res.status}`;
    } catch (e) {
      lastError = e.message;
    }
  }

  if (!raw) throw new Error(lastError || 'Falha ao consultar CNPJ');

  const normalized = normalizeCNPJData(raw);

  await pool.query(
    `INSERT INTO ${CNPJ_CACHE_TABLE} (cnpj, data) VALUES ($1, $2)
     ON CONFLICT (cnpj) DO UPDATE SET data = $2, fetched_at = NOW()`,
    [clean, JSON.stringify(normalized)]
  ).catch(() => {}); // falha de cache não bloqueia

  return normalized;
};

// Token OAuth2 para conecta.gov.br (busca por nome)
let _conectaToken = null;
let _conectaTokenExp = 0;

const getConectaToken = async () => {
  if (_conectaToken && Date.now() < _conectaTokenExp) return _conectaToken;
  const clientId = process.env.CNPJ_CLIENT_ID;
  const clientSecret = process.env.CNPJ_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  try {
    const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch('https://h-apigateway.conecta.gov.br/oauth2/jwt-token', {
      method: 'POST',
      headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) return null;
    const td = await res.json();
    _conectaToken = td.access_token;
    _conectaTokenExp = Date.now() + Math.max(0, (td.expires_in || 3600) - 120) * 1000;
    return _conectaToken;
  } catch {
    return null;
  }
};

// GET /api/leads/cnpj/:cnpj
app.get('/api/leads/cnpj/:cnpj', async (req, res) => {
  try {
    const data = await fetchCNPJFromAPI(req.params.cnpj);
    res.json(data);
  } catch (err) {
    console.error('Error fetching CNPJ:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// POST /api/leads/cnpj/batch  body: { cnpjs: string[] }
app.post('/api/leads/cnpj/batch', async (req, res) => {
  const { cnpjs } = req.body;
  if (!Array.isArray(cnpjs) || cnpjs.length === 0) {
    return res.status(400).json({ error: 'Forneça um array de CNPJs' });
  }
  const limited = cnpjs.slice(0, 50);
  const results = [];
  for (let i = 0; i < limited.length; i++) {
    const cnpj = limited[i];
    try {
      const data = await fetchCNPJFromAPI(cnpj);
      results.push({ cnpj: normalizeCNPJ(cnpj), success: true, data });
    } catch (err) {
      results.push({ cnpj: normalizeCNPJ(cnpj), success: false, error: err.message });
    }
    if (i < limited.length - 1) await new Promise(r => setTimeout(r, 300));
  }
  res.json(results);
});

// GET /api/leads/search?q=...&tipo=cnpj|razao_social|nome_fantasia|socio&uf=...
app.get('/api/leads/search', async (req, res) => {
  const { q, tipo = 'razao_social', uf } = req.query;
  if (!q) return res.status(400).json({ error: 'Parâmetro q é obrigatório' });

  // Se parece CNPJ (8+ dígitos), faz lookup direto
  const digits = q.replace(/[^\d]/g, '');
  if (digits.length >= 8) {
    try {
      const data = await fetchCNPJFromAPI(q);
      return res.json({ results: [data], total: 1, source: 'cnpj_direto' });
    } catch (err) {
      // Se falhar busca direta e é texto misto, cai no search por nome
      if (digits.length === 14) return res.status(400).json({ error: err.message });
    }
  }

  // Busca por nome via conecta.gov.br
  const token = await getConectaToken();
  if (!token) {
    return res.json({
      results: [],
      total: 0,
      source: 'none',
      requires_config: true,
      message: 'Para pesquisa por razão social, nome fantasia ou sócio, configure CNPJ_CLIENT_ID e CNPJ_CLIENT_SECRET no .env do servidor (API conecta.gov.br).',
    });
  }

  try {
    const tipoPath = tipo === 'nome_fantasia' ? 'nome-fantasia' : tipo === 'socio' ? 'socio' : 'razao-social';
    const url = `https://h-apigateway.conecta.gov.br/consulta-cnpj/v2/${tipoPath}/${encodeURIComponent(q)}`;
    const searchRes = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!searchRes.ok) {
      const txt = await searchRes.text().catch(() => '');
      return res.status(searchRes.status).json({ error: `Erro na API de busca: ${searchRes.status} — ${txt.slice(0, 200)}` });
    }
    const data = await searchRes.json();
    let results = Array.isArray(data) ? data : (data.estabelecimentos || data.cnpjs || data.results || (data.cnpj ? [data] : []));
    results = results.map(normalizeCNPJData).filter(Boolean);
    if (uf) results = results.filter(r => (r.uf || '').toUpperCase() === uf.toUpperCase());
    res.json({ results, total: results.length, source: 'conecta' });
  } catch (err) {
    console.error('Error searching CNPJ by name:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leads/existing-cnpjs — mapa cnpj → { id, name } para detecção de duplicatas
app.get('/api/leads/existing-cnpjs', async (req, res) => {
  const accountId = getAccountId(req);
  try {
    const { rows } = await pool.query(
      `SELECT id, name, COALESCE(custom_attributes->>'CNPJ_CPF', custom_attributes->>'CNPJ', custom_attributes->>'cnpj') AS cnpj,
              additional_attributes->>'company_name' AS company_name
       FROM contacts
       WHERE account_id = $1 AND (custom_attributes->>'CNPJ_CPF' IS NOT NULL OR custom_attributes->>'CNPJ' IS NOT NULL OR custom_attributes->>'cnpj' IS NOT NULL)`,
      [accountId]
    );
    const map = {};
    for (const row of rows) {
      const clean = normalizeCNPJ(row.cnpj);
      if (clean) map[clean] = { id: row.id, name: row.name, company_name: row.company_name };
    }
    res.json(map);
  } catch (err) {
    console.error('Error fetching existing CNPJs:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/leads/import
app.post('/api/leads/import', async (req, res) => {
  const accountId = getAccountId(req);
  const { leads, defaultStage = '1. Inbox (Novos)', overwriteDuplicates = false, labels = [] } = req.body;
  if (!Array.isArray(leads) || leads.length === 0) {
    return res.status(400).json({ error: 'Nenhum lead fornecido' });
  }
  const results = { imported: 0, updated: 0, skipped: 0, errors: [] };

  for (const lead of leads.slice(0, 100)) {
    try {
      const cnpj = normalizeCNPJ(lead.cnpj);
      // Nome do contato: sócio (se disponível) ou razão social
      const fullName = lead.primeiro_nome
        ? `${lead.primeiro_nome}${lead.sobrenome ? ' ' + lead.sobrenome : ''}`.trim()
        : (lead.razao_social || lead.nome_fantasia || 'Empresa');
      const name = fullName.slice(0, 255);
      const email = (lead.email || '').toLowerCase().trim().slice(0, 255) || null;
      const rawPhone = lead.ddd_telefone_1 || lead.ddd_telefone_2 || '';
      const phone = normalizeBRPhone(rawPhone);
      const location = [lead.municipio, lead.uf].filter(Boolean).join(', ');

      const existByCNPJ = await pool.query(
        `SELECT id FROM contacts WHERE account_id = $1 AND (custom_attributes->>'CNPJ_CPF' = $2 OR custom_attributes->>'CNPJ' = $2 OR custom_attributes->>'cnpj' = $2) LIMIT 1`,
        [accountId, cnpj]
      );
      const existByName = existByCNPJ.rows.length === 0
        ? await pool.query(
            `SELECT id FROM contacts WHERE account_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
            [accountId, name]
          )
        : { rows: [] };
      const existing = existByCNPJ.rows[0] || existByName.rows[0];

      if (existing && !overwriteDuplicates) { results.skipped++; continue; }

      const qsa = Array.isArray(lead.qsa) ? lead.qsa : [];
      const sociosStr = qsa.map(s => s.nome_socio || s.nome || '').filter(Boolean).join('; ');

      const customAttr = { Funil_Vendas: defaultStage, CNPJ_CPF: cnpj };
      if (lead.cnae_fiscal_descricao) customAttr.CNAE_Principal = String(lead.cnae_fiscal_descricao).slice(0, 255);
      if (lead.cnae_fiscal) customAttr.CNAE_Codigo = String(lead.cnae_fiscal);
      const capVal = String(lead.capital_social || '').trim();
      if (capVal) customAttr.Capital_Social = capVal;
      if (lead.descricao_situacao_cadastral) customAttr.Situacao_Cadastral = String(lead.descricao_situacao_cadastral).slice(0, 100);
      if (lead.data_inicio_atividade) customAttr.Data_Abertura = String(lead.data_inicio_atividade);
      if (lead.descricao_porte) customAttr.Porte = String(lead.descricao_porte).slice(0, 100);
      if (sociosStr) customAttr.Socios = sociosStr.slice(0, 500);
      if (lead.opcao_pelo_simples != null) customAttr.Simples_Nacional = lead.opcao_pelo_simples ? 'Sim' : 'Não';
      if (lead.opcao_pelo_mei != null) customAttr.MEI = lead.opcao_pelo_mei ? 'Sim' : 'Não';

      const addAttr = { company_name: (lead.nome_fantasia || lead.razao_social || '').slice(0, 255) };

      let contactId;
      if (existing && overwriteDuplicates) {
        await pool.query(
          `UPDATE contacts SET
             name = $1,
             email = COALESCE($2, email),
             phone_number = COALESCE($3, phone_number),
             location = COALESCE(NULLIF($4,''), location),
             custom_attributes = custom_attributes || $5::jsonb,
             additional_attributes = additional_attributes || $6::jsonb,
             updated_at = NOW()
           WHERE id = $7`,
          [name, email, phone, location, JSON.stringify(customAttr), JSON.stringify(addAttr), existing.id]
        );
        contactId = existing.id;
        results.updated++;
      } else {
        const ins = await pool.query(
          `INSERT INTO contacts (account_id, name, email, phone_number, location, custom_attributes, additional_attributes, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING id`,
          [accountId, name, email, phone, location, JSON.stringify(customAttr), JSON.stringify(addAttr)]
        );
        contactId = ins.rows[0]?.id;
        if (contactId) {
          await pool.query(
            `INSERT INTO ${HISTORY_TABLE} (contact_id, account_id, from_stage, to_stage, changed_at, source)
             VALUES ($1, $2, NULL, $3, NOW(), 'import_cnpj')`,
            [contactId, accountId, defaultStage]
          ).catch(() => {});
        }
        results.imported++;
      }

      // Aplicar etiquetas ao contato
      if (contactId && Array.isArray(labels) && labels.length > 0) {
        for (const labelTitle of labels) {
          const tag = await pool.query(
            `INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
            [labelTitle]
          );
          const tagId = tag.rows[0]?.id;
          if (tagId) {
            await pool.query(
              `INSERT INTO taggings (tag_id, taggable_type, taggable_id, context, created_at)
               VALUES ($1, 'Contact', $2, 'labels', NOW())
               ON CONFLICT DO NOTHING`,
              [tagId, contactId]
            ).catch(() => {});
          }
        }
      }
    } catch (err) {
      console.error('Import error for CNPJ', lead.cnpj, ':', err.message);
      results.errors.push({ cnpj: lead.cnpj, error: err.message });
    }
  }

  if ((results.imported || 0) > 0) {
    const n = results.imported;
    notifyAccountUsers(pool, {
      accountId,
      type: 'funil.lead_imported',
      title: `${n} lead${n === 1 ? '' : 's'} importado${n === 1 ? '' : 's'}`,
      body: `Busca B2B · ${results.updated || 0} atualizado(s), ${results.skipped || 0} ignorado(s).`,
      data: {
        view: 'Busca Lead B2B',
        imported: n,
        updated: results.updated || 0,
        skipped: results.skipped || 0,
      },
      dedupeKey: `import:${Date.now()}:${n}`,
    }).catch((err) => console.warn('[funil] notify import failed:', err.message));
  }

  res.json(results);
});

// ── CNAE helpers ────────────────────────────────────────────
let _cnaeCache = null;
let _cnaeCacheTime = 0;

const getCNAEList = async () => {
  if (_cnaeCache && Date.now() - _cnaeCacheTime < 86400000) return _cnaeCache;
  try {
    const res = await fetch('https://servicodados.ibge.gov.br/api/v2/cnae/subclasses', {
      headers: { Accept: 'application/json', 'User-Agent': 'kanban-dashboard/1.0' },
    });
    if (!res.ok) throw new Error(`IBGE CNAE: ${res.status}`);
    const data = await res.json();
    _cnaeCache = (Array.isArray(data) ? data : []).map(c => ({
      codigo: String(c.id || c.codigo || ''),
      descricao: String(c.descricao || ''),
    })).filter(c => c.codigo);
    _cnaeCacheTime = Date.now();
    return _cnaeCache;
  } catch (e) {
    console.error('Error fetching CNAE list:', e.message);
    return _cnaeCache || [];
  }
};

// Pré-filtra CNAEs por keywords (sem acentos, case-insensitive)
const stripAccents = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const preFilterCNAE = (cnaeList, query) => {
  const words = stripAccents(query).replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3);
  if (!words.length) return cnaeList;
  const scored = [];
  for (const c of cnaeList) {
    const desc = stripAccents(c.descricao);
    const code = stripAccents(c.codigo);
    let score = 0;
    for (const w of words) {
      if (desc.includes(w)) score += 2;
      if (code.includes(w)) score += 1;
    }
    if (score > 0) scored.push({ ...c, _score: score });
  }
  return scored.sort((a, b) => b._score - a._score);
};

const suggestCNAEWithAI = async (query) => {
  const cnaeList = await getCNAEList();

  // Pré-filtrar para reduzir tokens enviados à IA
  const preFiltered = preFilterCNAE(cnaeList, query);
  // Se pré-filtro retornou poucos resultados, envia todos (a IA sabe mais que keyword match)
  const toSend = preFiltered.length >= 5 ? preFiltered.slice(0, 300) : cnaeList;
  const cnaeStr = toSend.map(c => `${c.codigo}|${c.descricao}`).join('\n');

  const systemPrompt = `Você é especialista em CNAE (Classificação Nacional de Atividades Econômicas do Brasil).

CNAEs disponíveis (codigo|descricao):
${cnaeStr}

Dado uma descrição de setor ou tipo de empresa, identifique os CNAEs mais relevantes.
Considere sinônimos e termos técnicos do setor.
Retorne SOMENTE JSON (sem markdown, sem texto fora do JSON):
{"cnaes":[{"codigo":"XXXX-X/XX","descricao":"...","relevancia":"alta|media|baixa"}],"resumo":"uma linha sobre o setor"}
Máximo 15 CNAEs, mais relevantes primeiro.`;

  const providers = [];
  if (OPENAI_API_KEY) providers.push({ url: 'https://api.openai.com/v1/chat/completions', key: OPENAI_API_KEY, model: 'gpt-4o-mini' });
  if (GROQ_API_KEY) providers.push({ url: 'https://api.groq.com/openai/v1/chat/completions', key: GROQ_API_KEY, model: GROQ_AI_MODEL });

  if (!providers.length) {
    // Fallback sem IA: retorna top resultados do pré-filtro com relevância estimada
    const fallback = preFiltered.slice(0, 15).map((c, i) => ({
      codigo: c.codigo, descricao: c.descricao,
      relevancia: i < 5 ? 'alta' : i < 10 ? 'media' : 'baixa',
    }));
    return fallback.length > 0
      ? { cnaes: fallback, resumo: `Resultado por busca de texto para "${query}" (sem IA configurada)` }
      : { cnaes: [], resumo: null, message: 'Configure OPENAI_API_KEY ou GROQ_API_KEY para busca inteligente.' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    for (const provider of providers) {
      try {
        const res = await fetch(provider.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key}` },
          body: JSON.stringify({
            model: provider.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `Setor/ramo: "${query}"` },
            ],
            temperature: 0.1,
            max_tokens: 1500,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          console.error(`CNAE AI (${provider.model}) ${res.status}:`, errText.slice(0, 200));
          continue;
        }
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed.cnaes)) return parsed;
        }
        console.error(`CNAE AI (${provider.model}) invalid JSON:`, content.slice(0, 200));
      } catch (innerErr) {
        if (innerErr.name === 'AbortError') throw innerErr;
        console.error(`CNAE AI provider (${provider.model}):`, innerErr.message);
      }
    }
    // Todas as IAs falharam — fallback por keyword
    const fallback = preFiltered.slice(0, 15).map((c, i) => ({
      codigo: c.codigo, descricao: c.descricao,
      relevancia: i < 5 ? 'alta' : i < 10 ? 'media' : 'baixa',
    }));
    return fallback.length > 0
      ? { cnaes: fallback, resumo: `Resultado por busca de texto (IA indisponível)` }
      : { cnaes: [], resumo: null, message: 'Nenhum CNAE encontrado para esse termo.' };
  } catch (e) {
    if (e.name !== 'AbortError') console.error('suggestCNAEWithAI:', e.message);
    const fallback = preFiltered.slice(0, 10).map((c, i) => ({
      codigo: c.codigo, descricao: c.descricao,
      relevancia: i < 3 ? 'alta' : 'media',
    }));
    return fallback.length > 0
      ? { cnaes: fallback, resumo: 'Resultado parcial (timeout da IA)' }
      : null;
  } finally {
    clearTimeout(timeoutId);
  }
};

// GET /api/leads/cnae/filter?q=... — filtro por keyword, sem IA (para o dropdown do frontend)
app.get('/api/leads/cnae/filter', async (req, res) => {
  const { q } = req.query;
  try {
    const list = await getCNAEList();
    if (!q || !q.trim()) return res.json(list.slice(0, 50));
    const filtered = preFilterCNAE(list, q).slice(0, 50);
    res.json(filtered.map(({ _score, ...c }) => c));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/leads/cnae/list
app.get('/api/leads/cnae/list', async (req, res) => {
  try {
    const list = await getCNAEList();
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/leads/cnae/suggest?q=...
app.get('/api/leads/cnae/suggest', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Parâmetro q é obrigatório' });
  try {
    const result = await suggestCNAEWithAI(q);
    if (!result) {
      return res.json({ cnaes: [], resumo: null, message: 'Nenhuma IA disponível. Configure OPENAI_API_KEY ou GROQ_API_KEY.' });
    }
    res.json(result);
  } catch (e) {
    console.error('CNAE suggest error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/leads/cnae/search?codes=XXXX-X/XX,YYYY-Y/YY
app.get('/api/leads/cnae/search', async (req, res) => {
  const { codes } = req.query;
  if (!codes) return res.status(400).json({ error: 'Parâmetro codes é obrigatório' });

  const codeList = codes.split(',').map(c => c.trim()).filter(Boolean).slice(0, 5);
  const token = await getConectaToken();
  if (!token) {
    return res.json({
      results: [],
      total: 0,
      requires_config: true,
      message: 'Para buscar empresas por CNAE, configure CNPJ_CLIENT_ID e CNPJ_CLIENT_SECRET no .env (API conecta.gov.br).',
    });
  }

  const allResults = [];
  for (const code of codeList) {
    try {
      const url = `https://h-apigateway.conecta.gov.br/consulta-cnpj/v2/cnae/${encodeURIComponent(code)}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      if (!r.ok) { console.error('CNAE search error', code, r.status); continue; }
      const data = await r.json();
      const items = Array.isArray(data) ? data : (data.estabelecimentos || data.results || (data.cnpj ? [data] : []));
      for (const item of items) {
        const normalized = normalizeCNPJData(item);
        if (normalized) allResults.push({ ...normalized, _cnae_buscado: code });
      }
    } catch (e) { console.error('CNAE search:', code, e.message); }
    if (codeList.indexOf(code) < codeList.length - 1) await new Promise(r => setTimeout(r, 200));
  }

  // Deduplicar por CNPJ
  const seen = new Set();
  const unique = allResults.filter(r => {
    const k = normalizeCNPJ(r.cnpj || '');
    if (!k || seen.has(k)) return false;
    seen.add(k); return true;
  });

  res.json({ results: unique, total: unique.length, source: 'conecta_cnae' });
});

// ============================================================
// GOOGLE TRENDS → INTEL DE PROSPECÇÃO (Busca Lead B2B)
// Fonte principal: pytrends related queries (top + rising) por
// seeds do negócio (drones enterprise etc.), geo=BR.
// Fallback: RSS "em alta" do país se pytrends falhar.
// Cache diário (memória + Postgres): 1ª abertura do dia gera;
// demais aberturas no mesmo dia reutilizam o resultado.
// ============================================================

const TRENDS_RSS_URL = process.env.TRENDS_RSS_URL || 'https://trends.google.com/trending/rss?geo=BR';
// Google Trends espera ISO em maiúsculas (BR). Aceita "br" no .env.
const TRENDS_GEO = String(process.env.TRENDS_GEO || 'BR').trim().toUpperCase() || 'BR';
// Formato oficial: "today 3-m" (com espaço). Aceita "today-3m" / "today_3m" no .env.
const normalizeTrendsTimeframe = (raw) => {
  let v = String(raw || 'today 3-m').trim().replace(/["']/g, '');
  if (!v) v = 'today 3-m';
  // today-3m / today_3m / today3-m → today 3-m
  v = v.replace(/^(today|now)[-_]?(\d+)\s*[-_]?([a-z]+)$/i, (_, a, n, u) => `${a.toLowerCase()} ${n}-${u.toLowerCase()}`);
  v = v.replace(/^(today|now)[-_](\d+[-_][a-z]+)$/i, (_, a, rest) => `${a.toLowerCase()} ${rest.replace(/_/g, '-')}`);
  // already "today 3-m"
  if (/^(today|now)\s+\d+-[a-z]+$/i.test(v)) return v.toLowerCase().replace(/^(today|now)/, (m) => m.toLowerCase());
  return v;
};
const TRENDS_TIMEFRAME = normalizeTrendsTimeframe(process.env.TRENDS_TIMEFRAME || 'today 3-m');
// Poucas seeds de alto valor (1×/dia) — lista longa aumenta 429 no Google.
const TRENDS_SEEDS = (process.env.TRENDS_SEEDS || [
  'drone',
  'drone enterprise',
  'autel',
].join(','))
  .split(',')
  .map((s) => s.trim().replace(/^["']|["']$/g, ''))
  .filter(Boolean);

const AERION_PRODUCT_CONTEXT = `
Produtos Aerion (drones enterprise Autel e ecossistema):
- Autel EVO Lite Enterprise (640T/6K): inspeção ágil, segurança, mapeamento leve
- Autel EVO Max V2 (4T/4N): operações complexas, térmica, anti-interferência
- Autel Alpha: industrial IP55, zoom 35x, longo alcance, missões críticas
- EVO Nest + Autel Mapper: operação remota automatizada e processamento 2D/3D

ICPs prioritários:
1) Construção/topografia urbana — construtoras, topografia, geodesia
2) Inspeção industrial e energia — concessionárias, solar/eólica, manutenção de ativos
3) Segurança pública e defesa civil — PM, PC, PRF, segurança privada
4) Resgate, emergências e meio ambiente — bombeiros, defesa civil, ONGs ambientais
Modelo de canal: revendas/integradores; não concorre em serviço final; licitações com parceiro.
`.trim();

let trendsIntelMemory = null; // { dayKey, payload, updatedAt }
let trendsIntelRefreshRunning = false;

const brDayKey = (date = new Date()) => {
  // America/Sao_Paulo as YYYY-MM-DD without external deps
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date);
};

const decodeXmlEntities = (value = '') => String(value)
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&')
  .trim();

const extractXmlTag = (block, tag) => {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = block.match(re);
  return m ? decodeXmlEntities(m[1]) : '';
};

const extractRssImage = (block = '') => {
  const source = String(block);
  const direct = source.match(/<(?:media:content|media:thumbnail|enclosure)\b[^>]*\burl=["']([^"']+)["']/i);
  const description = extractXmlTag(source, 'description');
  const embedded = description.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
  const value = decodeXmlEntities(direct?.[1] || embedded?.[1] || '');
  return /^https?:\/\//i.test(value) ? value : null;
};

const parseGoogleTrendsRss = (xml = '') => {
  const items = [];
  const itemBlocks = String(xml).match(/<item>[\s\S]*?<\/item>/gi) || [];
  for (const block of itemBlocks) {
    const title = extractXmlTag(block, 'title');
    if (!title) continue;
    const traffic = extractXmlTag(block, 'ht:approx_traffic') || extractXmlTag(block, 'approx_traffic');
    const pubDate = extractXmlTag(block, 'pubDate');
    const picture = extractXmlTag(block, 'ht:picture') || extractXmlTag(block, 'picture');
    const newsBlocks = block.match(/<ht:news_item>[\s\S]*?<\/ht:news_item>/gi) || [];
    const news = newsBlocks.slice(0, 3).map((nb) => ({
      title: extractXmlTag(nb, 'ht:news_item_title') || extractXmlTag(nb, 'news_item_title'),
      source: extractXmlTag(nb, 'ht:news_item_source') || extractXmlTag(nb, 'news_item_source'),
      url: extractXmlTag(nb, 'ht:news_item_url') || extractXmlTag(nb, 'news_item_url'),
      picture: extractRssImage(nb),
    })).filter((n) => n.title);
    items.push({
      title,
      traffic: traffic || null,
      pubDate: pubDate || null,
      picture: picture || null,
      news,
    });
  }
  return items;
};

const fetchGoogleTrendsRssFallback = async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(TRENDS_RSS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AerionSalesCommand/1.0; +https://aerion.com.br)',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Google Trends RSS HTTP ${res.status}`);
    }
    const xml = await res.text();
    const trends = parseGoogleTrendsRss(xml);
    if (!trends.length) {
      throw new Error('RSS de trends vazio ou ilegível');
    }
    return {
      geo: TRENDS_GEO,
      source: 'google_trends_rss',
      fetchedAt: new Date().toISOString(),
      trends,
      seeds: [],
      by_seed: {},
    };
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Fallback setorial estável (sem pytrends): Google News RSS no BR
 * para as seeds do negócio. Funciona mesmo com 429 no Trends Explore.
 */
const fetchSectorNewsForSeeds = async (seeds = TRENDS_SEEDS) => {
  const list = (seeds || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 6);
  if (!list.length) throw new Error('Sem TRENDS_SEEDS para news setorial');

  const query = list
    .map((s) => (s.includes(' ') ? `"${s}"` : s))
    .join(' OR ');
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AerionSalesCommand/1.0; +https://aerion.com.br)',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Google News RSS HTTP ${res.status}`);
    const xml = await res.text();
    const itemBlocks = String(xml).match(/<item>[\s\S]*?<\/item>/gi) || [];
    const trends = [];
    const seen = new Set();
    for (const block of itemBlocks) {
      const title = extractXmlTag(block, 'title');
      if (!title) continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const pubDate = extractXmlTag(block, 'pubDate') || null;
      const link = extractXmlTag(block, 'link') || null;
      const source = extractXmlTag(block, 'source') || null;
      const picture = extractRssImage(block);
      // descarta ruído óbvio de toy/celeb se título não tiver ângulo tech/B2B — IA ainda filtra
      trends.push({
        title,
        kind: 'news',
        seed: list[0] || null,
        interest: null,
        change: null,
        traffic: 'news',
        pubDate,
        picture,
        url: link || null,
        source: source || null,
        news: link ? [{ title, source: source || '', url: link }] : [],
      });
      if (trends.length >= 20) break;
    }
    if (!trends.length) throw new Error('Google News setorial vazio');
    return {
      geo: TRENDS_GEO,
      source: 'google_news_sector',
      fetchedAt: new Date().toISOString(),
      timeframe: 'news-7d',
      seeds: list,
      by_seed: { _query: query },
      trends,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const isSectorTrendsSource = (source = '') =>
  /pytrends|related|news_sector|google_news/i.test(String(source || ''));

/** Chama scripts/fetch_trends_related.py (pytrends/HTTP) e devolve correlatos por seed. */
const fetchPytrendsRelated = async () => {
  const scriptPath = path.join(__dirname, 'scripts', 'fetch_trends_related.py');
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  // Poucas seeds + delay curto: se Google rate-limitar (429), falha rápido e cai no RSS.
  const seedsForRun = TRENDS_SEEDS.slice(0, 6);
  const args = [
    scriptPath,
    '--geo', TRENDS_GEO,
    '--timeframe', TRENDS_TIMEFRAME,
    '--seeds', seedsForRun.join(','),
    '--max-per-seed', '8',
    '--delay', '2.5',
  ];

  console.log(`[trends-intel] pytrends spawn seeds=${seedsForRun.join('|')} geo=${TRENDS_GEO} tf=${TRENDS_TIMEFRAME}`);

  const result = await new Promise((resolve, reject) => {
    const py = spawn(pythonCmd, args, {
      cwd: path.join(__dirname, 'scripts'),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    // 45s: se 429 em todas as seeds, não prender a UI por minutos
    const killTimer = setTimeout(() => {
      try { py.kill(); } catch (_) { /* ignore */ }
      reject(new Error('pytrends timeout (45s)'));
    }, 45000);
    py.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    py.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    py.on('error', (err) => {
      clearTimeout(killTimer);
      reject(err);
    });
    py.on('close', (code) => {
      clearTimeout(killTimer);
      const text = stdout.trim();
      if (!text) {
        reject(new Error(`pytrends sem stdout (code=${code}): ${(stderr || '').slice(0, 240)}`));
        return;
      }
      // Última linha JSON (ignora lixo eventual)
      const lines = text.split(/\r?\n/).filter(Boolean);
      let parsed = null;
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        try {
          parsed = JSON.parse(lines[i]);
          break;
        } catch (_) { /* try previous */ }
      }
      if (!parsed) {
        reject(new Error(`pytrends JSON inválido: ${text.slice(0, 200)}`));
        return;
      }
      if (!parsed.ok && !(parsed.trends || []).length) {
        reject(new Error(parsed.error || `pytrends falhou (code=${code})`));
        return;
      }
      resolve(parsed);
    });
  });

  const trends = (result.trends || []).map((t) => ({
    title: t.title,
    kind: t.kind || null,
    seed: t.seed || null,
    interest: t.interest ?? null,
    change: t.change || null,
    traffic: t.traffic || t.change || (t.interest != null ? String(t.interest) : null),
    pubDate: t.pubDate || null,
    picture: t.picture || null,
    news: Array.isArray(t.news) ? t.news : [],
  }));

  if (!trends.length) {
    throw new Error(result.error || 'pytrends retornou zero correlatos');
  }

  return {
    geo: result.geo || TRENDS_GEO,
    source: 'pytrends_related',
    fetchedAt: result.fetchedAt || new Date().toISOString(),
    timeframe: result.timeframe || TRENDS_TIMEFRAME,
    seeds: result.seeds || TRENDS_SEEDS,
    by_seed: result.by_seed || {},
    trends,
    partial_errors: result.partial_errors || [],
  };
};

/**
 * Pipeline de coleta (geo=BR, seeds do negócio):
 * 1) Related queries (pytrends/HTTP)
 * 2) Google News setorial pelas seeds (estável sob 429 do Trends)
 * 3) RSS "em alta" do país (último recurso)
 */
const fetchGoogleTrendsDaily = async () => {
  let pytrendsError = null;
  try {
    const related = await fetchPytrendsRelated();
    console.log(
      `[trends-intel] related ok trends=${related.trends.length} seeds=${(related.seeds || []).length}`
    );
    return related;
  } catch (err) {
    pytrendsError = err.message;
    console.warn(`[trends-intel] related/pytrends falhou: ${err.message}`);
  }

  try {
    const news = await fetchSectorNewsForSeeds(TRENDS_SEEDS);
    console.log(
      `[trends-intel] news sector ok trends=${news.trends.length} seeds=${(news.seeds || []).length}`
    );
    return { ...news, pytrends_error: pytrendsError };
  } catch (err) {
    console.warn(`[trends-intel] news sector falhou: ${err.message}`);
  }

  try {
    const rss = await fetchGoogleTrendsRssFallback();
    return {
      ...rss,
      source: 'google_trends_rss_fallback',
      seeds: TRENDS_SEEDS,
      pytrends_error: pytrendsError,
    };
  } catch (err) {
    throw new Error(
      `Falha total trends (related + news + rss): ${pytrendsError || ''} | ${err.message}`
    );
  }
};

const getAiChatProviders = () => {
  const providers = [];
  if (OPENAI_API_KEY) {
    providers.push({
      name: 'openai',
      url: 'https://api.openai.com/v1/chat/completions',
      key: OPENAI_API_KEY,
      model: OPENAI_AI_MODEL,
    });
  }
  if (GROQ_API_KEY) {
    providers.push({
      name: 'groq',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      key: GROQ_API_KEY,
      model: GROQ_AI_MODEL,
    });
  }
  if (OPENROUTER_API_KEY) {
    providers.push({
      name: 'openrouter',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      key: OPENROUTER_API_KEY,
      model: OPENROUTER_AI_MODEL,
      headers: {
        'HTTP-Referer': 'https://sales.aerion.com.br',
        'X-Title': 'Aerion Sales Command',
      },
    });
  }
  return providers;
};

const chatCompletionJson = async ({
  system,
  user,
  messages: extraMessages,
  maxTokens = 2200,
  temperature = 0.25,
  timeoutMs = 45000,
}) => {
  const providers = getAiChatProviders();
  if (!providers.length) {
    return { ok: false, error: 'Nenhuma IA configurada (OPENAI_API_KEY, GROQ_API_KEY ou OPENROUTER_API_KEY).' };
  }
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  if (Array.isArray(extraMessages) && extraMessages.length) {
    for (const m of extraMessages) {
      if (!m || !m.content) continue;
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      messages.push({ role, content: String(m.content) });
    }
  } else if (user) {
    messages.push({ role: 'user', content: user });
  }
  if (!messages.length) {
    return { ok: false, error: 'Mensagens vazias para a IA' };
  }
  const errors = [];
  for (const provider of providers) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(provider.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.key}`,
          ...(provider.headers || {}),
        },
        body: JSON.stringify({
          model: provider.model,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        errors.push(`${provider.name}:${res.status} ${errText.slice(0, 160)}`);
        continue;
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        errors.push(`${provider.name}:JSON inválido`);
        continue;
      }
      try {
        return {
          ok: true,
          data: JSON.parse(jsonMatch[0]),
          provider: provider.name,
          model: provider.model,
          raw: content,
        };
      } catch (parseErr) {
        errors.push(`${provider.name}:JSON parse fail`);
        continue;
      }
    } catch (err) {
      errors.push(`${provider.name}:${err.name === 'AbortError' ? 'timeout' : err.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
  return { ok: false, error: errors.join(' | ') || 'Falha em todos os providers de IA' };
};

// --- Checklist técnico IA: fetch seguro de páginas de produto + helpers ---
const isPrivateIpAddress = (ip) => {
  if (!ip || typeof ip !== 'string') return true;
  const v = ip.trim().toLowerCase();
  if (v === '::1' || v === '0.0.0.0') return true;
  if (v.startsWith('127.') || v.startsWith('10.') || v.startsWith('192.168.') || v.startsWith('169.254.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(v)) return true;
  if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
  return false;
};

const extractUrlsFromText = (text, max = 3) => {
  const re = /https?:\/\/[^\s<>"')\]]+/gi;
  const found = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(String(text || ''))) && found.length < max) {
    let u = m[0].replace(/[.,;:!?]+$/, '');
    try {
      const parsed = new URL(u);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      const key = parsed.href;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(parsed.href);
    } catch (_) { /* ignore bad url */ }
  }
  return found;
};

const htmlToPlainText = (html) => {
  let s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|br|section|article|header|footer)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '\n• ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCharCode(Number(n)); } catch { return ' '; }
    });
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ');
  return s.trim();
};

/** Extrai objeto JS balanceado a partir de posição (após `{`). */
const extractBalancedJsObject = (source, openBraceIndex, maxLen = 120000) => {
  if (!source || source[openBraceIndex] !== '{') return null;
  let depth = 0;
  let inStr = false;
  let quote = '';
  let escaped = false;
  const end = Math.min(source.length, openBraceIndex + maxLen);
  for (let i = openBraceIndex; i < end; i += 1) {
    const ch = source[i];
    if (inStr) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        inStr = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = true;
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openBraceIndex, i + 1);
    }
  }
  return null;
};

/** Converte trecho JS de technicalData / specs aninhadas em texto legível (folhas string/número). */
const jsObjectLiteralToText = (raw) => {
  if (!raw) return '';
  let s = String(raw);
  s = s.replace(/`([^`]*)`/g, (_, inner) => JSON.stringify(inner));
  s = s.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, inner) => {
    try { return JSON.stringify(JSON.parse(`"${inner}"`)); } catch { return JSON.stringify(inner); }
  });
  const lines = [];
  // chaves "quoted" OU identificadores sem aspas (Capacidade:"10000 mAh")
  const re = /(?:"([^"]{1,160})"|([A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_ ./%°×+\-]{0,80}))\s*:\s*("(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?)/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(s))) {
    const key = (m[1] || m[2] || '').trim();
    if (!key) continue;
    if (/^(className|children|style|icon|jsx|jsxs|to|path|href|src|alt|type|id|true|false|null)$/i.test(key)) continue;
    let val = m[3];
    if (val.startsWith('"')) {
      try { val = JSON.parse(val); } catch { val = val.slice(1, -1); }
    }
    if (String(val).length > 280) val = `${String(val).slice(0, 280)}…`;
    const line = `• ${key}: ${val}`;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
    if (lines.length >= 500) break;
  }
  return lines.join('\n');
};

/**
 * Em SPAs (ex.: aerion.com.br) as specs do accordion vivem no bundle JS, não no HTML.
 * Busca /assets/js/*.js same-origin e extrai technicalData / seções de specs do produto.
 */
const enrichProductPageFromJsBundles = async (pageUrl, html, { timeoutMs = 20000, maxBundleBytes = 2_500_000 } = {}) => {
  let page;
  try {
    page = new URL(pageUrl);
  } catch {
    return { text: '', note: null };
  }
  const slug = page.pathname.split('/').filter(Boolean).pop() || '';
  if (!slug || slug.length < 3) return { text: '', note: null };

  // nome legível a partir do slug (evo-max-v2 -> EVO Max V2 approx)
  const nameGuess = slug
    .split('-')
    .map((p) => (p.length <= 3 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');

  const assetHrefs = [...html.matchAll(/src=["']([^"']+\.js)["']/gi)]
    .map((m) => m[1])
    .filter((h) => /\/assets\/js\//i.test(h) || /chunk|index-|main-|app-/i.test(h))
    .slice(0, 5);
  if (!assetHrefs.length) return { text: '', note: null };

  const chunks = [];
  let usedBundle = null;

  const pushChunk = (title, flat, abs) => {
    if (!flat || flat.length < 30) return;
    chunks.push(`--- ${title} ---\n${flat}`);
    usedBundle = abs;
  };

  for (const href of assetHrefs) {
    let abs;
    try {
      abs = new URL(href, page.origin).href;
      if (new URL(abs).hostname !== page.hostname) continue;
    } catch {
      continue;
    }
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(abs, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'AerionSalesBot/1.0 (+checklist-tecnico; commercial research)',
          Accept: 'application/javascript,text/javascript,*/*',
        },
      });
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      if (buf.byteLength > maxBundleBytes) continue;
      const js = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      if (!js.includes(slug) && !js.includes(`/produtos/${slug}`)) continue;

      // 1) produto catálogo {id:"slug"...}
      const idNeedle = `id:"${slug}"`;
      let idPos = js.indexOf(idNeedle);
      if (idPos < 0) idPos = js.indexOf(`slug:"${slug}"`);
      if (idPos >= 0) {
        let start = idPos;
        for (let k = 0; k < 500 && start > 0; k += 1) {
          if (js[start] === '{') break;
          start -= 1;
        }
        if (js[start] === '{') {
          const obj = extractBalancedJsObject(js, start, 12000);
          if (obj) pushChunk(`produto ${slug}`, jsObjectLiteralToText(obj), abs);
        }
      }

      // Tokens do produto a partir do slug (evo-max-v2 → evo, max, v2)
      const slugTokens = slug.split(/[-_]/).filter((t) => t.length >= 2);
      const productMatchers = [
        nameGuess,
        slug,
        `/produtos/${slug}`,
        ...slugTokens.filter((t) => t.length >= 3).map((t) => t),
      ].filter(Boolean);

      // 2) Blocos specs:{...} — fichas do accordion (variantes 4T/4N etc.)
      const scoredSpecs = [];
      let from = 0;
      while (scoredSpecs.length < 16 && from < js.length) {
        const sp = js.indexOf('specs:{', from);
        if (sp < 0) break;
        from = sp + 7;
        const brace = sp + 6;
        if (js[brace] !== '{') continue;
        const obj = extractBalancedJsObject(js, brace, 100000);
        if (!obj || obj.length < 200) continue;
        const looksLikeSpec =
          obj.includes('BATERIA')
          || obj.includes('DESEMPENHO')
          || obj.includes('CÂMERA')
          || obj.includes('PORTABILIDADE')
          || obj.includes('TRANSMISS');
        if (!looksLikeSpec) continue;
        // contexto imediatamente antes (nome da variante / produto)
        const before = js.slice(Math.max(0, sp - 400), sp);
        let score = 0;
        const blob = `${before}\n${obj}`;
        const lower = blob.toLowerCase();
        for (const m of productMatchers) {
          if (m && lower.includes(String(m).toLowerCase())) score += 2;
        }
        if (/evo\s*max|max\s*v2|max\s*4t|max\s*4n/i.test(blob) && /max/i.test(slug)) score += 6;
        if (/fusion\s*4t|4t\s*v2|abx41/i.test(blob) && /max/i.test(slug)) score += 6;
        if (/fusion\s*4n|4n\s*v2/i.test(blob) && /max/i.test(slug)) score += 5;
        if (/autel\s*alpha|dg-l35t/i.test(blob) && /alpha/i.test(slug)) score += 6;
        if (/evo\s*lite|6175\s*mAh|68\.7\s*Wh/i.test(blob) && /lite/i.test(slug)) score += 6;
        if (/6175\s*mAh|68\.7\s*Wh/i.test(obj) && /max|alpha/i.test(slug)) score -= 5;
        if (/10000\s*mAh|237\s*Wh/i.test(obj) && /max/i.test(slug)) score += 3;
        if (/1665\s*g|1700\s*g|467\s*mm/i.test(obj) && /max/i.test(slug)) score += 4;
        // Alpha costuma ser bem mais pesado
        if (/[56]\d{3}\s*g|MTOM|8400\s*g/i.test(obj) && /max/i.test(slug) && !/1665|1700/i.test(obj)) score -= 6;
        if (score < 4) continue;
        scoredSpecs.push({ score, obj, len: obj.length });
      }
      scoredSpecs.sort((a, b) => b.score - a.score || b.len - a.len);
      for (const item of scoredSpecs.slice(0, 2)) {
        pushChunk(`ficha specs (score ${item.score})`, jsObjectLiteralToText(item.obj), abs);
      }

      // 3) technicalData com GTIN do produto
      let searchFrom = 0;
      while (searchFrom < js.length) {
        const td = js.indexOf('technicalData:', searchFrom);
        if (td < 0) break;
        searchFrom = td + 14;
        const brace = js.indexOf('{', td);
        if (brace < 0 || brace - td > 30) continue;
        const obj = extractBalancedJsObject(js, brace, 80000);
        if (!obj || obj.length < 80) continue;
        if (!obj.includes(nameGuess) && !obj.includes(slug) && !/GTIN.*Max|GTIN.*Alpha|GTIN.*Lite/i.test(obj)) continue;
        // só se mencionar o produto alvo
        if (!new RegExp(slugTokens.filter((t) => t.length > 2).join('|'), 'i').test(obj) && !obj.includes(nameGuess)) continue;
        pushChunk('technicalData comercial', jsObjectLiteralToText(obj), abs);
        break;
      }

      if (chunks.length) break;
    } catch (_) {
      /* next */
    } finally {
      clearTimeout(t);
    }
  }

  if (!chunks.length) {
    return {
      text: '',
      note: 'Accordion/specs detalhadas nao estavam no HTML (conteudo client-side). Bundle JS sem technicalData extraivel — use "Copiar informacoes" no site ou cole a ficha.',
    };
  }
  return {
    text: chunks.join('\n\n').slice(0, 50000),
    note: `Specs extraidas do bundle JS (accordion fechado no HTML)${usedBundle ? ` via ${usedBundle}` : ''}`,
  };
};

const fetchPublicUrlText = async (rawUrl, { maxChars = 45000, timeoutMs = 18000 } = {}) => {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    return { ok: false, url: rawUrl, error: 'URL invalida' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, url: parsed.href, error: 'Protocolo nao permitido' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, url: parsed.href, error: 'URL com credenciais nao permitida' };
  }
  const hostname = parsed.hostname;
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return { ok: false, url: parsed.href, error: 'Host local bloqueado' };
  }
  if (net.isIP(hostname) && isPrivateIpAddress(hostname)) {
    return { ok: false, url: parsed.href, error: 'IP privado bloqueado' };
  }
  try {
    const lookups = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!lookups.length || lookups.some((r) => isPrivateIpAddress(r.address))) {
      return { ok: false, url: parsed.href, error: 'Host resolve para IP privado' };
    }
  } catch (err) {
    return { ok: false, url: parsed.href, error: `DNS falhou: ${err.message}` };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(parsed.href, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'AerionSalesBot/1.0 (+checklist-tecnico; commercial research)',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
      },
    });
    try {
      const finalUrl = new URL(res.url || parsed.href);
      if (net.isIP(finalUrl.hostname) && isPrivateIpAddress(finalUrl.hostname)) {
        return { ok: false, url: parsed.href, error: 'Redirect para IP privado bloqueado' };
      }
    } catch (_) { /* ignore */ }

    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok) {
      return { ok: false, url: parsed.href, error: `HTTP ${res.status}`, contentType };
    }
    if (contentType.includes('application/pdf') || parsed.pathname.toLowerCase().endsWith('.pdf')) {
      return {
        ok: false,
        url: parsed.href,
        error: 'PDF nao lido automaticamente — cole o texto da ficha no chat',
        contentType,
      };
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 2 * 1024 * 1024) {
      return { ok: false, url: parsed.href, error: 'Pagina maior que 2MB' };
    }
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const rawHtml = decoder.decode(buf);
    const isHtml = contentType.includes('html') || /<html[\s>]/i.test(rawHtml.slice(0, 500));
    let text = isHtml ? htmlToPlainText(rawHtml) : rawHtml;
    let notes = [];
    const accordionCollapsed = isHtml && /aria-expanded=["']false["']/i.test(rawHtml) && /specs-|Especifica/i.test(rawHtml);

    // Enriquecer com specs do JS (accordion SPA)
    if (isHtml && (accordionCollapsed || text.length < 15000 || /\/produtos\//i.test(parsed.pathname))) {
      const enriched = await enrichProductPageFromJsBundles(res.url || parsed.href, rawHtml, {
        timeoutMs: Math.max(8000, timeoutMs - 2000),
      });
      if (enriched.text) {
        text = `${text}\n\n${enriched.text}`;
        if (enriched.note) notes.push(enriched.note);
      } else if (enriched.note) {
        notes.push(enriched.note);
      } else if (accordionCollapsed) {
        notes.push('Pagina tem secoes de especificacoes colapsadas (accordion); HTML so traz marketing. Prefira colar ficha completa se a avaliacao ficar com muitos "?".');
      }
    }

    text = text.slice(0, maxChars);
    if (text.trim().length < 40) {
      return {
        ok: false,
        url: parsed.href,
        error: 'Pagina sem texto util (SPA ou bloqueio) — cole as specs no chat',
        chars: text.length,
        notes,
      };
    }
    return {
      ok: true,
      url: res.url || parsed.href,
      text,
      chars: text.length,
      contentType,
      notes,
      accordion_collapsed: !!accordionCollapsed,
    };
  } catch (err) {
    return {
      ok: false,
      url: parsed.href,
      error: err.name === 'AbortError' ? 'timeout ao ler pagina' : err.message,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const AUTEL_PRODUCT_BRIEF = `
Linhas Autel (Aerion) — apoio comercial (priorizar ficha/URL colada; se conflitar, a ficha ganha):
- EVO Lite Enterprise (640T/6K): compacto enterprise, ~40 min voo, termica 640x512 opcional. ~ DJI Mavic 3 Enterprise/Thermal.
- EVO Max V2 (4T/4N): cameras triplas, termica 640x512, 4T zoom optico ~10x / hibrido ate ~160x, voo ~42 min, transmissao ~15 km FCC / ~8 km CE, IP43, deteccao obstaculos 720°, RTK frequentemente modulo opcional. ~ Matrice 30T.
- Autel Alpha: IP55, zoom optico alto (~35x), termicas, laser, alcance estendido, ~40 min. ~ Matrice 350 RTK + payload.
- EVO Nest + Autel Mapper: dock/operacao remota + mapeamento.
`.trim();

const normalizeChecklistAiStatus = (value) => {
  if (value === true || value === 1) return 'ok';
  if (value === false || value === 0) return 'nao_ok';
  let s = String(value || '').trim().toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/\s+/g, ' ');
  if (!s) return 'verificar';
  // valores canônicos e sinônimos comuns da IA
  if (/^(ok|atende|atendido|conforme|compativel|sim|yes|pass|passed|true|cumpre|atende_requisito)$/i.test(s)) return 'ok';
  if (/^(nao_ok|nao ok|nao-ok|naoatende|nao atende|incompativel|nao conforme|x|fail|failed|false|reprova|reprovado|n)$/i.test(s)) return 'nao_ok';
  if (/^(verificar|pendente|duvida|incerto|\?|unknown|tbd|check)$/i.test(s)) return 'verificar';
  if (/\bok\b/.test(s) && !/nao/.test(s)) return 'ok';
  if (/nao\s*ok|nao\s*atend|incompat/.test(s)) return 'nao_ok';
  return 'verificar';
};

/** Lê status de campos alternativos que a IA às vezes usa no lugar de "status". */
const pickRequirementStatus = (row) => {
  if (!row || typeof row !== 'object') return 'verificar';
  const candidates = [
    row.status,
    row.avaliacao,
    row.resultado,
    row.conformidade,
    row.verdict,
    row.state,
    row.ok,
    row.atende,
  ];
  for (const c of candidates) {
    if (c === undefined || c === null || c === '') continue;
    // { status: true } / ok: true
    if (typeof c === 'boolean' || typeof c === 'number') {
      return normalizeChecklistAiStatus(c);
    }
    const n = normalizeChecklistAiStatus(c);
    if (n !== 'verificar' || /verificar|pendente|\?/i.test(String(c))) return n;
  }
  // "OK - 42 min" em observacao no início
  const obs = String(row.observacao || row.obs || '');
  if (/^\s*ok\b/i.test(obs)) return 'ok';
  if (/^\s*(nao_ok|não_ok|nao ok|x)\b/i.test(obs)) return 'nao_ok';
  return 'verificar';
};

const countProposalStatuses = (requirements = []) => {
  const list = Array.isArray(requirements) ? requirements : [];
  return {
    ok: list.filter((r) => r.status === 'ok').length,
    nao_ok: list.filter((r) => r.status === 'nao_ok').length,
    verificar: list.filter((r) => r.status === 'verificar' || r.status === 'pendente' || !r.status).length,
    total: list.length,
  };
};

const normalizeChecklistAiProposal = (raw, { max = 200 } = {}) => {
  if (!raw || typeof raw !== 'object') {
    return { mode_hint: 'replace', modelo_produto: null, requirements: [] };
  }
  // às vezes a IA devolve requirements na raiz
  const root = raw.proposal && typeof raw.proposal === 'object' ? raw.proposal : raw;
  const modeHint = ['replace', 'append', 'patch'].includes(root.mode_hint)
    ? root.mode_hint
    : (['replace', 'append', 'patch'].includes(raw.mode_hint) ? raw.mode_hint : 'replace');
  const modelo = root.modelo_produto != null
    ? toNullableText(root.modelo_produto)
    : (raw.modelo_produto != null ? toNullableText(raw.modelo_produto) : null);
  const list = Array.isArray(root.requirements)
    ? root.requirements
    : (Array.isArray(raw.requirements)
      ? raw.requirements
      : (Array.isArray(raw.items) ? raw.items : []));
  const requirements = [];
  for (let i = 0; i < list.length && requirements.length < max; i += 1) {
    const r = list[i] || {};
    const requisito = toNullableText(r.requisito || r.texto || r.descricao || r.requirement);
    if (!requisito) continue;
    requirements.push({
      id: r.id != null && Number.isFinite(Number(r.id)) ? Number(r.id) : null,
      secao: toNullableText(r.secao || r.section) || null,
      requisito,
      status: pickRequirementStatus(r),
      observacao: toNullableText(r.observacao || r.obs || r.motivo || r.justificativa) || '',
      valor_ofertado: r.valor_ofertado != null ? toNullableNumber(r.valor_ofertado) : null,
      ordem: i,
    });
  }
  return { mode_hint: modeHint, modelo_produto: modelo, requirements };
};

/** Segunda passagem: só status por id/índice (mais confiável que reescrever 80+ requisitos). */
const evaluateChecklistStatusesPass = async ({
  requirements,
  modelo,
  productContext,
  urlBlocks,
}) => {
  const compact = (requirements || []).map((r, index) => ({
    i: index,
    id: r.id,
    secao: r.secao || null,
    requisito: r.requisito,
  }));
  if (!compact.length) return { ok: false, error: 'sem requisitos' };

  const system = `Você avalia conformidade de requisitos de edital vs produto.
Responda SOMENTE JSON válido, sem markdown:
{"items":[{"i":0,"id":123,"status":"ok|nao_ok|verificar","observacao":"fonte curta"}]}

REGRAS:
- Um item por requisito da lista (mesma ordem / mesmo i).
- status EXATAMENTE: ok | nao_ok | verificar
- Use ok/nao_ok quando houver evidência na ficha/URL/modelo; verificar só se faltar dado.
- observacao: 1 linha com base (ex: "site: IP43 < IP54 exigido", "ficha: 42min >= 40min").
- NÃO invente requisitos. NÃO omita itens. Total items = ${compact.length}.
- Se o produto for EVO Max / Autel e a ficha trouxer números, JULGUE (não deixe tudo verificar).`;

  const user = `MODELO: ${modelo || '(não informado)'}

FONTES DO PRODUTO:
${productContext || '(sem texto extra)'}
${urlBlocks || ''}

REQUISITOS:
${JSON.stringify(compact)}`;

  const ai = await chatCompletionJson({
    system,
    user,
    maxTokens: Math.min(16000, Math.max(4000, compact.length * 80)),
    temperature: 0.05,
    timeoutMs: 120000,
  });
  if (!ai.ok) return { ok: false, error: ai.error };

  const items = Array.isArray(ai.data?.items)
    ? ai.data.items
    : (Array.isArray(ai.data?.requirements) ? ai.data.requirements : []);
  if (!items.length) return { ok: false, error: 'items vazio' };

  const byIndex = new Map();
  const byId = new Map();
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const status = pickRequirementStatus(it);
    const obs = toNullableText(it.observacao || it.obs || it.motivo) || '';
    if (it.i != null && Number.isFinite(Number(it.i))) byIndex.set(Number(it.i), { status, observacao: obs });
    if (it.id != null && Number.isFinite(Number(it.id))) byId.set(Number(it.id), { status, observacao: obs });
  }

  const merged = requirements.map((r, index) => {
    const hit = (r.id != null && byId.has(Number(r.id)))
      ? byId.get(Number(r.id))
      : byIndex.get(index);
    if (!hit) return r;
    return {
      ...r,
      status: hit.status,
      observacao: hit.observacao || r.observacao || '',
    };
  });
  return { ok: true, requirements: merged, provider: ai.provider, model: ai.model };
};

const normalizePorteCode = (value) => {
  const v = String(value || '').trim();
  if (['00', '01', '03', '05'].includes(v)) return v;
  const lower = v.toLowerCase();
  if (/micro/.test(lower)) return '01';
  if (/pequeno|epp/.test(lower)) return '03';
  if (/demais|grande|medio|médio/.test(lower)) return '05';
  return '';
};

const resolveCnaeCodes = async (rawCodes = [], rawLabels = []) => {
  const list = await getCNAEList().catch(() => []);
  const byCode = new Map(list.map((c) => [String(c.codigo).replace(/\D/g, ''), c]));
  const resolved = [];
  const seen = new Set();

  const pushCode = (raw, descHint = '') => {
    if (!raw) return;
    const digits = String(raw).replace(/\D/g, '');
    if (!digits || seen.has(digits)) return;
    // exact / prefix match on RFB list
    let hit = byCode.get(digits)
      || list.find((c) => String(c.codigo).replace(/\D/g, '').startsWith(digits.slice(0, 5)))
      || list.find((c) => digits.startsWith(String(c.codigo).replace(/\D/g, '').slice(0, 5)));
    if (!hit && descHint) {
      const q = stripAccents(descHint).toLowerCase();
      const words = q.split(/\s+/).filter((w) => w.length > 3).slice(0, 4);
      if (words.length) {
        hit = list.find((c) => {
          const d = stripAccents(c.descricao).toLowerCase();
          return words.every((w) => d.includes(w));
        });
      }
    }
    if (hit) {
      seen.add(String(hit.codigo).replace(/\D/g, ''));
      resolved.push({ codigo: hit.codigo, descricao: hit.descricao });
    } else if (raw) {
      // keep AI suggestion even if not in local table yet
      const pretty = String(raw).trim();
      if (!seen.has(pretty)) {
        seen.add(pretty);
        resolved.push({ codigo: pretty, descricao: descHint || pretty });
      }
    }
  };

  for (const label of rawLabels) {
    if (typeof label === 'string') pushCode(label, label);
    else if (label && typeof label === 'object') pushCode(label.codigo || label.code, label.descricao || label.desc || '');
  }
  for (const code of rawCodes) pushCode(code);

  return resolved.slice(0, 12);
};

// Tokens geográficos BR para validar UF só com evidência no texto dos trends (não na “imaginação” da IA).
// Impede erros tipo "Bavi" → Bahia por semelhança fonética.
const BR_UF_GEO_ALIASES = {
  AC: ['acre', 'rio branco'],
  AL: ['alagoas', 'maceio', 'maceió'],
  AP: ['amapa', 'amapá', 'macapa', 'macapá'],
  AM: ['amazonas', 'manaus'],
  BA: ['bahia', 'salvador', 'feira de santana'],
  CE: ['ceara', 'ceará', 'fortaleza'],
  DF: ['distrito federal', 'brasilia', 'brasília'],
  ES: ['espirito santo', 'espírito santo', 'vitoria', 'vitória'],
  GO: ['goias', 'goiás', 'goiania', 'goiânia'],
  MA: ['maranhao', 'maranhão', 'sao luis', 'são luís'],
  MT: ['mato grosso', 'cuiaba', 'cuiabá'],
  MS: ['mato grosso do sul', 'campo grande'],
  MG: ['minas gerais', 'belo horizonte', 'uberlandia', 'uberlândia'],
  PA: ['para ', ' pará', 'belem', 'belém'], // "para" is noisy; rely more on belem
  PB: ['paraiba', 'paraíba', 'joao pessoa', 'joão pessoa'],
  PR: ['parana', 'paraná', 'curitiba', 'londrina'],
  PE: ['pernambuco', 'recife', 'olinda'],
  PI: ['piaui', 'piauí', 'teresina'],
  RJ: ['rio de janeiro', 'niteroi', 'niterói'],
  RN: ['rio grande do norte', 'natal'],
  RS: ['rio grande do sul', 'porto alegre'],
  RO: ['rondonia', 'rondônia', 'porto velho'],
  RR: ['roraima', 'boa vista'],
  SC: ['santa catarina', 'florianopolis', 'florianópolis', 'joinville'],
  SP: ['sao paulo', 'são paulo', 'campinas', 'santos', 'guarulhos'],
  SE: ['sergipe', 'aracaju'],
  TO: ['tocantins', 'palmas'],
};

const buildTrendsGeoCorpus = (trends = []) => {
  const parts = [];
  for (const t of trends) {
    if (t?.title) parts.push(String(t.title));
    for (const n of t?.news || []) {
      if (n?.title) parts.push(String(n.title));
      if (n?.source) parts.push(String(n.source));
    }
  }
  return stripAccents(parts.join(' \n ')).toLowerCase();
};

/** UF só se o corpus dos trends citar estado/cidade de forma explícita — nunca por rima/substring do título. */
const ufHasGeographicEvidence = (uf, corpus) => {
  const code = String(uf || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || !corpus) return false;
  const aliases = BR_UF_GEO_ALIASES[code] || [];
  for (const alias of aliases) {
    const a = stripAccents(alias).toLowerCase().trim();
    if (!a) continue;
    if (a.length <= 3) {
      // short tokens need word-ish boundaries
      const re = new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
      if (re.test(corpus)) return true;
    } else if (corpus.includes(a)) {
      return true;
    }
  }
  // Sigla UF como token isolado (não casa "ba" dentro de "bavi")
  const codeRe = new RegExp(`(^|[^a-z0-9])${code.toLowerCase()}([^a-z0-9]|$)`);
  return codeRe.test(corpus);
};

const sanitizeUfAgainstTrends = (uf, corpus) => {
  const code = String(uf || '').trim().toUpperCase();
  if (!code) return { uf: '', grounded: true, stripped: false };
  // SOMENTE evidência no corpus dos trends (título + manchetes). geo_basis da IA NÃO conta.
  if (ufHasGeographicEvidence(code, corpus)) {
    return { uf: code, grounded: true, stripped: false };
  }
  return { uf: '', grounded: false, stripped: true };
};

/** Remove localidades inventadas no texto quando a UF foi invalidada. */
const scrubInventedGeographyText = (text = '') => {
  let out = String(text || '');
  // estados e macrorregiões BR (sem base nos trends → não devem aparecer na sugestão)
  out = out.replace(
    /\b(em|no|na|do|da|dos|das|pelo|pela)?\s*(estado d[oa]\s+)?(acre|alagoas|amapa|amapá|amazonas|bahia|ceara|ceará|distrito federal|espirito santo|espírito santo|goias|goiás|maranhao|maranhão|mato grosso do sul|mato grosso|minas gerais|paraiba|paraíba|parana|paraná|pernambuco|piaui|piauí|rio de janeiro|rio grande do norte|rio grande do sul|rondonia|rondônia|roraima|santa catarina|sao paulo|são paulo|sergipe|tocantins|para|pará)\b/gi,
    ''
  );
  out = out.replace(
    /\b(regi[oõ]es?\s+)?(norte|nordeste|sudeste|sul|centro[- ]oeste)(\s+e\s+(norte|nordeste|sudeste|sul|centro[- ]oeste))?\b/gi,
    ''
  );
  out = out.replace(
    /\b(UF\s*)?(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/g,
    ''
  );
  out = out.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
  return out;
};

const normalizeIntelSuggestions = async (rawIntel = {}, trendsPayload = {}) => {
  const suggestionsIn = Array.isArray(rawIntel.suggestions) ? rawIntel.suggestions : [];
  const geoCorpus = buildTrendsGeoCorpus(trendsPayload.trends || []);
  const suggestions = [];
  for (const s of suggestionsIn.slice(0, 6)) {
    const filtersIn = s.filters || s.filter || {};
    const cnaeResolved = await resolveCnaeCodes(
      filtersIn.cnae || filtersIn.cnaes || [],
      filtersIn.cnae_labels || filtersIn.cnaeLabels || s.cnaes || []
    );
    const ufsRaw = []
      .concat(filtersIn.uf || filtersIn.ufs || [])
      .flatMap((u) => String(u).split(/[,\s]+/))
      .map((u) => u.trim().toUpperCase())
      .filter((u) => /^[A-Z]{2}$/.test(u));
    // Also catch "Bahia" written as full name in uf field
    const ufNameHints = String(filtersIn.uf || filtersIn.estado || s.title || s.company_profile || '');
    // no-op: only 2-letter codes enter filters
    const geoBasis = s.geo_basis || s.geoBasis || s.geographic_evidence || '';
    const groundedUfs = [];
    let strippedAnyUf = false;
    for (const code of ufsRaw) {
      const check = sanitizeUfAgainstTrends(code, geoCorpus);
      if (check.uf) groundedUfs.push(check.uf);
      if (check.stripped) strippedAnyUf = true;
    }
    // If AI left uf empty but put "Bahia"/"Nordeste" only in title/profile without evidence → scrub text
    const titleRaw = String(s.title || s.nome || 'Sugestão de prospecção');
    const profileRaw = String(s.company_profile || s.perfil || '');
    const inventedGeoInCopy = (() => {
      const blob = stripAccents(`${titleRaw} ${profileRaw} ${s.rationale || ''}`);
      // macrorregião or state name without corpus evidence
      const regions = ['nordeste', 'sudeste', 'norte', 'centro oeste', 'centro-oeste', 'sul'];
      if (regions.some((r) => blob.includes(r) && !geoCorpus.includes(r))) return true;
      for (const [code, aliases] of Object.entries(BR_UF_GEO_ALIASES)) {
        for (const alias of aliases) {
          const a = stripAccents(alias).toLowerCase().trim();
          if (a.length < 4) continue;
          if (blob.includes(a) && !geoCorpus.includes(a) && !ufHasGeographicEvidence(code, geoCorpus)) {
            return true;
          }
        }
      }
      return false;
    })();
    const uf = groundedUfs[0] || '';
    const mustScrubGeo = strippedAnyUf || (uf === '' && inventedGeoInCopy);
    let title = titleRaw.slice(0, 120);
    let companyProfile = profileRaw.slice(0, 200);
    let rationale = String(s.rationale || s.motivo || s.why || '').slice(0, 500);
    if (mustScrubGeo) {
      title = scrubInventedGeographyText(title) || titleRaw.slice(0, 120);
      companyProfile = scrubInventedGeographyText(companyProfile);
      rationale = scrubInventedGeographyText(rationale);
      const note = 'Localidade removida: só usamos UF/região se o trend ou manchete citar explicitamente o lugar no Brasil (ex.: Bavi ≠ Bahia).';
      rationale = rationale ? `${rationale} ${note}` : note;
      rationale = rationale.slice(0, 560);
    }
    void ufNameHints;
    void geoBasis;
    const capitalMin = Number(filtersIn.capital_min ?? filtersIn.capitalMin ?? 0) || 0;
    const capitalMax = Number(filtersIn.capital_max ?? filtersIn.capitalMax ?? 0) || 0;
    const aberturaMin = Number(filtersIn.abertura_min_anos ?? filtersIn.aberturaMinAnos ?? filtersIn.age_min ?? 0) || 0;
    const aberturaMax = Number(filtersIn.abertura_max_anos ?? filtersIn.aberturaMaxAnos ?? filtersIn.age_max ?? 0) || 0;
    suggestions.push({
      title: (mustScrubGeo ? title : titleRaw).slice(0, 120) || 'Sugestão de prospecção',
      rationale,
      related_trends: (s.related_trends || s.trends || s.relatedTrends || []).map(String).slice(0, 6),
      priority: ['alta', 'media', 'baixa'].includes(String(s.priority || '').toLowerCase())
        ? String(s.priority).toLowerCase()
        : 'media',
      company_profile: companyProfile,
      product_fit: String(s.product_fit || s.produto || '').slice(0, 200),
      geo_basis: mustScrubGeo ? '' : String(geoBasis || '').slice(0, 200),
      geo_grounded: Boolean(uf),
      filters: {
        uf,
        ufs: groundedUfs.slice(0, 5),
        cnae: cnaeResolved.map((c) => c.codigo),
        cnae_labels: cnaeResolved,
        porte: normalizePorteCode(filtersIn.porte),
        capital_min: capitalMin,
        capital_max: capitalMax,
        abertura_min_anos: aberturaMin,
        abertura_max_anos: aberturaMax,
        situacao: Array.isArray(filtersIn.situacao) && filtersIn.situacao.length
          ? filtersIn.situacao.map(String)
          : ['2'],
        nome: String(filtersIn.nome || filtersIn.razao || '').slice(0, 80),
        only_matriz: filtersIn.only_matriz !== false && filtersIn.onlyMatriz !== false,
        mei: filtersIn.mei === 'S' || filtersIn.mei === true ? 'S' : (filtersIn.mei === 'N' ? 'N' : ''),
        simples: filtersIn.simples === 'S' || filtersIn.simples === true ? 'S' : (filtersIn.simples === 'N' ? 'N' : ''),
      },
    });
  }
  return {
    summary: String(rawIntel.summary || rawIntel.resumo || '').slice(0, 600),
    opportunity_day: String(rawIntel.opportunity_day || rawIntel.tema_do_dia || '').slice(0, 300),
    suggestions,
    trends_count: (trendsPayload.trends || []).length,
    trends_geo: TRENDS_GEO,
  };
};

const buildTrendsIntelWithAI = async (trendsPayload) => {
  const trendsForPrompt = (trendsPayload.trends || []).slice(0, 40).map((t, i) => ({
    rank: i + 1,
    title: t.title,
    kind: t.kind || null, // top | rising (pytrends) ou null (RSS)
    seed: t.seed || null,
    traffic: t.traffic,
    change: t.change || null,
    interest: t.interest ?? null,
    headlines: (t.news || []).map((n) => n.title).filter(Boolean).slice(0, 2),
  }));

  const src = String(trendsPayload.source || '');
  const isRelatedSource = /pytrends|related/i.test(src);
  const isNewsSector = /news_sector|google_news/i.test(src);
  const sourceNote = isRelatedSource
    ? `Fonte: Google Trends RELATED QUERIES (correlatos) geo=${TRENDS_GEO}, timeframe=${trendsPayload.timeframe || TRENDS_TIMEFRAME}.
Seeds do negócio Aerion: ${(trendsPayload.seeds || TRENDS_SEEDS).join(', ')}.
Cada item é correlato (top = mais frequente; rising = em alta) das buscas por esses termos no Brasil — NÃO é o ranking geral do país.
Exemplos reais de rising úteis: prova ANAC, RBAC, inspeção, topografia, enterprise — use como sinal de demanda B2B.`
    : isNewsSector
      ? `Fonte: Google News RSS setorial (geo=BR) para seeds: ${(trendsPayload.seeds || TRENDS_SEEDS).join(', ')}.
Cada item é manchete recente ligada a drones/enterprise/Autel no Brasil (Trends related estava indisponível/429).
Trate como temas quentes do setor e gere buscas RFB de ICPs compradores — não invente UF sem citação na manchete.`
      : `Fonte: Google Trends RSS "em alta" geo=${TRENDS_GEO} (último fallback — correlatos e news setorial indisponíveis).
São buscas gerais no Brasil; conecte só o que tiver ângulo B2B drones/ICP.`;

  const system = `Você é estrategista de prospecção B2B da Aerion Technologies (drones enterprise Autel no Brasil).
${AERION_PRODUCT_CONTEXT}

${sourceNote}

Sua tarefa: a partir dos correlatos/trends, sugerir BUSCAS práticas na base RFB (CNPJ) de empresas que possam comprar/usar drones enterprise, integradores ou canais.
Priorize rising (em alta) e temas ligados a construção, topografia, energia, inspeção industrial, segurança, agronegócio, infraestrutura e canais/revendas.
Concorrentes (DJI, Mavic, etc.) também são sinal de demanda de mercado — use para achar ICPs, não para copiar o produto.

## Geografia (CRÍTICO — zero alucinação de UF)
- Só preencha filters.uf se o TÍTULO ou as MANCHETES citarem explicitamente um estado, cidade ou região do BRASIL (ex.: "Bahia", "Salvador", "SP", "Minas Gerais").
- geo_basis deve copiar a frase literal que justifica a UF. Sem citação → filters.uf = "" (busca nacional).
- PROIBIDO inferir UF por semelhança fonética, rima, anagrama ou pedaço de nome.
- Evento/consulta sem local BR: escala nacional (uf:"").

## Outras regras
- Conecte correlatos a casos de uso reais (inspeção, mapeamento, segurança, energia, obras).
- Ignore fofoca/celebridade/esporte sem ângulo B2B.
- Filtros: CNAEs BR reais (0000-0/00), porte 01|03|05, capital e idade em números, situacao ["2"].
- Varie perfis (novas/maduras/grandes). Máximo 5 sugestões, prioridade alta primeiro.
- Responda SOMENTE JSON válido, sem markdown:
{
  "summary": "1-2 frases sobre o clima de busca do setor e o ângulo comercial",
  "opportunity_day": "tema comercial do dia em uma linha",
  "suggestions": [
    {
      "title": "rótulo curto da busca",
      "rationale": "por que isso agora (liga correlato → produto); se uf vazio diga que é nacional",
      "related_trends": ["trend1"],
      "priority": "alta|media|baixa",
      "company_profile": "perfil sem inventar estado",
      "product_fit": "qual linha Autel encaixa",
      "geo_basis": "trecho literal que cita o local BR, ou string vazia",
      "filters": {
        "uf": "",
        "cnae": ["4120-4/00"],
        "cnae_labels": [{"codigo":"4120-4/00","descricao":"..."}],
        "porte": "05",
        "capital_min": 500000,
        "capital_max": 0,
        "abertura_min_anos": 3,
        "abertura_max_anos": 25,
        "situacao": ["2"],
        "nome": "",
        "only_matriz": true,
        "mei": "",
        "simples": ""
      }
    }
  ]
}`;

  const user = `Correlatos Google Trends geo=${TRENDS_GEO} — ${brDayKey()}
source=${trendsPayload.source || 'unknown'}
seeds=${JSON.stringify(trendsPayload.seeds || TRENDS_SEEDS)}
items:
${JSON.stringify(trendsForPrompt, null, 2)}

Gere o JSON de inteligência comercial.`;

  const ai = await chatCompletionJson({ system, user, maxTokens: 2500, temperature: 0.2 });
  if (!ai.ok) {
    // Fallback determinístico se IA cair: 3 buscas ICP clássicas
    const fallback = {
      summary: 'IA indisponível no momento. Sugestões padrão dos ICPs Aerion com base em prospecção recorrente.',
      opportunity_day: 'Prospecção ICP padrão (fallback)',
      suggestions: [
        {
          title: 'Construtoras e topografia (SP/MG/PR)',
          rationale: 'ICP 1 — obras e topografia recorrente; alto fit para EVO Lite / Max RTK.',
          related_trends: [],
          priority: 'alta',
          company_profile: 'Construtoras e topografia com capital relevante',
          product_fit: 'EVO Lite Enterprise / EVO Max 4T',
          filters: {
            uf: 'SP',
            cnae: ['4120-4/00', '7111-1/00', '4211-1/01'],
            porte: '05',
            capital_min: 1000000,
            abertura_min_anos: 2,
            situacao: ['2'],
            only_matriz: true,
          },
        },
        {
          title: 'Energia e inspeção de ativos',
          rationale: 'ICP 2 — inspeção de linhas, parques e plantas industriais.',
          related_trends: [],
          priority: 'alta',
          company_profile: 'Empresas de energia/manutenção com operação em área',
          product_fit: 'Autel Alpha / EVO Max 4T',
          filters: {
            uf: 'MG',
            cnae: ['3511-5/01', '3514-0/00', '7112-0/00'],
            porte: '05',
            capital_min: 2000000,
            abertura_min_anos: 5,
            situacao: ['2'],
            only_matriz: true,
          },
        },
        {
          title: 'Segurança privada e integradores',
          rationale: 'ICP 3/canal — segurança e integradores que operam com tecnologia de campo.',
          related_trends: [],
          priority: 'media',
          company_profile: 'Segurança privada e integração de sistemas',
          product_fit: 'Autel Alpha / EVO Max',
          filters: {
            uf: 'RJ',
            cnae: ['8011-1/01', '8020-0/01', '6201-5/01'],
            porte: '03',
            capital_min: 200000,
            abertura_min_anos: 1,
            abertura_max_anos: 15,
            situacao: ['2'],
            only_matriz: true,
          },
        },
      ],
    };
    const intel = await normalizeIntelSuggestions(fallback, trendsPayload);
    return {
      intel,
      ai: { provider: null, model: null, fallback: true, error: ai.error },
    };
  }

  const intel = await normalizeIntelSuggestions(ai.data, trendsPayload);
  return {
    intel,
    ai: { provider: ai.provider, model: ai.model, fallback: false },
  };
};

const createTrendsIntelTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trends_intel_cache (
      day_key TEXT PRIMARY KEY,
      geo TEXT NOT NULL DEFAULT 'BR',
      trends_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      intel_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
};

const loadTrendsIntelFromDb = async (dayKey) => {
  try {
    const { rows } = await pool.query(
      `SELECT day_key, geo, trends_json, intel_json, meta_json, updated_at
       FROM trends_intel_cache WHERE day_key = $1`,
      [dayKey]
    );
    if (!rows[0]) return null;
    const row = rows[0];
    return {
      dayKey: row.day_key,
      geo: row.geo,
      trends: row.trends_json,
      intel: row.intel_json,
      meta: row.meta_json || {},
      updatedAt: row.updated_at,
    };
  } catch (err) {
    console.warn('[trends-intel] load db:', err.message);
    return null;
  }
};

const saveTrendsIntelToDb = async (payload) => {
  try {
    await pool.query(
      `INSERT INTO trends_intel_cache (day_key, geo, trends_json, intel_json, meta_json, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, NOW())
       ON CONFLICT (day_key) DO UPDATE SET
         trends_json = EXCLUDED.trends_json,
         intel_json = EXCLUDED.intel_json,
         meta_json = EXCLUDED.meta_json,
         updated_at = NOW()`,
      [
        payload.dayKey,
        payload.geo || TRENDS_GEO,
        JSON.stringify(payload.trends || []),
        JSON.stringify(payload.intel || {}),
        JSON.stringify(payload.meta || {}),
      ]
    );
  } catch (err) {
    console.warn('[trends-intel] save db:', err.message);
  }
};

const reSanitizeCachedIntel = async (intel, trends) => {
  try {
    return await normalizeIntelSuggestions(intel || {}, { trends: trends || [] });
  } catch (err) {
    console.warn('[trends-intel] re-sanitize failed:', err.message);
    return intel;
  }
};

const buildTrendsIntelPayload = async ({ force = false } = {}) => {
  const dayKey = brDayKey();

  // Cache do dia: memória → DB. force=true só regenera se o cliente pedir explicitamente
  // (UI normal NÃO força; 1ª abertura do dia gera e mantém até o dia seguinte).
  const serveCached = async (raw, cacheLabel) => {
    const intel = await reSanitizeCachedIntel(raw.intel, raw.trends);
    const payload = {
      day: raw.day || raw.dayKey || dayKey,
      geo: raw.geo || TRENDS_GEO,
      trends: raw.trends || [],
      intel,
      meta: {
        ...(raw.meta || {}),
        updatedAt: raw.meta?.updatedAt || raw.updatedAt || null,
        geoSanitized: true,
        dailyCache: true,
      },
      cached: true,
      cache: cacheLabel,
    };
    trendsIntelMemory = { dayKey, payload, updatedAt: Date.now() };
    return payload;
  };

  // Cache genérico do país (RSS) não serve se queremos radar setorial por seeds — regenera 1×.
  const cacheIsUsableSector = (meta) => {
    if (!TRENDS_SEEDS.length) return true;
    return isSectorTrendsSource(meta?.source);
  };

  if (!force && trendsIntelMemory?.dayKey === dayKey && trendsIntelMemory.payload) {
    if (cacheIsUsableSector(trendsIntelMemory.payload.meta)) {
      return serveCached(trendsIntelMemory.payload, 'memory');
    }
    console.log('[trends-intel] cache memória é RSS geral — regenerando setorial');
  }

  if (!force) {
    const fromDb = await loadTrendsIntelFromDb(dayKey);
    if (fromDb && cacheIsUsableSector(fromDb.meta)) {
      const payload = await serveCached(
        {
          day: fromDb.dayKey,
          geo: fromDb.geo,
          trends: fromDb.trends,
          intel: fromDb.intel,
          meta: fromDb.meta || {},
          updatedAt: fromDb.updatedAt,
        },
        'db'
      );
      await saveTrendsIntelToDb({
        dayKey,
        geo: payload.geo,
        trends: payload.trends,
        intel: payload.intel,
        meta: payload.meta,
      });
      return payload;
    }
    if (fromDb && !cacheIsUsableSector(fromDb.meta)) {
      console.log('[trends-intel] cache DB é RSS geral — regenerando setorial');
    }
  }

  if (trendsIntelRefreshRunning) {
    // Espera a geração em andamento (1ª abertura do dia por outro request)
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      if (!trendsIntelRefreshRunning && trendsIntelMemory?.dayKey === dayKey && trendsIntelMemory.payload) {
        return { ...trendsIntelMemory.payload, cached: true, cache: 'memory' };
      }
    }
    // Se ainda rodando após 60s, tenta DB
    const fromDb = await loadTrendsIntelFromDb(dayKey);
    if (fromDb) {
      return serveCached(
        {
          day: fromDb.dayKey,
          geo: fromDb.geo,
          trends: fromDb.trends,
          intel: fromDb.intel,
          meta: fromDb.meta || {},
          updatedAt: fromDb.updatedAt,
        },
        'db'
      );
    }
  }

  trendsIntelRefreshRunning = true;
  try {
    const trendsPayload = await fetchGoogleTrendsDaily();
    const { intel, ai } = await buildTrendsIntelWithAI(trendsPayload);
    const payload = {
      day: dayKey,
      geo: trendsPayload.geo,
      trends: trendsPayload.trends,
      intel,
      meta: {
        source: trendsPayload.source,
        fetchedAt: trendsPayload.fetchedAt,
        timeframe: trendsPayload.timeframe || TRENDS_TIMEFRAME,
        seeds: trendsPayload.seeds || TRENDS_SEEDS,
        by_seed: trendsPayload.by_seed || {},
        pytrends_error: trendsPayload.pytrends_error || null,
        partial_errors: trendsPayload.partial_errors || [],
        ai,
        updatedAt: new Date().toISOString(),
        dailyCache: true,
      },
      cached: false,
      cache: 'fresh',
    };
    trendsIntelMemory = { dayKey, payload, updatedAt: Date.now() };
    await saveTrendsIntelToDb({
      dayKey,
      geo: payload.geo,
      trends: payload.trends,
      intel: payload.intel,
      meta: payload.meta,
    });
    console.log(
      `[trends-intel] refreshed day=${dayKey} source=${trendsPayload.source} trends=${payload.trends.length} suggestions=${intel.suggestions?.length || 0} ai=${ai.provider || 'fallback'}`
    );
    return payload;
  } finally {
    trendsIntelRefreshRunning = false;
  }
};

const loadTrendsIntelCacheOnly = async () => {
  const dayKey = brDayKey();
  let raw = null;
  let cache = 'memory';

  if (trendsIntelMemory?.dayKey === dayKey && trendsIntelMemory.payload) {
    raw = trendsIntelMemory.payload;
  } else {
    const fromDb = await loadTrendsIntelFromDb(dayKey);
    if (fromDb) {
      raw = {
        day: fromDb.dayKey,
        geo: fromDb.geo,
        trends: fromDb.trends,
        intel: fromDb.intel,
        meta: fromDb.meta || {},
        updatedAt: fromDb.updatedAt,
      };
      cache = 'db';
    }
  }

  if (!raw || (TRENDS_SEEDS.length && !isSectorTrendsSource(raw.meta?.source))) return null;
  const intel = await reSanitizeCachedIntel(raw.intel, raw.trends);
  const payload = {
    day: raw.day || raw.dayKey || dayKey,
    geo: raw.geo || TRENDS_GEO,
    trends: raw.trends || [],
    intel,
    meta: {
      ...(raw.meta || {}),
      updatedAt: raw.meta?.updatedAt || raw.updatedAt || null,
      geoSanitized: true,
      dailyCache: true,
    },
    cached: true,
    cache,
  };
  trendsIntelMemory = { dayKey, payload, updatedAt: Date.now() };
  return payload;
};

// GET /api/trends/intel — cache do dia; gera só se faltar (1ª abertura do dia)
// ?force=1 regenera (admin/debug); UI normal não usa force.
app.get('/api/trends/intel', async (req, res) => {
  try {
    const force = String(req.query.force || req.query.refresh || '') === '1';
    const asyncMode = String(req.query.async || '') === '1';
    if (asyncMode) {
      const cached = force ? null : await loadTrendsIntelCacheOnly();
      if (cached) {
        res.json(cached);
        return;
      }
      if (!trendsIntelRefreshRunning) {
        void buildTrendsIntelPayload({ force }).catch((err) => {
          console.error('[trends-intel] background refresh error:', err);
        });
      }
      res.status(202).json({
        status: 'processing',
        day: brDayKey(),
        retry_after_ms: 2500,
      });
      return;
    }
    const payload = await buildTrendsIntelPayload({ force });
    res.json(payload);
  } catch (err) {
    console.error('[trends-intel] GET error:', err);
    res.status(500).json({ error: err.message || 'Falha ao obter inteligência de trends' });
  }
});

// POST /api/trends/intel/refresh — por padrão devolve cache do dia (não re-consulta pytrends).
// Body/query force=1 para regenerar de verdade.
app.post('/api/trends/intel/refresh', async (req, res) => {
  try {
    const force = String(req.query.force || req.body?.force || '') === '1'
      || req.body?.force === true;
    const payload = await buildTrendsIntelPayload({ force });
    res.json(payload);
  } catch (err) {
    console.error('[trends-intel] refresh error:', err);
    res.status(500).json({ error: err.message || 'Falha ao atualizar trends' });
  }
});

// ============================================================
// FIM BUSCA LEADS
// ============================================================

// ============================================================
// RFB LOCAL — dados abertos da Receita Federal
// ============================================================

// In-memory import progress state
let rfbImportState = {
  status: 'idle', // idle | running | done | error
  message: '',
  file: '',
  percent: 0,
  records: 0,
  error: '',
  startedAt: null,
};

const isEnvFlagEnabled = (value) => {
  if (value === undefined || value === null) return false;
  return !['', '0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
};

let rfbUpdateCheckRunning = false;

async function recordRFBImportStart(modeLabel, notes) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO rfb_import_log (status, notes) VALUES ('running', $1) RETURNING id`,
      [`${modeLabel}${notes ? ` | ${notes}` : ''}`]
    );
    return rows[0]?.id || null;
  } catch (e) {
    console.warn('[rfb] Falha ao registrar início do import:', e.message);
    return null;
  }
}

async function recordRFBImportFinish(logId, status, notes = '') {
  if (!logId) return;
  try {
    await pool.query(
      `UPDATE rfb_import_log
       SET finished_at = NOW(), status = $2, notes = CONCAT(COALESCE(notes, ''), $3)
       WHERE id = $1`,
      [logId, status, notes ? ` | ${notes}` : '']
    );
  } catch (e) {
    console.warn('[rfb] Falha ao registrar fim do import:', e.message);
  }
}

function startRFBImport({ force = false, staging = false, append = false, reason = '' } = {}) {
  if (rfbImportState.status === 'running') return false; // already running
  const modeLabel = staging ? 'staging (zero-downtime)' : force ? 'completo (force)' : append ? 'append (gap-fill)' : 'incremental';
  rfbImportState = { status: 'running', message: `Iniciando importação ${modeLabel}...`, file: '', percent: 0, records: 0, error: '', startedAt: new Date().toISOString() };
  const importLogPromise = recordRFBImportStart(modeLabel, reason);

  const scriptPath = path.join(__dirname, 'scripts', 'rfb_import.py');
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  const args = [scriptPath];
  if (force) args.push('--force');
  if (staging) args.push('--staging');
  if (append) args.push('--append');
  const py = spawn(pythonCmd, args, {
    env: { ...process.env },
    cwd: path.join(__dirname, 'scripts'),
  });

  let buf = '';
  py.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop(); // keep incomplete line
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        rfbImportState = {
          status: msg.status === 'done' ? 'done' : msg.status === 'error' ? 'error' : 'running',
          message: msg.message || '',
          file: msg.file || '',
          percent: msg.percent || 0,
          records: msg.records || 0,
          error: msg.error || '',
          startedAt: rfbImportState.startedAt,
        };
      } catch (_) {
        // non-JSON stdout line, ignore
      }
    }
  });

  py.stderr.on('data', (chunk) => {
    console.error('[rfb_import]', chunk.toString());
  });

  py.on('close', (code) => {
    if (rfbImportState.status !== 'done' && rfbImportState.status !== 'error') {
      rfbImportState.status = code === 0 ? 'done' : 'error';
      rfbImportState.message = code === 0 ? 'Import concluído!' : `Import falhou (código ${code})`;
    }
    // invalidate caches so new data is reflected
    _rfbMunicipiosCache = null;
    _rfbCnaesCache = null;
    _rfbNaturezasCache = null;
    const failed = rfbImportState.status === 'error' || code !== 0;
    importLogPromise.then((importLogId) => recordRFBImportFinish(
      importLogId,
      failed ? 'error' : 'done',
      `code=${code}; records=${rfbImportState.records || 0}; message=${rfbImportState.message || ''}`
    ));
    console.log('[rfb_import] finished with code', code);
    notifyAccountUsers(pool, {
      accountId: CHATWOOT_ACCOUNT_ID,
      type: failed ? 'dados.rfb_import_failed' : 'dados.rfb_import_done',
      title: failed ? 'Import RFB falhou' : 'Import RFB concluído',
      body: failed
        ? String(rfbImportState.error || rfbImportState.message || `código ${code}`).slice(0, 200)
        : `${Number(rfbImportState.records || 0).toLocaleString('pt-BR')} registro(s) processados.`,
      data: { view: 'Busca Lead B2B', records: rfbImportState.records || 0 },
      dedupeKey: `rfb:${failed ? 'err' : 'ok'}:${rfbImportState.startedAt || Date.now()}`,
    }).catch((err) => console.warn('[rfb] notify import failed:', err.message));
  });

  py.on('error', (err) => {
    rfbImportState.status = 'error';
    rfbImportState.error = err.message;
    rfbImportState.message = `Falha ao iniciar script: ${err.message}`;
    importLogPromise.then((importLogId) => recordRFBImportFinish(importLogId, 'error', `spawn=${err.message}`));
    console.error('[rfb_import] spawn error:', err);
    notifyAccountUsers(pool, {
      accountId: CHATWOOT_ACCOUNT_ID,
      type: 'dados.rfb_import_failed',
      title: 'Import RFB falhou',
      body: String(err.message || 'spawn error').slice(0, 200),
      data: { view: 'Busca Lead B2B' },
      dedupeKey: `rfb:spawn:${Date.now()}`,
    }).catch(() => {});
  });

  return true;
}

function runRFBUpdateCheck() {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'scripts', 'rfb_import.py');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const py = spawn(pythonCmd, [scriptPath, '--check-updates'], {
      env: { ...process.env },
      cwd: path.join(__dirname, 'scripts'),
    });
    let stdout = '';
    let stderr = '';

    py.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    py.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    py.on('error', reject);
    py.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || `rfb update check failed with code ${code}`));
      }
      const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
      const parsed = lines.map((line) => {
        try { return JSON.parse(line); } catch (_) { return null; }
      }).filter(Boolean);
      const result = parsed.reverse().find((msg) => msg.type === 'rfb_update_check') || parsed.pop();
      if (!result) {
        return reject(new Error('rfb update check did not return JSON'));
      }
      resolve(result);
    });
  });
}

async function checkAndStartRFBImport(reason = 'scheduled-check') {
  if (rfbImportState.status === 'running' || rfbUpdateCheckRunning) return;
  rfbUpdateCheckRunning = true;
  try {
    const result = await runRFBUpdateCheck();
    if (!result.has_updates) {
      console.log(`[rfb] Base local atualizada (${reason}). remote=${result.remote_files}, tracked=${result.tracked_files}`);
      return;
    }
    const append = result.suggested_mode === 'append';
    const details = `missing=${result.missing_count || 0}; changed=${result.changed_count || 0}`;
    console.log(`[rfb] Atualização detectada (${reason}): ${details}; modo=${append ? 'append' : 'incremental'}`);
    startRFBImport({ append, reason: `${reason}; ${details}` });
  } catch (e) {
    console.error(`[rfb] Erro na checagem de atualização (${reason}):`, e.message);
  } finally {
    rfbUpdateCheckRunning = false;
  }
}

const createRFBTables = async () => {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS unaccent`).catch(() => {});
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`).catch(() => {});
  // Wrapper imutável necessário para índices de expressão com unaccent
  await pool.query(`
    CREATE OR REPLACE FUNCTION immutable_unaccent(text)
    RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
      SELECT public.unaccent($1);
    $$
  `).catch(() => {});
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rfb_empresas (
      cnpj_basico TEXT PRIMARY KEY,
      razao_social TEXT,
      natureza_juridica TEXT,
      qualificacao_do_responsavel TEXT,
      capital_social TEXT,
      porte_da_empresa TEXT,
      ente_federativo_responsavel TEXT
    );
    CREATE TABLE IF NOT EXISTS rfb_estabelecimentos (
      cnpj_basico TEXT,
      cnpj_ordem TEXT,
      cnpj_dv TEXT,
      identificador_matriz_filial TEXT,
      nome_fantasia TEXT,
      situacao_cadastral TEXT,
      data_situacao_cadastral TEXT,
      motivo_situacao_cadastral TEXT,
      nome_da_cidade_no_exterior TEXT,
      pais TEXT,
      data_de_inicio_da_atividade TEXT,
      cnae_fiscal_principal TEXT,
      cnae_fiscal_secundaria TEXT,
      tipo_de_logradouro TEXT,
      logradouro TEXT,
      numero TEXT,
      complemento TEXT,
      bairro TEXT,
      cep TEXT,
      uf TEXT,
      municipio TEXT,
      ddd1 TEXT, telefone1 TEXT,
      ddd2 TEXT, telefone2 TEXT,
      ddd_do_fax TEXT, fax TEXT,
      correio_eletronico TEXT,
      situacao_especial TEXT,
      data_da_situacao_especial TEXT,
      PRIMARY KEY (cnpj_basico, cnpj_ordem, cnpj_dv)
    );
    CREATE TABLE IF NOT EXISTS rfb_socios (
      cnpj_basico TEXT,
      identificador_de_socio TEXT,
      nome_do_socio TEXT,
      cnpj_ou_cpf_do_socio TEXT,
      qualificacao_do_socio TEXT,
      data_de_entrada_sociedade TEXT,
      pais TEXT,
      representante_legal TEXT,
      nome_do_representante TEXT,
      qualificacao_do_representante_legal TEXT,
      faixa_etaria TEXT
    );
    CREATE TABLE IF NOT EXISTS rfb_simples (
      cnpj_basico TEXT PRIMARY KEY,
      opcao_pelo_simples TEXT,
      data_opcao_simples TEXT,
      data_exclusao_simples TEXT,
      opcao_pelo_mei TEXT,
      data_opcao_mei TEXT,
      data_exclusao_mei TEXT
    );
    CREATE TABLE IF NOT EXISTS rfb_municipios (
      codigo TEXT PRIMARY KEY,
      descricao TEXT
    );
    CREATE TABLE IF NOT EXISTS rfb_cnaes (
      codigo TEXT PRIMARY KEY,
      descricao TEXT
    );
    CREATE TABLE IF NOT EXISTS rfb_natureza (
      codigo TEXT PRIMARY KEY,
      descricao TEXT
    );
    CREATE TABLE IF NOT EXISTS rfb_qualificacoes (
      codigo TEXT PRIMARY KEY,
      descricao TEXT
    );
    CREATE TABLE IF NOT EXISTS rfb_paises (
      codigo TEXT PRIMARY KEY,
      descricao TEXT
    );
    CREATE TABLE IF NOT EXISTS rfb_motivos (
      codigo TEXT PRIMARY KEY,
      descricao TEXT
    );
    CREATE TABLE IF NOT EXISTS rfb_import_log (
      id SERIAL PRIMARY KEY,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      status TEXT,
      records_empresas BIGINT DEFAULT 0,
      records_estabelecimentos BIGINT DEFAULT 0,
      dev_limit INTEGER,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS rfb_arquivos (
      filename TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      remote_size BIGINT NOT NULL,
      records BIGINT NOT NULL DEFAULT 0,
      imported_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  // Índices críticos — criados em background para não bloquear o startup
  setImmediate(async () => {
    const criticalIndexes = [
      `CREATE INDEX IF NOT EXISTS idx_rfb_est_ordem ON rfb_estabelecimentos(cnpj_ordem)`,
      `CREATE INDEX IF NOT EXISTS idx_rfb_est_basico ON rfb_estabelecimentos(cnpj_basico)`,
      `CREATE INDEX IF NOT EXISTS idx_rfb_socios_basico ON rfb_socios(cnpj_basico)`,
    ];
    for (const idx of criticalIndexes) {
      const name = idx.match(/idx_rfb_\w+/)?.[0] || '?';
      try {
        await pool.query(idx);
        console.log(`[rfb] Índice ${name} OK`);
      } catch (e) {
        console.log(`[rfb] Índice ${name}: ${e.message}`);
      }
    }
  });
};

// Cache em memória para listas de referência
let _rfbMunicipiosCache = null;
let _rfbCnaesCache = null;
let _rfbNaturezasCache = null;

// GET /api/rfb/status
app.get('/api/rfb/status', async (req, res) => {
  try {
    // COUNT(*) em tabelas grandes é muito lento — usar estimativa do catálogo do PG
    const fastCount = (table) =>
      pool.query(`SELECT reltuples::BIGINT AS count FROM pg_class WHERE relname = $1`, [table]);
    const [logRow, empCount, estCount, simCount, socCount, cnaeCount, munCount] = await Promise.all([
      pool.query(`SELECT * FROM rfb_import_log WHERE status = 'done' ORDER BY finished_at DESC LIMIT 1`),
      fastCount('rfb_empresas'),
      fastCount('rfb_estabelecimentos'),
      fastCount('rfb_simples'),
      fastCount('rfb_socios'),
      pool.query(`SELECT COUNT(*) FROM rfb_cnaes`),
      pool.query(`SELECT COUNT(*) FROM rfb_municipios`),
    ]);
    const last = logRow.rows[0];
    const empresas = parseInt(empCount.rows[0].count, 10);
    const estabelecimentos = parseInt(estCount.rows[0].count, 10);
    res.json({
      imported: estabelecimentos > 0,
      last_import: last?.finished_at || null,
      dev_limit: last?.dev_limit ?? null,
      records: {
        empresas,
        estabelecimentos,
        socios: Math.max(0, parseInt(socCount.rows[0].count, 10)),
        simples: parseInt(simCount.rows[0].count, 10),
        cnaes: parseInt(cnaeCount.rows[0].count, 10),
        municipios: parseInt(munCount.rows[0].count, 10),
      },
    });
  } catch (err) {
    res.json({ imported: false, error: err.message });
  }
});

// GET /api/rfb/municipios — com ?uf=XX filtra municípios daquela UF
app.get('/api/rfb/municipios', async (req, res) => {
  try {
    const { uf } = req.query;
    if (uf && uf.trim()) {
      // Aceita tanto sigla (SP) quanto código numérico (25) — converte para ambos
      const ufSigla = uf.trim().toUpperCase();
      const ufNumMap = { AC:'01',AL:'02',AP:'03',AM:'04',BA:'05',CE:'06',DF:'07',ES:'08',GO:'09',MA:'10',MT:'11',MS:'12',MG:'13',PA:'14',PB:'15',PR:'16',PE:'17',PI:'18',RJ:'19',RN:'20',RS:'21',RO:'22',RR:'23',SC:'24',SP:'25',SE:'26',TO:'27' };
      const ufCod = ufNumMap[ufSigla] || ufSigla;
      const r = await pool.query(`
        SELECT DISTINCT e.municipio AS codigo, m.descricao
        FROM rfb_estabelecimentos e
        JOIN rfb_municipios m ON e.municipio = m.codigo
        WHERE e.uf IN ($1, $2)
        ORDER BY m.descricao
      `, [ufSigla, ufCod]);
      return res.json(r.rows);
    }
    if (!_rfbMunicipiosCache) {
      const r = await pool.query('SELECT codigo, descricao FROM rfb_municipios ORDER BY descricao');
      _rfbMunicipiosCache = r.rows;
    }
    res.json(_rfbMunicipiosCache);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rfb/cnaes
app.get('/api/rfb/cnaes', async (req, res) => {
  try {
    if (!_rfbCnaesCache) {
      const r = await pool.query('SELECT codigo, descricao FROM rfb_cnaes ORDER BY codigo');
      _rfbCnaesCache = r.rows;
    }
    res.json(_rfbCnaesCache);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rfb/naturezas
app.get('/api/rfb/naturezas', async (req, res) => {
  try {
    if (!_rfbNaturezasCache) {
      const r = await pool.query('SELECT codigo, descricao FROM rfb_natureza ORDER BY codigo');
      _rfbNaturezasCache = r.rows;
    }
    res.json(_rfbNaturezasCache);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rfb/cnpj/:cnpj — lookup completo por CNPJ (14 dígitos)
app.get('/api/rfb/cnpj/:cnpj', async (req, res) => {
  try {
    const cnpj = String(req.params.cnpj).replace(/\D/g, '').padStart(14, '0').slice(-14);
    const basico = cnpj.slice(0, 8);
    const ordem  = cnpj.slice(8, 12);
    const dv     = cnpj.slice(12, 14);

    const [estRow, sociosRow] = await Promise.all([
      pool.query(`
        SELECT e.*, emp.razao_social, emp.capital_social, emp.porte_da_empresa, emp.natureza_juridica,
               m.descricao AS municipio_nome, c.descricao AS cnae_descricao,
               s.opcao_pelo_simples, s.opcao_pelo_mei,
               (SELECT json_agg(json_build_object('codigo', c2.codigo, 'descricao', c2.descricao) ORDER BY c2.codigo)
                FROM rfb_cnaes c2
                WHERE c2.codigo = ANY(string_to_array(NULLIF(TRIM(e.cnae_fiscal_secundaria), ''), ','))) AS cnaes_secundarios
        FROM rfb_estabelecimentos e
        JOIN rfb_empresas emp ON e.cnpj_basico = emp.cnpj_basico
        LEFT JOIN rfb_municipios m ON e.municipio = m.codigo
        LEFT JOIN rfb_cnaes c ON e.cnae_fiscal_principal = c.codigo
        LEFT JOIN rfb_simples s ON e.cnpj_basico = s.cnpj_basico
        WHERE e.cnpj_basico = $1 AND e.cnpj_ordem = $2 AND e.cnpj_dv = $3
        LIMIT 1
      `, [basico, ordem, dv]),
      pool.query('SELECT * FROM rfb_socios WHERE cnpj_basico = $1', [basico]),
    ]);

    if (estRow.rows.length === 0) return res.status(404).json({ error: 'CNPJ não encontrado na base local.' });

    const e = estRow.rows[0];
    res.json({ ...e, socios: sociosRow.rows, source: 'rfb_local' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rfb/cnpj-enrich/:cnpj — busca CNPJ na API pública e faz upsert local
// Resolve gap: CNPJs em rfb_empresas mas ausentes em rfb_estabelecimentos
app.post('/api/rfb/cnpj-enrich/:cnpj', async (req, res) => {
  try {
    const cnpj   = String(req.params.cnpj).replace(/\D/g, '').padStart(14, '0').slice(-14);
    const basico = cnpj.slice(0, 8);
    const ordem  = cnpj.slice(8, 12);
    const dv     = cnpj.slice(12, 14);

    const apiRes = await fetch(`https://publica.cnpj.ws/cnpj/${cnpj}`, {
      headers: { 'User-Agent': 'kanban-dashboard/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!apiRes.ok) return res.status(404).json({ error: `CNPJ não encontrado na Receita Federal (${apiRes.status})` });
    const api = await apiRes.json();
    const est = api.estabelecimento;
    if (!est) return res.status(404).json({ error: 'Dados de estabelecimento ausentes na resposta da API' });

    const SIT_MAP = { Ativa: '02', Baixada: '08', Suspensa: '03', Inapta: '04', Nula: '01' };
    const fmtDate = d => d ? d.replace(/-/g, '') : null;
    const sit = SIT_MAP[est.situacao_cadastral] || est.situacao_cadastral;
    const idMatFil = est.tipo === 'Matriz' ? '1' : '2';
    const cnaeSec = (est.atividades_secundarias || []).map(a => a.id).join(',') || null;

    // Resolve código do município a partir do nome
    const munRow = await pool.query(
      `SELECT codigo FROM rfb_municipios WHERE immutable_unaccent(lower(descricao)) = immutable_unaccent(lower($1)) LIMIT 1`,
      [est.cidade?.nome || '']
    );
    const munCod = munRow.rows[0]?.codigo || null;

    const client = await pool.connect();
    try {
      // Upsert rfb_empresas (garante razao_social atualizada)
      await client.query(`
        INSERT INTO rfb_empresas (cnpj_basico, razao_social, natureza_juridica, capital_social, porte_da_empresa)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (cnpj_basico) DO UPDATE SET
          razao_social = EXCLUDED.razao_social,
          natureza_juridica = EXCLUDED.natureza_juridica,
          capital_social = EXCLUDED.capital_social,
          porte_da_empresa = EXCLUDED.porte_da_empresa
      `, [basico, api.razao_social, api.natureza_juridica?.id, api.capital_social, api.porte?.id]);

      // Upsert rfb_estabelecimentos
      await client.query(`
        INSERT INTO rfb_estabelecimentos (
          cnpj_basico, cnpj_ordem, cnpj_dv, identificador_matriz_filial,
          nome_fantasia, situacao_cadastral, data_situacao_cadastral,
          data_de_inicio_da_atividade, cnae_fiscal_principal, cnae_fiscal_secundaria,
          tipo_de_logradouro, logradouro, numero, complemento, bairro, cep,
          uf, municipio, ddd1, telefone1, ddd2, telefone2, correio_eletronico
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        ON CONFLICT (cnpj_basico, cnpj_ordem, cnpj_dv) DO UPDATE SET
          nome_fantasia = EXCLUDED.nome_fantasia,
          situacao_cadastral = EXCLUDED.situacao_cadastral,
          data_situacao_cadastral = EXCLUDED.data_situacao_cadastral,
          data_de_inicio_da_atividade = EXCLUDED.data_de_inicio_da_atividade,
          cnae_fiscal_principal = EXCLUDED.cnae_fiscal_principal,
          cnae_fiscal_secundaria = EXCLUDED.cnae_fiscal_secundaria,
          tipo_de_logradouro = EXCLUDED.tipo_de_logradouro,
          logradouro = EXCLUDED.logradouro, numero = EXCLUDED.numero,
          complemento = EXCLUDED.complemento, bairro = EXCLUDED.bairro,
          cep = EXCLUDED.cep, uf = EXCLUDED.uf, municipio = EXCLUDED.municipio,
          ddd1 = EXCLUDED.ddd1, telefone1 = EXCLUDED.telefone1,
          ddd2 = EXCLUDED.ddd2, telefone2 = EXCLUDED.telefone2,
          correio_eletronico = EXCLUDED.correio_eletronico
      `, [
        basico, ordem, dv, idMatFil,
        est.nome_fantasia || null, sit, fmtDate(est.data_situacao_cadastral),
        fmtDate(est.data_inicio_atividade), est.atividade_principal?.id, cnaeSec,
        est.tipo_logradouro, est.logradouro, est.numero, est.complemento, est.bairro, est.cep,
        est.estado?.sigla, munCod, est.ddd1, est.telefone1, est.ddd2 || null, est.telefone2 || null,
        est.email,
      ]);

      // Upsert rfb_socios
      if (Array.isArray(api.socios) && api.socios.length > 0) {
        await client.query('DELETE FROM rfb_socios WHERE cnpj_basico = $1', [basico]);
        for (const s of api.socios) {
          await client.query(`
            INSERT INTO rfb_socios (cnpj_basico, identificador_de_socio, nome_do_socio,
              cnpj_ou_cpf_do_socio, qualificacao_do_socio, data_de_entrada_sociedade, faixa_etaria)
            VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING
          `, [basico, s.tipo === 'Pessoa Física' ? '2' : '1', s.nome,
              s.cpf_cnpj_socio, String(s.qualificacao_socio?.id || ''), fmtDate(s.data_entrada), s.faixa_etaria]);
        }
      }

      // Retorna o registro no mesmo formato do /api/rfb/cnpj/:cnpj
      const result = await client.query(`
        SELECT e.*, emp.razao_social, emp.capital_social, emp.porte_da_empresa, emp.natureza_juridica,
               m.descricao AS municipio_nome, c.descricao AS cnae_descricao,
               s.opcao_pelo_simples, s.opcao_pelo_mei
        FROM rfb_estabelecimentos e
        JOIN rfb_empresas emp ON e.cnpj_basico = emp.cnpj_basico
        LEFT JOIN rfb_municipios m ON e.municipio = m.codigo
        LEFT JOIN rfb_cnaes c ON e.cnae_fiscal_principal = c.codigo
        LEFT JOIN rfb_simples s ON e.cnpj_basico = s.cnpj_basico
        WHERE e.cnpj_basico = $1 AND e.cnpj_ordem = $2 AND e.cnpj_dv = $3
      `, [basico, ordem, dv]);
      const socios = await client.query('SELECT * FROM rfb_socios WHERE cnpj_basico = $1', [basico]);
      res.json({ ...result.rows[0], socios: socios.rows, source: 'rfb_api' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[cnpj-enrich]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rfb/filiais/:cnpjBasico — retorna todas as filiais de um CNPJ base
app.get('/api/rfb/filiais/:cnpjBasico', async (req, res) => {
  const { cnpjBasico } = req.params;
  try {
    const r = await pool.query(`
      SELECT
        e.cnpj_basico || e.cnpj_ordem || e.cnpj_dv AS cnpj,
        e.cnpj_ordem,
        e.nome_fantasia, e.situacao_cadastral,
        e.data_de_inicio_da_atividade,
        CASE e.uf
          WHEN '01' THEN 'AC' WHEN '02' THEN 'AL' WHEN '03' THEN 'AP' WHEN '04' THEN 'AM'
          WHEN '05' THEN 'BA' WHEN '06' THEN 'CE' WHEN '07' THEN 'DF' WHEN '08' THEN 'ES'
          WHEN '09' THEN 'GO' WHEN '10' THEN 'MA' WHEN '11' THEN 'MT' WHEN '12' THEN 'MS'
          WHEN '13' THEN 'MG' WHEN '14' THEN 'PA' WHEN '15' THEN 'PB' WHEN '16' THEN 'PR'
          WHEN '17' THEN 'PE' WHEN '18' THEN 'PI' WHEN '19' THEN 'RJ' WHEN '20' THEN 'RN'
          WHEN '21' THEN 'RS' WHEN '22' THEN 'RO' WHEN '23' THEN 'RR' WHEN '24' THEN 'SC'
          WHEN '25' THEN 'SP' WHEN '26' THEN 'SE' WHEN '27' THEN 'TO'
          ELSE e.uf
        END AS uf, m.descricao AS municipio_nome,
        e.logradouro, e.numero, e.complemento, e.bairro, e.cep,
        e.tipo_de_logradouro,
        e.ddd1, e.telefone1, e.ddd2, e.telefone2,
        e.correio_eletronico,
        e.cnae_fiscal_principal, c.descricao AS cnae_descricao
      FROM rfb_estabelecimentos e
      LEFT JOIN rfb_municipios m ON e.municipio = m.codigo
      LEFT JOIN rfb_cnaes c ON e.cnae_fiscal_principal = c.codigo
      WHERE e.cnpj_basico = $1 AND e.identificador_matriz_filial != '1'
      ORDER BY e.cnpj_ordem
    `, [cnpjBasico]);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rfb/search
// Params: cnpj, nome, nome_op, socio, socio_op, uf, municipio, cnae, situacao,
//         endereco, endereco_op, simples, mei, only_matriz,
//         capital_min, capital_max, abertura_min_anos, abertura_max_anos,
//         page, page_size, order_by
app.get('/api/rfb/search', async (req, res) => {
  try {
    const {
      cnpj = '', nome = '', nome_op = 'contains',
      nome2 = '', nome2_op = 'contains', nome_logic = 'AND',
      socio = '', socio_op = 'contains',
      socio2 = '', socio2_op = 'contains', socio_logic = 'AND',
      uf = '', municipio = '', cnae = '', cnae_not = '', cnae_only_principal = 'false',
      situacao = '', porte = '', natureza = '',
      endereco = '', endereco_op = 'contains',
      endereco2 = '', endereco2_op = 'contains', endereco_logic = 'AND',
      simples = '', mei = '',
      only_matriz = 'true',
      capital_min = '', capital_max = '',
      abertura_min_anos = '', abertura_max_anos = '',
      page = '1', page_size = '10',
      order_by = 'razao_social',
      known_total = '',  // client passes cached total on page>1 to skip count query
    } = req.query;

    const limit  = Math.min(Math.max(parseInt(page_size, 10) || 10, 1), 100);
    const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

    const params = [];
    const where  = [];
    const cleanCnpjFilter = cnpj.trim() ? cnpj.replace(/\D/g, '') : '';

    // Helper: aplica operador de texto em uma ou mais colunas
    const applyTextOp = (cols, val, op) => {
      const v = val.trim();
      let pattern, negated = false;
      if (op === 'not_contains') { pattern = `%${v}%`; negated = true; }
      else if (op === 'starts')  { pattern = `${v}%`; }
      else if (op === 'ends')    { pattern = `%${v}`; }
      else if (op === 'exact')   { pattern = v; }
      else                       { pattern = `%${v}%`; }
      params.push(pattern);
      const idx = params.length;
      // immutable_unaccent + ILIKE usa índice GIN trigrama e é insensível a acentos
      const conds = cols.map(col =>
        `immutable_unaccent(lower(${col})) ${negated ? 'NOT ' : ''}ILIKE immutable_unaccent(lower($${idx}))`
      );
      return conds.length === 1 ? conds[0] : `(${conds.join(' OR ')})`;
    };

    if (cnpj.trim()) {
      const clean = cleanCnpjFilter;
      if (clean.length === 14) {
        params.push(clean.slice(0, 8), clean.slice(8, 12), clean.slice(12, 14));
        where.push(`(e.cnpj_basico = $${params.length - 2} AND e.cnpj_ordem = $${params.length - 1} AND e.cnpj_dv = $${params.length})`);
      } else if (clean.length >= 8) {
        params.push(clean.slice(0, 8));
        where.push(`e.cnpj_basico = $${params.length}`);
      }
    }

    // Nome — aceita até 2 termos combinados com AND/OR
    // MATERIALIZED CTE: força o PG a executar o UNION e materializar os CNPJs antes de
    // planejar o JOIN com outros filtros. Sem isso, o índice GIN estima 2.7M linhas (vs real
    // ~29K), fazendo o planner escolher hash join com 64 partições em disco → timeout.
    // Com CTE materializado, o PG usa a contagem real e escolhe nested loop → <2s.
    const nomeCtes  = [];  // strings 'alias AS MATERIALIZED (...)'
    const nomeJoins = [];  // strings 'JOIN alias ON alias.cnpj_basico = e.cnpj_basico'
    {
      const n1 = nome.trim(), n2 = nome2.trim();
      if (n1 || n2) {
        // Monta o SQL do UNION para um termo (sem parâmetro ainda — recebe idx externo)
        const unionSql = (idx) =>
          `SELECT cnpj_basico FROM rfb_empresas WHERE immutable_unaccent(lower(razao_social)) ILIKE immutable_unaccent(lower($${idx}))
           UNION
           SELECT cnpj_basico FROM rfb_estabelecimentos WHERE identificador_matriz_filial = '1' AND immutable_unaccent(lower(nome_fantasia)) ILIKE immutable_unaccent(lower($${idx}))`;

        const addNomeTerm = (v, op) => {
          const negated = op === 'not_contains';
          let pattern;
          if (negated)              pattern = `%${v}%`;
          else if (op === 'starts') pattern = `${v}%`;
          else if (op === 'ends')   pattern = `%${v}`;
          else if (op === 'exact')  pattern = v;
          else                      pattern = `%${v}%`;
          params.push(pattern);
          return { idx: params.length, negated };
        };

        const t1 = n1 ? addNomeTerm(n1, nome_op)  : null;
        const t2 = n2 ? addNomeTerm(n2, nome2_op) : null;

        // Termos negativos: filtro direto nas colunas já presentes no JOIN
        // (emp.razao_social + e.nome_fantasia da matriz) — NÃO usar subquery.
        // NOT IN (union) força o PG a materializar TODO o conjunto do termo negado via
        // índice GIN trigrama; para termos comuns ("agro") esse scan leva 60s+ → timeout
        // (o planner subestima o nº de linhas e escolhe hash anti join sobre o set inteiro).
        // O filtro escalar é avaliado por linha candidata (já reduzida pelos positivos) →
        // trivial. COALESCE trata NULL como "não contém" (mantém a linha), igual ao NOT IN.
        [t1, t2].forEach(t => {
          if (t?.negated) {
            where.push(
              `immutable_unaccent(lower(COALESCE(emp.razao_social,''))) NOT ILIKE immutable_unaccent(lower($${t.idx}))
               AND immutable_unaccent(lower(COALESCE(e.nome_fantasia,''))) NOT ILIKE immutable_unaccent(lower($${t.idx}))`
            );
          }
        });

        // Termos positivos: MATERIALIZED CTE + JOIN
        const positivos = [t1, t2].filter(t => t && !t.negated);
        if (positivos.length === 2 && nome_logic === 'OR') {
          // OR: um único CTE combinando os dois conjuntos
          const alias = '_nome_or';
          nomeCtes.push(`${alias} AS MATERIALIZED (${unionSql(positivos[0].idx)} UNION ${unionSql(positivos[1].idx)})`);
          nomeJoins.push(`JOIN ${alias} ON ${alias}.cnpj_basico = e.cnpj_basico`);
        } else {
          // AND (ou termo único): um CTE por termo, um JOIN por CTE
          positivos.forEach((t, i) => {
            const alias = `_nome${i + 1}`;
            nomeCtes.push(`${alias} AS MATERIALIZED (${unionSql(t.idx)})`);
            nomeJoins.push(`JOIN ${alias} ON ${alias}.cnpj_basico = e.cnpj_basico`);
          });
        }
      }
    }

    // Sócio — aceita até 2 termos combinados com AND/OR
    // Positivos: MATERIALIZED CTE + JOIN (evita correlated subquery em 27M rows)
    // Negativos: mantém NOT IN subquery (raro, aplicado depois dos filtros positivos)
    const socioCtes  = [];
    const socioJoins = [];
    {
      // MEI não tem registro em rfb_socios — o nome do empreendedor vai pra
      // razao_social no formato "CNPJ_BASICO NOME". UNION com rfb_empresas
      // (filtrado por opcao_pelo_mei='S') traz esses casos. Mas trigram em
      // razao_social é caro pra termos genéricos ("joao silva" → 13s),
      // então só ativa o branch MEI quando o termo é específico:
      // 3+ palavras OU 14+ chars. Pega buscas tipo "vilma dos santos messias",
      // ignora "joao silva".
      // Se mei='N' (usuário excluiu MEI), desabilita extensão — seria caro
      // computar e descartar.
      const allowMei = mei !== 'N';
      const isSpecific = (v) => allowMei && (v.split(/\s+/).filter(Boolean).length >= 3 || v.length >= 14);
      const socioSql = (idx, includeMei) => includeMei
        ? `SELECT cnpj_basico FROM rfb_socios WHERE immutable_unaccent(lower(nome_do_socio)) ILIKE immutable_unaccent(lower($${idx}))
           UNION
           SELECT emp.cnpj_basico FROM rfb_empresas emp
           WHERE immutable_unaccent(lower(emp.razao_social)) ILIKE immutable_unaccent(lower($${idx}))
             AND EXISTS (SELECT 1 FROM rfb_simples sim WHERE sim.cnpj_basico = emp.cnpj_basico AND sim.opcao_pelo_mei = 'S')`
        : `SELECT cnpj_basico FROM rfb_socios WHERE immutable_unaccent(lower(nome_do_socio)) ILIKE immutable_unaccent(lower($${idx}))`;
      const mkPattern = (v, op) => {
        if (op === 'starts') return `${v}%`;
        if (op === 'ends')   return `%${v}`;
        if (op === 'exact')  return v;
        return `%${v}%`;
      };
      const s1 = socio.trim(), s2 = socio2.trim();
      if (s1 || s2) {
        // Negativos → NOT EXISTS correlato (sem extensão MEI: excluir por MEI removeria
        // empresas válidas). NOT IN materializa todo o conjunto de sócios que casam o termo
        // ("silva" → milhões) via trigrama → timeout. NOT EXISTS correlaciona por cnpj_basico
        // (indexado em rfb_socios): 1 lookup por candidato, já reduzido pelos positivos.
        const socioNotExists = (idx) =>
          `NOT EXISTS (SELECT 1 FROM rfb_socios _soc_neg WHERE _soc_neg.cnpj_basico = e.cnpj_basico
             AND immutable_unaccent(lower(_soc_neg.nome_do_socio)) ILIKE immutable_unaccent(lower($${idx})))`;
        if (s1 && socio_op === 'not_contains') {
          params.push(`%${s1}%`);
          where.push(socioNotExists(params.length));
        }
        if (s2 && socio2_op === 'not_contains') {
          params.push(`%${s2}%`);
          where.push(socioNotExists(params.length));
        }
        // Positivos → CTE + JOIN
        const pos = [];
        if (s1 && socio_op !== 'not_contains') { params.push(mkPattern(s1, socio_op)); pos.push({ idx: params.length, mei: isSpecific(s1) }); }
        if (s2 && socio2_op !== 'not_contains') { params.push(mkPattern(s2, socio2_op)); pos.push({ idx: params.length, mei: isSpecific(s2) }); }
        if (pos.length === 2 && socio_logic === 'OR') {
          socioCtes.push(`_socio_or AS MATERIALIZED (${socioSql(pos[0].idx, pos[0].mei)} UNION ${socioSql(pos[1].idx, pos[1].mei)})`);
          socioJoins.push(`JOIN _socio_or ON _socio_or.cnpj_basico = e.cnpj_basico`);
        } else {
          pos.forEach((p, i) => {
            const alias = `_socio${i + 1}`;
            socioCtes.push(`${alias} AS MATERIALIZED (${socioSql(p.idx, p.mei)})`);
            socioJoins.push(`JOIN ${alias} ON ${alias}.cnpj_basico = e.cnpj_basico`);
          });
        }
      }
    }

    // cnaeSecNarrow: condições de UF/municipio sem alias de tabela, usadas para
    // estreitar o scan de cnae_fiscal_secundaria (evita seq scan de 70M linhas).
    const cnaeSecNarrow = [];

    if (uf.trim()) {
      const ufSigla = uf.trim().toUpperCase();
      const _ufNumMap = { AC:'01',AL:'02',AP:'03',AM:'04',BA:'05',CE:'06',DF:'07',ES:'08',GO:'09',MA:'10',MT:'11',MS:'12',MG:'13',PA:'14',PB:'15',PR:'16',PE:'17',PI:'18',RJ:'19',RN:'20',RS:'21',RO:'22',RR:'23',SC:'24',SP:'25',SE:'26',TO:'27' };
      const ufCod = _ufNumMap[ufSigla] || ufSigla;
      params.push(ufSigla); params.push(ufCod);
      where.push(`e.uf IN ($${params.length - 1}, $${params.length})`);
      cnaeSecNarrow.push(`uf IN ($${params.length - 1}, $${params.length})`);
    }

    if (municipio.trim()) {
      if (/^\d+$/.test(municipio.trim())) {
        // Frontend envia o código numérico diretamente (ex: '7107' = SAO PAULO)
        params.push(municipio.trim());
        where.push(`e.municipio = $${params.length}`);
        cnaeSecNarrow.push(`municipio = $${params.length}`);
      } else {
        // Fallback: texto livre → busca por nome no rfb_municipios (não trackeia cnaeSecNarrow)
        params.push(`%${municipio.trim()}%`);
        where.push(`e.municipio IN (SELECT codigo FROM rfb_municipios WHERE immutable_unaccent(lower(descricao)) ILIKE immutable_unaccent(lower($${params.length})))`);
      }
    }

    // CNAE — duas estratégias:
    //
    // A) Inline (progressivo): CNAE sozinho (sem nome/sócio/endereço como grupo).
    //    MATERIALIZED forçava materializar TODOS os matches do CNAE (100k–500k+) antes
    //    do LIMIT — com porte/capital isso estourava 120s. Inline em
    //    e.cnae_fiscal_principal = ANY(...) usa idx_rfb_est_cnae e o LIMIT encerra cedo
    //    (~150ms para 101 linhas no mesmo cenário).
    //
    // B) MATERIALIZED CTE: quando CNAE combina com nome/sócio/endereço (INTERSECT em
    //    _inter). Materializar uma vez evita re-scan GIN/trgm e estabiliza o planner.
    //
    // Secundário: só entra com UF/municipio (cnaeSecNarrow). Sem filtro geográfico o
    // GIN em 70M linhas materializa centenas de milhares de CNPJs → timeout nacional.
    // cnae_only_principal=true também desliga o secundário.
    // Negativo: NOT EXISTS correlato (NOT IN com UNION causava timeout).
    const cnaeCtes  = [];
    const cnaeJoins = [];
    let cnaeInlineProgressive = false;
    let cnaeSecondarySkippedNoGeo = false;
    {
      const onlyPrincipal = cnae_only_principal === 'true';
      const hasGeoNarrow = cnaeSecNarrow.length > 0;
      const includeSecondary = !onlyPrincipal && hasGeoNarrow;
      const secNarrow = hasGeoNarrow ? ' AND ' + cnaeSecNarrow.join(' AND ') : '';
      const cnaeHasCompanionGroup = !!(
        nome.trim() || nome2.trim() || socio.trim() || socio2.trim()
        || endereco.trim() || endereco2.trim()
      );

      if (cnae.trim()) {
        const codes = cnae.split(',').map(c => c.replace(/\D/g, '')).filter(Boolean);
        if (codes.length > 0) {
          if (!onlyPrincipal && !hasGeoNarrow) cnaeSecondarySkippedNoGeo = true;

          if (!cnaeHasCompanionGroup) {
            // Estratégia A: inline + early-stop (sem MATERIALIZED)
            cnaeInlineProgressive = true;
            const start = params.length + 1;
            codes.forEach((c) => params.push(c));
            const arrParam = `ARRAY[${codes.map((_, i) => `$${start + i}`).join(', ')}]`;
            if (includeSecondary) {
              where.push(
                `(e.cnae_fiscal_principal = ANY(${arrParam})
                  OR string_to_array(NULLIF(TRIM(e.cnae_fiscal_secundaria), ''), ',') && ${arrParam})`
              );
            } else {
              where.push(`e.cnae_fiscal_principal = ANY(${arrParam})`);
            }
          } else {
            // Estratégia B: MATERIALIZED CTE + JOIN (intersect com outros grupos)
            const parts = codes.flatMap((code) => {
              params.push(code);
              const i = params.length;
              const principal = `SELECT cnpj_basico FROM rfb_estabelecimentos WHERE cnae_fiscal_principal = $${i} AND identificador_matriz_filial = '1'`;
              if (!includeSecondary) return [principal];
              const secundario = `SELECT cnpj_basico FROM rfb_estabelecimentos WHERE string_to_array(NULLIF(TRIM(cnae_fiscal_secundaria), ''), ',') @> ARRAY[$${i}] AND identificador_matriz_filial = '1'${secNarrow}`;
              return [principal, secundario];
            });
            cnaeCtes.push(`_cnae_f AS MATERIALIZED (${parts.join('\n  UNION\n  ')})`);
            cnaeJoins.push(`JOIN _cnae_f ON _cnae_f.cnpj_basico = e.cnpj_basico`);
          }
        }
      }
      if (cnae_not.trim()) {
        const codes = cnae_not.split(',').map(c => c.replace(/\D/g, '')).filter(Boolean);
        if (codes.length > 0) {
          // NOT EXISTS correlato com array ANY/&& — usa idx_rfb_est_basico (PK)
          // pra correlação por cnpj_basico, evitando o hash join cheio do NOT IN.
          // Sem geo: só principal no negativo (mesmo critério do positivo) — GIN nacional
          // no NOT EXISTS por linha ainda é ok (lookup por basico), mas o secundário no
          // candidato único é barato; mantém secundário no negativo pois é 1 row lookup.
          const start = params.length + 1;
          codes.forEach(c => params.push(c));
          const arrParam = `ARRAY[${codes.map((_, i) => `$${start + i}`).join(', ')}]`;
          const principalCond = `x.cnae_fiscal_principal = ANY(${arrParam})`;
          const secundarioCond = `string_to_array(NULLIF(TRIM(x.cnae_fiscal_secundaria), ''), ',') && ${arrParam}`;
          const cnaeCond = onlyPrincipal ? principalCond : `(${principalCond} OR ${secundarioCond})`;
          where.push(`NOT EXISTS (SELECT 1 FROM rfb_estabelecimentos x WHERE x.cnpj_basico = e.cnpj_basico AND x.identificador_matriz_filial = '1' AND ${cnaeCond})`);
        }
      }
    }

    if (situacao.trim()) {
      // Aceita múltiplos valores separados por vírgula (ex: "2,3,4")
      const sits = situacao.split(',').map(s => s.trim()).filter(Boolean);
      // Cada código aceita a versão com e sem zero à esquerda (ex: '2' e '02')
      const codes = [...new Set(sits.flatMap(s => [s, s.padStart(2, '0')]))];
      const start = params.length + 1;
      codes.forEach(c => params.push(c));
      where.push(`e.situacao_cadastral IN (${codes.map((_, i) => `$${start + i}`).join(', ')})`);
    }

    if (porte.trim()) {
      const p = porte.trim();
      const pPadded = p.padStart(2, '0');
      params.push(p); params.push(pPadded);
      where.push(`emp.porte_da_empresa IN ($${params.length - 1}, $${params.length})`);
    }

    if (natureza.trim()) {
      const nats = natureza.split(',').map(s => s.trim()).filter(Boolean);
      const start = params.length + 1;
      nats.forEach(n => params.push(n));
      where.push(`emp.natureza_juridica IN (${nats.map((_, i) => `$${start + i}`).join(', ')})`);
    }

    // Endereço — estratégia dupla:
    // • hasNarrowFilter (CNAE/nome/sócio): JOIN LATERAL que força nested loop.
    //   O planner convertia WHERE EXISTS em hash semi-join + seq scan de 67M linhas.
    //   LATERAL é sempre nested loop: 409 outer rows (CNAE+SP) × 1-2 lookups = <1s.
    //   lateralEndJoins é appendado APÓS o _inter para não quebrar o regex de alias.
    // • Sem filtros estreitos: MATERIALIZED CTE (bitmap scan — sem alternativa melhor).
    const endCtes  = [];
    const endJoins = [];
    const lateralEndJoins = [];
    // hasNarrowFilter usado tanto para endereço LATERAL quanto para rfb_empresas LATERAL.
    // CNAE positivo (cnae=) reduz o set; cnae_not não reduz o suficiente para LATERAL.
    const hasNarrowFilter = nomeCtes.length > 0 || socioCtes.length > 0 || cnae.trim() !== '';
    {
      const e1 = endereco.trim(), e2 = endereco2.trim();
      if (e1 || e2) {

        const buildEndResult = (v, op) => {
          const negated = op === 'not_contains';
          let pattern;
          if (negated)              pattern = `%${v}%`;
          else if (op === 'starts') pattern = `${v}%`;
          else if (op === 'ends')   pattern = `%${v}`;
          else if (op === 'exact')  pattern = v;
          else                      pattern = `%${v}%`;
          params.push(pattern);
          const idx = params.length;
          const ilikeSql = (alias) =>
            `(immutable_unaccent(lower(${alias}.logradouro)) ILIKE immutable_unaccent(lower($${idx}))
              OR immutable_unaccent(lower(${alias}.bairro)) ILIKE immutable_unaccent(lower($${idx})))`;
          const endSql = `SELECT DISTINCT cnpj_basico FROM rfb_estabelecimentos
                          WHERE ${ilikeSql('rfb_estabelecimentos')}`;
          if (negated) {
            // Filtro direto na matriz e (logradouro/bairro já na linha base) — NÃO subquery.
            // NOT IN (...) força seq scan de 70M linhas para materializar o conjunto → timeout.
            // COALESCE trata NULL como "não contém" (mantém a linha), igual ao NOT IN.
            where.push(
              `immutable_unaccent(lower(COALESCE(e.logradouro,''))) NOT ILIKE immutable_unaccent(lower($${idx}))
               AND immutable_unaccent(lower(COALESCE(e.bairro,''))) NOT ILIKE immutable_unaccent(lower($${idx}))`
            );
            return { handled: true };
          }
          return { handled: false, sql: endSql, ilikeSql };
        };

        const res1 = e1 ? buildEndResult(e1, endereco_op)  : null;
        const res2 = e2 ? buildEndResult(e2, endereco2_op) : null;
        const positivos = [res1, res2].filter(r => r && !r.handled);

        if (hasNarrowFilter && positivos.length > 0) {
          // JOIN LATERAL — garante nested loop, impede hash semi-join
          if (positivos.length === 2 && endereco_logic === 'OR') {
            lateralEndJoins.push(
              `JOIN LATERAL (SELECT 1 FROM rfb_estabelecimentos _e_lat
               WHERE _e_lat.cnpj_basico = e.cnpj_basico
                 AND (${positivos[0].ilikeSql('_e_lat')} OR ${positivos[1].ilikeSql('_e_lat')})
               LIMIT 1) _e_lat_r ON true`
            );
          } else {
            positivos.forEach((r, i) => {
              const a = `_e_lat${i + 1}`;
              lateralEndJoins.push(
                `JOIN LATERAL (SELECT 1 FROM rfb_estabelecimentos ${a}
                 WHERE ${a}.cnpj_basico = e.cnpj_basico AND ${r.ilikeSql(a)}
                 LIMIT 1) ${a}_r ON true`
              );
            });
          }
        } else if (positivos.length > 0) {
          // MATERIALIZED CTE — fallback para busca apenas por endereço
          if (positivos.length === 2 && endereco_logic === 'OR') {
            const alias = '_end_or';
            endCtes.push(`${alias} AS MATERIALIZED (${positivos[0].sql} UNION ${positivos[1].sql})`);
            endJoins.push(`JOIN ${alias} ON ${alias}.cnpj_basico = e.cnpj_basico`);
          } else {
            positivos.forEach((r, i) => {
              const alias = `_end${i + 1}`;
              endCtes.push(`${alias} AS MATERIALIZED (${r.sql})`);
              endJoins.push(`JOIN ${alias} ON ${alias}.cnpj_basico = e.cnpj_basico`);
            });
          }
        }
      }
    }

    // Simples Nacional / MEI — usa EXISTS/NOT EXISTS pra explorar idx_rfb_simples_basico
    // e idx_rfb_simples_mei (parcial). NOT IN tem semântica perigosa com NULLs e o planner
    // costuma escolher hash join cheio de 24M+ linhas → timeout. EXISTS roda 1 lookup
    // por linha candidata (~50μs cada) e termina cedo.
    if (simples === 'S') where.push(`EXISTS (SELECT 1 FROM rfb_simples sim_s WHERE sim_s.cnpj_basico = e.cnpj_basico AND sim_s.opcao_pelo_simples = 'S')`);
    if (simples === 'N') where.push(`NOT EXISTS (SELECT 1 FROM rfb_simples sim_s WHERE sim_s.cnpj_basico = e.cnpj_basico AND sim_s.opcao_pelo_simples = 'S')`);
    if (mei === 'S') where.push(`EXISTS (SELECT 1 FROM rfb_simples sim_m WHERE sim_m.cnpj_basico = e.cnpj_basico AND sim_m.opcao_pelo_mei = 'S')`);
    if (mei === 'N') where.push(`NOT EXISTS (SELECT 1 FROM rfb_simples sim_m WHERE sim_m.cnpj_basico = e.cnpj_basico AND sim_m.opcao_pelo_mei = 'S')`);

    // Mostrar apenas matriz por padrão, exceto quando a busca é por CNPJ completo.
    // Nesse caso, o usuário pediu um estabelecimento específico, que pode ser filial.
    if (only_matriz !== 'false' && cleanCnpjFilter.length !== 14) where.push(`e.identificador_matriz_filial = '1'`);

    // Capital social (TEXT → NUMERIC)
    const capitalExpr = `NULLIF(replace(replace(emp.capital_social,'.',''),',','.'), '')::NUMERIC`;
    if (capital_min !== '') {
      params.push(parseFloat(capital_min));
      where.push(`${capitalExpr} >= $${params.length}`);
    }
    if (capital_max !== '') {
      params.push(parseFloat(capital_max));
      where.push(`${capitalExpr} <= $${params.length}`);
    }

    // Tempo de abertura em anos — comparação lexicográfica em YYYYMMDD (texto).
    // Evita regex + TO_DATE por linha (caros em scans grandes). Datas inválidas
    // ('00000000', vazio) ficam de fora via bound inferior '18000101'.
    if (abertura_min_anos !== '') {
      const years = parseInt(abertura_min_anos, 10);
      // idade >= N anos → início <= hoje - N anos
      where.push(
        `e.data_de_inicio_da_atividade >= '18000101'
         AND e.data_de_inicio_da_atividade <= to_char(NOW() - INTERVAL '${years} years', 'YYYYMMDD')`
      );
    }
    if (abertura_max_anos !== '') {
      const years = parseInt(abertura_max_anos, 10);
      // idade <= N anos → início >= hoje - N anos
      where.push(
        `e.data_de_inicio_da_atividade >= to_char(NOW() - INTERVAL '${years} years', 'YYYYMMDD')
         AND e.data_de_inicio_da_atividade <= to_char(NOW(), 'YYYYMMDD')`
      );
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const positiveFilterGroupCount = [
      nomeJoins.length,
      cnaeJoins.length,
      endJoins.length,
      socioJoins.length,
    ].filter(Boolean).length;
    const hasCombinedHeavyFilters = positiveFilterGroupCount > 1;
    // Busca nacional por CNAE (ou CNAE inline progressivo): não contar o universo inteiro.
    // Contar/ordenar o set completo materializa centenas de milhares de linhas e estoura
    // o timeout mesmo quando a 1ª página já está pronta.
    const hasBroadCnaeSearch = (cnaeCtes.length > 0 || cnaeInlineProgressive) && cnaeSecNarrow.length === 0;
    const usesProgressiveTotal = hasCombinedHeavyFilters || hasBroadCnaeSearch || cnaeInlineProgressive;

    // Ordenação
    // Progressive path: SEM ORDER BY — permite early-stop no índice de CNAE.
    // ORDER BY e.cnpj_basico forçava coletar/ordenar todos os matches do filtro antes
    // do LIMIT (timeout com porte/capital seletivos sobre CNAEs grandes).
    // Com CTE de nome/sócio materializado (~dezenas de K), ORDER BY SQL é seguro.
    const ORDER_MAP = {
      razao_social:  'emp.razao_social NULLS LAST',
      nome_fantasia: 'e.nome_fantasia NULLS LAST',
      uf:            'e.uf NULLS LAST',
      situacao:      'e.situacao_cadastral NULLS LAST',
      capital_desc:  `${capitalExpr} DESC NULLS LAST`,
      capital_asc:   `${capitalExpr} ASC NULLS LAST`,
      abertura_desc: 'e.data_de_inicio_da_atividade DESC NULLS LAST',
      abertura_asc:  'e.data_de_inicio_da_atividade ASC NULLS LAST',
    };
    const useSqlOrder = !usesProgressiveTotal && (where.length > 0 || nomeCtes.length > 0 || socioCtes.length > 0);
    const sqlOrderClause = useSqlOrder
      ? (ORDER_MAP[order_by] || 'emp.razao_social NULLS LAST')
      : null;

    let allCtes  = [...nomeCtes, ...cnaeCtes, ...endCtes, ...socioCtes];
    let allJoins = [...nomeJoins, ...cnaeJoins, ...endJoins, ...socioJoins];

    // Quando dois ou mais grupos de CTEs (nome, CNAE, endereço, sócio) estão ativos,
    // pré-intersecta em _inter para minimizar o conjunto antes do JOIN final.
    const multiGroupJoins = [...nomeJoins, ...cnaeJoins, ...endJoins, ...socioJoins];
    if (multiGroupJoins.length > 1) {
      const aliasRe = /JOIN (\S+) ON/;
      const allAliases = multiGroupJoins.map(j => j.match(aliasRe)[1]);
      const interSql = allAliases.map(a => `SELECT cnpj_basico FROM ${a}`).join('\nINTERSECT\n');
      allCtes.push(`_inter AS MATERIALIZED (${interSql})`);
      allJoins = [`JOIN _inter ON _inter.cnpj_basico = e.cnpj_basico`];
    }
    // LATERAL joins são correlated e sempre nested loop — appendar após _inter
    if (lateralEndJoins.length > 0) allJoins = [...allJoins, ...lateralEndJoins];

    const ctePrefix = allCtes.length > 0 ? `WITH ${allCtes.join(',\n')}` : '';
    // hasNarrowFilter → LATERAL força nested loop: N lookups pontuais via idx_rfb_emp_basico
    // em vez de hash join + seq scan de 67M linhas de rfb_empresas.
    const rfbEmpJoin = hasNarrowFilter
      ? `JOIN LATERAL (SELECT razao_social, capital_social, porte_da_empresa, natureza_juridica FROM rfb_empresas WHERE cnpj_basico = e.cnpj_basico LIMIT 1) emp ON true`
      : `JOIN rfb_empresas emp ON e.cnpj_basico = emp.cnpj_basico`;
    const baseQuery = `
      FROM rfb_estabelecimentos e
      ${allJoins.join('\n      ')}
      ${rfbEmpJoin}
      LEFT JOIN rfb_municipios m ON e.municipio = m.codigo
      LEFT JOIN rfb_cnaes c ON e.cnae_fiscal_principal = c.codigo
      LEFT JOIN rfb_simples s ON e.cnpj_basico = s.cnpj_basico
      LEFT JOIN rfb_natureza nat ON emp.natureza_juridica = nat.codigo
      ${whereClause}
    `;

    // Duas conexões separadas para execução paralela real (mesma conexão seria sequencial).
    // random_page_cost=1.0 diz ao planner que o storage é SSD (I/O aleatório ≈ sequencial),
    // evitando seq scan de 49M linhas quando nested loop com índice é mais eficiente.
    // ORDER BY na SQL usa e.cnpj_basico (chave primária = 0-copy index scan + early termination).
    // Os resultados são re-ordenados em JS pelo campo solicitado — evita full sort no PG para
    // buscas amplas (ex: "elg" → 28K matches → ORDER BY razao_social forçaria sort de 28K rows).
    const SESSION_OPTS = `SET statement_timeout = '120s'; SET random_page_cost = 1.0; SET work_mem = '64MB'; SET max_parallel_workers_per_gather = 0`;
    const dataQuery = `
        SELECT
          e.cnpj_basico || e.cnpj_ordem || e.cnpj_dv AS cnpj,
          e.cnpj_basico, e.cnpj_ordem,
          emp.razao_social, e.nome_fantasia,
          CASE LTRIM(e.situacao_cadastral, '0')
            WHEN '1' THEN 'Nula' WHEN '2' THEN 'Ativa' WHEN '3' THEN 'Suspensa'
            WHEN '4' THEN 'Inapta' WHEN '8' THEN 'Baixada'
            ELSE e.situacao_cadastral
          END AS situacao_cadastral,
          e.data_de_inicio_da_atividade,
          e.cnae_fiscal_principal, c.descricao AS cnae_descricao,
          CASE e.uf
            WHEN '01' THEN 'AC' WHEN '02' THEN 'AL' WHEN '03' THEN 'AP' WHEN '04' THEN 'AM'
            WHEN '05' THEN 'BA' WHEN '06' THEN 'CE' WHEN '07' THEN 'DF' WHEN '08' THEN 'ES'
            WHEN '09' THEN 'GO' WHEN '10' THEN 'MA' WHEN '11' THEN 'MT' WHEN '12' THEN 'MS'
            WHEN '13' THEN 'MG' WHEN '14' THEN 'PA' WHEN '15' THEN 'PB' WHEN '16' THEN 'PR'
            WHEN '17' THEN 'PE' WHEN '18' THEN 'PI' WHEN '19' THEN 'RJ' WHEN '20' THEN 'RN'
            WHEN '21' THEN 'RS' WHEN '22' THEN 'RO' WHEN '23' THEN 'RR' WHEN '24' THEN 'SC'
            WHEN '25' THEN 'SP' WHEN '26' THEN 'SE' WHEN '27' THEN 'TO'
            ELSE e.uf
          END AS uf, m.descricao AS municipio_nome,
          e.logradouro, e.numero, e.complemento, e.bairro, e.cep,
          e.tipo_de_logradouro,
          e.ddd1, e.telefone1, e.ddd2, e.telefone2,
          e.correio_eletronico,
          emp.capital_social,
          CASE emp.porte_da_empresa
            WHEN '00' THEN 'Não informado' WHEN '01' THEN 'Micro Empresa'
            WHEN '03' THEN 'Empresa de Pequeno Porte' WHEN '05' THEN 'Demais'
            ELSE emp.porte_da_empresa
          END AS porte_da_empresa,
          emp.natureza_juridica,
          COALESCE(nat.descricao, emp.natureza_juridica) AS natureza_juridica_descricao,
          s.opcao_pelo_simples, s.opcao_pelo_mei,
          (SELECT string_agg(
             s2.nome_do_socio || COALESCE(' (' || q2.descricao || ')', ''),
             ' · ' ORDER BY s2.nome_do_socio
           ) FROM rfb_socios s2
           LEFT JOIN rfb_qualificacoes q2 ON s2.qualificacao_do_socio = q2.codigo
           WHERE s2.cnpj_basico = e.cnpj_basico) AS socios_nomes,
          (SELECT COUNT(*) FROM rfb_estabelecimentos WHERE cnpj_basico = e.cnpj_basico AND identificador_matriz_filial != '1')::INT AS filiais_count,
          e.cnae_fiscal_secundaria,
          (SELECT json_agg(json_build_object('codigo', c2.codigo, 'descricao', c2.descricao) ORDER BY c2.codigo)
           FROM rfb_cnaes c2
           WHERE c2.codigo = ANY(string_to_array(NULLIF(TRIM(e.cnae_fiscal_secundaria), ''), ','))) AS cnaes_secundarios
        ${baseQuery}
        ${sqlOrderClause ? `ORDER BY ${sqlOrderClause}` : ''}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `;
    const dataQueryFull  = `${ctePrefix} ${dataQuery}`;
    // Se o cliente já tem o total (paginação page>1), pula a query de count para economizar
    // ~12s em buscas filtradas (ELG+SC etc.). O total não muda entre páginas.
    const cachedTotal    = known_total !== '' ? parseInt(known_total, 10) : NaN;
    const skipCount      = (!isNaN(cachedTotal) && cachedTotal >= 0) || usesProgressiveTotal;
    const queryLimit     = usesProgressiveTotal ? limit + 1 : limit;
    const countQueryFull = skipCount ? null : `${ctePrefix} SELECT COUNT(*) FROM (SELECT 1 ${baseQuery} LIMIT 10001) __c`;

    let dataRows, countRow;
    if (skipCount) {
      const clientData = await pool.connect();
      try {
        await clientData.query(SESSION_OPTS);
        dataRows = await clientData.query(dataQueryFull, [...params, queryLimit, offset]);
      } finally {
        clientData.release();
      }
      countRow = { rows: [{ count: String(!isNaN(cachedTotal) && cachedTotal >= 0 ? cachedTotal : 0) }] };
    } else {
      const [clientData, clientCount] = await Promise.all([pool.connect(), pool.connect()]);
      try {
        await Promise.all([
          clientData.query(SESSION_OPTS),
          clientCount.query(SESSION_OPTS),
        ]);
        [dataRows, countRow] = await Promise.all([
          clientData.query(dataQueryFull, [...params, queryLimit, offset]),
          clientCount.query(countQueryFull, params),
        ]);
      } finally {
        clientData.release();
        clientCount.release();
      }
    }

    const hasMoreRows = usesProgressiveTotal && dataRows.rows.length > limit;
    if (hasMoreRows) dataRows.rows = dataRows.rows.slice(0, limit);
    // Progressive: total é limite inferior (não contagem exata). has_more=true significa
    // "há mais do que total-1". Nunca fingimos que 101 é o universo completo.
    if (usesProgressiveTotal) {
      const visibleTotal = offset + dataRows.rows.length + (hasMoreRows ? 1 : 0);
      const currentTotal = parseInt(countRow.rows[0].count, 10) || 0;
      countRow.rows[0].count = String(Math.max(currentTotal, visibleTotal));
    }

    // Deriva primeiro_socio de socios_nomes (evita segunda subquery no PG)
    for (const row of dataRows.rows) {
      const first = (row.socios_nomes || '').split(' · ')[0];
      row.primeiro_socio = first.replace(/\s*\(.*\)\s*$/, '').trim() || null;
    }

    // Re-ordenar em JS (evita full sort no PG para buscas amplas).
    // Dados já vêm paginados pelo offset correto via ORDER BY cnpj_basico na SQL.
    const capitalNum = (row) => {
      const n = parseFloat(String(row.capital_social || '0').replace(/\./g, '').replace(',', '.'));
      return isNaN(n) ? 0 : n;
    };
    const JS_SORT = {
      razao_social:  (a, b) => (a.razao_social || '').localeCompare(b.razao_social || '', 'pt-BR'),
      nome_fantasia: (a, b) => (a.nome_fantasia || '').localeCompare(b.nome_fantasia || '', 'pt-BR'),
      uf:            (a, b) => (a.uf || '').localeCompare(b.uf || ''),
      situacao:      (a, b) => (a.situacao_cadastral || '').localeCompare(b.situacao_cadastral || ''),
      capital_desc:  (a, b) => capitalNum(b) - capitalNum(a),
      capital_asc:   (a, b) => capitalNum(a) - capitalNum(b),
      abertura_desc: (a, b) => (b.data_de_inicio_da_atividade || '').localeCompare(a.data_de_inicio_da_atividade || ''),
      abertura_asc:  (a, b) => (a.data_de_inicio_da_atividade || '').localeCompare(b.data_de_inicio_da_atividade || ''),
    };
    // JS sort: só aplicar quando CTE não está ativo (sem nome filter), pois o SQL já
    // ordenou corretamente o resultado via ORDER BY ${sqlOrderClause}.
    if (!useSqlOrder && JS_SORT[order_by]) dataRows.rows.sort(JS_SORT[order_by]);

    const resolvedTotal = parseInt(countRow.rows[0].count, 10) || 0;
    const payload = {
      results: dataRows.rows,
      total: resolvedTotal,
      page: parseInt(page, 10) || 1,
      page_size: limit,
      // progressive=true: total é mínimo conhecido; não rode COUNT(*) no universo (timeout).
      progressive: usesProgressiveTotal,
      has_more: usesProgressiveTotal ? hasMoreRows : resolvedTotal > offset + dataRows.rows.length,
    };
    if (cnaeSecondarySkippedNoGeo) {
      // UI pode avisar: CNAE secundário exige UF/município em buscas nacionais.
      payload.warnings = [
        'cnae_secundario_omitido_sem_uf: sem filtro de UF/município a busca usa só CNAE principal (secundário nacional estoura o tempo).',
      ];
    }
    res.json(payload);
  } catch (err) {
    console.error('[rfb/search] Erro:', err.message);
    const timedOut = err?.code === '57014' || /statement timeout|canceling statement/i.test(err?.message || '');
    res.status(timedOut ? 504 : 500).json({
      error: timedOut
        ? 'A busca excedeu o tempo limite. Tente filtrar por UF, usar CNAE principal apenas, ou reduzir porte/capital/abertura.'
        : (err.message || 'Erro interno na busca'),
    });
  }
});

// GET /api/rfb/import-progress
app.get('/api/rfb/import-progress', (req, res) => {
  res.json(rfbImportState);
});

// POST /api/rfb/import/start — manual trigger (re-import)
// Body: { force: true } força re-download; { staging: true } zero-downtime; { append: true } gap-fill
app.post('/api/rfb/import/start', (req, res) => {
  if (rfbImportState.status === 'running') {
    return res.status(409).json({ error: 'Import já em andamento' });
  }
  const force   = Boolean(req.body?.force);
  const staging = Boolean(req.body?.staging);
  const append  = Boolean(req.body?.append);
  startRFBImport({ force, staging, append });
  const mode = staging ? 'staging (zero-downtime)' : force ? 'completo (force)' : append ? 'append (gap-fill)' : 'incremental';
  res.json({ ok: true, message: `Import ${mode} iniciado` });
});

// ============================================================
// FIM RFB LOCAL
// ============================================================

let dataLayerReady = false;
let backgroundSchedulesRegistered = false;
const registerBackgroundSchedules = () => {
  if (backgroundSchedulesRegistered) return;
  backgroundSchedulesRegistered = true;

  cron.schedule('0 * * * *', pollStageChanges);
  // Trends intel: sob demanda ao expandir o painel no frontend (sem cron diário).
  cron.schedule('17 */6 * * *', () => checkAndStartRFBImport('scheduled-check'));
  cron.schedule('30 7 * * *', async () => {
    try {
      await runComprasSync();
    } catch (error) {
      console.error('Error running automatic compras sync:', error);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // Atualização PCA diária, com horário explícito para não depender do timezone do container.
  cron.schedule('45 7 * * *', async () => {
    if (!dataLayerReady) {
      console.log('[pca] daily sync adiado: camada de dados ainda não inicializada');
      return;
    }
    if (pcaBootstrapState.running) {
      console.log('[pca] daily sync ignorado: preparação inicial em andamento');
      return;
    }
    try {
      const result = await runPcaDailySync();
      console.log('[pca] daily sync ok:', result);
    } catch (error) {
      console.error('[pca] daily sync error:', error);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // Recupera automaticamente carga inicial vazia/interrompida, sem depender de abrir a tela.
  cron.schedule('*/30 * * * *', async () => {
    if (!dataLayerReady) return;
    try {
      await ensurePcaBootstrap();
    } catch (error) {
      console.error('[pca] verificação automática do bootstrap falhou:', error.message);
    }
  });

  // Assinaturas de editais → fila WhatsApp: 08:00 e 13:00, só dias úteis (seg–sex).
  cron.schedule('0 8,13 * * 1-5', async () => {
    try {
      const result = await runEditalWatchlistMatching();
      console.log('[editais] watchlist sync ok:', result);
    } catch (error) {
      console.error('[editais] watchlist sync error:', error);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // Remove da lista classificada itens com prazo de proposta vencido (todos os jobs).
  // Roda cedo: a recoleta das 08:20 não reintroduz vencidos (filtro recebendo_proposta).
  cron.schedule('5 5 * * *', async () => {
    if (!dataLayerReady) {
      console.log('[pncp-search-jobs] purge vencidos adiado: camada de dados ainda não inicializada');
      return;
    }
    try {
      await runDailyPncpExpiredResultsPurge();
    } catch (error) {
      console.error('[pncp-search-jobs] purge vencidos error:', error);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // Pipeline: suspenso com prazo vencido → Monitoramento (ativo → Perdido só com confirm na UI).
  cron.schedule('10 5 * * *', async () => {
    if (!dataLayerReady) return;
    try {
      const result = await runExpiredSuspensoToMonitoramento({});
      if (result.moved > 0) {
        console.log(`[licitacoes] auto-move suspenso→monitoramento: moved=${result.moved}`);
      }
    } catch (error) {
      console.error('[licitacoes] auto-move suspenso→monitoramento error:', error);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // Buscas de editais ainda ativas (sem watchlist, < 7 dias): recoleta diária mantendo o acervo.
  cron.schedule('20 8 * * *', async () => {
    if (!dataLayerReady) {
      console.log('[pncp-search-jobs] daily refresh adiado: camada de dados ainda não inicializada');
      return;
    }
    try {
      // Segunda passagem: prazos que viraram no dia após o purge das 05:05.
      await runDailyPncpExpiredResultsPurge().catch((err) => {
        console.warn('[pncp-search-jobs] purge pré-refresh falhou:', err.message);
      });
      const result = await runDailyPncpSearchJobRefresh({ limit: 10 });
      console.log('[pncp-search-jobs] daily refresh ok:', result);
    } catch (error) {
      console.error('[pncp-search-jobs] daily refresh error:', error);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // Reconcilia situação do acervo local (suspensão pós-captura) sem reler o índice.
  // Roda após o refresh (08:20) com orçamento por job — bulk, não rouba a UI.
  cron.schedule('50 8 * * *', async () => {
    if (!dataLayerReady) {
      console.log('[pncp-search-jobs] status reconcile adiado: camada de dados ainda não inicializada');
      return;
    }
    try {
      const result = await runDailyPncpStatusReconcile({ limit: 10 });
      console.log('[pncp-search-jobs] status reconcile ok:', result);
    } catch (error) {
      console.error('[pncp-search-jobs] status reconcile error:', error);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // Contratos/atas publicados no PNCP: roda antes do compras sync (07:30) e do
  // matcher de editais (08:00) para a aba Contratos/Resultados amanhecer fresca.
  cron.schedule('15 7 * * *', async () => {
    if (!dataLayerReady) {
      console.log('[contratos-sync] adiado: camada de dados ainda não inicializada');
      return;
    }
    try {
      const result = startPncpOutcomeSync({ reason: 'daily' });
      console.log('[contratos-sync] daily:', JSON.stringify(result));
    } catch (error) {
      console.error('[contratos-sync] daily error:', error);
    }
  }, { timezone: 'America/Sao_Paulo' });

  cron.schedule('*/5 * * * *', async () => {
    try {
      await resumePausedPncpSearchJobs();
      const backfill = await runPncpJobValueBackfill();
      if (backfill.updated > 0) console.log('[pncp-value-backfill] updated:', backfill);
      const result = await processWatchlistNotifications();
      if (result.processed > 0) console.log('[watchlist-notifications] processed:', result);
    } catch (error) {
      console.error('[watchlist-notifications] error:', error);
    }
  });

  // Digest de prazos do pipeline → inbox + push (dedupe diário por tipo).
  cron.schedule('15 8,14 * * 1-5', async () => {
    if (!dataLayerReady) return;
    try {
      const result = await emitDeadlineDigest(pool, {
        accountId: CHATWOOT_ACCOUNT_ID,
        // Digest de prazos: pipeline operacional (sem PCA) + 3 dias úteis BR.
        getLicitacaoOpenPipelineSql: getLicitacaoOperationalPipelineSql,
        runExpiredLicitacaoProposalMove,
        analyzeLicitacaoDeadlineSummary,
      });
      if (result.created > 0 || result.pushed > 0) {
        console.log('[notifications] deadline digest:', result);
      }
    } catch (error) {
      console.error('[notifications] deadline digest error:', error);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // Leads parados no Inbox (etapa 1) há 3+ dias.
  cron.schedule('30 9 * * 1-5', async () => {
    if (!dataLayerReady) return;
    try {
      const result = await emitFunnelStaleInboxDigest(pool, {
        accountId: CHATWOOT_ACCOUNT_ID,
        staleDays: 3,
      });
      if (result.count > 0) console.log('[notifications] stale inbox digest:', result);
    } catch (error) {
      console.error('[notifications] stale inbox digest error:', error);
    }
  }, { timezone: 'America/Sao_Paulo' });

  cron.schedule('0 4 1 1 *', async () => {
    try {
      const r = await pool.query(
        `DELETE FROM ${PCA_PLANOS_TABLE} WHERE ano_pca < EXTRACT(YEAR FROM NOW())::int`
      );
      console.log(`[pca] cleanup anual: ${r.rowCount} planos removidos`);
    } catch (error) {
      console.error('[pca] cleanup anual error:', error);
    }
  }, { timezone: 'America/Sao_Paulo' });
};

const initializeDataLayer = async () => {
  await createHistoryTable();
  await createActivityTable();
  await createCNPJCacheTable();
  await createRFBTables();

  // Índices pesados seguem em background e não seguram a disponibilidade do app.
  (async () => {
    const enderecoIdxs = [
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rfb_est_logradouro_trgm
         ON rfb_estabelecimentos USING gin(immutable_unaccent(lower(logradouro)) gin_trgm_ops)`,
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rfb_est_bairro_trgm
         ON rfb_estabelecimentos USING gin(immutable_unaccent(lower(bairro)) gin_trgm_ops)`,
    ];
    for (const sql of enderecoIdxs) {
      try { await pool.query(sql); }
      catch (error) { console.warn('[rfb] Índice GIN endereço:', error.message); }
    }
    console.log('[rfb] Índices GIN de endereço verificados.');
  })();

  if (!isEnvFlagEnabled(process.env.RFB_SKIP_AUTO_IMPORT)) {
    try {
      const { rows } = await pool.query('SELECT COUNT(*) FROM rfb_estabelecimentos');
      if (parseInt(rows[0].count, 10) === 0) {
        console.log('[rfb] Tabelas vazias — iniciando import automático...');
        startRFBImport({ reason: 'startup-empty-tables' });
      } else {
        setImmediate(() => checkAndStartRFBImport('startup-check'));
      }
    } catch (error) {
      console.error('[rfb] Erro ao verificar tabelas:', error.message);
    }
  } else {
    console.log('[rfb] Auto-import desabilitado por RFB_SKIP_AUTO_IMPORT.');
  }

  await createLicitacaoTables();
  await migrateLicitacaoFases();
  await createTrendsIntelTable();
  await seedHistorySnapshot();
  await resumePausedPncpSearchJobs();
  await pollStageChanges();
  // Limpa prazos vencidos que acumularam com o backend offline / antes do cron.
  setImmediate(() => {
    runDailyPncpExpiredResultsPurge().catch((err) => {
      console.warn('[pncp-search-jobs] purge vencidos no startup falhou:', err.message);
    });
    runExpiredSuspensoToMonitoramento({}).then((result) => {
      if (result.moved > 0) {
        console.log(`[licitacoes] auto-move suspenso→monitoramento no startup: moved=${result.moved}`);
      }
    }).catch((err) => {
      console.warn('[licitacoes] auto-move suspenso→monitoramento no startup falhou:', err.message);
    });
  });

  // Retoma buscas profundas ANTES do catch-up PCA — senão o heavy slot fica
  // com o PCA e os jobs de editais ficam "Na fila" sem coletar.
  const { rows } = await pool.query(
    `SELECT id FROM ${PNCP_SEARCH_JOBS_TABLE}
      WHERE status IN ('queued', 'running', 'paused_rate_limit')
      ORDER BY updated_at DESC
      LIMIT 10`
  );
  for (const row of rows) {
    startPersistedPncpSearchJob(row.id, { force: true, preserveResults: true }).catch(() => {});
  }
  if (rows.length) console.log(`[PNCP Search Job] retomando ${rows.length} busca(s) órfã(s) após restart.`);

  // PCA bootstrap/catch-up depois (e adia se ainda houver deep jobs vivos).
  setImmediate(() => {
    ensurePcaBootstrap()
      .then((bootstrap) => {
        if (!bootstrap?.started) return catchUpPcaSyncIfStale({ deferIfDeepJobs: true });
        return null;
      })
      .catch((error) => {
        console.warn('[pca] verificação inicial da base:', error.message);
      });
  });

  setImmediate(() => {
    ensurePncpOutcomeBootstrap().catch((error) => {
      console.warn('[pncp-outcomes] verificação inicial da base:', error.message);
    });
  });
};

let dataLayerInitializationRunning = false;
const initializeDataLayerWithRetry = async (attempt = 1) => {
  if (dataLayerInitializationRunning) return;
  dataLayerInitializationRunning = true;
  try {
    await initializeDataLayer();
    dataLayerReady = true;
    console.log('[startup] camada de dados inicializada');
  } catch (error) {
    dataLayerReady = false;
    const delayMs = Math.min(10000 * (2 ** Math.min(attempt - 1, 5)), 300000);
    console.error(`[startup] banco indisponível na tentativa ${attempt}; nova tentativa em ${Math.round(delayMs / 1000)}s:`, error.message);
    setTimeout(() => initializeDataLayerWithRetry(attempt + 1), delayMs);
  } finally {
    dataLayerInitializationRunning = false;
  }
};

const startServer = () => {
  // Os agendamentos são registrados mesmo se o Postgres subir depois do app.
  registerBackgroundSchedules();
  app.listen(port, () => {
    console.log(`Backend server listening at http://localhost:${port}`);
    setImmediate(() => initializeDataLayerWithRetry());
  });
};

startServer();
