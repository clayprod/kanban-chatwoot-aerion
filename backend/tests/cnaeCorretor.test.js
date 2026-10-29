const test = require('node:test');
const assert = require('node:assert/strict');
const { corrigirCnaes } = require('../cnaeCorretor');

// Trecho real da rfb_cnaes (consultado em produção em 29/10).
const TABELA = [
  { codigo: '8421300', descricao: 'Relações exteriores' },
  { codigo: '8422100', descricao: 'Defesa' },
  { codigo: '8423000', descricao: 'Justiça' },
  { codigo: '8424800', descricao: 'Segurança e ordem pública' },
  { codigo: '8425600', descricao: 'Defesa Civil' },
  { codigo: '8011101', descricao: 'Atividades de vigilância e segurança privada' },
  { codigo: '7119702', descricao: 'Atividades de estudos geológicos' },
  { codigo: '4120400', descricao: 'Construção de edifícios' },
];

test('CNAE que existe passa intacto', () => {
  const r = corrigirCnaes({ lista: ['4120-4/00'], tabela: TABELA });
  assert.deepEqual(r.validos, ['4120400']);
  assert.deepEqual(r.corrigidos, []);
});

test('o caso de 29/10: 8421-1/00 vira Segurança e ordem pública + Defesa Civil, não Relações exteriores', () => {
  const r = corrigirCnaes({
    lista: ['8421-1/00'],
    labels: [{ codigo: '8421-1/00', descricao: 'Segurança pública' }],
    titulo: 'Segurança pública e defesa civil',
    tabela: TABELA,
  });
  assert.deepEqual(r.validos.sort(), ['8424800', '8425600']);
  assert.equal(r.corrigidos[0].de, '8421100');
  assert.ok(!r.validos.includes('8421300'), 'vizinho numérico sem relação com o setor');
  assert.ok(!r.validos.includes('8011101'), 'outra divisão (segurança privada) não entra');
});

test('sem descrição não há palpite por vizinhança numérica: descarta e registra', () => {
  const r = corrigirCnaes({ lista: ['8421-1/00'], tabela: TABELA });
  assert.deepEqual(r.validos, []);
  assert.equal(r.descartados[0].de, '8421100');
});

test('descrição que não bate com nada da mesma divisão descarta', () => {
  const r = corrigirCnaes({
    lista: ['8421-1/00'], titulo: 'Fabricação de drones agrícolas', tabela: TABELA,
  });
  assert.deepEqual(r.validos, []);
  assert.equal(r.descartados.length, 1);
});

test('mistura de válido e inválido mantém o válido e corrige o outro, sem duplicar', () => {
  const r = corrigirCnaes({
    lista: ['8425-6/00', '8421-1/00'],
    labels: [{ codigo: '8421-1/00', descricao: 'Defesa Civil' }],
    tabela: TABELA,
  });
  assert.deepEqual(r.validos.filter((c) => c === '8425600').length, 1);
  assert.ok(r.validos.includes('8425600'));
});

test('o 504 de 29/10: "Administração pública em geral" é trocada por Defesa Civil no perfil de resgate', () => {
  const r = corrigirCnaes({
    lista: ['8411600', '8411700'],
    labels: [
      { codigo: '8411600', descricao: 'ADMINISTRAÇÃO PÚBLICA EM GERAL' },
      { codigo: '8411700', descricao: '8411-7/00', unresolved: false },
    ],
    titulo: 'Empresas de resgate e emergência',
    tabela: [...TABELA, { codigo: '8411600', descricao: 'Administração pública em geral' }],
  });
  assert.deepEqual(r.validos, ['8425600']);
  assert.ok(!r.validos.includes('8411600'), 'toda prefeitura do país: setor errado e consulta enorme');
  assert.ok(!r.validos.includes('8422100'), 'Defesa (forças armadas) não é resgate');
});

test('CNAE genérico sem contexto do setor é descartado, nunca mantido', () => {
  const r = corrigirCnaes({
    lista: ['8411600'], tabela: [{ codigo: '8411600', descricao: 'Administração pública em geral' }],
  });
  assert.deepEqual(r.validos, []);
  assert.equal(r.descartados.length, 1);
});
