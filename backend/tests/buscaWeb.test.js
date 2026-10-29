const test = require('node:test');
const assert = require('node:assert/strict');
const {
  criarBuscaWeb, carregarConfigBusca, temTelefone, PLACES_TETO_MENSAL_ABSOLUTO,
} = require('../buscaWeb');

const ALVO = { nome: 'Sertec Engenharia', cnpj: '12345678000199', municipio: 'Goiania', uf: 'GO', curto: 'sertec' };
const CONSULTAS = [
  { fonte: 'site', monta: (a) => `site ${a.nome}` },
  { fonte: 'razao', monta: (a) => `razao ${a.nome}` },
];

// Pool falso: cota mensal em memória + cache por CNPJ.
const fakePool = ({ usado = 0 } = {}) => {
  const estado = { usado, cache: new Map(), consultas: [], porChave: new Map() };
  return {
    estado,
    query: async (sql, params = []) => {
      estado.consultas.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
      if (/INSERT INTO busca_web_uso/.test(sql)) {
        // Contador por (provedor, período): a linha ':dia' é o teto diário.
        const k = `${params[0]}|${params[1]}`;
        const atual = k.startsWith('places|') && estado.usado > 0 && !estado.porChave.has(k)
          ? estado.usado : (estado.porChave.get(k) || 0);
        if (atual >= params[2]) return { rows: [] };
        estado.porChave.set(k, atual + 1);
        if (params[0] === 'places') estado.usado = atual + 1;
        return { rows: [{ usado: atual + 1 }] };
      }
      if (/SELECT provedor, paginas/.test(sql)) {
        const c = estado.cache.get(params[0]);
        return { rows: c ? [c] : [] };
      }
      if (/INSERT INTO busca_web_cache/.test(sql)) {
        estado.cache.set(params[0], {
          provedor: params[1], paginas: JSON.parse(params[2]), created_at: new Date(),
        });
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
};

const resp = (status, corpo) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => corpo,
  text: async () => JSON.stringify(corpo),
});
const PLACE = {
  places: [{
    id: 'abc', displayName: { text: 'Sertec Engenharia' },
    formattedAddress: 'Rua X, Goiania - GO', nationalPhoneNumber: '(62) 3333-4444',
    websiteUri: 'https://sertec.com.br', businessStatus: 'OPERATIONAL',
  }],
};
const montar = (over = {}) => {
  const pool = over.pool || fakePool();
  const chamadas = [];
  const busca = criarBuscaWeb({
    pool,
    lerSegredo: async (n) => (over.segredos ?? { GOOGLE_PLACES_API_KEY: 'k', TAVILY_API_KEY: 't' })[n] || null,
    buscarNoTavily: over.tavily || (async () => { chamadas.push('tavily'); return []; }),
    consultas: CONSULTAS,
    fetchImpl: over.fetchImpl || (async (url) => { chamadas.push(url); return resp(200, PLACE); }),
    config: { ...carregarConfigBusca({}), ...over.config },
    log: { warn() {} },
  });
  return { busca, pool, chamadas };
};

test('defaults ficam abaixo da cota gratuita do Places (1000/mês)', () => {
  const c = carregarConfigBusca({});
  assert.ok(c.placesLimiteMensal < 1000);
  assert.deepEqual(c.ordem, ['places', 'tavily', 'headless']);
});

test('NENHUMA env consegue passar do teto absoluto da cota grátis do Places', () => {
  const c = carregarConfigBusca({ PLACES_MONTHLY_LIMIT: '100000', PLACES_DAILY_LIMIT: '99999' });
  assert.ok(c.placesLimiteMensal <= PLACES_TETO_MENSAL_ABSOLUTO);
  assert.ok(c.placesLimiteDiario <= PLACES_TETO_MENSAL_ABSOLUTO);
  assert.ok(PLACES_TETO_MENSAL_ABSOLUTO < 1000, 'tem que ficar abaixo dos 1.000 grátis');
});

test('teto diário bloqueia o Places antes de qualquer chamada ao Google', async () => {
  const { busca, chamadas } = montar({
    config: { placesLimiteDiario: 2 },
    tavily: async () => [],
  });
  for (let i = 0; i < 4; i += 1) {
    await busca.buscarPaginas({ alvo: { ...ALVO, cnpj: `1000000000000${i}` } });
    busca.bloquear('places', -1); // reabre o breaker: só o contador deve segurar
  }
  assert.equal(chamadas.filter((c) => String(c).includes('places.googleapis.com')).length, 2);
});

test('falha na chamada do Places AINDA consome cota (erra para gastar menos)', async () => {
  const { busca, pool } = montar({
    fetchImpl: async () => resp(500, { error: 'x' }),
    segredos: { GOOGLE_PLACES_API_KEY: 'k' },
    config: { ordem: ['places'] },
  });
  await busca.buscarPaginas({ alvo: ALVO });
  assert.equal(pool.estado.usado, 1);
});

test('Places resolve com UMA chamada e não toca no Tavily', async () => {
  const { busca, chamadas } = montar();
  const r = await busca.buscarPaginas({ alvo: ALVO });
  assert.equal(r.provedor, 'places');
  assert.equal(r.paginas[0].googlePlace.nome, 'Sertec Engenharia');
  assert.equal(chamadas.filter((c) => c === 'tavily').length, 0);
});

test('segunda busca do mesmo CNPJ sai do cache e não gasta cota', async () => {
  const { busca, pool, chamadas } = montar();
  await busca.buscarPaginas({ alvo: ALVO });
  const r2 = await busca.buscarPaginas({ alvo: ALVO });
  assert.equal(r2.doCache, true);
  assert.equal(chamadas.length, 1);
  assert.equal(pool.estado.usado, 1);
});

test('cota mensal cheia pula o Places e cai no Tavily', async () => {
  const pool = fakePool({ usado: 900 });
  const { busca, chamadas } = montar({
    pool,
    tavily: async () => [{ url: 'https://x.com', title: 'Sertec', content: 'Sertec (62) 3333-4444' }],
  });
  const r = await busca.buscarPaginas({ alvo: ALVO });
  assert.equal(r.provedor, 'tavily');
  assert.match(r.falhas[0], /cota gratuita/);
  assert.equal(chamadas.length, 0, 'não chamou a API do Google acima do teto');
});

test('Tavily 432 vira circuit-breaker: o lead seguinte nem tenta', async () => {
  let tentativas = 0;
  const { busca } = montar({
    segredos: { TAVILY_API_KEY: 't' },
    tavily: async () => { tentativas += 1; const e = new Error('Tavily HTTP 432'); e.status = 432; throw e; },
    config: { ordem: ['places', 'tavily'] },
  });
  const r1 = await busca.buscarPaginas({ alvo: ALVO });
  assert.equal(r1.transitorio, true, 'provedor fora do ar não é "empresa sem telefone"');
  await busca.buscarPaginas({ alvo: { ...ALVO, cnpj: '99999999000100' } });
  assert.equal(tentativas, 1);
});

test('falha de provedor não grava cache negativo; resposta vazia grava', async () => {
  const quebrado = montar({
    segredos: { TAVILY_API_KEY: 't' },
    tavily: async () => { throw new Error('rede'); },
    config: { ordem: ['tavily'] },
  });
  await quebrado.busca.buscarPaginas({ alvo: ALVO });
  assert.equal(quebrado.pool.estado.cache.size, 0);

  const vazio = montar({
    segredos: { TAVILY_API_KEY: 't' },
    tavily: async () => [],
    config: { ordem: ['tavily'] },
  });
  const r = await vazio.busca.buscarPaginas({ alvo: ALVO });
  assert.equal(r.transitorio, false);
  assert.equal(vazio.pool.estado.cache.size, 1);
});

test('Tavily usa no máximo 2 consultas e para na que trouxe telefone', async () => {
  const consultas = [];
  const { busca } = montar({
    segredos: { TAVILY_API_KEY: 't' },
    tavily: async ({ query }) => { consultas.push(query); return [{ url: 'u', content: 'tel 62 3333-4444' }]; },
    config: { ordem: ['tavily'] },
  });
  await busca.buscarPaginas({ alvo: ALVO });
  assert.equal(consultas.length, 1);
});

test('temTelefone só aceita texto com número', () => {
  assert.equal(temTelefone([{ content: 'sem número' }]), false);
  assert.equal(temTelefone([{ content: 'Fone 3333-4444' }]), true);
});
