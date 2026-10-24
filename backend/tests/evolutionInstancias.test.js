const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SLUG_DA_INSTANCIA,
  tokenDaInstancia,
  instanciaDoWebhook,
  criarMapaDeInstancias,
  instanciaPermitida,
  escolherInstancia,
  criarEnvioEvolution,
} = require('../evolutionInstancias');

// Linhas reais de channel_api em producao (consultadas em 2026-10-23).
const CANAIS = [
  { inbox_id: 2, inbox: 'ian_aerion', webhook_url: 'https://evolution.tenryu.com.br/chatwoot/webhook/ian_aerion' },
  { inbox_id: 5, inbox: 'iago_aerion', webhook_url: 'https://evolution.tenryu.com.br/chatwoot/webhook/iago_aerion' },
  { inbox_id: 6, inbox: 'comercial_aerion', webhook_url: 'https://evolution.tenryu.com.br/chatwoot/webhook/Comercial%20-%20Aerion%20Technologies' },
  { inbox_id: 10, inbox: 'thelga_lins', webhook_url: 'https://evolution.tenryu.com.br/chatwoot/webhook/Thelga%20Lins' },
];

const poolFake = (rows = CANAIS) => ({
  chamadas: 0,
  async query() { this.chamadas += 1; return { rows }; },
});

test('le o nome da instancia do webhook, inclusive com espaco escapado', () => {
  assert.equal(
    instanciaDoWebhook('https://evolution.tenryu.com.br/chatwoot/webhook/ian_aerion'),
    'ian_aerion'
  );
  assert.equal(
    instanciaDoWebhook('https://evolution.tenryu.com.br/chatwoot/webhook/Comercial%20-%20Aerion%20Technologies'),
    'Comercial - Aerion Technologies'
  );
  assert.equal(instanciaDoWebhook('https://exemplo.com/outra/coisa'), null);
  assert.equal(instanciaDoWebhook(''), null);
  assert.equal(instanciaDoWebhook(null), null);
});

test('o mapa sai do Chatwoot, nao de env var', async () => {
  const pool = poolFake();
  const mapa = criarMapaDeInstancias({ pool });
  const m = await mapa.carregar(2);
  assert.equal(m.porInbox.size, 4);
  assert.equal(m.porInbox.get(6).instancia, 'Comercial - Aerion Technologies');
  assert.equal(m.porInbox.get(2).instancia, 'ian_aerion');
  // Cache: nao bate no banco a cada mensagem.
  await mapa.carregar(2);
  assert.equal(pool.chamadas, 1);
});

test('instancia pessoal NAO e permitida — foi o erro de 23/10', async () => {
  const m = await criarMapaDeInstancias({ pool: poolFake() }).carregar(2);
  // claytoncosta existe no Evolution e estava em EVOLUTION_INSTANCE, mas nao tem
  // inbox no Chatwoot: nao e numero da operacao comercial.
  assert.equal(instanciaPermitida(m, 'claytoncosta'), false);
  assert.equal(instanciaPermitida(m, 'c2finance'), false, 'outro projeto, nao e da Aerion');
  assert.equal(instanciaPermitida(m, 'ian_aerion'), true);
  assert.equal(instanciaPermitida(m, 'IAN_AERION'), true, 'caixa nao importa');
  assert.equal(instanciaPermitida(m, 'Comercial - Aerion Technologies'), true);
  assert.equal(instanciaPermitida(m, null), false);
});

test('contato com conversa recebe pelo numero da conversa dele', async () => {
  const m = await criarMapaDeInstancias({ pool: poolFake() }).carregar(2);
  const escolha = escolherInstancia(m, { inboxId: 5, carga: new Map() });
  assert.equal(escolha.instancia, 'iago_aerion');
  assert.match(escolha.motivo, /conversa do contato/);
});

test('contato novo vai pelo numero menos carregado do dia', async () => {
  const m = await criarMapaDeInstancias({ pool: poolFake() }).carregar(2);
  const carga = new Map([[2, { hoje: 20 }], [5, { hoje: 3 }], [6, { hoje: 40 }], [10, { hoje: 9 }]]);
  const escolha = escolherInstancia(m, { inboxId: null, carga });
  assert.equal(escolha.instancia, 'iago_aerion');
  assert.match(escolha.motivo, /menos carregado/);
});

test('a lista de permitidas restringe a escolha', async () => {
  const m = await criarMapaDeInstancias({ pool: poolFake() }).carregar(2);
  const carga = new Map([[2, { hoje: 1 }], [6, { hoje: 30 }]]);
  // So comercial_aerion liberado: mesmo sendo o mais carregado, e ele.
  const escolha = escolherInstancia(m, {
    carga, permitidas: ['Comercial - Aerion Technologies'],
  });
  assert.equal(escolha.instancia, 'Comercial - Aerion Technologies');
  // Inbox fixo que nao esta na lista nao sequestra a escolha.
  const fora = escolherInstancia(m, {
    inboxId: 2, carga, permitidas: ['Comercial - Aerion Technologies'],
  });
  assert.equal(fora.instancia, 'Comercial - Aerion Technologies');
});

test('sem nenhum inbox com webhook, devolve erro em vez de chutar um numero', async () => {
  const m = await criarMapaDeInstancias({ pool: poolFake([]) }).carregar(2);
  const escolha = escolherInstancia(m, {});
  assert.match(escolha.erro, /nenhuma inst[âa]ncia da Aerion/);
  assert.equal(escolha.instancia, undefined);
});

test('o token e por instancia: o kanban nao alcanca numero que nao e da Aerion', () => {
  // A chave GLOBAL do Evolution abre todas as instancias do servidor, inclusive a
  // pessoal do Clayton e a do c2finance, que e outro projeto. Com token por
  // instancia, o alcance e exatamente o que foi configurado.
  const env = {
    EVOLUTION_TOKEN_COMERCIAL_AERION_TECHNOLOGIES: 'tok-comercial',
    EVOLUTION_TOKEN_IAGO_AERION: 'tok-iago',
    EVOLUTION_TOKEN_IAN: 'tok-ian-apelido',
  };
  assert.equal(SLUG_DA_INSTANCIA('Comercial - Aerion Technologies'), 'COMERCIAL_AERION_TECHNOLOGIES');
  assert.equal(tokenDaInstancia('Comercial - Aerion Technologies', env), 'tok-comercial');
  assert.equal(tokenDaInstancia('iago_aerion', env), 'tok-iago');
  assert.equal(tokenDaInstancia('ian_aerion', env), 'tok-ian-apelido', 'apelido curto tambem serve');
  assert.equal(tokenDaInstancia('c2f_transactions', env), null, 'outro projeto: sem token');
  assert.equal(tokenDaInstancia('claytoncosta', env), null, 'numero pessoal: sem token');
});

test('sem token para a instancia, o envio falha em vez de usar chave global', async () => {
  const enviar = criarEnvioEvolution({
    baseUrl: 'https://evo.example', env: {},
    fetchImpl: async () => { throw new Error('não devia chamar'); },
  });
  await assert.rejects(
    () => enviar({ numero: '5511999999999', texto: 'oi', instancia: 'c2f_transactions' }),
    /sem token para a inst[âa]ncia "c2f_transactions"/
  );
});

test('o envio exige instancia explicita: nao existe default implicito', async () => {
  const enviar = criarEnvioEvolution({
    baseUrl: 'https://evo.example/', apiKey: 'k',
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: 1 }) }),
  });
  await assert.rejects(
    () => enviar({ numero: '5511999999999', texto: 'oi' }),
    /inst[âa]ncia n[ãa]o informada/
  );
  await assert.rejects(
    () => enviar({ numero: '123', texto: 'oi', instancia: 'ian_aerion' }),
    /n[úu]mero inv[áa]lido/
  );
});

test('o envio usa a instancia na URL e apikey minusculo', async () => {
  const chamadas = [];
  const enviar = criarEnvioEvolution({
    baseUrl: 'https://evo.example',
    env: { EVOLUTION_TOKEN_COMERCIAL_AERION_TECHNOLOGIES: 'segredo' },
    fetchImpl: async (url, opts) => { chamadas.push({ url, opts }); return { ok: true, json: async () => ({}) }; },
  });
  await enviar({ numero: '+55 (11) 99999-9999', texto: 'oi', instancia: 'Comercial - Aerion Technologies' });
  assert.equal(
    chamadas[0].url,
    'https://evo.example/message/sendText/Comercial%20-%20Aerion%20Technologies'
  );
  assert.equal(chamadas[0].opts.headers.apikey, 'segredo');
  assert.equal(chamadas[0].opts.headers.ApiKey, undefined, 'duas grafias fazem o undici devolver 401');
  assert.deepEqual(JSON.parse(chamadas[0].opts.body), { number: '5511999999999', text: 'oi' });
});

test('erro da Evolution sobe com status e corpo', async () => {
  const enviar = criarEnvioEvolution({
    baseUrl: 'https://evo.example', apiKey: 'k',
    fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'Unauthorized' }),
  });
  await assert.rejects(
    () => enviar({ numero: '5511999999999', texto: 'oi', instancia: 'ian_aerion' }),
    /Evolution API 401: Unauthorized/
  );
});
