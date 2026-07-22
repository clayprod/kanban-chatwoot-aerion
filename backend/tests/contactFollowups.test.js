const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeReminderPayload,
  shouldAutoCompleteReminder,
} = require('../contactFollowups');

test('normaliza data e motivo de um retorno futuro', () => {
  const now = new Date('2026-07-22T12:00:00.000Z');
  const result = normalizeReminderPayload({
    due_at: '2026-07-22T15:00:00.000Z',
    note: '  Ligar sobre a proposta  ',
  }, now);

  assert.equal(result.dueAt, '2026-07-22T15:00:00.000Z');
  assert.equal(result.note, 'Ligar sobre a proposta');
});

test('rejeita retorno vencido e motivo acima do limite', () => {
  const now = new Date('2026-07-22T12:00:00.000Z');
  assert.throws(
    () => normalizeReminderPayload({ due_at: '2026-07-22T11:59:00.000Z' }, now),
    /horário futuro/
  );
  assert.throws(
    () => normalizeReminderPayload({
      due_at: '2026-07-22T13:00:00.000Z',
      note: 'x'.repeat(161),
    }, now),
    /no máximo 160/
  );
});

test('só conclui automaticamente com interação posterior ao agendamento', () => {
  const createdAt = '2026-07-22T12:00:00.000Z';
  assert.equal(shouldAutoCompleteReminder(createdAt, '2026-07-22T12:00:01.000Z'), true);
  assert.equal(shouldAutoCompleteReminder(createdAt, '2026-07-22T11:59:59.000Z'), false);
  assert.equal(shouldAutoCompleteReminder(createdAt, createdAt), false);
  assert.equal(shouldAutoCompleteReminder(createdAt, null), false);
});
