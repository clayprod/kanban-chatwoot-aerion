export const FOLLOWUP_TIME_ZONE = 'America/Sao_Paulo';

export const INTERACTION_LABELS = {
  incoming_message: 'Cliente respondeu',
  outgoing_message: 'Mensagem enviada',
  conversation_note: 'Nota registrada',
  contact_note: 'Nota registrada',
};

const zonedParts = (value, options = {}) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: FOLLOWUP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...options,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
};

const dayKey = (value) => {
  const parts = zonedParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : '';
};

const addCalendarDays = (value, days) => {
  const parts = zonedParts(value);
  if (!parts) return null;
  const calendar = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + days));
  return `${calendar.getUTCFullYear()}-${String(calendar.getUTCMonth() + 1).padStart(2, '0')}-${String(calendar.getUTCDate()).padStart(2, '0')}`;
};

export const formatElapsed = (from, to = new Date()) => {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '';
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return 'agora';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `há ${days} ${days === 1 ? 'dia' : 'dias'}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `há ${months} ${months === 1 ? 'mês' : 'meses'}`;
  const years = Math.floor(days / 365);
  return `há ${years} ${years === 1 ? 'ano' : 'anos'}`;
};

export const formatExactFollowupDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: FOLLOWUP_TIME_ZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
};

export const getInteractionPresentation = (interaction, now = new Date()) => {
  if (!interaction?.occurred_at) {
    return {
      text: 'Sem interação registrada',
      exact: 'Nenhuma mensagem ou nota encontrada no Chatwoot.',
      kind: null,
    };
  }
  const label = INTERACTION_LABELS[interaction.kind] || 'Interação registrada';
  const elapsed = formatElapsed(interaction.occurred_at, now);
  return {
    text: elapsed ? `${label} · ${elapsed}` : label,
    exact: `${label} em ${formatExactFollowupDate(interaction.occurred_at)}`,
    kind: interaction.kind,
  };
};

export const getReminderPresentation = (reminder, now = new Date()) => {
  if (!reminder?.due_at) {
    return {
      text: 'Agendar retorno',
      exact: 'Definir quando ligar ou falar novamente com este contato.',
      state: 'empty',
    };
  }
  const due = new Date(reminder.due_at);
  if (Number.isNaN(due.getTime())) {
    return { text: 'Retorno com data inválida', exact: 'Edite o retorno para corrigir a data.', state: 'error' };
  }
  const time = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FOLLOWUP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(due);
  let text;
  let state = 'future';
  if (due.getTime() <= new Date(now).getTime()) {
    state = 'overdue';
    text = `Atrasado · ${formatElapsed(due, now)}`;
  } else if (dayKey(due) === dayKey(now)) {
    state = 'today';
    text = `Hoje · ${time}`;
  } else if (dayKey(due) === addCalendarDays(now, 1)) {
    text = `Amanhã · ${time}`;
  } else {
    const date = new Intl.DateTimeFormat('pt-BR', {
      timeZone: FOLLOWUP_TIME_ZONE,
      day: '2-digit',
      month: '2-digit',
    }).format(due);
    text = `${date} · ${time}`;
  }
  return {
    text,
    exact: `Retorno agendado para ${formatExactFollowupDate(due)}${reminder.note ? ` — ${reminder.note}` : ''}`,
    state,
  };
};

export const formatDateTimeLocalInSaoPaulo = (value) => {
  const parts = zonedParts(value);
  if (!parts) return '';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

const getTimeZoneOffsetMs = (date) => {
  const parts = zonedParts(date, { second: '2-digit' });
  if (!parts) return 0;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second || 0)
  );
  return asUtc - date.getTime();
};

export const saoPauloDateTimeLocalToIso = (localValue) => {
  const match = String(localValue || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const utcGuess = new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute)
  ));
  let resolved = new Date(utcGuess.getTime() - getTimeZoneOffsetMs(utcGuess));
  resolved = new Date(utcGuess.getTime() - getTimeZoneOffsetMs(resolved));
  return Number.isNaN(resolved.getTime()) ? null : resolved.toISOString();
};

export const getReminderPresetValue = (preset, now = new Date()) => {
  if (preset === 'hour') {
    return formatDateTimeLocalInSaoPaulo(new Date(new Date(now).getTime() + 60 * 60 * 1000));
  }
  const days = preset === 'three_days' ? 3 : 1;
  const date = addCalendarDays(now, days);
  return date ? `${date}T09:00` : '';
};

const contactName = (contact) => String(contact?.company_name || contact?.name || '');

export const compareContactsByReminder = (a, b, statusById) => {
  const aDue = statusById?.[String(a.id)]?.reminder?.due_at;
  const bDue = statusById?.[String(b.id)]?.reminder?.due_at;
  const aTime = aDue ? new Date(aDue).getTime() : Number.POSITIVE_INFINITY;
  const bTime = bDue ? new Date(bDue).getTime() : Number.POSITIVE_INFINITY;
  if (aTime !== bTime) return aTime - bTime;
  return contactName(a).localeCompare(contactName(b), 'pt-BR', { sensitivity: 'base' });
};

export const compareContactsByOldestInteraction = (a, b, statusById) => {
  const aAt = statusById?.[String(a.id)]?.last_interaction?.occurred_at;
  const bAt = statusById?.[String(b.id)]?.last_interaction?.occurred_at;
  const aTime = aAt ? new Date(aAt).getTime() : Number.NEGATIVE_INFINITY;
  const bTime = bAt ? new Date(bAt).getTime() : Number.NEGATIVE_INFINITY;
  if (aTime !== bTime) return aTime - bTime;
  return contactName(a).localeCompare(contactName(b), 'pt-BR', { sensitivity: 'base' });
};
