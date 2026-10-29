const crypto = require('node:crypto');
const { encrypt, decrypt, encryptionKey } = require('./domain');
const truth = value => ['true', '1', 'yes', 'sim'].includes(String(value).toLowerCase());
const flags = ['whatsapp_opt_out', 'opt_out', 'nao_contatar', 'bloqueado'];
function segmentFor(stage) {
  const n = Number(String(stage || '').match(/^\d+/)?.[0]);
  if ([13, 18, 23].includes(n)) return 'customers';
  if (n >= 6 && n <= 12) return 'qualified';
  if (n >= 1 && n <= 5) return 'early';
  if ([15, 17].includes(n)) return 'nurturing';
  return [14, 16].includes(n) ? 'excluded' : 'unclassified';
}
function advertisingEligible(record, now = Date.now()) {
  const attrs = record.custom_attributes || {}, additional = record.additional_attributes || {};
  if (flags.some(f => truth(record[f]) || truth(attrs[f]) || truth(additional[f]))) return false;
  const proof = record.consent || attrs.aerion_advertising_consent;
  return proof?.status === 'granted' && proof.ad_user_data === true && proof.ad_personalization === true
    && typeof proof.source === 'string' && proof.source.trim().length > 0
    && Number.isFinite(Date.parse(proof.recorded_at)) && Date.parse(proof.recorded_at) <= now && !proof.withdrawn_at;
}
function emailHash(email, platform) {
  let normalized = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  if (platform === 'google_ads') {
    const [local, domain] = normalized.split('@');
    if (['gmail.com', 'googlemail.com'].includes(domain)) normalized = `${local.replace(/\./g, '')}@${domain}`;
  }
  return crypto.createHash('sha256').update(normalized).digest('hex');
}
function desiredMembers(records, mapping) {
  // A suppression on any duplicate email wins across that source's records.
  const suppressed = new Set(records.filter(r => !advertisingEligible(r)).map(r => emailHash(r.email, mapping.platform)).filter(Boolean));
  return [...new Set(records.filter(r => advertisingEligible(r)
    && (mapping.source !== 'crm' || segmentFor(r.custom_attributes?.Funil_Vendas) === mapping.segment))
    .map(r => emailHash(r.email, mapping.platform)).filter(h => h && !suppressed.has(h)))].sort();
}
function parseMappings(env) {
  let mappings;
  try { mappings = JSON.parse(env.ECOMMERCE_CUSTOMER_LISTS || '[]'); } catch { throw new Error('audience_mapping_required'); }
  if (!Array.isArray(mappings) || !mappings.length) throw new Error('audience_mapping_required');
  const destinations = new Set();
  for (const m of mappings) {
    if (!['store', 'crm'].includes(m.source) || !['meta_ads', 'google_ads'].includes(m.platform)
      || !/^\d+$/.test(m.id || '') || m.managedBy !== 'aerion_crm'
      || (m.source === 'crm' && !['customers', 'qualified', 'early', 'nurturing', 'excluded'].includes(m.segment))) throw new Error('audience_mapping_required');
    const key = `${m.platform}:${m.id}`;
    // One list cannot combine distribution/CRM and storefront, or two CRM stages.
    if (destinations.has(key)) throw new Error('audience_destination_collision');
    destinations.add(key);
  }
  return mappings;
}
async function createCustomerAudienceTables(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS ecommerce_marketing_memberships (
    platform text NOT NULL, destination text NOT NULL, account text NOT NULL, source text NOT NULL,
    members text NOT NULL, pending text, state text NOT NULL DEFAULT 'pending',
    updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(platform,destination)
  )`);
}
async function syncCustomerAudiences({ db, providers, env, configFor }) {
  const mappings = parseMappings(env);
  const key = encryptionKey(env), records = {}, results = [];
  if (mappings.some(m => m.source === 'crm')) {
    records.crm = (await db.query('SELECT email,custom_attributes,additional_attributes FROM contacts WHERE account_id=$1', [Number(env.CHATWOOT_ACCOUNT_ID || 2)])).rows;
  }
  if (mappings.some(m => m.source === 'store')) {
    const config = await configFor('woocommerce');
    const all = [];
    for (let page = 1; page <= 10000; page++) {
      const { data } = await providers.bridge(config, 'marketing-audience-customers', { page, per_page: 100 });
      if (!Array.isArray(data.customers) || data.complete_page !== true) throw new Error('audience_source_incomplete');
      all.push(...data.customers);
      if (data.customers.length < 100) break;
      if (page === 10000) throw new Error('audience_source_incomplete');
    }
    records.store = all;
  }
  for (const m of mappings) {
    const config = await configFor(m.platform);
    const account = String(config.account_id || config.customer_id);
    const old = (await db.query('SELECT * FROM ecommerce_marketing_memberships WHERE platform=$1 AND destination=$2', [m.platform, m.id])).rows[0];
    if (old && (old.account !== account || old.source !== `${m.source}:${m.segment || 'registered'}`)) throw new Error('audience_destination_collision');
    let members = old ? decrypt(old.members, key).hashes : [];
    if (old?.pending) {
      const pending = decrypt(old.pending, key);
      const status = await providers.customerAudienceJob(config, pending.job);
      if (status !== 'SUCCESS') {
        if (status === 'FAILED') {
          await db.query("UPDATE ecommerce_marketing_memberships SET pending=NULL,state='failed' WHERE platform=$1 AND destination=$2", [m.platform, m.id]);
          throw new Error('audience_upload_failed');
        }
        results.push({ source: m.source, segment: m.segment, platform: m.platform, destination: m.id, status: 'awaiting_external_processing', size: null });
        continue;
      }
      members = pending.hashes;
      await db.query("UPDATE ecommerce_marketing_memberships SET members=$3,pending=NULL,state='submitted',updated_at=now() WHERE platform=$1 AND destination=$2", [m.platform, m.id, encrypt({ hashes: members }, key)]);
    }
    const desired = desiredMembers(records[m.source], m);
    const desiredSet = new Set(desired), current = new Set(members);
    const removals = members.filter(h => !desiredSet.has(h)), additions = desired.filter(h => !current.has(h));
    if (!old) await db.query(`INSERT INTO ecommerce_marketing_memberships(platform,destination,account,source,members) VALUES($1,$2,$3,$4,$5)`, [m.platform, m.id, account, `${m.source}:${m.segment || 'registered'}`, encrypt({ hashes: [] }, key)]);
    // Removals always precede additions. Each successful Meta batch advances the
    // encrypted ledger, so a later failure retries only unfinished operations.
    if (m.platform === 'meta_ads') {
      for (const [operation, hashes] of [['remove', removals], ['add', additions]]) {
        for (let offset = 0; offset < hashes.length; offset += 500) {
          const batch = hashes.slice(offset, offset + 500);
          await providers.customerAudienceBatch(config, m.id, operation, batch);
          const next = new Set(members);
          batch.forEach(h => operation === 'remove' ? next.delete(h) : next.add(h));
          members = [...next].sort();
          await db.query("UPDATE ecommerce_marketing_memberships SET members=$3,state='submitted',updated_at=now() WHERE platform=$1 AND destination=$2", [m.platform, m.id, encrypt({ hashes: members }, key)]);
        }
      }
    } else if (removals.length || additions.length) {
      const job = await providers.customerAudienceGoogle(config, m.id, additions, removals);
      await db.query("UPDATE ecommerce_marketing_memberships SET pending=$3,state='processing',updated_at=now() WHERE platform=$1 AND destination=$2", [m.platform, m.id, encrypt({ job, hashes: desired }, key)]);
    }
    results.push({ source: m.source, segment: m.segment || 'registered', platform: m.platform, destination: m.id,
      status: 'awaiting_external_processing', eligible: desired.length, added: additions.length, removed: removals.length, size: null });
  }
  return { observedAt: new Date().toISOString(), lists: results, containsIdentifiers: false };
}
module.exports = { advertisingEligible, emailHash, desiredMembers, parseMappings, createCustomerAudienceTables, syncCustomerAudiences };
