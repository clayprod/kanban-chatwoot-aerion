'use strict';
const { text, hash, rankMatches } = require('./technicalRules');
const EXTRACTION_VERSION = 3;
const administrative = /\b(habilitacao|qualificacao econom|regularidade fiscal|proposta comercial|apresentacao de amostras|apresentacao de ficha tecnica|apresentar ficha tecnica|atestado de capacidade)\b/;
function categoryOf(fact) {
  if (['technical_sheet_required', 'sample_required'].includes(fact.key)) return 'administrative';
  if (['equipment', 'kit', 'supply', 'administrative'].includes(fact.category)) return fact.category;
  return administrative.test(text(`${fact.label} ${fact.quote}`)) ? 'administrative' : 'equipment';
}
// Only explicit, unambiguous aliases. No fuzzy comparison of technical metrics.
const aliases = { flight_duration: 'flight_time', flight_time_minutes: 'flight_time', battery_flight_time: 'flight_time', motorization: 'motor_type', return_home: 'return_to_home', rth: 'return_to_home' };
function normalizeFact(fact) {
  const key = text(fact.key).replace(/[\s-]+/g, '_');
  return { ...fact, key: aliases[key] || key, category: categoryOf(fact) };
}
function uniqueFacts(facts) {
  const unique = new Map();
  for (const raw of facts) {
    const f = normalizeFact(raw);
    // Labels and source locations vary between the summary table and TR.
    const unit = /^[kmgt]?b$/i.test(String(f.unit).trim()) ? String(f.unit).trim().slice(0, -1).toLowerCase() + String(f.unit).trim().slice(-1) : text(f.unit);
    const identity = hash({ key: f.key, kind: f.kind, value: typeof f.value === 'string' ? text(f.value) : f.value, upper: f.upper ?? null, unit, operator: f.operator, conditions: text(f.conditions), category: f.category });
    const previous = unique.get(identity);
    const citation = { source_id: f.source_id, location: f.location, quote: f.quote };
    if (previous) {
      if (!previous.citations.some(c => hash(c) === hash(citation))) previous.citations.push(citation);
    } else unique.set(identity, { ...f, citations: [citation] });
  }
  return [...unique.values()];
}
function requirementsForItem(facts, number) {
  const scoped = facts.filter(f => f.item_number === 'all' || String(f.item_number) === String(number)).map(normalizeFact);
  const replaced = f => scoped.some(newer => newer.source_id !== f.source_id && newer.key === f.key && newer.replacement_verified === true && text(newer.replaces_quote) === text(f.quote));
  const applicable = uniqueFacts(scoped.filter(f => !replaced(f)));
  return { requirements: applicable.filter(f => ['equipment', 'kit'].includes(f.category)), obligations: applicable.filter(f => ['supply', 'administrative'].includes(f.category)), superseded_requirements: uniqueFacts(scoped.filter(replaced)) };
}
module.exports = { EXTRACTION_VERSION, normalizeFact, uniqueFacts, requirementsForItem, rankMatches };
