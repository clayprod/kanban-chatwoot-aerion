'use strict';
const { randomUUID } = require('node:crypto');
async function createDiscoveries(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS prospecting_discoveries (
    id UUID PRIMARY KEY, account_id INTEGER NOT NULL, original_cnpj TEXT, telefone TEXT NOT NULL,
    empresa JSONB NOT NULL, evidence JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(account_id, telefone))`);
  await pool.query('ALTER TABLE prospeccao_log ADD COLUMN IF NOT EXISTS discovery_id UUID');
  await pool.query('ALTER TABLE prospeccao_log ADD COLUMN IF NOT EXISTS outbound_queue_id BIGINT');
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS prospeccao_discovery_id ON prospeccao_log(account_id,discovery_id) WHERE discovery_id IS NOT NULL`);
}
async function saveDiscoveries(pool, accountId, original, found) {
  for (const d of (found || []).slice(0, 2)) {
    if (!d.titularidadeComprovada || !d.empresaEncontrada?.razao_social || !/^55\d{10,11}$/.test(d.numero)) continue;
    await pool.query(`INSERT INTO prospecting_discoveries(id,account_id,original_cnpj,telefone,empresa,evidence)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(account_id,telefone) DO NOTHING`,
    [randomUUID(), accountId, original.cnpj || null, d.numero, JSON.stringify(d.empresaEncontrada), JSON.stringify(d)]);
  }
}
async function loadDiscoveries(pool, accountId) {
  const { rows } = await pool.query(`SELECT d.* FROM prospecting_discoveries d
    WHERE d.account_id=$1 AND NOT EXISTS(SELECT 1 FROM prospeccao_log p WHERE p.account_id=d.account_id AND p.discovery_id=d.id
      AND (p.proxima_tentativa IS NULL OR p.proxima_tentativa>NOW()))
    AND NOT EXISTS(SELECT 1 FROM contacts c WHERE c.account_id=d.account_id AND regexp_replace(COALESCE(c.phone_number,''),'[^0-9]','','g')=d.telefone)
    ORDER BY d.created_at LIMIT 10`, [accountId]);
  return rows.map(d => ({ ...d.empresa, cnpj: null, _discovery_id: d.id, _evidence: d.evidence, telefone: d.telefone }));
}
async function importDiscovery(pool, accountId, empresa) {
  if (!empresa._discovery_id || !empresa._evidence?.titularidadeComprovada) throw new Error('Descoberta sem evidência de titularidade');
  const { withAccountLock } = require('./prospectingBudget');
  const result = await withAccountLock(pool, `discovery:${accountId}:${empresa.telefone_verificado}`, async db => {
    const phone = empresa.telefone_verificado;
    // Do not overwrite, merge or contact an existing CRM number (including opt-outs).
    const existing = await db.query(`SELECT id FROM contacts WHERE account_id=$1 AND regexp_replace(COALESCE(phone_number,''),'[^0-9]','','g')=$2`, [accountId, phone]);
    if (existing.rows.length) throw new Error('Telefone já cadastrado no CRM; descoberta não será abordada novamente');
    const evidence = empresa._evidence;
    const row = await db.query(`INSERT INTO contacts(account_id,name,phone_number,custom_attributes,additional_attributes,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,NOW(),NOW()) RETURNING id`, [accountId, empresa.razao_social.slice(0,255), `+${phone}`,
      JSON.stringify({ Funil_Vendas: '1. Inbox (Novos)' }), JSON.stringify({company_name:empresa.razao_social,prospecting_discovery_id:empresa._discovery_id,
        phone_provenance:{source:evidence.origem,chain:evidence.chain,checked_at:new Date().toISOString()},legal_identity:'CNPJ não confirmado'})]);
    return row.rows[0]?.id;
  });
  if(result?.skipped)throw new Error('Importação em execução; tentar depois');
  return result;
}
module.exports = { createDiscoveries, saveDiscoveries, loadDiscoveries, importDiscovery };
// Run once per account; no messaging, no reopening exclusions or known contacts.
module.exports.upgradeResearch = async (pool, accountId) => {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const marker = await db.query(`INSERT INTO ai_settings(chave,valor,updated_by) VALUES($1,'1','migration:research-v2') ON CONFLICT DO NOTHING RETURNING chave`, [`research_v2:${accountId}`]);
    if (marker.rows.length) {
      await db.query(`UPDATE prospeccao_log SET proxima_tentativa=NOW() WHERE account_id=$1 AND status='descartado'
        AND created_at>NOW()-INTERVAL '30 days' AND motivo ~* '(titularidade|na web:|fonte indispon|nenhum candidato|busca falhou)'
        AND motivo !~* '(SPE/SCP|fora dos ICPs|opt.out|bloqueado|não contatar)'`, [accountId]);
      await db.query("DELETE FROM busca_web_cache WHERE paginas='[]'::jsonb");
    }
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
};
