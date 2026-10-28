const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ehVeiculoDeObra,
  perfilConfirmaEmpresa,
  extrairPerfis,
  paramsDaBusca,
  cnaesValidos,
  telefoneDaEmpresa,
  montarPromptAbordagem,
  comporAbordagem,
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
      if (sql.includes('AS total')) return { rows: [{ total: hoje }] };
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

// Por que a prospeccao ficou ligada horas sem abordar ninguem (reportado em 23/10):
// o cache do Radar guarda as sugestoes em intel.suggestions, e o worker lia a raiz.
test('le as sugestoes de onde o cache do Radar realmente guarda', () => {
  const comoVemDoCache = {
    day: '2026-10-23',
    geo: 'BR',
    trends: [],
    news: [],
    intel: {
      summary: 'x',
      suggestions: [{ title: 'Topografia', filters: { cnae: ['4120400'], uf: '' } }],
    },
  };
  const p = extrairPerfis(comoVemDoCache);
  assert.equal(p.length, 1, 'perfil do cache real tem que ser encontrado');
  assert.equal(p[0].titulo, 'Topografia');
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

test('CNAE formatado nao vai para a busca', () => {
  // Medido em producao em 23/10: "7520-0/00" devolve total 0 em 0.0s, porque a coluna
  // guarda 7 digitos. Dois dos cinco perfis do dia tinham so codigo formatado.
  assert.deepEqual(cnaesValidos(['7520-0/00', '3511-2/00', '4120400']), ['7520000', '3511200', '4120400']);
  assert.deepEqual(cnaesValidos(['35', 'drone', null, '']), [], 'codigo curto ou texto nao vira filtro');
  const qs = paramsDaBusca({ cnae: ['4120-4/00'] }, { pageSize: 10 });
  assert.equal(qs.get('cnae'), '4120400', 'pontuacao e tirada antes de buscar');
});

test('a faixa de idade da empresa NAO vai para a busca', () => {
  // Mesma medicao: CNAE + idade 3-25 anos estourou o statement timeout de 120s
  // (504 em 140s); o mesmo CNAE com porte e capital respondeu em ~20s.
  const qs = paramsDaBusca(
    { cnae: ['4120400'], porte: '05', capital_min: 500000, abertura_min_anos: 3, abertura_max_anos: 25 },
    { pageSize: 40 }
  );
  assert.equal(qs.get('abertura_min_anos'), null);
  assert.equal(qs.get('abertura_max_anos'), null);
  assert.equal(qs.get('porte'), '05', 'porte e capital continuam, que sao baratos');
  assert.equal(qs.get('capital_min'), '500000');
});

test('telefone sai de ddd1/telefone1, como a busca RFB devolve', () => {
  // Ler ddd_telefone_1 (formato de importacao) dava undefined em todo candidato e
  // cada empresa era registrada como "sem telefone no cadastro".
  assert.equal(telefoneDaEmpresa({ ddd1: '61', telefone1: '39644043' }), '556139644043');
  assert.equal(telefoneDaEmpresa({ ddd1: '11', telefone1: '987654321' }), '5511987654321');
  assert.equal(
    telefoneDaEmpresa({ ddd1: '', telefone1: '', ddd2: '85', telefone2: '98745632' }),
    '558598745632',
    'cai para o segundo telefone do cadastro'
  );
  assert.equal(telefoneDaEmpresa({ ddd_telefone_1: '(19) 98765-4321' }), '5519987654321');
  assert.equal(telefoneDaEmpresa({ telefone: '+55 (19) 98765-4321' }), '5519987654321', 'não duplica o código do país');
  assert.equal(telefoneDaEmpresa({ ddd1: '61', telefone1: '3964' }), '', 'curto demais para discar');
  assert.equal(telefoneDaEmpresa({}), '');
});

test('quando o perfil NAO confirma, a abertura tem que perguntar', () => {
  const { system, user } = montarPromptAbordagem({
    empresa: EMPRESA, perfil: 'Topografia SP', confirmouEmpresa: false,
  });
  assert.match(system, /NÃO temos certeza/);
  assert.match(system, /falo com alguém da/);
  assert.match(user, /CONFIRMANDO primeiro/);
  assert.match(system, /Não invente prova social/);
  assert.match(system, /UMA aplicação concreta/);
});

test('apresentação e portfólio são obrigatórios mesmo quando a IA só escreve a aplicação',async()=>{
 const enviadas=[];
 const corpo='Drones permitem acompanhar a evolução das obras por imagens e comparar frentes de trabalho. Quem cuida desse acompanhamento na empresa?';
 await runProspeccaoTick(fakePool(),deps({chatCompletionJson:async()=>({ok:true,data:{mensagem:corpo,confianca:0.9}}),enfileirarEnvio:async item=>enviadas.push(item)}));
 assert.equal(enviadas.length,1);assert.equal(enviadas[0].texto,comporAbordagem(corpo));
 assert.match(enviadas[0].texto,/^Olá! Somos da Aerion, distribuidora de drones profissionais e representante da Autel no Brasil\./);
 assert.ok(enviadas[0].texto.endsWith('Portfólio: https://aerion.com.br/produtos'));
 assert.ok(enviadas[0].texto.length<=600);
 const prompt=montarPromptAbordagem({empresa:{...EMPRESA,cnae_descricao:'Serviços de engenharia'},confirmouEmpresa:true});
 assert.match(prompt.user,/Atividade \(CNAE\): Serviços de engenharia/);
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
  assert.match(pool.gravados.at(-1).motivo, /Receita sem WhatsApp/);
  assert.match(pool.gravados.at(-1).motivo, /na web: não procurei/, 'diz que nem tentou a web');
});

test('sem WhatsApp na Receita, procura o contato na web antes de desistir', async () => {
  // Medido em 24/10: o telefone da Receita tem WhatsApp em 2 de ~360 empresas. Sem
  // procurar fora, a prospeccao avalia dezenas e aborda zero.
  const pool = fakePool();
  const consultados = [];
  const r = await runProspeccaoTick(pool, deps({
    verificarNumerosWhatsapp: async (nums) => {
      consultados.push(nums);
      // O da Receita nao tem; o achado na web tem.
      return { existentes: new Set(nums.filter((n) => n === '5519998887777')), perfis: new Map() };
    },
    buscarContatoWeb: async () => ({
      numero: '5519998887777', fonte: 'instagram', origem: 'https://instagram.com/x', celular: true,
    }),
  }));
  assert.equal(r.abordados, 1);
  assert.equal(r.achadosNaWeb, 1);
  assert.equal(pool.gravados.at(-1).status, 'enfileirado');
  assert.match(pool.gravados.at(-1).motivo, /achado na web \(instagram\)/);
});

test('numero achado na web que nao tem WhatsApp nao e usado', async () => {
  const pool = fakePool();
  const r = await runProspeccaoTick(pool, deps({
    verificarNumerosWhatsapp: async () => ({ existentes: new Set(), perfis: new Map() }),
    buscarContatoWeb: async () => ({ numero: '5519998887777', fonte: 'site', origem: 'https://x.com' }),
  }));
  assert.equal(r.descartados, 1);
  assert.match(pool.gravados.at(-1).motivo, /achado na web, mas sem WhatsApp/);
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
  // 'enfileirado', nao 'abordado': a abordagem entrou na fila e quem entrega e o
  // despachante. O painel precisa dizer a verdade.
  assert.equal(pool.gravados.at(-1).status, 'enfileirado');
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

test('CNAE repetido nao vai duplicado para a busca', () => {
  // Perfil do Radar de 24/10 veio com "0111301,0111301".
  assert.deepEqual(cnaesValidos(['0111301', '0111301', '4120400']), ['0111301', '4120400']);
  const qs = paramsDaBusca({ cnae: ['0111-3/01', '0111301'] }, { pageSize: 10 });
  assert.equal(qs.get('cnae'), '0111301');
});

test('empresa fora dos ICPs nao e abordada', async () => {
  // Medido em 24/10 em dry run: perfil de agronegocio (vertical descontinuada) trouxe
  // uma produtora de arroz, e a IA escreveu abordagem sobre monitorar lavoura e pasto.
  // Sem ICP nao se sabe a dor, e o modelo inventa uma.
  const registros = [];
  const pool = {
    async query(sql, params) {
      if (sql.includes('INSERT INTO prospeccao_log')) {
        registros.push({ status: params[5], motivo: params[6] });
        return { rows: [] };
      }
      if (sql.includes('FROM prospeccao_log')) return { rows: [] };
      if (sql.includes('AS total')) return { rows: [{ total: 0 }] };
      if (sql.includes('FROM contacts')) return { rows: [] };
      return { rows: [] };
    },
  };
  let chamouIa = false;
  const r = await runProspeccaoTick(pool, {
    accountId: 2,
    config: { enabled: true, dryRun: true, maxPorDia: 10, maxPorTick: 3, candidatosPorPerfil: 5, minConfianca: 0.6 },
    carregarPerfis: async () => [{ titulo: 'Agronegócio', filtros: { cnae: ['0111301'] } }],
    buscarEmpresas: async () => ([{
      cnpj: '12345678000195', razao_social: 'BOM AMIGO AGROPECUARIA LTDA',
      ddd1: '11', telefone1: '47943786', cnae_fiscal_principal: '0111301',
      cnae_descricao: 'Cultivo de arroz',
    }]),
    verificarNumerosWhatsapp: async () => ({ existentes: new Set(['551147943786']), perfis: new Map() }),
    chatCompletionJson: async () => { chamouIa = true; return { ok: false }; },
    contextoComercial: async () => ({ icp: 'desconhecido', blocoIcp: '', blocoCatalogo: '' }),
  });
  assert.equal(chamouIa, false, 'nem gasta token escrevendo para quem nao e ICP');
  assert.equal(r.descartados, 1);
  assert.match(registros[0].motivo, /fora dos ICPs/);
  assert.equal(registros[0].status, 'descartado');
});

test('o teto diario conta mensagem ENTREGUE, nao tentativa', async () => {
  // Regra do Clayton (24/10). Em 23/10 o despachante estava quebrado: contar por
  // "abordado" (que e so enfileirado) queimaria os 10 do dia sem um unico envio.
  let sqlVisto = '';
  const pool = {
    async query(sql) {
      if (sql.includes('AS total')) { sqlVisto = sql; return { rows: [{ total: 10 }] }; }
      return { rows: [] };
    },
  };
  const r = await runProspeccaoTick(pool, {
    accountId: 2,
    config: { enabled: true, dryRun: false, maxPorDia: 10, maxPorTick: 3 },
    carregarPerfis: async () => { throw new Error('nao devia chegar aqui'); },
  });
  assert.match(r.skipped, /teto di[áa]rio/);
  // Quem diz que saiu e a fila, nao o log de tentativa.
  assert.match(sqlVisto, /outbound_queue/);
  assert.match(sqlVisto, /status = 'sent'/);
  assert.match(sqlVisto, /origem = 'prospeccao'/);
  // Dry run ainda conta, porque gasta token.
  assert.match(sqlVisto, /status = 'dry_run'/);
  // E o que apenas entrou na fila NAO conta.
  assert.doesNotMatch(sqlVisto, /'abordado'/);
});

test('SPE e SCP nao sao abordadas: sao CNPJ de uma obra', () => {
  // Em 26/10 a prospeccao automatica enfileirou 9 abordagens e 7 eram SPE/SCP.
  // Nao tem operacao, nao compra equipamento e nao tem ninguem atendendo.
  for (const nome of [
    'BATEL SPOT EMPREENDIMENTO SPE LTDA',
    'NEO LIFE PENHA II LTDA SCP',
    'YT5 MGA INCORPORACOES SPE LTDA',
    'IMSW SPE 03 LTDA',
    'RT 47 EMPREENDIMENTOS IMOBILIARIOS SPE S.A.',
  ]) {
    assert.equal(ehVeiculoDeObra({ razao_social: nome }), true, nome);
  }
  // Empresa de verdade continua passando.
  for (const nome of [
    'GEOMINAS TOPOGRAFIA LTDA',
    'CONSTRUTORA SAGA LTDA',
    'ESPECTRO ENGENHARIA LTDA',
    'SPEED FARAH IMOVEIS LTDA',
  ]) {
    assert.equal(ehVeiculoDeObra({ razao_social: nome }), false, nome);
  }
});

test('verificacao indisponivel NAO vira abordagem', async () => {
  // A verificacao e fail-OPEN (devolve todos como existentes quando nao consegue
  // consultar), o que serve para campanha mas nao para contato frio: em 26/10 o
  // token sumiu num deploy e a prospeccao aceitou PABX sem conferir nada.
  const pool = fakePool();
  let chamouIA = false;
  const r = await runProspeccaoTick(pool, deps({
    verificarNumerosWhatsapp: async (nums) => ({
      existentes: new Set(nums), perfis: new Map(), indisponivel: true,
    }),
    chatCompletionJson: async () => { chamouIA = true; return { ok: true, data: {} }; },
  }));
  assert.equal(chamouIA, false);
  assert.equal(r.abordados, 0);
  assert.match(r.errosBusca.join(' '), /verificação de WhatsApp indisponível/);
});
