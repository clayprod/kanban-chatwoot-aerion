const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SEGMENTOS, carregarConfigSegmento, avaliarSegmento, montarPromptSegmento, runSegmentClassificationTick,
} = require('../segmentoClassifier');

const CFG = { ...carregarConfigSegmento(), enabled: true, dryRun: false };

test('defaults são seguros sem nenhuma env var', () => {
  const c = carregarConfigSegmento();
  assert.equal(c.enabled, false);
  assert.equal(c.dryRun, true);
  assert.equal(c.maxPorDia, 40);
});

test('etiquetas de origem/vendedor não são segmento', () => {
  for (const n of ['comercial_aerion', 'ian_aerion', 'key_account', 'prospeccao-ia', 'leads_desqualificados']) {
    assert.equal(Object.hasOwn(SEGMENTOS, n), false, n);
  }
  assert.equal(Object.hasOwn(SEGMENTOS, 'construcao_e_topografia'), true);
});

test('só etiqueta com segmento válido e confiança suficiente', () => {
  assert.equal(avaliarSegmento({ segmento: 'nenhum', confianca: 1, config: CFG }).acao, 'skipped');
  assert.equal(avaliarSegmento({ segmento: 'inventado', confianca: 1, config: CFG }).acao, 'skipped');
  assert.equal(avaliarSegmento({ segmento: 'agricultura', confianca: 0.5, config: CFG }).acao, 'skipped');
  assert.equal(avaliarSegmento({ segmento: 'agricultura', confianca: 0.9, config: CFG }).acao, 'applied');
});

test('o prompt lista os segmentos e manda recusar na dúvida', () => {
  const { system, user } = montarPromptSegmento({
    contato: { name: 'Acme Topografia', empresa: 'Acme' }, historico: [{ autor: 'cliente', texto: 'fazemos levantamento' }],
  });
  for (const k of Object.keys(SEGMENTOS)) assert.ok(system.includes(k), k);
  assert.match(system, /"nenhum"/);
  assert.match(user, /fazemos levantamento/);
});

// Pool falso: devolve 1 candidato, etiquetas atuais por tipo e guarda o log.
const fakePool = ({ candidato, atuais = {} } = {}) => {
  const gravados = [];
  return {
    gravados,
    query: async (sql, params = []) => {
      if (/COUNT\(\*\)::int AS total/.test(sql)) return { rows: [{ total: 0 }] };
      if (/FROM contacts c/.test(sql)) return { rows: candidato ? [candidato] : [] };
      if (/FROM conversations WHERE/.test(sql)) return { rows: [{ id: 700 }] };
      if (/FROM taggings g JOIN tags t/.test(sql)) return { rows: (atuais[params[0]] || []).map((name) => ({ name })) };
      if (/INSERT INTO ai_segment_log/.test(sql)) { gravados.push({ status: params[5], segmento: params[2] }); return { rows: [] }; }
      return { rows: [] };
    },
  };
};

test('aplica a etiqueta MESCLADA no contato e na conversa, sem apagar as existentes', async () => {
  const pool = fakePool({
    candidato: { contact_id: 5, name: 'Acme', empresa: 'Acme Topografia', atributos: {} },
    atuais: { Contact: ['comercial_aerion'], Conversation: ['ian_aerion'] },
  });
  const aplicados = [];
  const r = await runSegmentClassificationTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => ({ ok: true, data: { segmento: 'construcao_e_topografia', confianca: 0.9, motivo: 'topografia' } }),
    carregarContextoConversa: async () => [{ autor: 'cliente', texto: 'topografia' }],
    aplicarEtiquetas: async (a) => { aplicados.push(a); },
    config: CFG,
  });
  assert.equal(r.etiquetados, 1);
  assert.deepEqual(aplicados.map((a) => a.labels), [
    ['comercial_aerion', 'construcao_e_topografia'],
    ['ian_aerion', 'construcao_e_topografia'],
  ]);
  assert.equal(pool.gravados.at(-1).status, 'applied');
});

test('dry run decide mas não escreve no Chatwoot', async () => {
  const pool = fakePool({ candidato: { contact_id: 5, name: 'Acme', atributos: {} } });
  const r = await runSegmentClassificationTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => ({ ok: true, data: { segmento: 'agricultura', confianca: 0.95, motivo: 'fazenda' } }),
    carregarContextoConversa: async () => [],
    aplicarEtiquetas: async () => { throw new Error('não deveria escrever'); },
    config: { ...CFG, dryRun: true },
  });
  assert.equal(r.etiquetados, 1);
  assert.equal(pool.gravados.at(-1).status, 'dry_run');
});

test('desligado não consulta nada', async () => {
  const r = await runSegmentClassificationTick(fakePool(), {
    accountId: 2, chatCompletionJson: null, carregarContextoConversa: null, aplicarEtiquetas: null,
    config: { ...CFG, enabled: false },
  });
  assert.deepEqual(r, { skipped: 'desligado' });
});
