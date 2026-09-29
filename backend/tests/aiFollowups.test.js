const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validarMensagem,
  dentroDaJanela,
  montarPrompt,
  buscarCandidatos,
  nomeCurtoEmpresa,
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
      if (sql.includes('ultima_mensagem AS (')) return { rows: candidatos };
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
  assert.match(user, /\[cliente — [^\]]+\] tenho interesse/);
});

test('o histórico leva a idade de cada mensagem e a data de hoje', () => {
  // Regressão real: sem isso a IA leu um disparo de maio sobre a DroneShow (16-18/jun)
  // e, em setembro, convidou contatos para comparecer a um evento que já tinha passado.
  const agora = new Date('2026-09-29T15:00:00.000Z');
  const { system, user } = montarPrompt({
    contato: CANDIDATO,
    historico: [
      { autor: 'nós', texto: 'A Aerion estará na DroneShow, 16 a 18 de Junho.', em: '2026-05-07T12:00:00.000Z' },
      { autor: 'cliente', texto: 'Legal!', em: '2026-09-28T12:00:00.000Z' },
    ],
    followupsAnteriores: 0,
    diasSilencio: 1,
    agora,
  });
  assert.match(user, /Hoje é 29 de setembro de 2026/);
  assert.match(user, /há 145 dias] A Aerion estará na DroneShow/);
  assert.match(user, /ontem] Legal!/);
  assert.match(system, /JÁ PASSOU/);
  assert.match(system, /Nunca convide alguém para/);
});

test('avisa para não tirar primeiro nome do cadastro', () => {
  // "DRONE FLORIANO" virou "Olá, Floriano!" numa mensagem real.
  const { system, user } = montarPrompt({
    contato: { ...CANDIDATO, name: 'DRONE FLORIANO' },
    historico: [{ autor: 'nós', texto: 'Bom dia!', em: '2026-09-01T12:00:00.000Z' }],
    followupsAnteriores: 0,
    diasSilencio: 28,
    agora: new Date('2026-09-29T15:00:00.000Z'),
  });
  assert.match(system, /APENAS se ele aparecer no histórico/);
  assert.match(user, /não use como primeiro nome/);
  assert.match(user, /DRONE FLORIANO/);
});

test('encurta razão social sem deixar conectivo ou sufixo juridico', () => {
  // "Como estão os projetos em andamento na Leandro Martins Imagens Aéreas?" saiu de
  // verdade e soou a cobrança de cartório.
  assert.equal(nomeCurtoEmpresa('Leandro Martins Imagens Aéreas'), 'Leandro Martins');
  assert.equal(nomeCurtoEmpresa('GESTÃO ENGENHARIA E COMÉRCIO LTDA.'), 'GESTÃO ENGENHARIA');
  assert.equal(nomeCurtoEmpresa('Aerion Technologies S/A'), 'Aerion Technologies');
  // Nunca terminar em conectivo ou traço solto.
  assert.equal(nomeCurtoEmpresa('WEPRO DO BRASIL LTDA'), 'WEPRO');
  assert.equal(nomeCurtoEmpresa('SERTEC – ENGENHARIA E AEROLEVANTAMENTOS LTDA.'), 'SERTEC');
  // Curto demais ou vazio.
  assert.equal(nomeCurtoEmpresa('Mafra'), 'Mafra');
  assert.equal(nomeCurtoEmpresa(''), null);
  assert.equal(nomeCurtoEmpresa(null), null);
});

test('o prompt entrega a empresa encurtada e como contexto, nao como vocativo', () => {
  const { system, user } = montarPrompt({
    contato: { ...CANDIDATO, empresa: 'Leandro Martins Imagens Aéreas LTDA' },
    historico: [{ autor: 'nós', texto: 'Oi', em: '2026-09-01T12:00:00.000Z' }],
    followupsAnteriores: 0,
    diasSilencio: 28,
    agora: new Date('2026-09-29T15:00:00.000Z'),
  });
  assert.match(user, /Empresa \(contexto/);
  assert.match(user, /Leandro Martins/);
  assert.doesNotMatch(user, /Imagens Aéreas/, 'a razão social completa nao vai para o modelo');
  assert.match(system, /não coisa para recitar/);
  assert.match(system, /jamais a razão/);
});

test('o prompt proibe formulas de circunstancia', () => {
  const { system } = montarPrompt({
    contato: CANDIDATO,
    historico: [{ autor: 'nós', texto: 'Oi', em: '2026-09-01T12:00:00.000Z' }],
    followupsAnteriores: 0,
    diasSilencio: 28,
    agora: new Date('2026-09-29T15:00:00.000Z'),
  });
  assert.match(system, /Espero que esteja tudo bem/);
  assert.match(system, /Estou à disposição/);
  assert.match(system, /retomando o assunto/);
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

test('a busca coordena com o disparo pela carga do numero, nao por sistema', async () => {
  // O follow-up sai pela MESMA instancia Evolution do disparo em massa. Medido em
  // 29/09: o inbox comercial_aerion fez 71 envios num dia, com 24 numa unica hora,
  // somando campanha + vendedor humano. Contar so o que a IA mandou nao protege nada.
  let sqlVisto = null;
  let paramsVistos = null;
  const pool = {
    async query(sql, params) { sqlVisto = sql; paramsVistos = params; return { rows: [] }; },
  };
  await buscarCandidatos(pool, {
    accountId: 2,
    limite: 3,
    config: {
      etapas: ['17. Nurturing'],
      silencioDias: 3,
      maxPorContato: 2,
      cooldownDias: 5,
      gapSegundos: 300,
      instanciaCapDiario: 40,
      instanciaCapHorario: 12,
    },
  });

  // A carga considera TODO outbound do numero, nao so o da IA.
  assert.match(sqlVisto, /carga_inbox/);
  assert.match(sqlVisto, /m\.message_type = 1/);
  assert.doesNotMatch(
    sqlVisto.split('carga_inbox')[1].split('ultima_mensagem')[0],
    /ai_followup_log/,
    'a carga do numero nao pode olhar so a tabela da IA'
  );
  // Anti-lote: nao entra enquanto o numero acabou de disparar.
  assert.match(sqlVisto, /carga\.ultimo_envio <= NOW\(\) - make_interval\(secs => \$7\)/);
  assert.match(sqlVisto, /COALESCE\(carga\.hoje, 0\) < \$8/);
  assert.match(sqlVisto, /COALESCE\(carga\.ultima_hora, 0\) < \$9/);
  assert.deepEqual(paramsVistos.slice(6), [300, 40, 12]);
  // Cliente parado ha mais tempo primeiro.
  assert.match(sqlVisto, /ORDER BY um\.created_at ASC/);
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
