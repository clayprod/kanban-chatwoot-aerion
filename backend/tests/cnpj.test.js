const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateCnpjCheckDigits,
  formatCnpj,
  hasValidCnpjCheckDigits,
  isCnpjFormat,
  isCnpjRoot,
  normalizeCnpj,
  normalizeFiscalIdentifier,
  splitCnpj,
} = require('../cnpj');

test('normaliza, formata e divide o exemplo oficial de CNPJ alfanumérico', () => {
  const formatted = '12.ABC.345/01DE-35';
  const compact = '12ABC34501DE35';

  assert.equal(normalizeCnpj(formatted.toLowerCase()), compact);
  assert.equal(formatCnpj(compact), formatted);
  assert.deepEqual(splitCnpj(formatted), {
    cnpj: compact,
    basico: '12ABC345',
    ordem: '01DE',
    dv: '35',
  });
  assert.equal(isCnpjFormat(compact), true);
  assert.equal(isCnpjRoot('12.ABC.345'), true);
});

test('calcula os dígitos verificadores pelo módulo 11 alfanumérico da Receita', () => {
  assert.equal(calculateCnpjCheckDigits('12ABC34501DE'), '35');
  assert.equal(hasValidCnpjCheckDigits('12.ABC.345/01DE-35'), true);
  assert.equal(hasValidCnpjCheckDigits('12.ABC.345/01DE-36'), false);
});

test('mantém compatibilidade com CNPJ numérico e CPF de fornecedor', () => {
  assert.equal(formatCnpj('11222333000181'), '11.222.333/0001-81');
  assert.equal(hasValidCnpjCheckDigits('11.222.333/0001-81'), true);
  assert.equal(normalizeFiscalIdentifier('123.456.789-09'), '12345678909');
});

test('rejeita formatos com letras nos dígitos verificadores ou símbolos estranhos', () => {
  assert.equal(isCnpjFormat('12ABC34501DE3F'), false);
  assert.equal(isCnpjFormat('12ABC345@1DE35'), false);
  assert.equal(splitCnpj('ABC'), null);
});
