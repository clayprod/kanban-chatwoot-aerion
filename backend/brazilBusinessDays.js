/**
 * Dias úteis no Brasil (calendário nacional).
 *
 * Conta seg–sex, excluindo feriados nacionais fixos e móveis
 * (Carnaval seg/ter, Sexta-feira Santa, Corpus Christi).
 * Fuso de referência: America/Sao_Paulo.
 *
 * Não inclui feriados estaduais/municipais (varia por UASG/órgão).
 */

const TZ = 'America/Sao_Paulo';

/** Domingo de Páscoa (algoritmo anônimo gregoriano). */
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=mar, 4=abr
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

function ymdKey(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addUtcDays(y, m, d, delta) {
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
  };
}

/** Feriados nacionais do ano (fixos + móveis ligados à Páscoa). */
function brazilNationalHolidayKeys(year) {
  const set = new Set([
    ymdKey(year, 1, 1),   // Confraternização Universal
    ymdKey(year, 4, 21),  // Tiradentes
    ymdKey(year, 5, 1),   // Dia do Trabalho
    ymdKey(year, 9, 7),   // Independência
    ymdKey(year, 10, 12), // N. Sra. Aparecida
    ymdKey(year, 11, 2),  // Finados
    ymdKey(year, 11, 15), // Proclamação da República
    ymdKey(year, 11, 20), // Consciência Negra (Lei 14.759/2023)
    ymdKey(year, 12, 25), // Natal
  ]);

  const e = easterSunday(year);
  // Carnaval: segunda e terça (Páscoa −48 / −47)
  const carnMon = addUtcDays(e.year, e.month, e.day, -48);
  const carnTue = addUtcDays(e.year, e.month, e.day, -47);
  const goodFri = addUtcDays(e.year, e.month, e.day, -2);
  const corpus = addUtcDays(e.year, e.month, e.day, 60);
  set.add(ymdKey(carnMon.year, carnMon.month, carnMon.day));
  set.add(ymdKey(carnTue.year, carnTue.month, carnTue.day));
  set.add(ymdKey(goodFri.year, goodFri.month, goodFri.day));
  set.add(ymdKey(corpus.year, corpus.month, corpus.day));
  return set;
}

const holidayCache = new Map();
function holidaysForYear(year) {
  if (!holidayCache.has(year)) {
    holidayCache.set(year, brazilNationalHolidayKeys(year));
  }
  return holidayCache.get(year);
}

function ymdInTimeZone(date, timeZone = TZ) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  return { year, month, day, key: ymdKey(year, month, day) };
}

function weekdayInTimeZone(date, timeZone = TZ) {
  // 0=dom … 6=sáb
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(date);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[wd] ?? 0;
}

/** Início do dia civil em America/Sao_Paulo, como instante UTC. */
function startOfDaySaoPaulo(date = new Date()) {
  const { year, month, day } = ymdInTimeZone(date, TZ);
  // Meia-noite em SP: usar offset via format (evita libs)
  // Construímos uma data e ajustamos com o offset de SP naquele dia.
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)); // noon UTC approx
  const sp = ymdInTimeZone(probe, TZ);
  // Diferença entre "wall clock noon SP" e UTC
  const asUtcGuess = new Date(`${ymdKey(year, month, day)}T00:00:00-03:00`);
  // Corrige se o dia em SP não bater (DST histórico BR — desde 2019 sem horário de verão)
  const check = ymdInTimeZone(asUtcGuess, TZ);
  if (check.key === ymdKey(year, month, day)) {
    return asUtcGuess;
  }
  // Fallback: busca meia-noite por varredura de offset −2/−3/−4
  for (const off of ['-03:00', '-02:00', '-04:00']) {
    const d = new Date(`${ymdKey(year, month, day)}T00:00:00${off}`);
    if (ymdInTimeZone(d, TZ).key === ymdKey(year, month, day)) return d;
  }
  return asUtcGuess;
}

function endOfDaySaoPaulo(date = new Date()) {
  const start = startOfDaySaoPaulo(date);
  // +1 dia civil SP − 1 ms
  const next = addBrazilCalendarDays(start, 1);
  return new Date(next.getTime() - 1);
}

function addBrazilCalendarDays(date, deltaDays) {
  const { year, month, day } = ymdInTimeZone(date, TZ);
  const next = addUtcDays(year, month, day, deltaDays);
  return startOfDaySaoPaulo(new Date(Date.UTC(next.year, next.month - 1, next.day, 15, 0, 0)));
}

function isBrazilBusinessDay(date = new Date()) {
  const wd = weekdayInTimeZone(date, TZ);
  if (wd === 0 || wd === 6) return false;
  const { year, key } = ymdInTimeZone(date, TZ);
  return !holidaysForYear(year).has(key);
}

/**
 * Avança `n` dias úteis a partir do dia civil de `from` (não conta o próprio dia).
 * Ex.: sexta + 1 d.ú. = segunda (se não feriado).
 */
function addBrazilBusinessDays(from, n) {
  const steps = Number(n) || 0;
  if (steps === 0) return startOfDaySaoPaulo(from);
  let remaining = Math.abs(steps);
  const dir = steps > 0 ? 1 : -1;
  let cursor = startOfDaySaoPaulo(from);
  while (remaining > 0) {
    cursor = addBrazilCalendarDays(cursor, dir);
    if (isBrazilBusinessDay(cursor)) remaining -= 1;
  }
  return cursor;
}

/**
 * Janela "vence em até N dias úteis": do instante atual até o fim do N-ésimo dia útil
 * a partir de hoje (inclui prazos de hoje).
 */
function brazilBusinessDaysDeadlineWindow(n = 3, now = new Date()) {
  const startToday = startOfDaySaoPaulo(now);
  const nthDay = addBrazilBusinessDays(startToday, n);
  const end = endOfDaySaoPaulo(nthDay);
  return {
    now,
    startToday,
    endInclusive: end,
    nthBusinessDay: nthDay,
    n,
  };
}

module.exports = {
  TZ,
  easterSunday,
  brazilNationalHolidayKeys,
  isBrazilBusinessDay,
  addBrazilBusinessDays,
  startOfDaySaoPaulo,
  endOfDaySaoPaulo,
  brazilBusinessDaysDeadlineWindow,
  ymdInTimeZone,
};
