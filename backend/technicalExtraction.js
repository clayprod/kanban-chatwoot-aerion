'use strict';
const { text, hash, evidenceValid,quotedNumber } = require('./technicalRules');
const { normalizeFact } = require('./technicalQuality');
const { FACTS_FORMAT, coverageFormatFor } = require('./technicalAiFormat');

// Coverage is about reading the source, not granting compliance. Real source
// contradictions remain visible even after every block has been read.
const AUDIT_VERSION = 3;
const MIN_SPLIT = 900;
function canonicalItemNumber(value,items=[]) {
  const number=String(value ?? '');
  if(/^\d+$/.test(number)){
    const match=items.find(i=>/^\d+$/.test(String(i.number)) && BigInt(i.number)===BigInt(number));
    if(match)return String(match.number);
  }
  return number;
}
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
  if(typeof quote!=='string' || text(quote).length<3)return null;
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
function sourceLines(value) {
  let position=0;
  return value.split('\n').map((line,index)=>{const row={id:`l${index}`,text:line,start:position,end:position+line.length};position=row.end+1;return row;});
}
function quoteFromLines(ids,value) {
  if(!Array.isArray(ids)||!ids.length)return null;
  const lines=sourceLines(value),positions=[...new Set(ids.map(id=>/^l\d+$/.test(id)?Number(id.slice(1)):-1))].sort((a,b)=>a-b);
  if(positions.some(n=>n<0||n>=lines.length))return null;
  const quote=value.slice(lines[positions[0]].start,lines[positions.at(-1)].end);
  return text(quote).length>=5?quote:null;
}
function validateFacts(raw, source, chunk, kind, context, prefix) {
  const rejected = [], facts = [], indexes = new Map();
  for (const [index, row] of (Array.isArray(raw) ? raw : []).entries()) {
    const number=canonicalItemNumber(row.item_number,kind==='notice'?context.items:[]);
    const fact = normalizeFact({ ...row, item_number: number, id: `${prefix}:${index}`, source_id: String(source.id), location: chunk.location });
    const literal=literalEvidenceQuote(fact.quote,chunk.text) || quoteFromLines(row.evidence_line_ids,chunk.text);
    if(literal && literal!==fact.quote){fact.original_quote=fact.quote;fact.quote=literal;fact.quote_recovered=true;}
    if (fact.replaces_quote || fact.replacement_statement) {
      const statement = text(fact.replacement_statement);
      fact.replacement_verified = !!fact.replaces_quote && !!statement && text(chunk.text).includes(statement) && statement.includes(text(fact.replaces_quote)) && statement.includes(text(fact.quote)) && /onde se le[\s\S]+leia[ -]se/.test(statement);
    }
    const reason = !evidenceValid(fact, [{id: String(source.id), text: chunk.text}]) ? 'Citação não encontrada literalmente neste trecho.'
      : !fact.key || !fact.label ? 'Exigência sem identificação.'
        : fact.kind==='numeric' && !quotedNumber(fact,fact.value) ? 'O valor extraído não está no trecho citado.'
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
  const entries = Array.isArray(value.coverage) ? value.coverage : value.coverage && typeof value.coverage==='object'
    ? Object.entries(value.coverage).map(([block_id,review])=>({...review,block_id})) : [];
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
      // A single fact cannot stand in for an entire table row. Independently
      // account for every explicit measurement and standalone capability token.
      const mentions=[...block.text.matchAll(/\b\d+(?:[.,]\d+)?\s*(?:m\/s|km\/h|GHz|MHz|MP|mAh|Wh|GB|TB|rpm|polegadas|min(?:utos)?|[kK](?![a-z]))\b/g)].map(m=>m[0]);
      const facts=validated.facts.filter(f=>text(block.text).includes(text(f.quote)) || text(f.quote).includes(text(block.text).slice(0,35)));
      for(const mention of mentions){
        if(!facts.some(f=>text(f.quote).includes(text(mention)) && (quotedNumber({quote:mention},f.value) || typeof f.value==='string' && text(f.value).includes(text(mention)))))
          issues.push({block_id:block.id,reason:`Medida técnica ainda sem exigência individual: ${mention}.`});
      }
      for(const token of block.text.match(/\b(?:GPS|GNSS|RTH|Bluetooth|Wi[ -]Fi)\b/gi) || []){
        const normalized=v=>text(v).replace(/[ -]/g,'');
        if(!facts.some(f=>normalized(f.quote).includes(normalized(token)) && normalized(f.value).includes(normalized(token))))
          issues.push({block_id:block.id,reason:`Característica ainda sem exigência individual: ${token}.`});
      }
    } else if(entry.classification==='administrative') {
      const quote=literalEvidenceQuote(quoteFromLines(entry.evidence_line_ids,chunk.text) || '',block.text) || literalEvidenceQuote(entry.quote || '',block.text);
      if(!quote || !entry.reason?.trim())issues.push({block_id:block.id,reason:'Classificação administrativa sem justificativa e citação do bloco.'});
      if(quote)entry.quote=quote;
      if(kind==='notice' && (/\d\s*(?:mm|cm|metros|m\/s|km\/h|km|kg|mhz|ghz|hz|mp|pixels|dpi|gb|tb|kw|w|v|mah|ah|wh|kwh|bar|kpa|rpm|polegadas)\b/i.test(block.text) || /\b(?:anatel|inmetro|abnt|nbr|iso\s*\d|treinamento|manual de operacao|assistencia tecnica)\b/.test(text(block.text))))
        issues.push({block_id:block.id,reason:'Bloco administrativo contém possível especificação ou obrigação técnica; requer extração.'});
    } else if (entry.classification !== 'context' || !entry.reason?.trim()) issues.push({block_id:block.id,reason:'Classificação de cobertura não confirmada.'});
    else if (kind === 'notice' && /\b(devera|deverao|obrigatori[oa]|exigid[oa]s?|no minimo)\b/.test(text(block.text)))
      issues.push({block_id:block.id,reason:'Bloco com linguagem de exigência foi classificado sem requisitos; requer nova leitura.'});
  }
  if (entries.some(c => !blocks.some(b => b.id === c.block_id))) issues.push({reason:'Auditoria referenciou bloco inexistente.'});
  const conflicts = [];
  for (const conflict of value.conflicts || []) {
    if (!evidenceValid({...conflict,source_id:String(source.id),location:chunk.location},[{id:String(source.id),text:chunk.text}]))
      issues.push({reason:'Conflito sem trecho literal verificável.',candidate:conflict});
    else {
      const item_numbers=(conflict.item_numbers || []).map(n=>canonicalItemNumber(n,context.items || []));
      if(kind==='notice' && (!item_numbers.length || item_numbers.some(n=>n!=='all'&&!context.items.some(i=>String(i.number)===n))))issues.push({reason:'Conflito sem associação confirmada ao item.',candidate:conflict});
      conflicts.push({...conflict,item_numbers,source_id:String(source.id),location:chunk.location});
    }
  }
  if (value.complete !== true) issues.push({reason:'Revisor não confirmou leitura integral do trecho.'});
  return { facts:validated.facts, complete:issues.length === 0, conflicts, issues, blocks:blocks.length,block_reviews:entries.map(entry=>({...entry,block_ref:`${prefix}:${entry.block_id}`})),
    audited_blocks:blocks.filter(b=>entries.some(c=>c.block_id===b.id)).length };
}

function createExtractionRunner({ read, write, ask, isTruncated }) {
  async function extract({job,config,source:s,chunk,kind,context,system,repair=false},work) {
    const key = hash({audit:AUDIT_VERSION,kind,context,text:chunk.text});
    const old = await read(job,s,kind,key,chunk.chunk);
    if (old?.audit_version === AUDIT_VERSION && (old.complete ||
      (!old.pending_subtasks && old.phase !== 'auditing' && (!repair || old.repair_request === repair)))) return {...old,cache_hit:true};
    // Incomplete evidence is a durable result, NOT permission to spend again.
    // Only an explicit new repair request may reread a finished partial chunk.
    const prefix = `${s.id}:${key.slice(0,12)}:${chunk.chunk}`;
    let first,initial,truncated=false;
    const blocks = sourceBlocks(chunk.text);
    let data=old?.children?.length ? {...old,child_done:old.pending_subtasks ? (old.child_done || old.children.map(()=>false)) : old.children.map(()=>false)} : null;
    if(!data){
    if(!work.remaining)return{facts:[],complete:false,pending_subtasks:true,parts:{done:0,total:1},conflicts:[],issues:[],blocks:0,audited_blocks:0};
    work.remaining--;
    try {
      first = old?.phase==='auditing' ? old.first_response : await ask(job,config,system,JSON.stringify({context,document:{...chunk,source_id:String(s.id)}}),7000,FACTS_FORMAT);
      if (!Array.isArray(first?.facts)) throw Object.assign(new Error('Extração fora do formato esperado.'),{code:'TECHNICAL_EXTRACTION_INVALID'});
      initial = validateFacts(first.facts,s,chunk,kind,context,`${prefix}:initial`);
      const lines=sourceLines(chunk.text);
      await write(job,s,kind,key,chunk.chunk,{audit_version:AUDIT_VERSION,phase:'auditing',first_response:first,complete:false});
      const audit = await ask(job,config,`${system}\nPara cada fato, preencha evidence_line_ids com os identificadores [lN] das linhas CONTÍGUAS que contêm a exigência. O servidor copia essas linhas originais; quote pode ser vazio quando as linhas forem indicadas. A cobertura administrative também pode indicar evidence_line_ids para copiar sua justificativa literal. O servidor sempre preserva o intervalo inteiro, incluindo linhas intermediárias e condições. Nunca use o texto dos marcadores [lN] na citação. Não altere números, unidades, operadores ou condições. coverage é um OBJETO com uma propriedade para CADA block.id, conforme as chaves obrigatórias do schema; não use array nem repita blocos. Os identificadores de linhas permitidos estão restritos no schema.\nVocê é o revisor de COBERTURA DAS EXIGÊNCIAS TÉCNICAS DOS ITENS. Releia TODOS os blocos do trecho. Extraia novamente TODAS as exigências técnicas atômicas em facts, inclusive as omitidas ou rejeitadas na primeira leitura, componentes do kit, acessórios, garantia do equipamento, treinamento, entrega, instalação, manuais, assistência e documentação técnica/certificações. Procure essas exigências também em cláusulas administrativas. Não elimine uma exigência para satisfazer a validação. Copie citações contíguas literalmente de document.text, sem reticências ou junção de frases.\nRetorne coverage com exatamente uma entrada para CADA block.id: requirements (qualquer exigência técnica ou obrigação de fornecimento/documentação técnica; fact_indexes aponta índices de facts que citam esse bloco); administrative (somente regras jurídicas/fiscais e ritos da disputa, sem requisito técnico do item; justifique e cite em quote um trecho literal de até 300 caracteres desse bloco); context (nenhuma exigência; justifique); ou unreadable (explique). quote pode ser vazio em requirements/context, pois as evidências técnicas estão em facts. Toda a página é lida; cláusulas jurídicas/fiscais puras são registradas na cobertura e não viram especificações de produto. complete só confirma leitura integral, NÃO significa que o produto atende. Conflitos reais precisam de quote literal; ausência de exigências técnicas não é conflito. Não transforme falta de informação em requisito.`,
        JSON.stringify({context,document:{...chunk,text:lines.map(line=>`[${line.id}] ${line.text}`).join('\n'),source_id:String(s.id)},blocks,previous_facts:initial.facts,rejected_candidates:initial.rejected,previous_conflicts:first.conflicts || []}),7000,coverageFormatFor(blocks,lines));
      data = validateAudit(audit,s,chunk,kind,context,blocks,`${prefix}:audit`);
      // Preserve verified initial facts; unsupported model candidates are NOT
      // requirements. The independent auditor must cover the actual source and
      // supply literal evidence, rather than being forced to repeat a hallucination.
      data.first_pass_rejections=initial.rejected;
      data.facts = mergeFacts(initial.facts,data.facts);
    } catch (error) {
      if (!isTruncated(error)) throw error;
      truncated=true;
      data = {facts:initial?.facts || [],complete:false,conflicts:[],issues:[{reason:'Resposta excedeu a capacidade do trecho; subdivisão necessária.'}],blocks:blocks.length,audited_blocks:0};
    }
    if (truncated && chunk.text.length > MIN_SPLIT) {
      const middle = Math.floor(chunk.text.length / 2), overlap = 150;
      data = {...data,base_facts:data.facts,base_conflicts:data.conflicts,base_rejections:data.first_pass_rejections || [],child_done:[false,false],children:[
        {...chunk,text:chunk.text.slice(0,middle+overlap)},
        {...chunk,text:chunk.text.slice(middle-overlap),context_before:chunk.text.slice(Math.max(0,middle-1200),middle-overlap)},
      ]};
      await write(job,s,kind,key,chunk.chunk,{...data,audit_version:AUDIT_VERSION,complete:false,pending_subtasks:true});
    }
    }
    if(data.children?.length){
      const results = [];
      for (const [index,child] of data.children.entries()) {
        const childKey=hash({audit:AUDIT_VERSION,kind,context,text:child.text});
        const saved=data.child_done[index] ? await read(job,s,kind,childKey,child.chunk) : null;
        const result=saved && saved.audit_version===AUDIT_VERSION && !saved.pending_subtasks && saved.phase!=='auditing'
          ? {...saved,cache_hit:true} : await extract({job,config,source:s,chunk:child,kind,context,system,repair},work);
        results.push(result);data.child_done[index]=!result.pending_subtasks;
      }
      const childFacts = mergeFacts(...results.map(r=>r.facts));
      data = { ...data,facts:mergeFacts(data.base_facts || [],childFacts), complete:results.every(r=>r.complete),pending_subtasks:results.some(r=>r.pending_subtasks),
        conflicts:[...(data.base_conflicts || []),...results.flatMap(r=>r.conflicts)],issues:results.flatMap(r=>r.issues || []),
        first_pass_rejections:[...(data.base_rejections || []),...results.flatMap(r=>r.first_pass_rejections || [])],
        blocks:results.reduce((n,r)=>n+(r.blocks || 0),0),audited_blocks:results.reduce((n,r)=>n+(r.audited_blocks || 0),0),subdivided:true,
        block_reviews:results.flatMap(r=>r.block_reviews || []),
        parts:{done:results.reduce((n,r)=>n+(r.parts?.done ?? (r.pending_subtasks?0:1)),0),total:results.reduce((n,r)=>n+(r.parts?.total || 1),0)} };
    }
    data = {...data,audit_version:AUDIT_VERSION,global_incomplete:!data.complete,repair,repair_request:repair || null,
      attempted_at:new Date().toISOString()};
    await write(job,s,kind,key,chunk.chunk,data);
    return data;
  }
  // At most one extraction/audit unit per scheduler turn. Children and first
  // responses are durable, so another notice can run before the next unit.
  return args=>extract(args,{remaining:1});
}
module.exports = { AUDIT_VERSION,sourceBlocks,sourceLines,quoteFromLines,literalEvidenceQuote,canonicalItemNumber,validateFacts,validateAudit,mergeFacts,createExtractionRunner };
