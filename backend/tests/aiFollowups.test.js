const test = require('node:test');
const assert = require('node:assert/strict');

const {
  carregarConfig,
  estrategiaDaTentativa,
  SITUACOES_SEM_MENSAGEM,
  ESPERA_POR_SITUACAO,
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
const fakePool = ({ candidatos = [], historico = [], anteriores = [], enviadosHoje = 0 }) => {
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
      // follow-ups que a IA ja mandou para o contato (sequencia)
      if (sql.includes('SELECT message, created_at')) return { rows: anteriores };
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

// A janela e calculada em America/Sao_Paulo, nao no fuso do container (que varia no
// Swarm). Estes casos travam as bordas e as armadilhas de UTC.
test('janela: bordas de horario em Sao Paulo', () => {
  // Quarta-feira 2026-09-30. SP = UTC-3.
  const sp = (h, m = 0) => new Date(Date.UTC(2026, 8, 30, h + 3, m)); // h = hora em SP
  assert.equal(dentroDaJanela(CONFIG_BASE, sp(8, 59)), false, '08:59 ainda fechado');
  assert.equal(dentroDaJanela(CONFIG_BASE, sp(9, 0)), true, '09:00 abre');
  assert.equal(dentroDaJanela(CONFIG_BASE, sp(12, 30)), true);
  assert.equal(dentroDaJanela(CONFIG_BASE, sp(17, 59)), true, '17:59 ainda vale');
  assert.equal(dentroDaJanela(CONFIG_BASE, sp(18, 0)), false, '18:00 fecha');
  assert.equal(dentroDaJanela(CONFIG_BASE, sp(23, 0)), false, 'nunca de madrugada');
  assert.equal(dentroDaJanela(CONFIG_BASE, sp(3, 0)), false);
});

test('janela: fim de semana bloqueado o dia inteiro', () => {
  // 2026-10-03 sabado, 2026-10-04 domingo.
  const sab = (h) => new Date(Date.UTC(2026, 9, 3, h + 3));
  const dom = (h) => new Date(Date.UTC(2026, 9, 4, h + 3));
  for (const h of [9, 12, 15, 17]) {
    assert.equal(dentroDaJanela(CONFIG_BASE, sab(h)), false, `sabado ${h}h`);
    assert.equal(dentroDaJanela(CONFIG_BASE, dom(h)), false, `domingo ${h}h`);
  }
});

test('janela: armadilha de fuso — o dia que vale e o de Sao Paulo, nao o UTC', () => {
  // Segunda 2026-10-05 01:00 UTC = domingo 2026-10-04 22:00 em SP. Em UTC parece
  // dia util; em SP e domingo de noite. Tem que barrar.
  assert.equal(dentroDaJanela(CONFIG_BASE, new Date('2026-10-05T01:00:00.000Z')), false);
  // Sabado 2026-10-03 01:00 UTC = sexta 2026-10-02 22:00 em SP: sexta, mas fora do
  // horario. Barra pela hora, nao pelo dia.
  assert.equal(dentroDaJanela(CONFIG_BASE, new Date('2026-10-03T01:00:00.000Z')), false);
  // Sexta 2026-10-02 20:00 UTC = sexta 17:00 em SP: ultimo tick da semana, vale.
  assert.equal(dentroDaJanela(CONFIG_BASE, new Date('2026-10-02T20:00:00.000Z')), true);
});

test('janela: feriado nacional em dia util tambem barra', () => {
  // 2026-09-07, Independencia, cai numa segunda-feira.
  assert.equal(dentroDaJanela(CONFIG_BASE, new Date('2026-09-07T15:00:00.000Z')), false);
  // 2026-12-25, Natal, numa sexta.
  assert.equal(dentroDaJanela(CONFIG_BASE, new Date('2026-12-25T15:00:00.000Z')), false);
  // 2026-09-08, terca comum logo apos o feriado: volta a valer.
  assert.equal(dentroDaJanela(CONFIG_BASE, new Date('2026-09-08T15:00:00.000Z')), true);
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
  assert.match(user, /Tentativa 2 de 3/);
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

test('defaults sao seguros sem nenhuma env var', () => {
  // As variaveis vivem em `docker service update` e ja se perderam em deploy mais de
  // uma vez. Se isso acontecer, o comportamento tem que continuar correto sozinho.
  const salvos = {};
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('AI_FOLLOWUP_')) { salvos[k] = process.env[k]; delete process.env[k]; }
  }
  try {
    const cfg = carregarConfig();
    // 1 por tick e seguranca: o loop do tick nao pausa entre contatos, entao >1 vira
    // rajada pelo mesmo numero.
    assert.equal(cfg.maxPorTick, 1, 'default nao pode permitir lote');
    assert.equal(cfg.maxPorDia, 30);
    // Nasce inerte e em modo sombra: perder env nunca pode LIGAR envio sozinho.
    assert.equal(cfg.enabled, false, 'sem env, desligado');
    assert.equal(cfg.dryRun, true, 'sem env, modo sombra');
    // Protecoes do numero continuam de pe.
    assert.equal(cfg.gapSegundos, 300);
    assert.equal(cfg.instanciaCapDiario, 40);
    assert.equal(cfg.instanciaCapHorario, 12);
    // Janela comercial e silencio minimo.
    assert.equal(cfg.horaInicio, 9);
    assert.equal(cfg.horaFim, 18);
    assert.equal(cfg.silencioDias, 3);
    assert.equal(cfg.maxPorContato, 3);
  } finally {
    Object.assign(process.env, salvos);
  }
});

test('cada tentativa da sequencia tem estrategia propria', () => {
  const a = estrategiaDaTentativa(1, 3);
  const b = estrategiaDaTentativa(2, 3);
  const c = estrategiaDaTentativa(3, 3);
  assert.notEqual(a, b);
  assert.notEqual(b, c);
  assert.match(a, /retome o assunto/);
  assert.match(b, /TRAGA VALOR/);
  // A ultima tentativa qualifica o timing para nurture; nunca se despede.
  assert.match(c, /VALUE-ADD, nunca despedida/);
  // A ultima tentativa fecha o ciclo mesmo quando o teto e menor que 3.
  assert.equal(estrategiaDaTentativa(2, 2), c, 'tentativa final sempre encerra');
});

test('o prompt mostra a tentativa e o que a IA ja disse, para nao repetir', () => {
  const { system, user } = montarPrompt({
    contato: CANDIDATO,
    historico: [{ autor: 'nós', texto: 'Mandei o material', em: '2026-09-01T12:00:00.000Z' }],
    followupsAnteriores: 1,
    diasSilencio: 12,
    maxPorContato: 3,
    anteriores: [
      { message: 'Oi, ainda tem interesse nos drones?', created_at: '2026-09-20T12:00:00.000Z' },
    ],
    agora: new Date('2026-09-30T15:00:00.000Z'),
  });
  assert.match(user, /Tentativa 2 de 3/);
  assert.match(user, /mude o angulo/);
  assert.match(user, /já mandou nesta sequência/);
  assert.match(user, /1ª \(há 10 dias\): Oi, ainda tem interesse nos drones\?/);
  assert.match(system, /Nunca repita a abordagem/);
});

test('primeira tentativa nao lista anteriores', () => {
  const { user } = montarPrompt({
    contato: CANDIDATO,
    historico: [{ autor: 'nós', texto: 'Oi', em: '2026-09-01T12:00:00.000Z' }],
    followupsAnteriores: 0,
    diasSilencio: 29,
    maxPorContato: 3,
    anteriores: [],
    agora: new Date('2026-09-30T15:00:00.000Z'),
  });
  assert.match(user, /Tentativa 1 de 3/);
  assert.doesNotMatch(user, /já mandou nesta sequência/);
});

test('despedida e bloqueada — a cadencia termina em silencio, nao em adeus', () => {
  // Mensagens que saíram de verdade para clientes e que o Clayton reprovou: o processo
  // comercial (Chris Voss) termina a cadência em value-add e manda o lead para nurture.
  // Avisar que "não vou mais insistir" entrega que desistimos e fecha a porta.
  const reprovadas = [
    'Oi! Essa é minha última mensagem sobre drones. Você gostaria de receber informações futuras?',
    'Entendo que o momento pode não ser o ideal. Agradeço pela atenção até aqui e deixo a porta aberta.',
    'Vou encerrar por aqui, mas agradeço pelo tempo que você dedicou até agora.',
    'Desculpe incomodar, não vou mais insistir.',
    'Prefere que eu não insista mais?',
  ];
  for (const t of reprovadas) {
    assert.match(validarMensagem(t, 0.9, CONFIG_BASE) || '', /se despede/, t.slice(0, 40));
  }
});

test('pergunta calibrada passa; pergunta fechada de interesse nao', () => {
  // "Tem interesse?" e "ainda há interesse?" sao as perguntas preguicosas que o
  // processo manda trocar por calibradas comecando em "Como" / "O que" / "Quando".
  assert.ok(validarMensagem('Oi, ainda há interesse nos drones?', 0.9, CONFIG_BASE));
  assert.ok(validarMensagem('Voce tem interesse?', 0.9, CONFIG_BASE));
  assert.equal(
    validarMensagem('Oi! Como está o volume de voo da frota de vocês nesse fim de ano?', 0.9, CONFIG_BASE),
    null
  );
  assert.equal(
    validarMensagem('Quando voces costumam revisar investimento em equipamento?', 0.9, CONFIG_BASE),
    null
  );
});

test('a terceira tentativa e value-add, nao despedida', () => {
  const terceira = estrategiaDaTentativa(3, 3);
  assert.match(terceira, /VALUE-ADD/);
  assert.match(terceira, /nunca despedida/);
  assert.match(terceira, /TIMING|timing/);
  assert.doesNotMatch(terceira, /n[aã]o vai insistir/);
});

// Caso real (contato Mafra, out/2026). O cliente disse que não cuida do assunto e
// passou o contato de outra pessoa; a IA respondeu perguntando A ELE se NÓS já
// tínhamos falado com o indicado, e insistiu mais duas vezes. Dois erros de leitura:
// a frase do handoff estava uma mensagem ANTES do cartão de contato, e as nossas
// mensagens sem resposta depois disso faziam o fim da conversa parecer silêncio.
const HISTORICO_HANDOFF = [
  { autor: 'nós', texto: 'Houve avanço nas ETPs?', em: '2026-09-29T12:00:00.000Z' },
  { autor: 'cliente', texto: 'Bom dia, não estou a frente da parte das ETPs vc pode falar com o Cap Sá Fortes', em: '2026-09-29T16:00:00.000Z' },
  { autor: 'cliente', texto: '**Contato:** *Nome:* Cap Sá Fortes GSD-CO *Número (1):* +55 51 9960-7789', em: '2026-09-29T16:01:00.000Z' },
  { autor: 'nós', texto: 'Obrigado!', em: '2026-09-29T16:20:00.000Z' },
  { autor: 'nós', texto: 'Já consegui falar com o Cap Sá Fortes?', em: '2026-10-05T12:00:00.000Z' },
];

test('o foco leva a RAJADA do cliente, nao so a ultima linha', () => {
  const { user } = montarPrompt({
    contato: CANDIDATO,
    historico: HISTORICO_HANDOFF,
    followupsAnteriores: 2,
    diasSilencio: 22,
    maxPorContato: 3,
    agora: new Date('2026-10-21T15:00:00.000Z'),
  });
  // A frase que define a situação vem UMA mensagem antes do cartão de contato.
  // Destacar só a última linha entregava "Nome: Cap Sá Fortes, Número: ..." sem sentido.
  const foco = user.split('Histórico completo')[0];
  assert.match(foco, /não estou a frente da parte das ETPs/);
  assert.match(foco, /Cap Sá Fortes GSD-CO/);
  // E tem que dizer que o que veio depois foi insistência nossa, não fato novo.
  assert.match(foco, /nós mandamos 2 mensagem\(ns\)/);
  assert.match(foco, /insistência nossa/);
});

test('nunca passa de "tentativa N de N"', () => {
  const { user } = montarPrompt({
    contato: CANDIDATO,
    historico: HISTORICO_HANDOFF,
    followupsAnteriores: 7,
    diasSilencio: 22,
    maxPorContato: 3,
    agora: new Date('2026-10-21T15:00:00.000Z'),
  });
  assert.match(user, /Tentativa 3 de 3/);
  assert.doesNotMatch(user, /Tentativa [4-9] de 3/);
});

test('handoff, recusa, cliente e bola-conosco nunca viram mensagem', () => {
  for (const s of ['handoff', 'recusa_definitiva', 'virou_cliente', 'aguardando_nos']) {
    assert.ok(SITUACOES_SEM_MENSAGEM.has(s), `${s} tinha que bloquear`);
  }
  // Silêncio e dúvida aberta continuam gerando follow-up.
  assert.ok(!SITUACOES_SEM_MENSAGEM.has('silencio'));
  assert.ok(!SITUACOES_SEM_MENSAGEM.has('duvida_aberta'));
  // Quem já disse o que tinha a dizer sai de cena por muito tempo.
  assert.ok(ESPERA_POR_SITUACAO.handoff >= 180);
  assert.ok(ESPERA_POR_SITUACAO.recusa_definitiva >= 365);
});

test('situacao de handoff nao envia, agenda longe e guarda a indicacao', async () => {
  const pool = fakePool({ candidatos: [CANDIDATO], historico: HISTORICO_HANDOFF.map((h) => ({
    content: h.texto, message_type: h.autor === 'cliente' ? 0 : 1, created_at: h.em,
  })) });
  let bateu = false;
  const agendados = [];
  const avisos = [];
  const r = await runAiFollowupTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => ({
      ok: true,
      data: {
        situacao: 'handoff',
        acao: 'nao_escrever',
        motivo: 'não estou a frente da parte das ETPs',
        mensagem: null,
        confianca: 0.9,
        indicacao: { nome: 'Cap Sá Fortes', telefone: '+55 51 9960-7789' },
      },
    }),
    fetchImpl: async () => { bateu = true; return { ok: true, json: async () => ({}) }; },
    agendarRetorno: async (a) => { agendados.push(a); },
    notify: async (a) => { avisos.push(a); },
    config: CONFIG_BASE,
    now: new Date('2026-10-21T15:00:00.000Z'),
  });

  assert.equal(bateu, false, 'nao pode mandar nada para quem fez handoff');
  assert.equal(r.pulados, 1);
  assert.equal(r.enviados, 0);
  assert.match(pool.gravados.at(-1).skipReason, /handoff/);
  assert.equal(agendados.length, 1, 'tem que sair de cena por muito tempo');
  assert.match(agendados[0].note, /handoff/);
  const indicacao = avisos.find((a) => a.tipo === 'indicacao');
  assert.ok(indicacao, 'a indicacao e o ativo da resposta, nao pode sumir');
  assert.equal(indicacao.indicacao.telefone, '+55 51 9960-7789');
});

test('guarda dura: situacao bloqueada nao escreve nem se o modelo mandar texto', async () => {
  const pool = fakePool({ candidatos: [CANDIDATO], historico: HISTORICO_HANDOFF.map((h) => ({
    content: h.texto, message_type: h.autor === 'cliente' ? 0 : 1, created_at: h.em,
  })) });
  let bateu = false;
  const r = await runAiFollowupTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => ({
      ok: true,
      // O modelo se contradiz: diz handoff mas pede para escrever. A decisao nao e dele.
      data: { situacao: 'handoff', acao: 'escrever', mensagem: 'Oi! Já falou com o Cap?', confianca: 0.95 },
    }),
    fetchImpl: async () => { bateu = true; return { ok: true, json: async () => ({}) }; },
    config: CONFIG_BASE,
    now: new Date('2026-10-21T15:00:00.000Z'),
  });
  assert.equal(bateu, false);
  assert.equal(r.enviados, 0);
  assert.equal(r.pulados, 1);
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
  // Agendado vencido tem precedencia; depois, o parado ha mais tempo.
  assert.match(sqlVisto, /ORDER BY \(retorno\.id IS NOT NULL\) DESC/);
  assert.match(sqlVisto, /um\.created_at ASC/);
  // O lembrete agendado pela classificacao de etapa e gatilho por si so.
  assert.match(sqlVisto, /contact_followup_reminders/);
  assert.match(sqlVisto, /retorno\.id IS NOT NULL OR um\.message_type = 1/);
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
