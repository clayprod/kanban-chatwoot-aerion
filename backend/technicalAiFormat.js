'use strict';
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const string = { type: 'string' };
const fact = object({ item_number: string, label: string, key: string,
  kind: { type: 'string', enum: ['numeric', 'categorical', 'compound'] },
  value: { type: ['number', 'string', 'null'] }, upper: { type: ['number', 'null'] }, unit: string,
  operator: { type: 'string', enum: ['min', 'max', 'eq', 'range'] }, conditions: string, quote: string, location: string, source_id: string });
const format = (name, schema) => ({ type: 'json_schema', json_schema: { name, strict: true, schema } });
const FACTS_FORMAT = format('technical_facts', object({ complete: { type: 'boolean' }, facts: { type: 'array', items: fact }, conflicts: { type: 'array', items: string } }));
const MAPPING_FORMAT = format('technical_mapping', object({ matches: { type: 'array', items: object({ requirement_id: string, spec_ids: { type: 'array', items: string }, same_metric: { type: 'boolean' } }) } }));
module.exports = { FACTS_FORMAT, MAPPING_FORMAT };
