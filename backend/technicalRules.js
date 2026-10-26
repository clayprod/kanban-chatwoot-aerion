'use strict';
const crypto = require('node:crypto');
const VERSION = 4;
const { metricKey, sameMetric, conditionsKey, conditionsCompatible, categoricalValue } = require('./technicalMetrics');
const {fullAwardable}=require('./technicalAwarding');
const {numberMentions,measurements}=require('./technicalNumbers');
const text = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const hash = v => crypto.createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(v)).digest('hex');
const commercialUnit = v => /^(?:embalagem\s+)?1(?:[.,]0+)?\s*(?:unidades?|un)$/.test(text(v))?'unit':({ un: 'unit', unidade: 'unit', unidades: 'unit', unit: 'unit', units: 'unit', und: 'unit', peca: 'unit', pecas: 'unit' }[text(v)] || text(v));
const number = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const UNITS = {
  ms: ['time', .001], s: ['time', 1], seg: ['time', 1], segundos: ['time', 1], min: ['time', 60], minutos: ['time', 60], h: ['time', 3600], horas: ['time', 3600],
  mm: ['length', .001], cm: ['length', .01], m: ['length', 1], metros: ['length', 1], km: ['length', 1000],
  g: ['mass', .001], kg: ['mass', 1], hz: ['frequency', 1], khz: ['frequency', 1000], mhz: ['frequency', 1e6], ghz: ['frequency', 1e9],
  '%': ['percentage', 1], graus: ['angle', 1], '°': ['angle', 1], un: ['count', 1], unidades: ['count', 1], x: ['factor', 1],
  v: ['voltage', 1], w: ['power', 1], mah: ['charge', 1], ah: ['charge', 1000], mp: ['pixels', 1e6], megapixels: ['pixels', 1e6], pixels: ['pixels', 1],
  'm/s': ['speed', 1], 'km/h': ['speed', [5, 18]], kph: ['speed', [5, 18]],
  second: ['time', 1], seconds: ['time', 1], minute: ['time', 60], minutes: ['time', 60], hour: ['time', 3600], hours: ['time', 3600],
  wh: ['energy', 1], kwh: ['energy', 1000],
  kb: ['storage', 1000], mb: ['storage', 1000000], gb: ['storage', 1000000000], tb: ['storage', 1000000000000],
  bateria: ['battery_count', 1], baterias: ['battery_count', 1], battery: ['battery_count', 1], batteries: ['battery_count', 1],
};
const sourceNumbers = quote => String(quote || '').match(/-?\d+(?:[.,]\d+)*/g) || [];
const parseSourceNumber = value => /^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(value) ? Number(value.replace(/\./g, '').replace(',', '.')) : Number(value.replace(',', '.'));
const unitInfo = value => {
  // Storage bytes (B) and bits (b) are case-sensitive, unlike Hz/hz.
  const bitScale = { kb: 125, mb: 125000, gb: 125000000, tb: 125000000000 };
  if (String(value).trim().endsWith('b') && bitScale[text(value)]) return ['storage', bitScale[text(value)]];
  return UNITS[text(value)] || [/^[a-z]+$/.test(text(value)) ? `literal:${text(value).replace(/s$/, '')}` : `unsupported:${text(value)}`, 1];
};
function evidenceValid(fact, sources) {
  if (!fact || !fact.source_id || !fact.quote || !fact.location) return false;
  const source = sources.find(s => String(s.id) === String(fact.source_id));
  return !!source && text(source.text).includes(text(fact.quote)) && text(fact.quote).length >= 3;
}
function quotedNumber(fact, value) {
  if (number(value) === null) return false;
  return numberMentions(fact.quote).some(n=>n.value===value);
}
function numericFactValid(fact, requirement = false) {
  if (!fact || !text(fact.key) || !text(fact.unit) || !quotedNumber(fact, fact.value)) return false;
  const expected = unitInfo(fact.unit);
  const literal = String(fact.quote).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/(\d)\s*\([^)]*\)\s*(?=[a-z%°])/gi, '$1 ');
  const measured = measurements(literal);
  if (!(fact.quantity_verified===true&&['count','battery_count'].includes(expected[0])) && !measured.some(m => (m.value === fact.value || (requirement && fact.operator === 'range' && m.value === fact.upper)) && unitInfo(m.unit)[0] === expected[0] && String(unitInfo(m.unit)[1]) === String(expected[1]))) return false;
  if (fact.conditions && !text(fact.conditions).split(/[;|]/).every(c => text(fact.quote).includes(c.trim()))) return false;
  if (!fact.conditions && /\b(?:sem (?:vento|carga)|com carga|fcc|ce)\b/.test(text(fact.quote))) return false;
  if (!requirement) return true;
  const q = text(fact.quote);
  if (fact.operator === 'min') return /minim|pelo menos|no minimo|nao inferior|ou superior|≥|>=/.test(q);
  if (fact.operator === 'max') return /maxim|no maximo|nao superior|ate\b|≤|<=/.test(q);
  if (fact.operator === 'range') return quotedNumber(fact, fact.upper) && fact.upper >= fact.value && /entre|faixa|intervalo|\ba\b/.test(q);
  return fact.operator === 'eq' && !/minim|maxim|pelo menos|ate\b|superior|inferior/.test(q);
}
function compareNumeric(req, spec) {
  if (!numericFactValid(req, true) || !numericFactValid(spec)) return { status: 'verificar', reason: 'Número ou operador sem comprovação no trecho citado.' };
  if (!sameMetric(req,spec) || !conditionsCompatible(req,spec)) return { status: 'verificar', reason: 'Grandeza, componente ou condições de medição diferentes.' };
  // A performance capability described as "até" is not an upper limit on the
  // offered product. Do not approve a shorter flight simply because 40 <= 45.
  if (req.operator==='max' && /\bate\b/.test(text(req.quote)) && /^(flight_time|flight_speed|flight_ceiling|takeoff_altitude|transmission_distance|range)$/.test(metricKey(req.key)) && !/nao superior|no maximo|limite|limitad|nao exced/.test(text(req.quote)))
    return {status:'verificar',reason:'O texto descreve capacidade com “até”; é necessário confirmar o desempenho exigido, sem aprovar um valor inferior.'};
  const zoom = value => /optical|optico/.test(text(value)) ? 'optical' : /hibrid|hybrid/.test(text(value)) ? 'hybrid' : /digital/.test(text(value)) ? 'digital' : null;
  if (zoom(req.quote) && zoom(req.quote) !== zoom(spec.quote)) return { status: 'verificar', reason: 'Tipo de zoom diferente ou não comprovado.' };
  if (!/total|combinad|somad/.test(text(req.quote)) && /total|combinad|somad/.test(text(spec.quote))) return { status: 'verificar', reason: 'Valor total ou combinado não comprova desempenho individual.' };
  // Ratings, optical/hybrid zoom and multidimensional values must not become scalar comparisons.
  if (/^(ip|resolucao|resolution|dimensoes)/.test(text(req.unit)) || req.compound || spec.compound) return { status: 'verificar', reason: 'Critério composto exige verificação específica.' };
  const a = unitInfo(req.unit), b = unitInfo(spec.unit);
  if (!a || !b || a[0] !== b[0]) return { status: 'verificar', reason: 'Unidades sem conversão segura.' };
  const fraction = value => {
    if (Array.isArray(value)) return [BigInt(value[0]), BigInt(value[1])];
    const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
    const decimals = (mantissa.split('.')[1] || '').length - Number(exponent);
    const numerator = BigInt(mantissa.replace('.', ''));
    return decimals >= 0 ? [numerator, 10n ** BigInt(decimals)] : [numerator * 10n ** BigInt(-decimals), 1n];
  };
  const scaled = (value, scale) => { const [n, d] = fraction(value), [sn, sd] = fraction(scale); return [n * sn, d * sd]; };
  const compare = (left, right) => left[0] * right[1] - right[0] * left[1];
  const bound = scaled(req.value, a[1]), value = scaled(spec.value, b[1]);
  const difference = compare(value, bound);
  const ok = req.operator === 'min' ? difference >= 0n : req.operator === 'max' ? difference <= 0n
    : req.operator === 'range' ? difference >= 0n && compare(value, scaled(req.upper, a[1])) <= 0n : difference === 0n;
  return { status: ok ? 'ok' : 'nao_ok', reason: `${spec.value} ${spec.unit} ${ok ? 'atende' : 'não atende'} ${req.operator === 'min' ? 'mínimo' : req.operator === 'max' ? 'máximo' : req.operator === 'range' ? 'intervalo' : 'valor exigido'} ${req.value}${req.operator === 'range' ? `–${req.upper}` : ''} ${req.unit}.` };
}
function compareCompound(req, spec) {
  if (!sameMetric(req,spec) || conditionsKey(req.conditions) !== conditionsKey(spec.conditions)) return null;
  const a = String(req.value || '').toUpperCase(), b = String(spec.value || '').toUpperCase();
  if (!text(req.quote).includes(text(a)) || !text(spec.quote).includes(text(b))) return null;
  const ipA = /^IP([0-6])([0-8])$/.exec(a), ipB = /^IP([0-6])([0-8])$/.exec(b);
  if (ipA && ipB) {
    if (req.operator === 'eq') return { status: a === b ? 'ok' : 'nao_ok', reason: `Proteção ${b}; exigido ${a}.` };
    if (req.operator !== 'min' || !/minim|pelo menos|nao inferior/.test(text(req.quote))) return null;
    const dust = Number(ipB[1]) >= Number(ipA[1]);
    // Immersion ratings do not imply resistance to water jets (IPX5/IPX6).
    const waterKnown = Number(ipA[2]) <= 6 && Number(ipB[2]) <= 6 || ipA[2] === ipB[2];
    if (!waterKnown) return null;
    const ok = dust && Number(ipB[2]) >= Number(ipA[2]);
    return { status: ok ? 'ok' : 'nao_ok', reason: `Proteção ${b} ${ok ? 'atende' : 'não atende'} ao mínimo ${a}.` };
  }
  const dims = v => /^(\d+)\s*[X×]\s*(\d+)$/.exec(v);
  const da = dims(a), db = dims(b);
  if (da && db && /resol|pixel/.test(text(req.key)) && ['min', 'eq'].includes(req.operator)) {
    if (req.operator === 'min' && !/minim|pelo menos|nao inferior/.test(text(req.quote))) return null;
    const ok = req.operator === 'eq' ? Number(da[1]) === Number(db[1]) && Number(da[2]) === Number(db[2]) : Number(db[1]) >= Number(da[1]) && Number(db[2]) >= Number(da[2]);
    return { status: ok ? 'ok' : 'nao_ok', reason: `Resolução ${b}; exigência ${a} (${req.operator === 'min' ? 'mínima' : 'exata'}).` };
  }
  return null;
}
function compareRequirement(req, specs, sources, mapping = {}) {
  const base = { requirement: req, status: 'verificar', reason: 'Falta evidência suficiente na ficha técnica.', evidence: [] };
  if (!evidenceValid(req, sources)) return { ...base, reason: 'Exigência sem fonte verificável.' };
  const uncertainOcr = fact => {
    const source = sources.find(s => String(s.id) === String(fact.source_id));
    const page = /pagina\s+(\d+)/.exec(text(fact.location))?.[1];
    return (source?.notes || []).some(note => /ocr.*(?:duvida|falha)|falha.*ocr/.test(text(note)) && (!page || !/pagina\s+(\d+)/.test(text(note)) || /pagina\s+(\d+)/.exec(text(note))?.[1] === page));
  };
  if (uncertainOcr(req)) return { ...base, reason: 'A leitura OCR desta exigência contém números incertos. Confira o documento original.' };
  const requiredComponent=require('./technicalMetrics').componentOf(req);
  const absent=requiredComponent&&specs.find(s=>s.key==='component_presence'&&require('./technicalMetrics').componentOf(s)===requiredComponent&&/^(nao|no|ausente|not present)$/.test(text(s.value))&&evidenceValid(s,sources));
  if(absent)return {...base,status:'nao_ok',reason:'A ficha informa explicitamente que este modelo não possui o componente exigido.',evidence:[absent]};
  // Model IDs and same_metric are suggestions, not evidence of equivalence.
  const selected = specs.filter(s => (mapping.spec_ids || []).includes(s.id) && sameMetric(req,s) && evidenceValid(s, sources));
  if (!selected.length) return base;
  base.evidence = selected;
  if (selected.some(uncertainOcr)) return { ...base, reason: 'A leitura OCR da ficha contém números incertos. Confira o documento original.' };
  if(metricKey(req.key)==='camera_sensor'&&/cmos/.test(text(req.quote))&&selected.every(s=>/cmos/.test(text(s.quote)))){
    const format=value=>{
      const m=/(\d+(?:[.,]\d+)?)(?:\s*\/\s*(\d+(?:[.,]\d+)?))?\s*(?:["″”]|polegadas?|inch(?:es)?)/i.exec(String(value));
      return m?Number(m[1].replace(',','.'))/(m[2]?Number(m[2].replace(',','.')):1):null;
    };
    const required=format(req.value),offered=selected.map(s=>format(s.value));
    if(required&&offered.every(v=>v!==null)&&new Set(offered).size===1){
      if(offered[0]<required)return {...base,status:'nao_ok',reason:'A ficha informa formato de sensor CMOS inferior ao formato exigido.'};
      if(offered[0]===required || req.operator==='min'&&/minim|ou superior|pelo menos/.test(text(req.quote)))return {...base,status:'ok',reason:'O formato do sensor CMOS está explicitamente comprovado na ficha.'};
    }
  }
  // Explicit lists are capabilities, not contradictory alternatives: a source
  // may list JPEG and another JPEG/RAW. Every requested token must be evidenced.
  if (['photo_formats','video_formats','gnss_systems'].includes(metricKey(req.key)) && req.value!=null && text(req.quote).includes(text(req.value))) {
    const tokens=value=>text(value).replace(/jpeg/g,'jpg').replace(/beidou/g,'bds').match(/\b(?:jpg|raw|dng|png|tiff|mp4|mov|gps|glonass|galileo|bds|gnss)\b/g) || [];
    const required=tokens(req.value);
    const offered=new Set(selected.filter(s=>conditionsCompatible(req,s) && text(s.quote).includes(text(s.value))).flatMap(s=>tokens(s.value)));
    if(required.length && required.every(t=>t==='gnss' ? ['gps','glonass','galileo','bds'].some(v=>offered.has(v)) : offered.has(t)))return {...base,status:'ok',reason:'Todos os formatos ou sistemas exigidos constam explicitamente na ficha.'};
  }
  if (selected.length > 1) {
    const fingerprints = selected.map(s => s.kind === 'numeric' ? `${unitInfo(s.unit)[0]}:${s.value * (Array.isArray(unitInfo(s.unit)[1]) ? unitInfo(s.unit)[1][0] / unitInfo(s.unit)[1][1] : unitInfo(s.unit)[1])}:${text(s.conditions)}` : `${text(s.value)}:${text(s.conditions)}`);
    if (new Set(fingerprints).size > 1) return { ...base, reason: 'Fontes apresentam valores ou condições diferentes; confirme a especificação correta.' };
  }
  if (req.kind === 'numeric') {
    const results = selected.map(s => compareNumeric(req, s));
    const statuses = new Set(results.map(r => r.status));
    if (statuses.size !== 1) return { ...base, reason: 'Fontes ou condições conflitantes; confira a variante e a composição.' };
    return { ...base, ...results[0] };
  }
  if (req.kind === 'compound') {
    const results = selected.map(s => compareCompound(req, s));
    if (results.every(Boolean) && new Set(results.map(r => r.status)).size === 1) return { ...base, ...results[0] };
    return { ...base, reason: 'Critério composto sem equivalência comprovada ou fontes conflitantes.' };
  }
  // A qualitative equivalence is not a licence to relax an exact requirement.
  // Only identical, explicitly extracted categorical values are auto-confirmed.
  if (req.kind === 'categorical' && req.value != null && selected.every(s => s.value != null && sameMetric(req,s) && conditionsKey(s.conditions) === conditionsKey(req.conditions))) {
    const categorical = categoricalValue;
    const values = new Set(selected.map(categorical));
    if (values.size === 1 && values.has(categorical(req)) && selected.every(s => text(s.quote).includes(text(s.value))) && text(req.quote).includes(text(req.value))) {
      return { ...base, status: 'ok', reason: 'Característica explicitamente comprovada nas fontes.' };
    }
    // Different names/standards may be equivalent; a model assertion is insufficient.
  }
  return { ...base, reason: 'Equivalência qualitativa ou critério composto requer confirmação.' };
}
function guardLegacyRequirement(row) {
  // The old chat has unstructured observations, not independently cited product
  // facts. It cannot auto-approve numerical requirements without a verified source.
  if (row.status === 'ok' && /\d/.test(String(row.requisito || ''))) return { ...row, status: 'verificar', observacao: `${row.observacao || ''} · Exigência numérica: confirme na ficha cadastrada pela análise técnica validada.`.trim() };
  return row;
}
function assessProduct(product, requirements, sources, mappings = [], complete = false, item = {}) {
  const rows = requirements.map(r => compareRequirement(r, product.specs || [], sources, mappings.find(m => m.requirement_id === r.id) || {}));
  const counts = { ok: rows.filter(r => r.status === 'ok').length, nao_ok: rows.filter(r => r.status === 'nao_ok').length, verificar: rows.filter(r => r.status === 'verificar').length, total: rows.length };
  const full = complete && product.specs_complete === true && counts.total > 0 && counts.ok === counts.total;
  const status = full ? 'full' : counts.nao_ok ? 'failed' : 'uncertain';
  const sameUnit = commercialUnit(product.unit) === commercialUnit(item.unit) && !!text(item.unit);
  const reference = Number(item.reference_price), price = Number(product.sale_price);
  const comparable = sameUnit && reference > 0 && price > 0 && product.package_confirmed === true;
  const technical = !complete ? 0 : full ? 20 : counts.nao_ok ? 0 : counts.total ? 8 * counts.ok / counts.total : 0;
  const commercial = full && comparable ? price < reference ? 5 : price === reference ? 3 : 1 : 0;
  return { product_id: product.id, product_name: product.name, sale_price: price, product_version: product.version, specs_complete: product.specs_complete === true,
    price_rankable: sameUnit && product.package_confirmed === true && price > 0,
    status, counts, technical_percent: counts.total ? Math.floor(100*counts.ok/counts.total) : null, assessment_complete: complete && product.specs_complete===true, requirements: rows, technical_bonus: technical, commercial_bonus: commercial,
    price_comparison: comparable ? { reference, offered: price, difference: price - reference, relation: price < reference ? 'below' : price === reference ? 'equal' : 'above' } : null };
}
function summarize(items, baseScore = 0) {
  const relevant = items.filter(i => i.in_scope);
  const weighted = relevant.length > 0 && relevant.every(i => Number(i.reference_price) > 0 && Number(i.quantity) > 0);
  let weightSum = 0, technical = 0, commercial = 0;
  const result = items.map(item => {
    const products = [...(item.products || [])].sort(rankMatches);
    const recommended = products.find(p => p.status === 'full') || null;
    const potential = recommended || products[0] || null;
    if (item.in_scope) {
      const weight = weighted ? Number(item.reference_price) * Number(item.quantity) : 1;
      weightSum += weight; technical += weight * (potential?.technical_bonus || 0); commercial += weight * (recommended?.commercial_bonus || 0);
    }
    return { ...item, products, awardable_full:fullAwardable(items,item), technical_percent: potential?.evidence_current===false ? null : potential?.technical_percent ?? (potential?.counts?.total ? Math.floor(100*potential.counts.ok/potential.counts.total) : null), recommended_product: recommended, potential_product: potential };
  });
  technical = weightSum ? Math.round(technical / weightSum * 100) / 100 : 0;
  commercial = weightSum ? Math.round(commercial / weightSum * 100) / 100 : 0;
  return { version: VERSION, items: result, relevant_items: relevant.length, full_items: result.filter(i => i.in_scope && i.recommended_product && i.awardable_full).length,
    technical_percent: result.filter(i=>i.in_scope && i.technical_percent!=null).length ? Math.max(...result.filter(i=>i.in_scope).map(i=>i.technical_percent ?? 0)) : null,
    base_score: Number(baseScore) || 0, technical_bonus: technical, commercial_bonus: commercial,
    score: Math.min(100, Math.round((Number(baseScore) || 0) + technical + commercial)), weighting: weighted ? 'reference_value' : 'equal' };
}
function rankMatches(a, b) {
  const ratio = p => p.evidence_current!==false && p.counts?.total > 0 ? p.counts.ok / p.counts.total : 0;
  const price = p => p.price_rankable !== false && Number(p.sale_price) > 0 ? Number(p.sale_price) : Infinity;
  return Number(b.status === 'full') - Number(a.status === 'full') || ratio(b) - ratio(a) || price(a) - price(b) || String(a.product_id).localeCompare(String(b.product_id), 'en', { numeric: true });
}
module.exports = { VERSION, text, hash, commercialUnit, evidenceValid, quotedNumber, compareNumeric, compareCompound, compareRequirement, assessProduct, summarize, guardLegacyRequirement, rankMatches };
