const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validarMensagem,
  dentroDaJanela,
  montarPrompt,
  runAiFollowupTick,
} = require('../aiFollowups');

const CONFIG_BASE = {
  enabled: true,
  dryRun: false,
  etapas: ['3. Follow-up 1'],
  silencioDias: 3,
  maxPorContato: 2,
  maxPorDia: 20,
  maxPorTick: 3,
  cooldownDias: 5,
  minConfianca: 0.6,
  horaInicio: 9,
  horaFim: 18,
  chatwootBaseUrl: 'https://chat.example',
  chatwootToken: 'token',
};

// Pool falso: devolve respostas na ordem em que as queries aparecem e guarda
// tudo que foi gravado, para as asserções.
const fakePool = ({ candidatos = [], historico = [], enviadosHoje = 0 }) => {
  const gravados = [];
  return {
    gravados,
    async query(sql, params) {
      if (sql.includes('INSERT INTO ai_followup_log')) {
        gravados.push({ status: params[4], skipReason: params[5], message: params[9], error: params[10] });
        return { rows: [{ id: gravados.length }] };
      }
      // a query de candidatos também tem COUNT(*)::int — testar por ela primeiro
      if (sql.includes('WITH ultima_mensagem')) return { rows: candidatos };
      if (sql.includes('COUNT(*)::int AS total')) return { rows: [{ total: enviadosHoje }] };
      if (sql.includes('SELECT m.content')) return { rows: historico };
      throw new Error(`query inesperada: ${sql.slice(0, 60)}`);
    },
  };
};

const CANDIDATO = {
  contact_id: 1,
  name: 'Paloma Oliveira',
  funil: '3. Follow-up 1',
  empresa: 'ACME',
  conversation_id: 77,
  ultima_em: '2026-09-15T12:00:00.000Z',
  followups_anteriores: 0,
};

const HISTORICO = [
  { content: 'Bom dia, tenho interesse', message_type: 0, created_at: '2026-09-14T12:00:00.000Z' },
  { content: 'Oi! Te mandei o material', message_type: 1, created_at: '2026-09-15T12:00:00.000Z' },
];

test('a janela comercial respeita horário e dia útil', () => {
  // Quarta-feira, 14h em São Paulo.
  assert.equal(dentroDaJanela(CONFIG_BASE, new Date('2026-09-23T17:00:00.000Z')), true);
  // Mesma quarta, 5h da manhã em São Paulo.
  assert.equal(dentroDaJanela(CONFIG_BASE, new Date('2026-09-23T08:00:00.000Z')), false);
  // Domingo.
  assert.equal(dentroDaJanela(CONFIG_BASE, new Date('2026-09-20T17:00:00.000Z')), false);
});

test('o prompt leva histórico, etapa e follow-ups anteriores', () => {
  const { system, user } = montarPrompt({
    contato: CANDIDATO,
    historico: [{ autor: 'cliente', texto: 'tenho interesse' }],
    followupsAnteriores: 1,
    diasSilencio: 4,
  });
  assert.match(system, /Responda SOMENTE com um objeto JSON/);
  assert.match(user, /Paloma Oliveira/);
  assert.match(user, /3\. Follow-up 1/);
  assert.match(user, /Dias sem resposta: 4/);
  assert.match(user, /já enviados a este contato: 1/);
  assert.match(user, /\[cliente\] tenho interesse/);
});

test('mensagem válida passa em todas as barreiras', () => {
  assert.equal(
    validarMensagem('Oi Paloma, conseguiu dar uma olhada no material?', 0.8, CONFIG_BASE),
    null
  );
});

test('barra mensagem com placeholder, tema comercial, tamanho ou confiança baixa', () => {
  assert.match(validarMensagem('Oi {nome}!', 0.9, CONFIG_BASE), /placeholder/);
  assert.match(validarMensagem('Faço por R$ 900', 0.9, CONFIG_BASE), /comercial proibido/);
  assert.match(validarMensagem('Posso dar desconto', 0.9, CONFIG_BASE), /comercial proibido/);
  assert.match(validarMensagem('x'.repeat(601), 0.9, CONFIG_BASE), /longa demais/);
  assert.match(validarMensagem('Oi Paloma, tudo certo?', 0.2, CONFIG_BASE), /abaixo do mínimo/);
  assert.match(validarMensagem('Oi Paloma, tudo certo?', null, CONFIG_BASE), /confiança ausente/);
});

test('desligado não consulta nada', async () => {
  const pool = fakePool({});
  const r = await runAiFollowupTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => { throw new Error('não deveria chamar a IA'); },
    config: { ...CONFIG_BASE, enabled: false },
  });
  assert.deepEqual(r, { skipped: 'desligado' });
  assert.equal(pool.gravados.length, 0);
});

test('fora da janela comercial não envia', async () => {
  const pool = fakePool({ candidatos: [CANDIDATO] });
  const r = await runAiFollowupTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => { throw new Error('não deveria chamar a IA'); },
    config: CONFIG_BASE,
    now: new Date('2026-09-20T17:00:00.000Z'), // domingo
  });
  assert.equal(r.skipped, 'fora da janela comercial');
});

test('teto diário interrompe antes de gastar token', async () => {
  const pool = fakePool({ candidatos: [CANDIDATO], enviadosHoje: 20 });
  const r = await runAiFollowupTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => { throw new Error('não deveria chamar a IA'); },
    config: CONFIG_BASE,
    now: new Date('2026-09-23T17:00:00.000Z'),
  });
  assert.equal(r.skipped, 'teto diário atingido');
});

test('envia pelo Chatwoot e registra como enviado', async () => {
  const pool = fakePool({ candidatos: [CANDIDATO], historico: HISTORICO });
  const chamadas = [];
  const r = await runAiFollowupTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => ({
      ok: true,
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
      data: { mensagem: 'Oi Paloma, conseguiu ver o material?', confianca: 0.9 },
    }),
    fetchImpl: async (url, opts) => {
      chamadas.push({ url, body: JSON.parse(opts.body), token: opts.headers.api_access_token });
      return { ok: true, json: async () => ({ id: 1 }) };
    },
    config: CONFIG_BASE,
    now: new Date('2026-09-23T17:00:00.000Z'),
  });

  assert.equal(r.enviados, 1);
  assert.equal(r.falhas, 0);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, 'https://chat.example/api/v1/accounts/2/conversations/77/messages');
  assert.equal(chamadas[0].body.message_type, 'outgoing');
  assert.equal(chamadas[0].body.content, 'Oi Paloma, conseguiu ver o material?');
  assert.equal(pool.gravados.at(-1).status, 'sent');
});

test('dry run grava a mensagem e não chama o Chatwoot', async () => {
  const pool = fakePool({ candidatos: [CANDIDATO], historico: HISTORICO });
  let bateu = false;
  const r = await runAiFollowupTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => ({
      ok: true,
      data: { mensagem: 'Oi Paloma, tudo certo por aí?', confianca: 0.85 },
    }),
    fetchImpl: async () => { bateu = true; return { ok: true, json: async () => ({}) }; },
    config: { ...CONFIG_BASE, dryRun: true },
    now: new Date('2026-09-23T17:00:00.000Z'),
  });

  assert.equal(bateu, false);
  assert.equal(r.dry_run, 1);
  assert.equal(r.enviados, 0);
  assert.equal(pool.gravados.at(-1).status, 'dry_run');
  assert.equal(pool.gravados.at(-1).message, 'Oi Paloma, tudo certo por aí?');
});

test('mensagem reprovada é registrada como pulada e nunca sai', async () => {
  const pool = fakePool({ candidatos: [CANDIDATO], historico: HISTORICO });
  let bateu = false;
  const r = await runAiFollowupTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => ({
      ok: true,
      data: { mensagem: 'Oi {nome}, faço por R$ 300!', confianca: 0.95 },
    }),
    fetchImpl: async () => { bateu = true; return { ok: true, json: async () => ({}) }; },
    config: CONFIG_BASE,
    now: new Date('2026-09-23T17:00:00.000Z'),
  });

  assert.equal(bateu, false);
  assert.equal(r.pulados, 1);
  assert.equal(pool.gravados.at(-1).status, 'skipped');
  assert.match(pool.gravados.at(-1).skipReason, /placeholder/);
});

test('contato sem histórico textual é pulado antes da IA', async () => {
  const pool = fakePool({ candidatos: [CANDIDATO], historico: [] });
  const r = await runAiFollowupTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => { throw new Error('não deveria chamar a IA'); },
    config: CONFIG_BASE,
    now: new Date('2026-09-23T17:00:00.000Z'),
  });
  assert.equal(r.pulados, 1);
  assert.match(pool.gravados.at(-1).skipReason, /sem histórico/);
});

test('falha da IA vira registro de falha, não exceção', async () => {
  const pool = fakePool({ candidatos: [CANDIDATO], historico: HISTORICO });
  const r = await runAiFollowupTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => ({ ok: false, error: 'openrouter:503' }),
    config: CONFIG_BASE,
    now: new Date('2026-09-23T17:00:00.000Z'),
  });
  assert.equal(r.falhas, 1);
  assert.equal(pool.gravados.at(-1).status, 'failed');
  assert.equal(pool.gravados.at(-1).error, 'openrouter:503');
});

test('erro do Chatwoot não derruba o lote', async () => {
  const pool = fakePool({ candidatos: [CANDIDATO, { ...CANDIDATO, contact_id: 2, conversation_id: 78 }], historico: HISTORICO });
  let n = 0;
  const r = await runAiFollowupTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => ({
      ok: true,
      data: { mensagem: 'Oi Paloma, conseguiu ver?', confianca: 0.9 },
    }),
    fetchImpl: async () => {
      n += 1;
      if (n === 1) return { ok: false, status: 422, text: async () => 'erro' };
      return { ok: true, json: async () => ({}) };
    },
    config: CONFIG_BASE,
    now: new Date('2026-09-23T17:00:00.000Z'),
  });
  assert.equal(r.falhas, 1);
  assert.equal(r.enviados, 1);
});
