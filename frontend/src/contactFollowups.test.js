import {
  compareContactsByOldestInteraction,
  compareContactsByReminder,
  formatDateTimeLocalInSaoPaulo,
  getInteractionPresentation,
  getReminderPresentation,
  saoPauloDateTimeLocalToIso,
} from './contactFollowups';

test('descreve direção e tempo da última interação', () => {
  const now = new Date('2026-07-22T15:00:00.000Z');
  expect(getInteractionPresentation({
    kind: 'incoming_message',
    occurred_at: '2026-07-22T12:00:00.000Z',
  }, now).text).toBe('Cliente respondeu · há 3 h');
  expect(getInteractionPresentation(null, now).text).toBe('Sem interação registrada');
});

test('formata estados de retorno no fuso de São Paulo', () => {
  const now = new Date('2026-07-22T15:00:00.000Z'); // 12:00 em São Paulo
  expect(getReminderPresentation({ due_at: '2026-07-22T16:30:00.000Z' }, now)).toMatchObject({
    text: 'Hoje · 13:30',
    state: 'today',
  });
  expect(getReminderPresentation({ due_at: '2026-07-22T14:00:00.000Z' }, now)).toMatchObject({
    text: 'Atrasado · há 1 h',
    state: 'overdue',
  });
  expect(getReminderPresentation(null, now).state).toBe('empty');
});

test('converte datetime-local de São Paulo sem deslocar o horário', () => {
  const iso = saoPauloDateTimeLocalToIso('2026-07-23T09:00');
  expect(iso).toBe('2026-07-23T12:00:00.000Z');
  expect(formatDateTimeLocalInSaoPaulo(iso)).toBe('2026-07-23T09:00');
});

test('ordena próximo retorno e contatos sem interação primeiro', () => {
  const contacts = [{ id: 1, name: 'Beta' }, { id: 2, name: 'Alfa' }, { id: 3, name: 'Gama' }];
  const statuses = {
    1: { reminder: { due_at: '2026-07-24T12:00:00.000Z' }, last_interaction: { occurred_at: '2026-07-20T12:00:00.000Z' } },
    2: { reminder: { due_at: '2026-07-23T12:00:00.000Z' }, last_interaction: null },
    3: { reminder: null, last_interaction: { occurred_at: '2026-07-21T12:00:00.000Z' } },
  };

  expect([...contacts].sort((a, b) => compareContactsByReminder(a, b, statuses)).map((c) => c.id)).toEqual([2, 1, 3]);
  expect([...contacts].sort((a, b) => compareContactsByOldestInteraction(a, b, statuses)).map((c) => c.id)).toEqual([2, 1, 3]);
});
