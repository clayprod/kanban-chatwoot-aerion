'use strict';
const { text, hash, rankMatches } = require('./technicalRules');
const {metricKey,componentOf,conditionsKey}=require('./technicalMetrics');
const {inferKey}=require('./structuredSpecifications');
const EXTRACTION_VERSION = 6;
const administrative = /\b(habilitacao|qualificacao econom|regularidade fiscal|proposta comercial|apresentacao de amostras|apresentacao de ficha tecnica|apresentar ficha tecnica|atestado de capacidade)\b/;
function categoryOf(fact) {
  if (['technical_sheet_required', 'sample_required'].includes(fact.key)) return 'administrative';
  if (['equipment', 'kit', 'supply', 'administrative'].includes(fact.category)) return fact.category;
  return administrative.test(text(`${fact.label} ${fact.quote}`)) ? 'administrative' : 'equipment';
}
// Only explicit, unambiguous aliases. No fuzzy comparison of technical metrics.
const aliases = { flight_duration: 'flight_time', flight_time_minutes: 'flight_time', battery_flight_time: 'flight_time', motorization: 'motor_type', return_home: 'return_to_home', rth: 'return_to_home' };
function normalizeFact(fact) {
  // K video formats cannot be compared to megapixels. Preserve the literal
  // source value as a compound format instead of inventing a pixel count.
  if(metricKey(fact.key)==='camera_resolution' && /^k$/i.test(fact.unit || ''))fact={...fact,key:'video_resolution',kind:'compound',value:`${fact.value}K`,unit:''};
  if(['optical_zoom','digital_zoom','hybrid_zoom'].includes(metricKey(fact.key)) && !/optical|optico|digital|hybrid|hibrid/.test(text(fact.quote)))fact={...fact,key:'zoom_unspecified'};
  const key = text(fact.key).replace(/[\s-]+/g, '_');
  const inferred=inferKey(fact.label,fact.section);
  const recognized=['return_to_home','gimbal_axes','video_resolution','thermal_resolution','flight_time','hover_time','ascent_speed','descent_speed','flight_speed','flight_ceiling','takeoff_altitude','wind_resistance','transmission_distance','photo_formats','video_formats','gnss_systems','gimbal_stabilization','camera_resolution','camera_sensor','optical_zoom','digital_zoom','hybrid_zoom','battery_capacity'];
  return { ...fact, component:componentOf(fact), key: recognized.includes(inferred) ? inferred : metricKey(aliases[key] || key), category: categoryOf(fact) };
}
function uniqueFacts(facts) {
  const unique = new Map();
  for (const raw of facts) {
    const f = normalizeFact(raw);
    // Labels and source locations vary between the summary table and TR.
    const unit = /^[kmgt]?b$/i.test(String(f.unit).trim()) ? String(f.unit).trim().slice(0, -1).toLowerCase() + String(f.unit).trim().slice(-1) : text(f.unit);
    const identity = hash({ key: f.key, component:componentOf(f), kind: f.kind, value: typeof f.value === 'string' ? text(f.value) : f.value, upper: f.upper ?? null, unit, operator: f.operator, conditions: conditionsKey(f.conditions), category: f.category });
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
