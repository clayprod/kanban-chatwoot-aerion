const express = require('express');
const crypto = require('node:crypto');
const { encrypt, decrypt, encryptionKey } = require('./ecommerce/domain');

const ORIGIN = 'https://api-empresa100.gohobby.com.br';
const RESOURCES = { orders: '/v1/vendas/pedidos', invoices: '/v1/vendas/nfe' };
const fail = (message, status = 502) => Object.assign(new Error(message), { status, erpSafe: true });
function erpDate(value) {
  const text = String(value || '');
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(text);
  const date = br ? `${br[3]}-${br[2]}-${br[1]}` : text.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date))
    && new Date(date).toISOString().slice(0, 10) === date ? date : null;
}
function normalizeHeader(row, companyId, resource) {
  if (!row || typeof row !== 'object' || (row.codigoEmpresa != null && Number(row.codigoEmpresa) !== companyId)) {
    throw fail('O proxy retornou um documento fora da empresa configurada.');
  }
  const id = String(row.codigoNota || '');
  if (!/^[1-9]\d{0,17}$/.test(id)) throw fail('Documento sem codigoNota válido; lote não confirmado.');
  const rawTotal = row.valorNota;
  const total = rawTotal !== '' && rawTotal != null ? Number(rawTotal) : NaN;
  if (!Number.isFinite(total)) throw fail('Documento sem valorNota numérico; lote não confirmado.');
  const date = erpDate(row.dataNegociacao);
  if (!date) throw fail('Documento sem dataNegociacao válida; lote não confirmado.');
  // Fiscal/customer identifiers, addresses and financial titles are deliberately
  // omitted. These operational snapshots do not replace product-level revenue.
  return { id, companyId, number: String(row.numeroNota || ''), resource,
    date, modifiedAt: String(row.dataHoraAlteracao || ''),
    total, currency: ['REAL', 'REAIS', 'BRL', 'R$'].includes(String(row.nomeMoeda || '').trim().toUpperCase()) ? 'BRL' : null,
    invoiceStatus: row.statusNFe == null ? null : String(row.statusNFe),
    authorized: resource === 'invoices' && String(row.statusNFe) === '1',
    confirmed: ['S', 'SIM', 'TRUE', '1'].includes(String(row.confirmada).toUpperCase()),
    pending: ['S', 'SIM', 'TRUE', '1'].includes(String(row.pendente).toUpperCase()),
    originOrderId: String(row.codigoPedidoOrigem || ''), sellerCode: String(row.codigoVendedor || ''),
  };
}
function parsePage(body, resource, companyId) {
  const keys = resource === 'orders' ? ['pedido', 'pedidos'] : ['nota', 'notas', 'nfe', 'notasFiscais'];
  const key = keys.find(k => Object.prototype.hasOwnProperty.call(body || {}, k));
  if (!key || !body.pagination || body[key] == null) throw fail('Formato da listagem incompatível; última importação preservada.');
  const rows = Array.isArray(body[key]) ? body[key] : [body[key]];
  const more = body.pagination.hasMore;
  if (![true, false, 'true', 'false', 'S', 'N', 1, 0, '1', '0'].includes(more)) throw fail('Paginação sem hasMore válido; lote não confirmado.');
  return { rows: rows.map(row => normalizeHeader(row, companyId, resource)), hasMore: [true, 'true', 'S', 1, '1'].includes(more) };
}
async function createTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sankhya_reporting_connections (
      company_id int PRIMARY KEY, origin text NOT NULL, secrets text NOT NULL,
      enabled boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sankhya_reporting_streams (
      company_id int NOT NULL REFERENCES sankhya_reporting_connections(company_id), resource text NOT NULL,
      status text NOT NULL DEFAULT 'pending', error text, cursor jsonb, published_generation text, previous_generation text,
      last_success_at timestamptz, last_attempt_at timestamptz,
      next_run_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(company_id,resource)
    );
    CREATE TABLE IF NOT EXISTS sankhya_reporting_documents (
      company_id int NOT NULL, resource text NOT NULL, document_id text NOT NULL,
      date date, data jsonb NOT NULL, generation text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(company_id,resource,document_id,generation)
    );
    CREATE INDEX IF NOT EXISTS sankhya_reporting_dates ON sankhya_reporting_documents(company_id,resource,date);
  `);
}
function createSankhyaReporting({ pool, authorize, env = process.env, transport = fetch }) {
  let ready, ticking = false;
  const ensure = () => ready || (ready = createTables(pool).catch(error => { ready = null; throw error; }));
  const router = express.Router();
  router.use(authorize);
  router.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin) {
      let url; try { url = new URL(origin); } catch { return res.status(403).json({ error: 'Origem não autorizada.' }); }
      let publicOrigin; try { publicOrigin = new URL(env.ECOMMERCE_PUBLIC_URL).origin; } catch { /* Same-host requests still work. */ }
      if (url.host !== req.get('host') && url.origin !== publicOrigin) return res.status(403).json({ error: 'Origem não autorizada.' });
    }
    next();
  });
  router.use(async (req, res, next) => {
    try { await ensure(); next(); } catch { res.status(503).json({ error: 'Integração ERP indisponível.' }); }
  });
  router.put('/connections/:companyId', async (req, res) => {
    const companyId = Number(req.params.companyId);
    // This partner contract authorizes only 102. Adding another company requires
    // an updated provider contract, not sending codigoEmpresa=100 to this proxy.
    if (companyId !== 102) return res.status(400).json({ error: 'O contrato atual permite somente a empresa 102.' });
    if (req.body.origin && req.body.origin !== ORIGIN) return res.status(400).json({ error: 'Origem ERP não autorizada.' });
    const old = (await pool.query('SELECT secrets FROM sankhya_reporting_connections WHERE company_id=$1', [companyId])).rows[0];
    const key = String(req.body.partner_key || '').trim() || (old ? decrypt(old.secrets, encryptionKey(env)).partner_key : '');
    if (!key || key.length > 1000 || /[\r\n]/.test(key)) return res.status(400).json({ error: 'Informe uma chave de parceiro válida.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO sankhya_reporting_connections(company_id,origin,secrets,enabled) VALUES($1,$2,$3,$4)
        ON CONFLICT(company_id) DO UPDATE SET secrets=EXCLUDED.secrets,enabled=EXCLUDED.enabled,updated_at=now()`,
      [companyId, ORIGIN, encrypt({ partner_key: key }, encryptionKey(env)), req.body.enabled === true]);
      for (const resource of Object.keys(RESOURCES)) await client.query(`INSERT INTO sankhya_reporting_streams(company_id,resource) VALUES($1,$2)
        ON CONFLICT(company_id,resource) DO UPDATE SET next_run_at=now()`, [companyId, resource]);
      await client.query('COMMIT');
      res.json({ saved: true, companyId, enabled: req.body.enabled === true });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
  router.post('/sync', async (req, res) => {
    await pool.query(`UPDATE sankhya_reporting_streams SET next_run_at=now()
      WHERE company_id IN (SELECT company_id FROM sankhya_reporting_connections WHERE enabled)`);
    res.status(202).json({ queued: true });
  });
  router.get('/report', async (req, res) => {
    const year = Number(req.query.ano || new Date().getFullYear());
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return res.status(400).json({ error: 'Ano inválido.' });
    const { rows } = await pool.query(`SELECT c.company_id,c.enabled,s.resource,s.status,s.error,s.last_success_at,s.last_attempt_at,s.next_run_at,
        count(d.document_id)::int AS documents,
        count(d.document_id) FILTER (WHERE coalesce(d.data->>'currency','')<>'BRL')::int AS unknown_currency_documents,
        coalesce(sum((d.data->>'total')::numeric),0)::float AS gross_total,
        count(d.document_id) FILTER (WHERE d.data->>'authorized'='true')::int AS authorized_documents,
        coalesce(sum((d.data->>'total')::numeric) FILTER (WHERE d.data->>'authorized'='true'),0)::float AS authorized_gross_total
      FROM sankhya_reporting_connections c JOIN sankhya_reporting_streams s USING(company_id)
      LEFT JOIN sankhya_reporting_documents d ON d.company_id=c.company_id AND d.resource=s.resource AND d.generation=s.published_generation
        AND d.date >= make_date($1,1,1) AND d.date < make_date($1+1,1,1)
      GROUP BY c.company_id,c.enabled,s.resource,s.status,s.error,s.last_success_at,s.last_attempt_at,s.next_run_at
      ORDER BY c.company_id,s.resource`, [year]);
    res.json({ year, source: 'sankhya_partner_proxy', currentRevenueSource: 'existing_reporting_database',
      scope: 'Empresa 102 e documentos visíveis à chave de parceiro; não consolida a empresa 100.',
      note: 'Pedidos não são faturamento. Valores de notas são brutos; não substituem a receita de produtos das metas.',
      streams: rows.map(row => ({ ...row, gross_total: row.last_success_at && !row.unknown_currency_documents ? row.gross_total : null,
        authorized_gross_total: row.last_success_at && !row.unknown_currency_documents ? row.authorized_gross_total : null })) });
  });
  async function run(companyId, resource, { force = false } = {}) {
    if (companyId !== 102 || !RESOURCES[resource]) throw fail('Empresa ou recurso não autorizado.', 400);
    await ensure();
    const client = await pool.connect();
    let locked = false;
    try {
      locked = (await client.query('SELECT pg_try_advisory_lock($1) AS locked', [791000 + companyId])).rows[0].locked;
      if (!locked) return;
      const connection = (await client.query('SELECT * FROM sankhya_reporting_connections WHERE company_id=$1', [companyId])).rows[0];
      const state = (await client.query('SELECT * FROM sankhya_reporting_streams WHERE company_id=$1 AND resource=$2', [companyId, resource])).rows[0];
      if (!connection?.enabled || !state || (!force && new Date(state.next_run_at) > new Date())) return;
      if (connection.origin !== ORIGIN) throw fail('Origem ERP não autorizada.');
      const { partner_key: key } = decrypt(connection.secrets, encryptionKey(env));
      let cursor = state.cursor || { page: 0, generation: crypto.randomUUID() };
      await client.query("UPDATE sankhya_reporting_streams SET status='syncing',last_attempt_at=now(),error=NULL WHERE company_id=$1 AND resource=$2", [companyId, resource]);
      // Small bounded batches. Persistent page checkpoints survive restarts and
      // independent invoice failures never stop the order stream.
      for (let batch = 0; batch < 3; batch++) {
        const response = await transport(`${ORIGIN}${RESOURCES[resource]}?page=${cursor.page}`, {
          method: 'GET', headers: { 'X-Partner-Key': key, Accept: 'application/json' },
          redirect: 'error', signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) throw fail(`Consulta ${resource === 'orders' ? 'de pedidos' : 'de notas fiscais'} recusada pelo proxy (HTTP ${response.status}). Últimos dados preservados.`);
        let body; try { body = await response.json(); } catch { throw fail('O proxy não retornou JSON válido. Últimos dados preservados.'); }
        const page = parsePage(body, resource, companyId);
        if (cursor.page > 10000) throw fail('Limite de paginação atingido; importação não considerada completa.');
        await client.query('BEGIN');
        try {
          for (const row of page.rows) await client.query(`INSERT INTO sankhya_reporting_documents(company_id,resource,document_id,date,data,generation)
            VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(company_id,resource,document_id,generation) DO UPDATE
            SET date=EXCLUDED.date,data=EXCLUDED.data,updated_at=now()`,
          [companyId, resource, row.id, row.date, row, cursor.generation]);
          if (!page.hasMore) {
            await client.query(`UPDATE sankhya_reporting_streams SET cursor=NULL,status='connected',error=NULL,last_success_at=now(),next_run_at=now()+interval '30 minutes',
                previous_generation=published_generation,published_generation=$3 WHERE company_id=$1 AND resource=$2`, [companyId, resource, cursor.generation]);
            await client.query(`DELETE FROM sankhya_reporting_documents d WHERE d.company_id=$1 AND d.resource=$2
              AND d.generation<>$3 AND NOT EXISTS (SELECT 1 FROM sankhya_reporting_streams s
                WHERE s.company_id=d.company_id AND s.resource=d.resource AND s.previous_generation=d.generation)`, [companyId, resource, cursor.generation]);
          } else {
            cursor = { ...cursor, page: cursor.page + 1 };
            await client.query(`UPDATE sankhya_reporting_streams SET cursor=$3,status='pending',next_run_at=now() WHERE company_id=$1 AND resource=$2`, [companyId, resource, cursor]);
          }
          await client.query('COMMIT');
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        if (!page.hasMore) break;
      }
    } catch (error) {
      // Never echo upstream bodies, headers, URLs containing credentials, or
      // transport errors. Operator diagnostics stay useful without secret leaks.
      const message = error.erpSafe ? error.message : 'Falha de comunicação com o ERP. Últimos dados preservados; nova tentativa em 30 minutos.';
      await client.query(`UPDATE sankhya_reporting_streams SET status='error',error=$3,next_run_at=now()+interval '30 minutes' WHERE company_id=$1 AND resource=$2`, [companyId, resource, message]);
    } finally {
      if (locked) await client.query('SELECT pg_advisory_unlock($1)', [791000 + companyId]);
      client.release();
    }
  }
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      await ensure();
      const { rows } = await pool.query(`SELECT s.company_id,s.resource FROM sankhya_reporting_streams s
        JOIN sankhya_reporting_connections c USING(company_id) WHERE c.enabled AND s.next_run_at<=now()
        ORDER BY s.next_run_at LIMIT 2`);
      for (const row of rows) await run(row.company_id, row.resource);
    } finally { ticking = false; }
  }
  return { router, ensure, tick, run };
}
module.exports = { createSankhyaReporting, normalizeHeader, parsePage, erpDate };
