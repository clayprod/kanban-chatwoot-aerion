const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

test('insere o envio ao CRM entre a gravação do JSON e a resposta de sucesso', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aerion-workflow-'));
  const input = path.join(dir, 'input.json');
  const output = path.join(dir, 'output.json');
  const workflow = [{
    id: 'AerionAstTranscript',
    nodes: [
      { name: 'Salvar JSON final', position: [900, 260] },
      { name: 'Confirmar JSON salvo', position: [1120, 260] },
    ],
    connections: {
      'Salvar JSON final': {
        main: [[{ node: 'Confirmar JSON salvo', type: 'main', index: 0 }]],
      },
    },
  }];
  fs.writeFileSync(input, JSON.stringify(workflow));

  execFileSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'patch_call_transcript_workflow.js'),
    input,
    output,
    'TestCredential01',
  ]);

  const patched = JSON.parse(fs.readFileSync(output, 'utf8'))[0];
  const crmNode = patched.nodes.find((node) => node.name === 'Enviar transcrição ao CRM');
  assert.equal(crmNode.parameters.url, 'http://kanban-chatwoot-aerion/api/call-transcripts');
  assert.equal(crmNode.credentials.httpHeaderAuth.id, 'TestCredential01');
  assert.equal(
    patched.connections['Salvar JSON final'].main[0][0].node,
    'Enviar transcrição ao CRM'
  );
  assert.equal(
    patched.connections['Enviar transcrição ao CRM'].main[0][0].node,
    'Confirmar JSON salvo'
  );
});
