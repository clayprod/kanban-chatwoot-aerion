'use strict';
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const string = { type: 'string' };
const fact = object({ item_number: string, label: string, key: string, section:string, component:string,
  category: { type: 'string', enum: ['equipment', 'kit', 'supply', 'administrative'] },
  replaces_quote: string, replacement_statement: string,
  kind: { type: 'string', enum: ['numeric', 'categorical', 'compound'] },
  value: { type: ['number', 'string', 'null'] }, upper: { type: ['number', 'null'] }, unit: string,
  operator: { type: 'string', enum: ['min', 'max', 'eq', 'range'] }, conditions: string, quote: string, location: string, source_id: string });
const format = (name, schema) => ({ type: 'json_schema', json_schema: { name, strict: true, schema } });
const FACTS_FORMAT = format('technical_facts', object({ complete: { type: 'boolean' }, facts: { type: 'array', items: fact }, conflicts: { type: 'array', items: object({ item_numbers: { type: 'array', items: string }, message: string }) } }));
const COVERAGE_FORMAT = format('technical_coverage', object({
  complete: { type: 'boolean' }, facts: { type: 'array', items: object({...fact.properties,evidence_line_ids:{type:'array',items:string}}) },
  conflicts: { type: 'array', items: object({ item_numbers: { type: 'array', items: string }, message: string, quote: string }) },
  coverage: { type: 'array', items: object({ block_id: string,
    classification: { type: 'string', enum: ['requirements', 'administrative', 'context', 'unreadable'] },
    fact_indexes: { type: 'array', items: { type: 'integer', minimum: 0 } }, reason: string, quote:string,evidence_line_ids:{type:'array',items:string} }) },
}));
function coverageFormatFor(blocks,lines) {
  const result=JSON.parse(JSON.stringify(COVERAGE_FORMAT));
  if(blocks.length){
    const review=result.json_schema.schema.properties.coverage.items;
    delete review.properties.block_id;review.required=review.required.filter(key=>key!=='block_id');
    if(lines.length)review.properties.evidence_line_ids.items.enum=lines.map(line=>line.id);
    result.json_schema.schema.properties.coverage={type:'object',properties:Object.fromEntries(blocks.map(block=>[block.id,review])),required:blocks.map(block=>block.id),additionalProperties:false};
  }
  if(lines.length)result.json_schema.schema.properties.facts.items.properties.evidence_line_ids.items.enum=lines.map(l=>l.id);
  return result;
}
const MAPPING_FORMAT = format('technical_mapping', object({ matches: { type: 'array', items: object({ requirement_id: string, spec_ids: { type: 'array', items: string }, same_metric: { type: 'boolean' } }) } }));
function requestExceedsCapacity(status, body) {
  if(status===413 || /request too large|context_length_exceeded|maximum context length/i.test(body)) return true;
  const limit=/\blimit\s*[:=]?\s*([\d,]+)/i.exec(body),requested=/\brequested\s*[:=]?\s*([\d,]+)/i.exec(body);
  return status===429 && !!limit && !!requested && Number(requested[1].replace(/,/g,''))>Number(limit[1].replace(/,/g,''));
}
module.exports = { FACTS_FORMAT, COVERAGE_FORMAT, MAPPING_FORMAT, coverageFormatFor, requestExceedsCapacity };
