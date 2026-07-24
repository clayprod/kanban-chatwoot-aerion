#!/usr/bin/env node

const fs = require('fs');

const [inputPath, outputPath, credentialId = 'AerionCrmTranscript01'] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('Uso: node patch_call_transcript_workflow.js <entrada.json> <saida.json> [credential_id]');
  process.exit(2);
}

const workflows = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (!Array.isArray(workflows) || workflows.length !== 1) {
  throw new Error('O arquivo deve conter exatamente um workflow exportado pelo n8n.');
}

const workflow = workflows[0];
if (workflow.id !== 'AerionAstTranscript') {
  throw new Error(`Workflow inesperado: ${workflow.id || '(sem id)'}.`);
}

const sourceName = 'Salvar JSON final';
const targetName = 'Confirmar JSON salvo';
const crmNodeName = 'Enviar transcrição ao CRM';
const sourceNode = workflow.nodes.find((node) => node.name === sourceName);
const targetNode = workflow.nodes.find((node) => node.name === targetName);
if (!sourceNode || !targetNode) {
  throw new Error('Nós esperados do pipeline de transcrição não foram encontrados.');
}

const crmNode = {
  id: 'send-transcript-to-crm',
  name: crmNodeName,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [1120, 260],
  parameters: {
    method: 'POST',
    url: 'http://kanban-chatwoot-aerion/api/call-transcripts',
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: "={{ $('Unificar falas e metadados').first().json }}",
    options: {
      timeout: 20000,
    },
  },
  credentials: {
    httpHeaderAuth: {
      id: credentialId,
      name: 'Aerion — CRM Call Transcripts',
    },
  },
};

const existingIndex = workflow.nodes.findIndex((node) => node.name === crmNodeName);
if (existingIndex >= 0) workflow.nodes[existingIndex] = crmNode;
else workflow.nodes.push(crmNode);

targetNode.position = [1340, 260];
workflow.connections[sourceName] = {
  main: [[{ node: crmNodeName, type: 'main', index: 0 }]],
};
workflow.connections[crmNodeName] = {
  main: [[{ node: targetName, type: 'main', index: 0 }]],
};

fs.writeFileSync(outputPath, `${JSON.stringify(workflows, null, 2)}\n`, { mode: 0o600 });
console.log(`Workflow ${workflow.id} preparado com envio idempotente ao CRM.`);
