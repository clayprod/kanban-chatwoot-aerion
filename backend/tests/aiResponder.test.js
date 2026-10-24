const test = require('node:test');
const assert = require('node:assert/strict');

const {
  carregarConfigResponder,
  motivoDeEscalar,
  buscarPendentes,
  montarPromptResposta,
  validarResposta,
  runAiResponderTick,
} = require('../aiResponder');

const CONFIG = {
  enabled: true,
  dryRun: false,
  esperaSegundos: 300,
  janelaMaximaHoras: 24,
  maxPorTick: 3,
  maxPorDia: 60,
  minConfianca: 0.7,
  historicoMax: 24,
};

const PENDENTE = {
  conversation_id: 77,
  last_incoming_id: 9001,
  pergunta: 'O EVO Max 4T serve para inspeção de linha de transmissão?',
  perguntado_em: new Date('2026-10-23T13:00:00.000Z'),
  esperando_segundos: 420,
  contact_id: 42,
  assignee_id: null,
  contato_nome: 'Energisa Manutenção',
  phone_number: '+5561999999999',
  custom_attributes: {},
  additional_attributes: {},
};

const PRODUTOS = [{
  nome: 'EVO Max 4T V2 sem baterias',
  sku: '102003505',
  link: 'https://loja.aerion.com.br/loja/produto/evo-max-4t-v2/',
  estoque: 'instock',
  precoPublicoPix: 41946.31,
  precoPublicoCartao: 49349.46,
  tabelaRevendaCartao: 34034.54,
  ficha: { 'câmera': 'RGB com zoom' },
}];

const catalogoFake = ({ falhar = false } = {}) => ({
  carregarCatalogo: async () => {
    if (falhar) throw new Error('loja HTTP 500');
    return PRODUTOS;
  },
  blocoCatalogo: (_p, { revendaConfirmada }) => (revendaConfirmada
    ? 'CATALOGO: EVO Max 4T V2 | SKU 102003505 | tabela de revenda R$ 34.034,54 no cartao'
    : 'CATALOGO: EVO Max 4T V2 | SKU 102003505 | R$ 41.946,31 no PIX'),
});

const fakePool = ({ pendentes = [], historico = [], hoje = 0 }) => {
  const gravados = [];
  return {
    gravados,
    async query(sql, params) {
      if (sql.includes('INSERT INTO ai_responder_log')) {
        gravados.push({
          status: params[4], icp: params[5], revenda: params[7],
          mensagem: params[9], motivo: params[10],
        });
        return { rows: [] };
      }
      if (sql.includes('WITH ultima_entrada AS (')) return { rows: pendentes };
      if (sql.includes('COUNT(*)::int AS total')) return { rows: [{ total: hoje }] };
      if (sql.includes('SELECT message_type, content')) return { rows: historico };
      throw new Error(`query inesperada: ${sql.slice(0, 60)}`);
    },
  };
};

const classificador = (over = {}) => async () => ({
  icp: 'energia',
  confianca: 0.85,
  revendaConfirmada: false,
  tier: 'none',
  bloco: 'PERFIL DO LEAD: Inspeção Industrial e Energia.',
  ...over,
});

const iaQue = (data, extra = {}) => async () => ({ ok: true, data, provider: 'openrouter', model: 'x', ...extra });

test('defaults sao seguros: desligado e em dry run', () => {
  const limpo = { ...process.env };
  for (const k of Object.keys(process.env)) if (k.startsWith('AI_RESPONDER_')) delete process.env[k];
  const c = carregarConfigResponder();
  assert.equal(c.enabled, false, 'perder env nunca pode ligar envio');
  assert.equal(c.dryRun, true);
  assert.equal(c.esperaSegundos, 300, 'os 5 minutos que o vendedor tem para chegar primeiro');
  assert.equal(c.janelaMaximaHoras, 24);
  process.env = limpo;
});

test('a query exige que NINGUEM tenha respondido depois do cliente', async () => {
  let sqlVisto = '';
  const pool = {
    async query(sql, params) {
      if (sql.includes('WITH ultima_entrada AS (')) { sqlVisto = sql; return { rows: [] }; }
      return { rows: [{ total: 0 }] };
    },
  };
  await buscarPendentes(pool, { accountId: 2, config: CONFIG });
  // O candidato morre se existir qualquer saida com id maior que a fala do cliente.
  assert.match(sqlVisto, /message_type = 1/);
  assert.match(sqlVisto, /m\.id > ue\.message_id/);
  assert.match(sqlVisto, /r\.conversation_id IS NULL/);
  // Marca da IA: saida sem ela conta como humana.
  assert.match(sqlVisto, /aerion_ai/);
  // Espera de 5 minutos e teto de 24h.
  assert.match(sqlVisto, />= \$2/);
  assert.match(sqlVisto, /make_interval\(hours => \$3\)/);
  // Opt-out vale aqui tambem.
  assert.match(sqlVisto, /whatsapp_opt_out/);
  assert.match(sqlVisto, /nao_contatar/);
  // Mesma mensagem recebida nao e decidida duas vezes.
  assert.match(sqlVisto, /l\.id IS NULL/);
});

test('assunto proibido escala sem gastar token de IA', async () => {
  const perguntas = [
    ['Consegue um desconto nesse valor?', /negocia/],
    ['Qual o prazo de entrega para Manaus?', /frete|prazo/],
    ['Dá para parcelar em 12x no boleto?', /pagamento/],
    ['Preciso da nota fiscal com ICMS destacado', /fiscal/],
    ['O drone que recebi veio errado', /pedido/],
    ['Tem garantia se quebrar?', /garantia|venda/],
    ['Como funciona o processo licitatório?', /licita|contrato/],
  ];
  for (const [p, esperado] of perguntas) {
    assert.match(String(motivoDeEscalar(p)), esperado, p);
  }
  assert.equal(motivoDeEscalar('O EVO Max serve para inspeção térmica?'), null);

  const pool = fakePool({ pendentes: [{ ...PENDENTE, pergunta: 'me dá um desconto?' }] });
  let chamouIa = false;
  const avisos = [];
  const r = await runAiResponderTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => { chamouIa = true; return { ok: false }; },
    classificarContato: classificador(),
    catalogo: catalogoFake(),
    enviar: async () => { throw new Error('não devia enviar'); },
    notificarHumano: async (d) => avisos.push(d.motivo),
    config: CONFIG,
  });
  assert.equal(chamouIa, false, 'nem chega na IA');
  assert.equal(r.escalados, 1);
  assert.equal(pool.gravados[0].status, 'escalated');
  assert.match(avisos[0], /negocia/);
});

test('responde e envia quando tem base', async () => {
  const pool = fakePool({
    pendentes: [PENDENTE],
    historico: [{ message_type: 0, content: 'Bom dia', created_at: new Date(), da_ia: false }],
  });
  const enviados = [];
  const r = await runAiResponderTick(pool, {
    accountId: 2,
    chatCompletionJson: iaQue({
      acao: 'responder',
      assunto: 'inspeção de linha',
      mensagem: 'Serve sim — o EVO Max 4T V2 tem câmera térmica e zoom para linha de transmissão. '
        + 'Veja a ficha: https://loja.aerion.com.br/loja/produto/evo-max-4t-v2/ Como vocês inspecionam hoje?',
      produtos: ['102003505'],
      confianca: 0.9,
      motivo: 'pergunta técnica coberta pelo catálogo',
    }),
    classificarContato: classificador(),
    catalogo: catalogoFake(),
    enviar: async (d) => enviados.push(d),
    notificarHumano: async () => {},
    config: CONFIG,
  });
  assert.equal(r.respondidos, 1);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].contato.conversation_id, 77);
  assert.equal(pool.gravados[0].status, 'sent');
  assert.equal(pool.gravados[0].icp, 'energia');
});

test('a IA escalando NAO manda mensagem para o cliente', async () => {
  const pool = fakePool({ pendentes: [PENDENTE] });
  const avisos = [];
  const r = await runAiResponderTick(pool, {
    accountId: 2,
    chatCompletionJson: iaQue({ acao: 'escalar', mensagem: null, confianca: 0.9, motivo: 'quer falar de contrato' }),
    classificarContato: classificador(),
    catalogo: catalogoFake(),
    enviar: async () => { throw new Error('não devia enviar'); },
    notificarHumano: async (d) => avisos.push(d),
    config: CONFIG,
  });
  assert.equal(r.escalados, 1);
  assert.equal(avisos.length, 1);
  assert.equal(pool.gravados[0].status, 'escalated');
});

test('valor que nao veio do catalogo nao sai — vira escalada', async () => {
  const pool = fakePool({ pendentes: [PENDENTE] });
  const avisos = [];
  const r = await runAiResponderTick(pool, {
    accountId: 2,
    // Preco inventado: o catalogo deste perfil diz 41.946,31.
    chatCompletionJson: iaQue({
      acao: 'responder', mensagem: 'Esse sai por R$ 38.000,00 à vista.', confianca: 0.95, motivo: 'preço',
    }),
    classificarContato: classificador(),
    catalogo: catalogoFake(),
    enviar: async () => { throw new Error('não devia enviar'); },
    notificarHumano: async (d) => avisos.push(d),
    config: CONFIG,
  });
  assert.equal(r.escalados, 1);
  assert.match(pool.gravados[0].motivo, /valor que n[ãa]o veio do cat[aá]logo/);
  assert.equal(avisos[0].rascunho, 'Esse sai por R$ 38.000,00 à vista.', 'o humano recebe o rascunho');
});

test('a validacao segura preco, link, placeholder e despedida', () => {
  const permitidos = ['R$ 41.946,31', 'R$ 49.349,46'];
  const ok = (t, c = 0.9) => validarResposta(t, c, { minConfianca: 0.7, precosPermitidos: permitidos });

  assert.equal(ok('Fica R$ 41.946,31 no PIX.'), null, 'preco do catalogo passa');
  assert.match(String(ok('Fica R$ 41.000,00 no PIX.')), /valor que n[ãa]o veio/);
  assert.equal(ok('Veja em https://loja.aerion.com.br/loja/produto/x/'), null);
  assert.match(String(ok('Veja em https://mercadolivre.com.br/drone')), /fora do dom[ií]nio/);
  assert.match(String(ok('Oi {nome}, tudo bem?')), /placeholder/);
  assert.match(String(ok('Desculpe o incômodo, não vou mais insistir.')), /despedida/);
  assert.match(String(ok('Claro!', 0.4)), /confian[çc]a/);
  assert.match(String(ok('')), /vazia/);
  assert.match(String(ok('x'.repeat(800))), /longa/);
});

test('catalogo fora do ar: a IA nao responde nada e o humano continua dono', async () => {
  const pool = fakePool({ pendentes: [PENDENTE] });
  const r = await runAiResponderTick(pool, {
    accountId: 2,
    chatCompletionJson: async () => { throw new Error('não devia chamar IA'); },
    classificarContato: classificador(),
    catalogo: catalogoFake({ falhar: true }),
    enviar: async () => { throw new Error('não devia enviar'); },
    config: CONFIG,
  });
  assert.match(r.skipped, /cat[aá]logo indispon[ií]vel/);
  assert.equal(pool.gravados.length, 0);
});

test('desligado e fora da janela nao consultam nada', async () => {
  const explode = { async query() { throw new Error('não devia consultar'); } };
  assert.deepEqual(
    await runAiResponderTick(explode, { config: { ...CONFIG, enabled: false } }),
    { skipped: 'desligado' }
  );
  assert.deepEqual(
    await runAiResponderTick(explode, { config: CONFIG, dentroDaJanela: () => false }),
    { skipped: 'fora da janela' }
  );
});

test('dry run decide mas nao envia', async () => {
  const pool = fakePool({ pendentes: [PENDENTE] });
  const r = await runAiResponderTick(pool, {
    accountId: 2,
    chatCompletionJson: iaQue({ acao: 'responder', mensagem: 'Serve sim.', confianca: 0.9, motivo: 'x' }),
    classificarContato: classificador(),
    catalogo: catalogoFake(),
    enviar: async () => { throw new Error('dry run não envia'); },
    config: { ...CONFIG, dryRun: true },
  });
  assert.equal(r.respondidos, 1);
  assert.equal(pool.gravados[0].status, 'dry_run');
  assert.equal(pool.gravados[0].mensagem, 'Serve sim.');
});

test('o prompt destaca a pergunta, separa IA de vendedor e manda escalar', () => {
  const { system, user } = montarPromptResposta({
    contato: PENDENTE,
    pergunta: PENDENTE.pergunta,
    historico: [
      { autor: 'cliente', texto: 'Bom dia', em: '2026-10-20T12:00:00.000Z' },
      { autor: 'nós (vendedor)', texto: 'Bom dia! Como posso ajudar?', em: '2026-10-20T12:30:00.000Z' },
      { autor: 'nós (IA)', texto: 'Oi, tudo bem por aí?', em: '2026-10-22T12:00:00.000Z' },
    ],
    blocoIcp: 'PERFIL DO LEAD: Inspeção Industrial e Energia.',
    blocoCatalogo: 'CATALOGO: EVO Max 4T V2',
    agora: new Date('2026-10-23T12:00:00.000Z'),
  });
  assert.match(user, /EST[ÁA] ESPERANDO/);
  assert.match(user, /linha de transmiss/);
  // A conversa diz quem falou: vendedor e IA nao sao a mesma voz.
  assert.match(user, /n[óo]s \(vendedor\)/);
  assert.match(user, /n[óo]s \(IA\)/);
  assert.match(user, /h[áa] \d+ dias/);
  // O system carrega perfil, catalogo e a regra de escalar.
  assert.match(system, /PERFIL DO LEAD/);
  assert.match(system, /CATALOGO/);
  assert.match(system, /Escalar n[ãa]o [ée] falhar/);
  assert.match(system, /voc[êe] n[ãa]o tem aqui/);
  assert.match(system, /"mensagem": null/);
  // E diz por que ela existe: o vendedor teve a chance primeiro.
  assert.match(system, /vendedor humano teve a chance de responder primeiro/);
});
