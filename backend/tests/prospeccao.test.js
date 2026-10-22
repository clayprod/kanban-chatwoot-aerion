const test = require('node:test');
const assert = require('node:assert/strict');

const {
  perfilConfirmaEmpresa,
  extrairPerfis,
  paramsDaBusca,
  montarPromptAbordagem,
  carregarConfigProspeccao,
  runProspeccaoTick,
} = require('../prospeccao');

const CFG = {
  enabled: true, dryRun: false, maxPorDia: 10, maxPorTick: 3,
  candidatosPorPerfil: 40, minConfianca: 0.6,
};

const EMPRESA = {
  cnpj: '11222333000181',
  razao_social: 'SERTEC ENGENHARIA E AEROLEVANTAMENTOS LTDA',
  nome_fantasia: 'Sertec Aero',
  ddd_telefone_1: '5519987654321',
  municipio_nome: 'Vinhedo', uf: 'SP',
  cnae_principal_desc: 'Serviços de cartografia e topografia',
};

const fakePool = ({ jaNaBase = [], jaTentados = [], hoje = 0 } = {}) => {
  const gravados = [];
  return {
    gravados,
    async query(sql, params) {
      if (sql.includes('INSERT INTO prospeccao_log')) {
        gravados.push({ status: params[5], motivo: params[6], confirmou: params[8], msg: params[10] });
        return { rows: [] };
      }
      if (sql.includes('COUNT(*)::int AS total')) return { rows: [{ total: hoje }] };
      if (sql.includes('FROM contacts')) return { rows: jaNaBase.map((c) => ({ cnpj: c })) };
      if (sql.includes('FROM prospeccao_log')) return { rows: jaTentados.map((c) => ({ cnpj: c })) };
      throw new Error(`query inesperada: ${sql.slice(0, 50)}`);
    },
  };
};

const deps = (over = {}) => ({
  accountId: 2,
  carregarPerfis: async () => [{ titulo: 'Topografia SP', filtros: { cnae: ['7119702'], uf: 'SP' } }],
  buscarEmpresas: async () => [EMPRESA],
  verificarNumerosWhatsapp: async () => ({
    existentes: new Set(['5519987654321']),
    perfis: new Map([['5519987654321', 'Sertec Aero']]),
  }),
  chatCompletionJson: async () => ({
    ok: true,
    data: { mensagem: 'Oi! Como está o volume de voo de vocês?', confianca: 0.8 },
  }),
  importarLead: async () => 999,
  enfileirarEnvio: async () => {},
  config: CFG,
  ...over,
});

test('defaults nascem desligados e em sombra', () => {
  const salvos = {};
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('PROSPECCAO_')) { salvos[k] = process.env[k]; delete process.env[k]; }
  }
  try {
    const c = carregarConfigProspeccao();
    assert.equal(c.enabled, false, 'contato frio nunca pode comecar sozinho');
    assert.equal(c.dryRun, true);
    assert.equal(c.maxPorDia, 10);
  } finally { Object.assign(process.env, salvos); }
});

test('so confirma a empresa com palavra significativa em comum', () => {
  assert.equal(perfilConfirmaEmpresa('Sertec Engenharia', 'SERTEC ENGENHARIA E AEROLEV LTDA'), true);
  assert.equal(perfilConfirmaEmpresa('Compcell', 'A.C.COMPCELL COMERCIO DE INFORMATICA LTDA'), true);
  // Palavra generica nao confirma nada: metade das empresas tem "comercio" no nome.
  assert.equal(perfilConfirmaEmpresa('Comercio', 'A.C.COMPCELL COMERCIO DE INFORMATICA LTDA'), false);
  assert.equal(perfilConfirmaEmpresa('LTDA', 'GESTAO ENGENHARIA E COMERCIO LTDA'), false);
  // Nome de pessoa que nao tem relacao com a empresa.
  assert.equal(perfilConfirmaEmpresa('Thelga', 'SERTEC ENGENHARIA LTDA'), false);
  assert.equal(perfilConfirmaEmpresa('', 'QUALQUER LTDA'), false);
});

test('perfis do Radar entram sem formato novo', () => {
  const p = extrairPerfis({ suggestions: [
    { titulo: 'A', filters: { cnae: ['7119702'], uf: 'SP' } },
    { titulo: 'B', filters: {} },           // sem cnae nem uf: ignorado
    { titulo: 'C' },                        // sem filters: ignorado
  ] });
  assert.equal(p.length, 1);
  assert.equal(p[0].titulo, 'A');
  assert.deepEqual(extrairPerfis(null), []);
});

test('a busca so manda ativas e matriz por padrao', () => {
  const qs = paramsDaBusca({ cnae: ['7119702', '7112000'], uf: 'SP', porte: '03' }, { pageSize: 40 });
  assert.equal(qs.get('cnae'), '7119702,7112000');
  assert.equal(qs.get('uf'), 'SP');
  assert.equal(qs.get('situacao'), '2', 'empresa baixada nao e lead');
  assert.equal(qs.get('only_matriz'), 'true');
  assert.equal(qs.get('page_size'), '40');
});

test('quando o perfil NAO confirma, a abertura tem que perguntar', () => {
  const { system, user } = montarPromptAbordagem({
    empresa: EMPRESA, perfil: 'Topografia SP', confirmouEmpresa: false,
  });
  assert.match(system, /NÃO temos certeza/);
  assert.match(system, /falo com alguém da/);
  assert.match(user, /CONFIRMANDO primeiro/);
  // E a prova social, que responde 35% contra 19%, continua sendo a base.
  assert.match(system, /prova social/);
  assert.match(system, /35%/);
});

test('quando confirma, vai direto ao assunto', () => {
  const { system, user } = montarPromptAbordagem({
    empresa: EMPRESA, perfil: 'Topografia SP', confirmouEmpresa: true,
  });
  assert.match(system, /vá direto ao assunto/);
  assert.doesNotMatch(user, /CONFIRMANDO primeiro/);
});

test('desligado nao consulta nada', async () => {
  const pool = fakePool();
  const r = await runProspeccaoTick(pool, deps({
    config: { ...CFG, enabled: false },
    carregarPerfis: async () => { throw new Error('nao deveria buscar perfil'); },
  }));
  assert.deepEqual(r, { skipped: 'desligado' });
});

test('teto diario corta antes de gastar token', async () => {
  const pool = fakePool({ hoje: 10 });
  const r = await runProspeccaoTick(pool, deps({
    chatCompletionJson: async () => { throw new Error('nao deveria chamar a IA'); },
  }));
  assert.equal(r.skipped, 'teto diário atingido');
});

test('numero que nao existe no WhatsApp e descartado antes da IA', async () => {
  const pool = fakePool();
  let chamouIA = false;
  const r = await runProspeccaoTick(pool, deps({
    verificarNumerosWhatsapp: async () => ({ existentes: new Set(), perfis: new Map() }),
    chatCompletionJson: async () => { chamouIA = true; return { ok: true, data: {} }; },
  }));
  assert.equal(chamouIA, false);
  assert.equal(r.descartados, 1);
  assert.match(pool.gravados.at(-1).motivo, /não existe no WhatsApp/);
});

test('empresa que ja esta na base nao e prospectada de novo', async () => {
  const pool = fakePool({ jaNaBase: ['11222333000181'] });
  const r = await runProspeccaoTick(pool, deps({
    chatCompletionJson: async () => { throw new Error('nao deveria chamar a IA'); },
  }));
  assert.equal(r.avaliados, 0);
  assert.equal(r.abordados, 0);
});

test('empresa ja tentada antes nao volta', async () => {
  const pool = fakePool({ jaTentados: ['11222333000181'] });
  const r = await runProspeccaoTick(pool, deps());
  assert.equal(r.avaliados, 0);
});

test('aborda, importa o lead e enfileira por telefone', async () => {
  const pool = fakePool();
  const enfileirados = [];
  const importados = [];
  const r = await runProspeccaoTick(pool, deps({
    importarLead: async (e) => { importados.push(e.cnpj); return 999; },
    enfileirarEnvio: async (e) => { enfileirados.push(e); },
  }));
  assert.equal(r.abordados, 1);
  assert.deepEqual(importados, ['11222333000181']);
  // Lead frio nao tem conversa: o envio vai por telefone.
  assert.equal(enfileirados[0].telefone, '5519987654321');
  assert.equal(enfileirados[0].contactId, 999);
  assert.match(enfileirados[0].dedupeKey, /^prospeccao:11222333000181$/);
  assert.equal(pool.gravados.at(-1).status, 'abordado');
  assert.equal(pool.gravados.at(-1).confirmou, true);
});

test('modo sombra decide mas nao importa nem envia', async () => {
  const pool = fakePool();
  let importou = false; let enfileirou = false;
  const r = await runProspeccaoTick(pool, deps({
    config: { ...CFG, dryRun: true },
    importarLead: async () => { importou = true; return 1; },
    enfileirarEnvio: async () => { enfileirou = true; },
  }));
  assert.equal(importou, false, 'nao polui a base em modo sombra');
  assert.equal(enfileirou, false);
  assert.equal(r.abordados, 1);
  assert.equal(pool.gravados.at(-1).status, 'dry_run');
});

test('mensagem reprovada na validacao nao sai', async () => {
  const pool = fakePool();
  let enfileirou = false;
  const r = await runProspeccaoTick(pool, deps({
    chatCompletionJson: async () => ({ ok: true, data: { mensagem: 'Oi, tem interesse?', confianca: 0.9 } }),
    validarMensagem: () => 'pergunta fechada de interesse',
    enfileirarEnvio: async () => { enfileirou = true; },
  }));
  assert.equal(enfileirou, false);
  assert.equal(r.descartados, 1);
});
