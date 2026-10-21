// Operational CLI: a dedicated workspace, immutable backup, version check before publish.
// Credentials stay on the server; no browser credentials or customer data are read.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildPlan } = require('./ecommerce.cjs');
const CONTAINER = 'accounts/6331136521/containers/239118574';
const PUBLIC_ID = 'GTM-5G8QBHHC';
const WORKSPACE = 'Aerion Ecommerce · medição validada';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
async function decode(response) {
  const data = await response.json();
  if (!response.ok) {
    const reason = data.error?.details?.find(d => d.reason)?.reason || data.error?.status || 'request_failed';
    throw new Error(`Google HTTP ${response.status}: ${reason}`);
  }
  return data;
}
async function token(account, scopes) {
  if (account.type !== 'workload_identity') throw new Error('Expected the dedicated server workload identity.');
  const now = Math.floor(Date.now() / 1000);
  const content = `${encode({ alg: 'RS256', typ: 'JWT', kid: account.key_id })}.${encode({ iss: account.issuer, sub: account.subject, aud: account.token_audience, iat: now, exp: now + 300 })}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(content), account.private_key).toString('base64url');
  const federated = await decode(await fetch('https://sts.googleapis.com/v1/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ audience: account.audience, grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token', subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      scope: 'https://www.googleapis.com/auth/cloud-platform', subject_token: `${content}.${signature}` }),
  }));
  const result = await decode(await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(account.client_email)}:generateAccessToken`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${federated.access_token}` },
    body: JSON.stringify({ scope: scopes.map(scope => `https://www.googleapis.com/auth/tagmanager.${scope}`), lifetime: '3600s' }),
  }));
  return result.accessToken;
}
async function main() {
  const args = process.argv.slice(2), value = name => args[args.indexOf(name) + 1];
  if (!args.includes('--credentials') || !args.includes('--state-dir')) throw new Error('Specify --credentials and a private --state-dir.');
  const prepare = args.includes('--prepare'), publish = args.includes('--publish');
  if (prepare && publish) throw new Error('Prepare and publish are separate operations.');
  const directory = path.resolve(value('--state-dir'));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const save = (name, object) => { fs.writeFileSync(path.join(directory, name), JSON.stringify(object, null, 2), { mode: 0o600 }); fs.chmodSync(path.join(directory, name), 0o600); };
  const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
  const account = JSON.parse(fs.readFileSync(value('--credentials'), 'utf8'));
  const access = await token(account, prepare || publish ? ['readonly', 'edit.containers', 'edit.containerversions', 'publish'] : ['readonly']);
  let last = 0;
  const request = async (endpoint, method = 'GET', body) => {
    await sleep(Math.max(0, 2200 - (Date.now() - last))); last = Date.now();
    return decode(await fetch(`https://tagmanager.googleapis.com/tagmanager/v2/${endpoint}`, {
      method, headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(45000),
    }));
  };
  const container = await request(CONTAINER);
  if (container.publicId !== PUBLIC_ID) throw new Error('Unexpected GTM container.');
  const live = await request(`${CONTAINER}/versions:live`);
  if (publish) {
    const state = read('prepared.json');
    if (state.container !== CONTAINER || !state.versionPath.startsWith(`${CONTAINER}/versions/`)) throw new Error('Unexpected prepared version.');
    if (live.containerVersionId !== state.baseVersion) throw new Error('Live version changed; review concurrent changes before publishing.');
    const result = await request(`${state.versionPath}:publish`, 'POST');
    if (result.compilerError) throw new Error('GTM reported compilation errors.');
    const current = await request(`${CONTAINER}/versions:live`);
    if (current.containerVersionId !== state.version) throw new Error('Published version could not be verified.');
    save('published.json', { ...state, publishedAt: new Date().toISOString() });
    console.log(JSON.stringify({ published: true, container: PUBLIC_ID, version: state.version, previousVersion: state.baseVersion }));
    return;
  }
  if (!prepare) {
    save('live-audit.json', live);
    console.log(JSON.stringify({ container: PUBLIC_ID, version: live.containerVersionId, tags: live.tag.map(t => ({ name: t.name, type: t.type })) }));
    return;
  }
  if (fs.existsSync(path.join(directory, 'prepared.json'))) throw new Error('A version is already prepared. Review or publish it before preparing another.');
  const backup = `live-before-${live.containerVersionId}.json`;
  if (!fs.existsSync(path.join(directory, backup))) save(backup, live);
  const plan = buildPlan(live);
  let workspace;
  if (fs.existsSync(path.join(directory, 'workspace.json'))) {
    const previous = read('workspace.json');
    if (previous.container !== CONTAINER || previous.baseVersion !== live.containerVersionId || !previous.workspace.startsWith(`${CONTAINER}/workspaces/`)) throw new Error('Previous workspace differs from the current live version.');
    workspace = await request(previous.workspace);
  } else {
    workspace = await request(`${CONTAINER}/workspaces`, 'POST', { name: WORKSPACE, description: 'Ecommerce pago, SKU, consentimento e deduplicação. Sem alterações de campanhas, orçamento ou conversões de leads.' });
  }
  save('workspace.json', { container: CONTAINER, workspace: workspace.path, baseVersion: live.containerVersionId });
  const upsert = async (kind, spec) => {
    const { triggers, accountId, containerId, workspaceId, tagId, path: resourcePath, fingerprint, ...body } = spec;
    if (triggers) body.firingTriggerId = triggers.map(name => triggerIds[name]);
    const old = (await request(`${workspace.path}/${kind}`))[kind === 'variables' ? 'variable' : kind === 'triggers' ? 'trigger' : 'tag']?.find(item => item.name === spec.name);
    if (old) return request(old.path, 'PUT', { ...body, fingerprint: old.fingerprint });
    return request(`${workspace.path}/${kind}`, 'POST', body);
  };
  for (const variable of plan.variables) await upsert('variables', variable);
  const triggerIds = {};
  for (const trigger of plan.triggers) triggerIds[trigger.name] = (await upsert('triggers', trigger)).triggerId;
  for (const tag of plan.tags) await upsert('tags', tag);
  const status = await request(`${workspace.path}/status`);
  if (status.mergeConflict?.length) throw new Error('GTM workspace has merge conflicts.');
  const created = await request(`${workspace.path}:create_version`, 'POST', { name: 'Aerion Ecommerce · compras pagas e consentimento', notes: 'GA4 ecommerce estruturado; Meta Purchase com event_id, SKU e consentimento. Mantém ações de leads Google Ads existentes.' });
  if (created.compilerError || created.syncStatus?.mergeConflict?.length || !created.containerVersion?.path) throw new Error('GTM did not compile a clean version.');
  save('prepared-version.json', created.containerVersion);
  const state = { container: CONTAINER, publicId: PUBLIC_ID, baseVersion: live.containerVersionId,
    version: created.containerVersion.containerVersionId, versionPath: created.containerVersion.path,
    workspace: workspace.path, preparedAt: new Date().toISOString(), changes: plan.tags.map(t => t.name) };
  save('prepared.json', state);
  console.log(JSON.stringify({ prepared: true, ...state }));
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { token };
