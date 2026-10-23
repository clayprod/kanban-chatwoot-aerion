'use strict';
const { text, hash, evidenceValid } = require('./technicalRules');
const { normalizeFact } = require('./technicalQuality');
const { FACTS_FORMAT, COVERAGE_FORMAT } = require('./technicalAiFormat');

// Coverage is about reading the source, not granting compliance. Real source
// contradictions remain visible even after every block has been read.
const AUDIT_VERSION = 1;
const MIN_SPLIT = 900;
function mappedText(raw, joinWrappedWords) {
  let value='';const positions=[];
  for(let index=0;index<raw.length;){
    const at=index,code=raw.codePointAt(index),char=String.fromCodePoint(code);index+=char.length;
    if(/[-‐]/u.test(char) && /\p{L}/u.test(raw[at-1] || '')){
      const wrap=/^[ \t]*\r?\n[ \t]*(?=\p{L})/u.exec(raw.slice(index));
      if(wrap){index+=wrap[0].length;if(joinWrappedWords)continue;}
    }
    const normalized=char.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    for(const next of normalized){
      if(/\s/u.test(next)){
        if(value.endsWith(' ')){positions[positions.length-1].end=index;continue;}
        value+=' ';positions.push({start:at,end:index});
      }else{value+=next;for(let unit=0;unit<next.length;unit++)positions.push({start:at,end:index});}
    }
  }
  return{value,positions};
}
function literalEvidenceQuote(quote,source) {
  if(typeof quote!=='string' || text(quote).length<5)return null;
  if(text(source).includes(text(quote)))return quote;
  if(text(quote).length<12)return null;
  // PDF line wrapping is formatting, not permission to fix numbers or wording.
  // Locate the contiguous original span and save THAT literal source quotation.
  for(const join of [false,true]){
    const document=mappedText(source,join),needle=mappedText(quote,join).value.trim();
    const start=document.value.indexOf(needle);
    if(start>=0){const end=start+needle.length-1;return source.slice(document.positions[start].start,document.positions[end].end);}
  }
  return null;
}
function sourceBlocks(value, size = 1200) {
  const blocks = [];
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + size, value.length);
    if (end < value.length) {
      const line = value.lastIndexOf('\n', end);
      if (line > start + size / 2) end = line + 1;
    }
    const content = value.slice(start, end);
    if (content.trim()) blocks.push({ id: String(blocks.length), text: content });
    start = end;
  }
  return blocks;
}
const factIdentity = f => hash({ item: String(f.item_number), key: f.key, value: f.value, upper: f.upper ?? null,
  kind: f.kind, unit: f.unit, operator: f.operator, conditions: f.conditions, quote: text(f.quote), source: f.source_id });
function mergeFacts(...lists) {
  const unique = new Map();
  for (const fact of lists.flat()) unique.set(factIdentity(fact), fact);
  return [...unique.values()];
}
function validateFacts(raw, source, chunk, kind, context, prefix) {
  const rejected = [], facts = [], indexes = new Map();
  for (const [index, row] of (Array.isArray(raw) ? raw : []).entries()) {
    let number = String(row.item_number ?? '');
    if (kind === 'notice' && /^\d+$/.test(number)) {
      const canonical = context.items.find(i => /^\d+$/.test(String(i.number)) && BigInt(i.number) === BigInt(number));
      if (canonical) number = String(canonical.number);
    }
    const fact = normalizeFact({ ...row, item_number: number, id: `${prefix}:${index}`, source_id: String(source.id), location: chunk.location });
    const literal=literalEvidenceQuote(fact.quote,chunk.text);
    if(literal && literal!==fact.quote){fact.original_quote=fact.quote;fact.quote=literal;fact.quote_recovered=true;}
    if (fact.replaces_quote || fact.replacement_statement) {
      const statement = text(fact.replacement_statement);
      fact.replacement_verified = !!fact.replaces_quote && !!statement && text(chunk.text).includes(statement) && statement.includes(text(fact.replaces_quote)) && statement.includes(text(fact.quote)) && /onde se le[\s\S]+leia[ -]se/.test(statement);
    }
    const reason = !evidenceValid(fact, [{id: String(source.id), text: chunk.text}]) ? 'Citação não encontrada literalmente neste trecho.'
      : !fact.key || !fact.label ? 'Exigência sem identificação.'
        : (fact.replaces_quote || fact.replacement_statement) && !fact.replacement_verified ? 'Substituição sem declaração literal verificável.'
          : kind === 'notice' && number !== 'all' && !context.items.some(i => String(i.number) === number) ? 'Associação com item não confirmado.' : null;
    if (reason) rejected.push({ index, reason, fact });
    else { indexes.set(index, fact); facts.push(fact); }
  }
  return { facts, rejected, indexes };
}
function validateAudit(value, source, chunk, kind, context, blocks, prefix) {
  const validated = validateFacts(value.facts, source, chunk, kind, context, prefix);
  const issues = validated.rejected.map(r => ({ reason: r.reason, candidate: r.fact }));
  if (!Array.isArray(value.facts)) issues.push({reason:'Lista de exigências ausente na auditoria.'});
  const entries = Array.isArray(value.coverage) ? value.coverage : [];
  const normalizedSource = text(chunk.text);
  for (const block of blocks) {
    const matches = entries.filter(c => c.block_id === block.id);
    if (matches.length !== 1) { issues.push({block_id: block.id, reason:'Bloco sem auditoria única de cobertura.'}); continue; }
    const entry = matches[0];
    if (entry.classification === 'unreadable') issues.push({block_id:block.id,reason:entry.reason || 'Bloco ilegível.'});
    else if (entry.classification === 'requirements') {
      const start = normalizedSource.indexOf(text(block.text)), end = start + text(block.text).length;
      const supported = (entry.fact_indexes || []).some(index => {
        const fact = validated.indexes.get(index);
        if (!fact) return false;
        const at = normalizedSource.indexOf(text(fact.quote));
        return at < end && at + text(fact.quote).length > start;
      });
      if (!supported) issues.push({block_id:block.id,reason:'Bloco com exigência sem fato e citação válidos.'});
    } else if (entry.classification !== 'context' || !entry.reason?.trim()) issues.push({block_id:block.id,reason:'Classificação de cobertura não confirmada.'});
    else if (kind === 'notice' && /\b(devera|deverao|obrigatori[oa]|exigid[oa]s?|no minimo)\b/.test(text(block.text)))
      issues.push({block_id:block.id,reason:'Bloco com linguagem de exigência foi classificado sem requisitos; requer nova leitura.'});
  }
  if (entries.some(c => !blocks.some(b => b.id === c.block_id))) issues.push({reason:'Auditoria referenciou bloco inexistente.'});
  const conflicts = [];
  for (const conflict of value.conflicts || []) {
    if (!evidenceValid({...conflict,source_id:String(source.id),location:chunk.location},[{id:String(source.id),text:chunk.text}]))
      issues.push({reason:'Conflito sem trecho literal verificável.',candidate:conflict});
    else conflicts.push({...conflict,source_id:String(source.id),location:chunk.location});
  }
  if (value.complete !== true) issues.push({reason:'Revisor não confirmou leitura integral do trecho.'});
  return { facts:validated.facts, complete:issues.length === 0, conflicts, issues, blocks:blocks.length,
    audited_blocks:blocks.filter(b=>entries.some(c=>c.block_id===b.id)).length };
}

function createExtractionRunner({ read, write, ask, isTruncated }) {
  async function extract({job,config,source:s,chunk,kind,context,system,repair=false}) {
    const key = hash({audit:AUDIT_VERSION,kind,context,text:chunk.text});
    const old = await read(job,s,kind,key,chunk.chunk);
    if (old?.audit_version === AUDIT_VERSION && old.complete) return {...old,cache_hit:true};
    // A partial cache is evidence for repair, never a permanent successful cache.
    const prefix = `${s.id}:${key.slice(0,12)}:${chunk.chunk}`;
    let first;
    const blocks = sourceBlocks(chunk.text);
    let data;
    try {
      first = await ask(job,config,system,JSON.stringify({context,document:{...chunk,source_id:String(s.id)}}),7000,FACTS_FORMAT);
      if (!Array.isArray(first?.facts)) throw Object.assign(new Error('Extração fora do formato esperado.'),{code:'TECHNICAL_EXTRACTION_INVALID'});
      const initial = validateFacts(first.facts,s,chunk,kind,context,`${prefix}:initial`);
      const audit = await ask(job,config,`${system}\nVocê é o revisor de COBERTURA. Releia TODOS os blocos do trecho, inclusive obrigações de fornecimento e documentação. Extraia novamente TODAS as exigências atômicas em facts, inclusive as omitidas ou rejeitadas na primeira leitura. Não elimine uma exigência para satisfazer a validação. Copie citações contíguas literalmente de document.text, sem reticências ou junção de frases.\nRetorne também coverage com exatamente uma entrada para CADA block.id: requirements (inclui exigências técnicas, kit, fornecimento e administrativas; fact_indexes aponta índices de facts que citam esse bloco), context (nenhuma exigência; justifique), ou unreadable (explique). complete só confirma leitura integral, NÃO significa que o produto atende. Conflitos reais precisam de quote literal; ausência de exigências técnicas não é conflito. Não transforme falta de informação em requisito.`,
        JSON.stringify({context,document:{...chunk,source_id:String(s.id)},blocks,previous_facts:initial.facts,rejected_candidates:initial.rejected,previous_conflicts:first.conflicts || []}),7000,COVERAGE_FORMAT);
      data = validateAudit(audit,s,chunk,kind,context,blocks,`${prefix}:audit`);
      // Preserve verified initial facts; unsupported model candidates are NOT
      // requirements. The independent auditor must cover the actual source and
      // supply literal evidence, rather than being forced to repeat a hallucination.
      data.first_pass_rejections=initial.rejected;
      data.facts = mergeFacts(initial.facts,data.facts);
    } catch (error) {
      if (!isTruncated(error)) throw error;
      data = {facts:[],complete:false,conflicts:[],issues:[{reason:'Resposta excedeu a capacidade do trecho; subdivisão necessária.'}],blocks:blocks.length,audited_blocks:0};
    }
    if (!data.complete && chunk.text.length > MIN_SPLIT) {
      const middle = Math.floor(chunk.text.length / 2), overlap = 150;
      const children = [
        {...chunk,text:chunk.text.slice(0,middle+overlap)},
        {...chunk,text:chunk.text.slice(middle-overlap),context_before:chunk.text.slice(Math.max(0,middle-1200),middle-overlap)},
      ];
      const results = [];
      for (const child of children) results.push(await extract({job,config,source:s,chunk:child,kind,context,system,repair:true}));
      const childFacts = mergeFacts(...results.map(r=>r.facts));
      data = { facts:mergeFacts(data.facts,childFacts), complete:results.every(r=>r.complete),
        conflicts:results.flatMap(r=>r.conflicts),issues:results.flatMap(r=>r.issues || []),
        first_pass_rejections:[...(data.first_pass_rejections || []),...results.flatMap(r=>r.first_pass_rejections || [])],
        blocks:results.reduce((n,r)=>n+r.blocks,0),audited_blocks:results.reduce((n,r)=>n+r.audited_blocks,0),subdivided:true };
    }
    data = {...data,audit_version:AUDIT_VERSION,global_incomplete:!data.complete,repair,
      attempted_at:new Date().toISOString()};
    await write(job,s,kind,key,chunk.chunk,data);
    return data;
  }
  return extract;
}
module.exports = { AUDIT_VERSION,sourceBlocks,literalEvidenceQuote,validateFacts,validateAudit,mergeFacts,createExtractionRunner };
