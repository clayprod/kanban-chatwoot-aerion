const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolverFlag,
  carregarSettings,
  invalidarCacheSettings,
  gravarSetting,
} = require('../aiSettings');

// As env vivem em `docker service update --env-add` e foram apagadas por deploy seis
// vezes: o follow-up ficou dias parado e a classificação voltou sozinha para modo
// sombra depois de ligada. Por isso o estado operacional mora no banco.

test('o banco manda; sem registro vale a env', () => {
  const banco = new Map([['followup_enabled', '1'], ['stage_dry_run', '0']]);
  assert.equal(resolverFlag(banco, 'followup_enabled', false), true, 'banco liga mesmo com env off');
  assert.equal(resolverFlag(banco, 'stage_dry_run', true), false, 'banco desliga mesmo com env on');
  assert.equal(resolverFlag(banco, 'stage_enabled', true), true, 'sem registro, cai na env');
  assert.equal(resolverFlag(new Map(), 'followup_enabled', false), false, 'banco vazio preserva o default');
});

test('aceita as grafias usadas na mao e ignora lixo', () => {
  for (const v of ['1', 'true', 'TRUE', 'sim', 'on', 'yes']) {
    assert.equal(resolverFlag(new Map([['k', v]]), 'k', false), true, v);
  }
  for (const v of ['0', 'false', 'nao', 'não', 'off', 'no']) {
    assert.equal(resolverFlag(new Map([['k', v]]), 'k', true), false, v);
  }
  // Valor sem sentido não pode virar um liga/desliga aleatório: mantém a env.
  for (const v of ['talvez', '', '  ']) {
    assert.equal(resolverFlag(new Map([['k', v]]), 'k', true), true, JSON.stringify(v));
  }
});

test('banco fora do ar nao derruba o worker', async () => {
  invalidarCacheSettings();
  const pool = { async query() { throw new Error('connection refused'); } };
  const valores = await carregarSettings(pool, { agora: Date.now() });
  assert.ok(valores instanceof Map, 'devolve mapa vazio em vez de explodir');
  // E o que vale passa a ser a env, nao um estado inventado.
  assert.equal(resolverFlag(valores, 'followup_enabled', true), true);
});

test('cache evita ir ao banco a cada tick, mas a gravacao vale na hora', async () => {
  invalidarCacheSettings();
  let consultas = 0;
  const linhas = [{ chave: 'followup_enabled', valor: '0' }];
  const pool = {
    async query(sql, params) {
      if (String(sql).startsWith('INSERT')) { linhas[0].valor = params[1]; return { rows: [] }; }
      consultas += 1;
      return { rows: linhas };
    },
  };
  const t = Date.now();
  await carregarSettings(pool, { agora: t });
  await carregarSettings(pool, { agora: t + 1000 });
  assert.equal(consultas, 1, 'segunda leitura veio do cache');

  await gravarSetting(pool, 'followup_enabled', '1');
  const depois = await carregarSettings(pool, { agora: t + 2000 });
  assert.equal(consultas, 2, 'gravar invalida o cache');
  assert.equal(resolverFlag(depois, 'followup_enabled', false), true);
});
