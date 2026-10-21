const test = require('node:test');
const assert = require('node:assert/strict');

const {
  carregarConfigStage,
  ORIGENS_PROTEGIDAS_PADRAO,
  avaliarSugestao,
  montarPromptStage,
  runStageClassificationTick,
  ALVOS_AUTOMATICOS_PADRAO,
} = require('../leadStage');

const ETAPAS = [
  '1. Inbox (Novos)', '2. Em Contato', '3. Follow-up 1', '5. Follow-up 3',
  '6. Qualificado (SQL)', '7. Agendamento Demo', '10. Proposta Enviada',
  '11. Em Negociação', '16. Descartado', '17. Nurturing', '18. Novos Clientes',
];

const CFG = {
  enabled: true,
  dryRun: false,
  janelaDias: 30,
  maxPorTick: 5,
  maxPorDia: 60,
  minConfianca: 0.7,
  alvosAutomaticos: ALVOS_AUTOMATICOS_PADRAO,
  origensProtegidas: ORIGENS_PROTEGIDAS_PADRAO,
  etapasFrias: ['16. Descartado', '17. Nurturing', '15. Pausado'],
  retomarMinDias: 15,
  retomarMaxDias: 180,
};

const CANDIDATO = {
  contact_id: 42,
  name: 'ACME Topografia',
  etapa_atual: '1. Inbox (Novos)',
  empresa: 'ACME',
  respondeu_em: '2026-10-20T13:00:00.000Z',
};

const HISTORICO = [
  { autor: 'nós', texto: 'Oi! Trabalham com drones?' },
  { autor: 'cliente', texto: 'Trabalhamos sim, mas já temos fornecedor DJI' },
];

// Pool falso: responde por assinatura da query e guarda o que foi gravado.
const fakePool = ({ candidatos = [], etapas = ETAPAS, aplicadosHoje = 0, contatoAtual } = {}) => {
  const gravados = [];
  const escritas = [];
  const client = {
    async query(sql, params) {
      if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) return { rows: [] };
      if (sql.includes('FOR UPDATE')) {
        return { rows: [{ custom_attributes: { Funil_Vendas: contatoAtual ?? CANDIDATO.etapa_atual }, account_id: 2 }] };
      }
      if (sql.includes('UPDATE contacts SET custom_attributes')) {
        escritas.push({ tipo: 'contato', etapa: params[0].Funil_Vendas, id: params[1] });
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO kanban_stage_history')) {
        escritas.push({ tipo: 'historico', de: params[2], para: params[3] });
        return { rows: [] };
      }
      throw new Error(`query de client inesperada: ${sql.slice(0, 50)}`);
    },
    release() {},
  };
  return {
    gravados,
    escritas,
    async connect() { return client; },
    async query(sql, params) {
      if (sql.includes('INSERT INTO ai_stage_log')) {
        gravados.push({ status: params[6], to: params[3], skip: params[7], error: params[10] });
        return { rows: [{ id: gravados.length }] };
      }
      if (sql.includes('COUNT(*)::int AS total')) return { rows: [{ total: aplicadosHoje }] };
      if (sql.includes('DISTINCT custom_attributes')) return { rows: etapas.map((e) => ({ etapa: e })) };
      if (sql.includes('WITH ult_in')) return { rows: candidatos };
      throw new Error(`query inesperada: ${sql.slice(0, 50)}`);
    },
  };
};

const contexto = (rows) => async () => rows;

test('defaults sao seguros sem nenhuma env var', () => {
  const salvos = {};
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('AI_STAGE_')) { salvos[k] = process.env[k]; delete process.env[k]; }
  }
  try {
    const cfg = carregarConfigStage();
    // Escrever no CRM sem ninguem pedir seria pior que nao escrever.
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.dryRun, true);
    // Confianca mais alta que a do follow-up: aqui muta dado, nao so manda mensagem.
    assert.equal(cfg.minConfianca, 0.7);
    assert.ok(!cfg.alvosAutomaticos.includes('10. Proposta Enviada'));
    assert.ok(!cfg.alvosAutomaticos.includes('11. Em Negociação'));
    assert.ok(cfg.alvosAutomaticos.includes('16. Descartado'));
  } finally {
    Object.assign(process.env, salvos);
  }
});

test('etapa de trabalho e aplicada; marco comercial so e sugerido', () => {
  assert.equal(
    avaliarSugestao({ etapaAtual: '1. Inbox (Novos)', sugerida: '17. Nurturing', confianca: 0.9, etapas: ETAPAS, config: CFG }).acao,
    'applied'
  );
  assert.equal(
    avaliarSugestao({ etapaAtual: '1. Inbox (Novos)', sugerida: '16. Descartado', confianca: 0.9, etapas: ETAPAS, config: CFG }).acao,
    'applied'
  );
  // Criar pipeline falso e pior que deixar o card parado.
  for (const marco of ['10. Proposta Enviada', '11. Em Negociação', '7. Agendamento Demo', '18. Novos Clientes']) {
    const v = avaliarSugestao({ etapaAtual: '2. Em Contato', sugerida: marco, confianca: 0.95, etapas: ETAPAS, config: CFG });
    assert.equal(v.acao, 'suggested', `${marco} deveria so sugerir`);
    assert.match(v.motivo, /confirmação humana/);
  }
});

test('nao rebaixa quem ja passou de marco comercial', () => {
  // A sombra propos "18. Novos Clientes -> 2. Em Contato" e "-> 16. Descartado".
  // Rebaixar quem ja comprou e estrago chato de desfazer: so sugere.
  for (const origem of ['18. Novos Clientes', '7. Agendamento Demo', '11. Em Negociação']) {
    const v = avaliarSugestao({
      etapaAtual: origem, sugerida: '2. Em Contato', confianca: 0.95, etapas: ETAPAS, config: CFG,
    });
    assert.equal(v.acao, 'suggested', `saida de ${origem} deveria so sugerir`);
    assert.match(v.motivo, /confirmação humana/);
  }
  // Nem para Descartado, que e o caso mais perigoso.
  assert.equal(
    avaliarSugestao({ etapaAtual: '18. Novos Clientes', sugerida: '16. Descartado', confianca: 1, etapas: ETAPAS, config: CFG }).acao,
    'suggested'
  );
  // Etapa de trabalho continua movendo normalmente.
  assert.equal(
    avaliarSugestao({ etapaAtual: '1. Inbox (Novos)', sugerida: '2. Em Contato', confianca: 0.85, etapas: ETAPAS, config: CFG }).acao,
    'applied'
  );
});

test('rejeita etapa inexistente, igual a atual, ou confianca insuficiente', () => {
  const base = { etapaAtual: '2. Em Contato', etapas: ETAPAS, config: CFG };
  assert.match(avaliarSugestao({ ...base, sugerida: 'Etapa Inventada', confianca: 0.99 }).motivo, /inexistente/);
  assert.match(avaliarSugestao({ ...base, sugerida: '2. Em Contato', confianca: 0.99 }).motivo, /já está correta/);
  assert.match(avaliarSugestao({ ...base, sugerida: '17. Nurturing', confianca: 0.5 }).motivo, /abaixo de/);
  assert.match(avaliarSugestao({ ...base, sugerida: '17. Nurturing', confianca: null }).motivo, /confiança ausente/);
  assert.match(avaliarSugestao({ ...base, sugerida: '', confianca: 0.9 }).motivo, /vazia/);
});

test('o prompt lista as etapas reais e manda julgar pelo cliente', () => {
  const { system, user } = montarPromptStage({ contato: CANDIDATO, historico: HISTORICO, etapas: ETAPAS });
  for (const e of ETAPAS) assert.ok(system.includes(e), `faltou ${e}`);
  assert.match(system, /Olhe o que o CLIENTE disse/);
  assert.match(system, /mais conservadora/);
  assert.match(user, /Etapa atual: 1\. Inbox \(Novos\)/);
  assert.match(user, /já temos fornecedor DJI/);
});

test('desligado nao consulta nada', async () => {
  const pool = fakePool({});
  const r = await runStageClassificationTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => { throw new Error('nao deveria chamar a IA'); },
    carregarContextoConversa: contexto(HISTORICO),
    config: { ...CFG, enabled: false },
  });
  assert.deepEqual(r, { skipped: 'desligado' });
  assert.equal(pool.gravados.length, 0);
});

test('teto diario corta antes de gastar token', async () => {
  const pool = fakePool({ candidatos: [CANDIDATO], aplicadosHoje: 60 });
  const r = await runStageClassificationTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => { throw new Error('nao deveria chamar a IA'); },
    carregarContextoConversa: contexto(HISTORICO),
    config: CFG,
  });
  assert.equal(r.skipped, 'teto diário atingido');
});

test('aplica o movimento e grava no historico do kanban', async () => {
  const pool = fakePool({ candidatos: [CANDIDATO] });
  const r = await runStageClassificationTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => ({
      ok: true, provider: 'openrouter', model: 'gpt-4o-mini',
      data: { etapa: '16. Descartado', confianca: 0.9, motivo: 'ja temos fornecedor DJI' },
    }),
    carregarContextoConversa: contexto(HISTORICO),
    config: CFG,
  });
  assert.equal(r.movidos, 1);
  assert.deepEqual(pool.escritas, [
    { tipo: 'contato', etapa: '16. Descartado', id: 42 },
    { tipo: 'historico', de: '1. Inbox (Novos)', para: '16. Descartado' },
  ]);
  assert.equal(pool.gravados.at(-1).status, 'applied');
});

test('etapa fria agenda o retorno; faixa absurda e descartada', async () => {
  const { normalizarRetomada } = require('../leadStage');
  const cfg = { retomarMinDias: 15, retomarMaxDias: 180 };
  assert.equal(normalizarRetomada(0, cfg), null, '0 = recusa definitiva, nao reagenda');
  assert.equal(normalizarRetomada(3, cfg), null, 'cedo demais para etapa fria');
  assert.equal(normalizarRetomada(400, cfg), null, 'longe demais para ser util');
  assert.equal(normalizarRetomada('nao sei', cfg), null);
  const ok = normalizarRetomada(90, cfg);
  assert.equal(ok.dias, 90);
  assert.ok(new Date(ok.dueAt) > new Date(), 'a data tem que ser futura');

  const pool = fakePool({ candidatos: [CANDIDATO] });
  const agendados = [];
  const r = await runStageClassificationTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => ({
      ok: true,
      data: { etapa: '17. Nurturing', confianca: 0.9, motivo: 'me chama daqui uns meses', retomar_em_dias: 90 },
    }),
    carregarContextoConversa: contexto(HISTORICO),
    agendarRetorno: async (a) => { agendados.push(a); },
    config: CFG,
  });
  assert.equal(r.movidos, 1);
  assert.equal(r.agendados, 1);
  assert.equal(agendados[0].contactId, 42);
  assert.match(agendados[0].note, /retomar em 90 dias/);
});

test('etapa quente nao agenda retorno', async () => {
  const pool = fakePool({ candidatos: [CANDIDATO] });
  const agendados = [];
  const r = await runStageClassificationTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => ({
      ok: true, data: { etapa: '2. Em Contato', confianca: 0.9, motivo: 'x', retomar_em_dias: 90 },
    }),
    carregarContextoConversa: contexto(HISTORICO),
    agendarRetorno: async (a) => { agendados.push(a); },
    config: CFG,
  });
  assert.equal(r.movidos, 1);
  assert.deepEqual(agendados, [], 'lead ativo nao precisa de data de volta');
});

test('dry run decide mas nao escreve no contato', async () => {
  const pool = fakePool({ candidatos: [CANDIDATO] });
  const r = await runStageClassificationTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => ({ ok: true, data: { etapa: '17. Nurturing', confianca: 0.9, motivo: 'x' } }),
    carregarContextoConversa: contexto(HISTORICO),
    config: { ...CFG, dryRun: true },
  });
  assert.equal(r.movidos, 1);
  assert.deepEqual(pool.escritas, [], 'nenhum card pode se mexer em modo sombra');
  assert.equal(pool.gravados.at(-1).status, 'dry_run');
});

test('marco comercial notifica e nao escreve', async () => {
  const pool = fakePool({ candidatos: [CANDIDATO] });
  const avisos = [];
  const r = await runStageClassificationTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => ({ ok: true, data: { etapa: '10. Proposta Enviada', confianca: 0.95, motivo: 'pediu proposta' } }),
    carregarContextoConversa: contexto(HISTORICO),
    notify: async (a) => { avisos.push(a); },
    config: CFG,
  });
  assert.equal(r.sugeridos, 1);
  assert.deepEqual(pool.escritas, []);
  assert.equal(avisos[0].tipo, 'suggested');
  assert.equal(avisos[0].para, '10. Proposta Enviada');
});

test('aborta se o vendedor moveu o card durante a analise', async () => {
  // O candidato foi lido como Inbox, mas na hora de escrever ja estava em outra etapa.
  const pool = fakePool({ candidatos: [CANDIDATO], contatoAtual: '6. Qualificado (SQL)' });
  const r = await runStageClassificationTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => ({ ok: true, data: { etapa: '17. Nurturing', confianca: 0.9, motivo: 'x' } }),
    carregarContextoConversa: contexto(HISTORICO),
    config: CFG,
  });
  assert.equal(r.pulados, 1);
  assert.deepEqual(pool.escritas, [], 'decisao humana recente tem precedencia');
  assert.match(pool.gravados.at(-1).skip, /mudou durante a análise/);
});

test('contato sem historico textual e pulado antes da IA', async () => {
  const pool = fakePool({ candidatos: [CANDIDATO] });
  const r = await runStageClassificationTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => { throw new Error('nao deveria chamar a IA'); },
    carregarContextoConversa: contexto([]),
    config: CFG,
  });
  assert.equal(r.pulados, 1);
  assert.match(pool.gravados.at(-1).skip, /sem histórico/);
});

test('falha da IA vira registro, nao excecao', async () => {
  const pool = fakePool({ candidatos: [CANDIDATO] });
  const r = await runStageClassificationTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => ({ ok: false, error: 'openrouter:503' }),
    carregarContextoConversa: contexto(HISTORICO),
    config: CFG,
  });
  assert.equal(r.falhas, 1);
  assert.equal(pool.gravados.at(-1).status, 'failed');
});
