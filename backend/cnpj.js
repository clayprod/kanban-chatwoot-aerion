'use strict';

const CNPJ_FORMAT_RE = /^[A-Z0-9]{12}\d{2}$/;
const CNPJ_ROOT_RE = /^[A-Z0-9]{8}$/;
const CNPJ_SEPARATORS_RE = /[.\/\-\s]/g;

const normalizeCnpj = (value) => String(value ?? '')
  .trim()
  .toUpperCase()
  .replace(CNPJ_SEPARATORS_RE, '');

const normalizeFiscalIdentifier = (value) => normalizeCnpj(value);

const isCnpjFormat = (value) => CNPJ_FORMAT_RE.test(normalizeCnpj(value));
const isCnpjRoot = (value) => CNPJ_ROOT_RE.test(normalizeCnpj(value));

const splitCnpj = (value) => {
  const cnpj = normalizeCnpj(value);
  if (!CNPJ_FORMAT_RE.test(cnpj)) return null;
  return {
    cnpj,
    basico: cnpj.slice(0, 8),
    ordem: cnpj.slice(8, 12),
    dv: cnpj.slice(12, 14),
  };
};

const formatCnpj = (value) => {
  const cnpj = normalizeCnpj(value);
  if (!CNPJ_FORMAT_RE.test(cnpj)) return String(value ?? '');
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12, 14)}`;
};

const calculateDigit = (characters, weights) => {
  const sum = characters.split('').reduce((total, character, index) => (
    total + (character.charCodeAt(0) - 48) * weights[index]
  ), 0);
  const remainder = sum % 11;
  return remainder === 0 || remainder === 1 ? '0' : String(11 - remainder);
};

const calculateCnpjCheckDigits = (firstTwelve) => {
  const base = normalizeCnpj(firstTwelve);
  if (!/^[A-Z0-9]{12}$/.test(base)) return null;
  const first = calculateDigit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calculateDigit(`${base}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${first}${second}`;
};

const hasValidCnpjCheckDigits = (value) => {
  const cnpj = normalizeCnpj(value);
  return CNPJ_FORMAT_RE.test(cnpj)
    && calculateCnpjCheckDigits(cnpj.slice(0, 12)) === cnpj.slice(12);
};

module.exports = {
  calculateCnpjCheckDigits,
  formatCnpj,
  hasValidCnpjCheckDigits,
  isCnpjFormat,
  isCnpjRoot,
  normalizeCnpj,
  normalizeFiscalIdentifier,
  splitCnpj,
};
