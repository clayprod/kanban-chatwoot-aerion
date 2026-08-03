import {
  calculateCnpjCheckDigits,
  formatCnpj,
  hasValidCnpjCheckDigits,
  isCnpjFormat,
  isCnpjRoot,
  normalizeCnpj,
  normalizeFiscalIdentifier,
  splitCnpj,
} from './cnpj';

test('suporta o CNPJ alfanumérico oficial sem perder letras', () => {
  const formatted = '12.ABC.345/01DE-35';
  const compact = '12ABC34501DE35';
  expect(normalizeCnpj(formatted.toLowerCase())).toBe(compact);
  expect(formatCnpj(compact)).toBe(formatted);
  expect(splitCnpj(formatted)).toEqual({
    cnpj: compact,
    basico: '12ABC345',
    ordem: '01DE',
    dv: '35',
  });
  expect(isCnpjFormat(compact)).toBe(true);
  expect(isCnpjRoot('12.ABC.345')).toBe(true);
});

test('calcula DV alfanumérico e preserva documentos numéricos', () => {
  expect(calculateCnpjCheckDigits('12ABC34501DE')).toBe('35');
  expect(hasValidCnpjCheckDigits('12.ABC.345/01DE-35')).toBe(true);
  expect(hasValidCnpjCheckDigits('12.ABC.345/01DE-36')).toBe(false);
  expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81');
  expect(normalizeFiscalIdentifier('123.456.789-09')).toBe('12345678909');
});
