#!/usr/bin/env node

const fs = require('fs');

const [outputPath, credentialId = 'AerionCrmTranscript01'] = process.argv.slice(2);
const token = String(process.env.CALL_TRANSCRIPTS_TOKEN || '').trim();
if (!outputPath || !token) {
  console.error('Uso: CALL_TRANSCRIPTS_TOKEN=<token> node write_call_transcript_credential.js <saida.json> [credential_id]');
  process.exit(2);
}

const credential = [{
  id: credentialId,
  name: 'Aerion — CRM Call Transcripts',
  data: {
    name: 'Authorization',
    value: `Bearer ${token}`,
  },
  type: 'httpHeaderAuth',
  isManaged: false,
  isGlobal: false,
  isResolvable: false,
  resolvableAllowFallback: false,
  resolverId: null,
}];

fs.writeFileSync(outputPath, `${JSON.stringify(credential, null, 2)}\n`, { mode: 0o600 });
console.log(`Credencial ${credentialId} preparada.`);
