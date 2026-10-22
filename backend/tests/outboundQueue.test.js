const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PRIORIDADES,
  prioridadeDe,
  bloqueioDoNumero,
  despacharTick,
  enfileirar,
} = require('../outboundQueue');

const LIMITES = { gapSegundos: 300, capHorario: 12, capDiario: 40 };
const AGORA = new Date('2026-10-22T15:00:00.000Z'); // quinta, 12h SP

// Pool falso: a fila em memória, a carga por inbox controlada pelo teste.
const fakePool = ({ fila = [], carga = [] } = {}) => {
  const updates = [];
  return {
    updates,
    async query(sql, params) {
      if (sql.includes('FROM outbound_queue') && sql.includes("status = 'pending'")) {
        return { rows: fila };
      }
      if (sql.includes('FROM messages m')) return { rows: carga };
      if (sql.includes('UPDATE outbound_queue')) {
        updates.push({ id: params[0], sql });
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO outbound_queue')) return { rows: [{ id: 1 }] };
      throw new Error(`query inesperada: ${sql.slice(0, 50)}`);
    },
  };
};

const item = (id, origem, inbox, extra = {}) => ({
  id, origem, inbox_id: inbox, prioridade: prioridadeDe(origem),
  texto: `msg ${id}`, attempts: 0, ...extra,
});

test('resposta de cliente nunca espera atras de contato frio', () => {
  assert.ok(PRIORIDADES.resposta < PRIORIDADES.followup);
  assert.ok(PRIORIDADES.followup < PRIORIDADES.campanha);
  assert.ok(PRIORIDADES.campanha < PRIORIDADES.prospeccao);
  assert.equal(prioridadeDe('origem_desconhecida'), 50, 'origem nova entra por ultimo, nao na frente');
});

test('enfileirar rejeita origem invalida e texto vazio', async () => {
  const pool = fakePool();
  await assert.rejects(() => enfileirar(pool, { accountId: 2, origem: 'spam', texto: 'oi' }), /origem inválida/);
  await assert.rejects(() => enfileirar(pool, { accountId: 2, origem: 'followup', texto: '   ' }), /texto vazio/);
});

test('bloqueia pelo gap, pelo teto horario e pelo diario', () => {
  const t = AGORA.getTime();
  // Mandou ha 1 minuto: o gap de 5 min ainda vale.
  assert.match(
    bloqueioDoNumero({ hoje: 1, ultima_hora: 1, ultimo_envio: new Date(t - 60000) }, LIMITES, t),
    /faltam \d+s/
  );
  // Ha 10 minutos: liberado.
  assert.equal(
    bloqueioDoNumero({ hoje: 1, ultima_hora: 1, ultimo_envio: new Date(t - 600000) }, LIMITES, t),
    null
  );
  assert.match(bloqueioDoNumero({ hoje: 5, ultima_hora: 12, ultimo_envio: null }, LIMITES, t), /por hora/);
  assert.match(bloqueioDoNumero({ hoje: 40, ultima_hora: 0, ultimo_envio: null }, LIMITES, t), /diário/);
  // Número sem histórico nenhum está liberado.
  assert.equal(bloqueioDoNumero(undefined, LIMITES, t), null);
});

test('CONFLITO: follow-up e prospeccao no mesmo numero nao saem juntos', async () => {
  // O cenário que motivou a fila: dois sistemas querendo o mesmo número ao mesmo tempo.
  const pool = fakePool({
    fila: [item(1, 'followup', 6), item(2, 'prospeccao', 6), item(3, 'campanha', 6)],
  });
  const enviados = [];
  const r = await despacharTick(pool, {
    accountId: 2,
    enviar: async (i) => { enviados.push(i.id); },
    limites: LIMITES,
    maxPorTick: 5,
    agora: AGORA,
  });
  assert.deepEqual(enviados, [1], 'só o de maior prioridade sai; os outros esperam o próximo tick');
  assert.equal(r.despachados, 1);
  assert.equal(r.bloqueados, 2);
});

test('numeros diferentes saem no mesmo tick', async () => {
  const pool = fakePool({
    fila: [item(1, 'followup', 6), item(2, 'followup', 5), item(3, 'followup', 2)],
  });
  const enviados = [];
  await despacharTick(pool, {
    accountId: 2,
    enviar: async (i) => { enviados.push(i.id); },
    limites: LIMITES,
    maxPorTick: 5,
    agora: AGORA,
  });
  assert.deepEqual(enviados.sort(), [1, 2, 3], 'a trava é por número, não global');
});

test('ordem de prioridade: resposta passa na frente de tudo', async () => {
  const pool = fakePool({
    fila: [
      item(1, 'resposta', 6), item(2, 'followup', 5),
      item(3, 'campanha', 2), item(4, 'prospeccao', 7),
    ].sort((a, b) => a.prioridade - b.prioridade),
  });
  const enviados = [];
  await despacharTick(pool, {
    accountId: 2, enviar: async (i) => { enviados.push(i.origem); },
    limites: LIMITES, maxPorTick: 2, agora: AGORA,
  });
  assert.deepEqual(enviados, ['resposta', 'followup']);
});

test('numero carregado e pulado, e o proximo da fila aproveita a vez', async () => {
  const pool = fakePool({
    fila: [item(1, 'followup', 6), item(2, 'followup', 5)],
    // inbox 6 estourou o teto horário; inbox 5 está livre.
    carga: [
      { inbox_id: 6, hoje: 20, ultima_hora: 12, ultimo_envio: null },
      { inbox_id: 5, hoje: 2, ultima_hora: 0, ultimo_envio: null },
    ],
  });
  const enviados = [];
  const r = await despacharTick(pool, {
    accountId: 2, enviar: async (i) => { enviados.push(i.id); },
    limites: LIMITES, maxPorTick: 5, agora: AGORA,
  });
  assert.deepEqual(enviados, [2], 'o número saturado é pulado, não trava a fila inteira');
  assert.equal(r.bloqueados, 1);
  assert.match(Object.keys(r.motivos)[0], /por hora/);
});

test('fora da janela comercial nao despacha nada', async () => {
  const pool = fakePool({ fila: [item(1, 'followup', 6)] });
  let bateu = false;
  const r = await despacharTick(pool, {
    accountId: 2,
    enviar: async () => { bateu = true; },
    dentroDaJanela: () => false,
    limites: LIMITES, agora: AGORA,
  });
  assert.equal(bateu, false);
  assert.equal(r.skipped, 'fora da janela comercial');
});

test('falha no envio nao derruba o lote e vira retry', async () => {
  const pool = fakePool({ fila: [item(1, 'followup', 6), item(2, 'followup', 5)] });
  const r = await despacharTick(pool, {
    accountId: 2,
    enviar: async (i) => { if (i.id === 1) throw new Error('Evolution 500'); },
    limites: LIMITES, maxPorTick: 5, agora: AGORA,
  });
  assert.equal(r.falhas, 1);
  assert.equal(r.despachados, 1, 'o segundo item saiu mesmo com o primeiro falhando');
  const upd = pool.updates.find((u) => u.id === 1);
  assert.match(upd.sql, /attempts \+ 1 >= 3 THEN 'failed'/, 'tenta de novo antes de desistir');
});

test('o envio conta na carga na hora, sem esperar o banco', async () => {
  // Dois ticks seguidos sem o Chatwoot ter gravado a mensagem ainda: o segundo
  // item do mesmo número tem que continuar bloqueado pelo gap.
  const pool = fakePool({ fila: [item(1, 'followup', 6), item(2, 'followup', 6)] });
  const enviados = [];
  await despacharTick(pool, {
    accountId: 2, enviar: async (i) => { enviados.push(i.id); },
    limites: LIMITES, maxPorTick: 5, agora: AGORA,
  });
  assert.equal(enviados.length, 1);
});
