const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeNationalPhone,
  phoneMatchCandidates,
  buildContactNote,
  validateTranscriptPayload,
} = require('../callTranscripts');

test('normaliza telefone brasileiro com código do país e pontuação', () => {
  assert.equal(normalizeNationalPhone('+55 (11) 99876-5432'), '11998765432');
  assert.equal(normalizeNationalPhone('11 99876-5432'), '11998765432');
  assert.equal(normalizeNationalPhone('02111998765432'), '11998765432');
});

test('não tenta associar números ocultos ou incompletos', () => {
  assert.equal(normalizeNationalPhone('anonymous'), null);
  assert.equal(normalizeNationalPhone('0000000000'), null);
  assert.equal(normalizeNationalPhone('99876-5432'), null);
  assert.deepEqual(phoneMatchCandidates('restricted'), []);
});

test('gera candidatos com e sem DDI e tolera celular legado sem nono dígito', () => {
  assert.deepEqual(
    new Set(phoneMatchCandidates('+55 11 99876-5432')),
    new Set(['11998765432', '5511998765432', '1198765432', '551198765432'])
  );
});

test('formata a nota com metadados, transcrição e chave da ligação', () => {
  const note = buildContactNote({
    transcript_id: 'call_abc.123',
    call: {
      caller_number: '+5511998765432',
      did: '1151973319',
      dial_status: 'ANSWER',
      started_at_utc: '2026-07-24T18:30:00.000Z',
      duration_seconds: 75,
    },
    plain_text: '[00:00:00.000–00:00:03.000] CLIENTE: Olá',
  });

  assert.match(note, /24\/07\/2026/);
  assert.match(note, /Duração: 01:15/);
  assert.match(note, /CLIENTE: Olá/);
  assert.match(note, /ID da ligação: call_abc\.123/);
});

test('exige transcript_id e limita o tamanho do identificador', () => {
  assert.equal(validateTranscriptPayload({ transcript_id: 'call_1' }), 'call_1');
  assert.throws(() => validateTranscriptPayload({}), /transcript_id/);
  assert.throws(() => validateTranscriptPayload({ transcript_id: 'x'.repeat(256) }), /255/);
});
