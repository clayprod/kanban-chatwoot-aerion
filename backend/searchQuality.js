'use strict';

// The same lexical policy is used in JS and PostgreSQL. AI proposes terms; it
// cannot override this decision or turn commercial scores into relevance.
const QUALITY_VERSION = 1;
const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const words = (value) => normalize(value).match(/[a-z0-9]+/g) || [];
const unique = (values) => [...new Map((Array.isArray(values) ? values : []).filter(v => typeof v === 'string' && words(v).length).map(v => [words(v).join(' '), v.trim().slice(0, 200)])).values()].slice(0, 40);
const variants = (word) => word.length >= 4 && !/\d/.test(word)
  ? (word.endsWith('s') ? `${word.slice(0, -1)}s?` : `${word}s?`) : word;
const termPattern = (term, sql = false) => {
  const tokens = words(term);
  if (!tokens.length) return '(?!)';
  const boundary = sql ? '[^[:alnum:]]' : '[^a-z0-9]';
  return `(^|${boundary})${tokens.map(variants).join(`${boundary}+`)}(${boundary}|$)`;
};
const matchesTerm = (text, term) => words(term).length > 0 && new RegExp(termPattern(term), 'i').test(normalize(text));
const snippet = (text, term) => {
  const match = new RegExp(termPattern(term), 'i').exec(normalize(text));
  const start = Math.max(0, (match?.index || 0) - 65);
  return String(text).slice(start, start + 240);
};

function normalizeProfile(input = {}, fallback = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const original = String(fallback.q || fallback.palavras_chave?.[0] || source.terms?.[0] || '').trim();
  const autel = words(original).join(' ') === 'autel' && !source.match_mode && !source.confirmed_at;
  const mode = autel ? 'literal' : (source.match_mode || fallback.match_mode ||
    ((fallback.usar_ia === true || fallback.usar_ia === 'true') ? 'expanded' : 'literal'));
  const terms = unique(source.terms || fallback.palavras_chave || [original]);
  return {
    version: QUALITY_VERSION,
    description: String(source.description || fallback.intencao || original).slice(0, 2000),
    objective: String(source.objective || original).slice(0, 600),
    match_mode: mode === 'expanded' ? 'expanded' : 'literal',
    terms: autel ? [original] : (terms.length ? terms : unique([original])),
    related_terms: autel || mode !== 'expanded' ? [] : unique(source.related_terms || []),
    excluded_terms: unique(source.excluded_terms || fallback.termos_negativos || []),
    item_kind: ['material', 'service'].includes(source.item_kind) ? source.item_kind : 'all',
    product_ids: [...new Set((Array.isArray(source.product_ids) ? source.product_ids : []).map(String).filter(v => /^\d+$/.test(v)))].slice(0, 100),
    confirmed_at: typeof source.confirmed_at === 'string' ? source.confirmed_at.slice(0, 40) : null,
  };
}

function classifyItem(item = {}) {
  const signals = [];
  const take = (value, field, domain) => {
    if (value === undefined || value === null || value === '') return;
    const mapped = domain[String(value).trim().toLowerCase()];
    if (mapped) signals.push({ kind: mapped, field, value });
  };
  take(item.materialOuServico ?? item.material_ou_servico, 'materialOuServico', { m: 'material', s: 'service' });
  take(item.classificacaoCatalogo ?? item.classificacaoCatalogoId, 'classificacaoCatalogo', { 1: 'material', 2: 'service' });
  take(item.materialOuServicoNome, 'materialOuServicoNome', { material: 'material', 'serviço': 'service', servico: 'service' });
  // categoriaItemPca has a DIFFERENT domain. Never assume 1/2 means M/S.
  take(item.categoriaItemPcaNome ?? item.categoria_item, 'categoriaItemPcaNome', {
    material: 'material', 'material de consumo': 'material', 'material permanente': 'material',
    'serviço': 'service', servico: 'service', 'serviços': 'service', servicos: 'service',
  });
  const kinds = new Set(signals.map(s => s.kind));
  return { kind: kinds.size === 1 ? signals[0].kind : 'unknown', source: signals.length ? 'pncp' : null,
    conflict: kinds.size > 1, fields: signals };
}

const contentText = (item) => [item?.titulo, item?.title, item?.objetoCompra, item?.descricao,
  item?.description, item?.informacaoComplementar, item?.descricaoItem].filter(Boolean).join(' ');
const detailItems = (item) => [item?.quality_items, item?.itens, item?.itens_pertinentes].find(Array.isArray) || [];

function evaluateResult(item, profile) {
  const p = normalizeProfile(profile);
  const terms = unique([...p.terms, ...(p.match_mode === 'expanded' ? p.related_terms : [])]);
  const entries = [{ item, text: contentText(item), field: 'objeto' }];
  for (const detail of detailItems(item)) entries.push({ item: detail, text: contentText(detail), field: 'item' });
  // The full summary is retained at ingestion, not just its first 20 items.
  if (item?.itens_resumo_texto || item?.__itens_resumo_texto) entries.push({ item: {},
    text: item.itens_resumo_texto || item.__itens_resumo_texto, field: 'resumo_itens' });
  const hits = [];
  const excluded = [];
  for (const entry of entries) {
    const negative = p.excluded_terms.find(t => matchesTerm(entry.text, t));
    if (negative) { excluded.push({ ...entry, negative }); continue; }
    const term = terms.find(t => matchesTerm(entry.text, t));
    if (term) hits.push({ ...entry, term, classification: classifyItem(entry.item) });
  }
  const base = { version: QUALITY_VERSION, match_mode: p.match_mode, checked_at: new Date().toISOString() };
  if (!hits.length) return { ...base, accepted: false, status: 'rejected',
    reason: excluded.length ? 'excluded_term' : 'no_evidence', term: excluded[0]?.negative || null };
  const itemHits = hits.filter(h => h.field === 'item');
  const candidates = itemHits.length ? itemHits : hits;
  const eligible = p.item_kind === 'all' ? candidates : candidates.filter(h => h.classification.kind === p.item_kind);
  const unknown = candidates.filter(h => h.classification.kind === 'unknown');
  const complete = item?.quality_items_complete === true || item?.quality_is_pca === true;
  const allDetailClassifications = detailItems(item).map(classifyItem);
  const entirelyOpposite = complete && allDetailClassifications.length > 0 &&
    allDetailClassifications.every(c => c.kind !== 'unknown' && c.kind !== p.item_kind);
  if (p.item_kind !== 'all' && !eligible.length && entirelyOpposite) {
    return { ...base, accepted: false, status: 'rejected', reason: 'official_item_kind',
      classification: allDetailClassifications[0], term: candidates[0].term };
  }
  if (p.item_kind !== 'all' && !eligible.length && !unknown.length && complete) {
    return { ...base, accepted: false, status: 'rejected', reason: 'official_item_kind',
      classification: candidates[0].classification, term: candidates[0].term };
  }
  const hit = eligible[0] || unknown[0] || candidates[0];
  const pending = p.item_kind !== 'all' && !eligible.length;
  const matchingItems = itemHits.filter(h => p.item_kind === 'all' || h.classification.kind === p.item_kind);
  return { ...base, accepted: true, status: pending ? 'pending_classification' : 'accepted',
    reason: pending ? 'classification_unconfirmed' : (p.terms.some(t => matchesTerm(hit.text, t)) ? 'original_term' : 'approved_related_term'),
    term: hit.term, field: hit.field, snippet: snippet(hit.text, hit.term), classification: hit.classification,
    matching_item_numbers: matchingItems.map(h => h.item.numeroItem ?? h.item.numero_item).filter(v => v != null),
    matched_value: matchingItems.length ? matchingItems.reduce((sum, h) => sum + (Number(h.item.valorTotal ?? h.item.valor_total) || 0), 0) : null,
    evidence: hits.slice(0, 8).map(h => ({ term: h.term, field: h.field, snippet: snippet(h.text, h.term), classification: h.classification })),
  };
}

function applyQuality(items, profile) {
  const reasons = {};
  const accepted = [];
  const rejectedItems = [];
  for (const item of items) {
    const quality = evaluateResult(item, profile);
    reasons[quality.reason] = (reasons[quality.reason] || 0) + 1;
    if (quality.accepted) {
      const numbers = new Set(quality.matching_item_numbers.map(String));
      const relevant = detailItems(item).filter(i => numbers.has(String(i.numeroItem ?? i.numero_item)));
      accepted.push({ ...item, search_quality: quality, valor_itens_pertinentes: quality.matched_value,
        itens_pertinentes_count: relevant.length,
        itens_pertinentes: relevant.map(i => ({ numero_item: i.numeroItem ?? i.numero_item, descricao: i.descricao,
          valor_total: i.valorTotal ?? i.valor_total ?? null, quantidade: i.quantidade ?? null,
          unidade: i.unidadeMedida ?? i.unidade ?? null, valor_unitario_estimado: i.valorUnitarioEstimado ?? i.valor_unitario_estimado ?? null })) });
    }
    else rejectedItems.push({ ...item, search_quality: quality });
  }
  return { items: accepted, rejected_items: rejectedItems, audit: { version: QUALITY_VERSION, candidates: items.length,
    accepted: accepted.length, rejected: items.length - accepted.length, reasons } };
}

// SQL binds regexes instead of interpolating user input. Count and page use the
// identical predicate; post-filtering a limited page would lose valid results.
function buildPcaPredicate(profile, params, alias = 'i') {
  const p = normalizeProfile(profile);
  const terms = unique([...p.terms, ...(p.match_mode === 'expanded' ? p.related_terms : [])]);
  params.push(terms.map(t => termPattern(t, true)));
  let sql = `immutable_unaccent(lower(${alias}.descricao)) ~ ANY($${params.length}::text[])`;
  if (p.excluded_terms.length) {
    params.push(p.excluded_terms.map(t => termPattern(t, true)));
    sql += ` AND NOT (immutable_unaccent(lower(${alias}.descricao)) ~ ANY($${params.length}::text[]))`;
  }
  if (p.item_kind !== 'all') {
    // Unknown and conflicting official classifications remain visible for review.
    const wanted = p.item_kind === 'material' ? 'M' : 'S';
    params.push(wanted);
    const classification = pcaClassificationSql(alias);
    sql += ` AND (${classification} IS NULL OR ${classification} = $${params.length})`;
  }
  return sql;
}

function pcaClassificationSql(alias = 'i') {
  const raw = `${alias}.payload_raw`;
  const material = `(upper(COALESCE(${raw}->>'materialOuServico','')) = 'M'
    OR COALESCE(${raw}->>'classificacaoCatalogo',${raw}->>'classificacaoCatalogoId','') = '1'
    OR lower(COALESCE(${raw}->>'materialOuServicoNome','')) = 'material'
    OR immutable_unaccent(lower(COALESCE(${raw}->>'categoriaItemPcaNome',${alias}.categoria_item,''))) IN ('material','material de consumo','material permanente'))`;
  const service = `(upper(COALESCE(${raw}->>'materialOuServico','')) = 'S'
    OR COALESCE(${raw}->>'classificacaoCatalogo',${raw}->>'classificacaoCatalogoId','') = '2'
    OR immutable_unaccent(lower(COALESCE(${raw}->>'materialOuServicoNome',''))) = 'servico'
    OR immutable_unaccent(lower(COALESCE(${raw}->>'categoriaItemPcaNome',${alias}.categoria_item,''))) IN ('servico','servicos'))`;
  return `(CASE WHEN ${alias}.classification_version = ${QUALITY_VERSION} THEN ${alias}.official_item_kind
    WHEN ${material} AND NOT ${service} THEN 'M' WHEN ${service} AND NOT ${material} THEN 'S' ELSE NULL END)`;
}

module.exports = { QUALITY_VERSION, normalize, unique, words, matchesTerm, termPattern,
  normalizeProfile, classifyItem, evaluateResult, applyQuality, buildPcaPredicate, pcaClassificationSql };
