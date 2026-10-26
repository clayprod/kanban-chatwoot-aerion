const test = require('node:test');
const assert = require('node:assert/strict');

const { criarCofre, PREFIXO } = require('../segredos');
const { encrypt, encryptionKey } = require('../ecommerce/domain');

const ENV = { ECOMMERCE_ENCRYPTION_KEY: 'a'.repeat(64) };

const poolFake = (linhas = []) => {
  const gravados = [];
  return {
    gravados,
    consultas: 0,
    async query(sql, params) {
      if (sql.startsWith('INSERT')) { gravados.push({ chave: params[0], valor: params[1] }); return { rows: [] }; }
      this.consultas += 1;
      return { rows: linhas };
    },
  };
};

test('le o segredo do banco, decifrado', async () => {
  const pool = poolFake([
    { chave: `${PREFIXO}TAVILY_API_KEY`, valor: encrypt('tvly-do-banco', encryptionKey(ENV)) },
  ]);
  const cofre = criarCofre({ pool, env: ENV });
  assert.equal(await cofre.ler('TAVILY_API_KEY'), 'tvly-do-banco');
});

test('o banco ganha do env; sem registro, vale o env', async () => {
  const env = { ...ENV, TAVILY_API_KEY: 'tvly-do-env', OUTRA: 'so-no-env' };
  const pool = poolFake([
    { chave: `${PREFIXO}TAVILY_API_KEY`, valor: encrypt('tvly-do-banco', encryptionKey(env)) },
  ]);
  const cofre = criarCofre({ pool, env });
  assert.equal(await cofre.ler('TAVILY_API_KEY'), 'tvly-do-banco');
  assert.equal(await cofre.ler('OUTRA'), 'so-no-env', 'env e o piso enquanto nao migrar');
  assert.equal(await cofre.ler('NAO_EXISTE'), null);
});

test('grava cifrado — credencial nao fica em texto puro no banco', async () => {
  const pool = poolFake();
  const cofre = criarCofre({ pool, env: ENV });
  await cofre.gravar('EVOLUTION_TOKEN_IAGO_AERION', 'ED3821C1FCC5', 'clayton');
  const [g] = pool.gravados;
  assert.equal(g.chave, `${PREFIXO}EVOLUTION_TOKEN_IAGO_AERION`);
  assert.ok(!g.valor.includes('ED3821C1FCC5'), 'o valor nao pode aparecer legivel');
  assert.ok(g.valor.length > 10);
});

test('nao bate no banco a cada leitura', async () => {
  const pool = poolFake([{ chave: `${PREFIXO}X`, valor: encrypt('1', encryptionKey(ENV)) }]);
  const cofre = criarCofre({ pool, env: ENV });
  await cofre.ler('X'); await cofre.ler('X'); await cofre.ler('X');
  assert.equal(pool.consultas, 1);
});

test('banco fora do ar nao derruba: cai para o env', async () => {
  const env = { ...ENV, TAVILY_API_KEY: 'tvly-do-env' };
  const pool = { async query() { throw new Error('ECONNREFUSED'); } };
  const cofre = criarCofre({ pool, env });
  assert.equal(await cofre.ler('TAVILY_API_KEY'), 'tvly-do-env');
});

test('segredo cifrado com outra chave e ignorado, nao explode', async () => {
  const env = { ...ENV, TAVILY_API_KEY: 'tvly-do-env' };
  const pool = poolFake([{ chave: `${PREFIXO}TAVILY_API_KEY`, valor: 'lixo-que-nao-decifra' }]);
  const cofre = criarCofre({ pool, env });
  assert.equal(await cofre.ler('TAVILY_API_KEY'), 'tvly-do-env');
});
