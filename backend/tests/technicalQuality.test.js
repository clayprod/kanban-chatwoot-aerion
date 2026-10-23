'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirementsForItem, uniqueFacts, rankMatches, normalizeFact } = require('../technicalQuality');
const { compareNumeric } = require('../technicalRules');
const fact = { id: 'one', item_number: '1', key: 'flight_time', label: 'Autonomia', kind: 'numeric', value: 41, upper: null, unit: 'min', operator: 'min', conditions: '', quote: 'Autonomia mínima de 41 min', source_id: '1', location: 'Página 1' };
test('duplicate table/TR labels count once, retain citations and do not merge different conditions', () => {
  const facts = [fact, { ...fact, id: 'two', label: 'AERONAVE - AUTONOMIA', source_id: '2' }];
  const result = uniqueFacts(facts);
  assert.equal(result.length, 1); assert.equal(result[0].citations.length, 2);
  assert.equal(uniqueFacts([...facts, { ...fact, conditions: 'sem vento' }]).length, 2);
});
test('item association follows explicit numbers and shared scope, never identical descriptions', () => {
  const shared = { ...fact, id: 'shared', item_number: 'all', key: 'rth', kind: 'categorical', value: 'RTH' };
  const facts = [fact, shared, { ...fact, id: 'docs', item_number: 'all', key: 'technical_sheet_required', label: 'Apresentação de ficha técnica' }, { ...fact, id: 'training', item_number: 'all', category: 'supply', key: 'training', label: 'Treinamento' }];
  assert.equal(requirementsForItem(facts, '1').requirements.length, 2);
  assert.equal(requirementsForItem(facts, '2').requirements.length, 1);
  assert.equal(requirementsForItem(facts, '1').obligations.length, 2);
  const camera={...fact,key:'camera_sensor',category:'equipment',quote:'Apresentar ficha técnica comprovando sensor mínimo de 1 polegada.'};
  assert.equal(requirementsForItem([camera],'1').requirements.length,1);
});
test('ranking puts compatibility before price, with price as the second criterion', () => {
  const p = (id,ok,price,status='uncertain') => ({ product_id:id,status,sale_price:price,price_rankable:true,counts:{ok,total:10} });
  assert.deepEqual([p('cheap',3,1),p('match',9,100),p('tie',9,80),p('failed',8,1,'failed')].sort(rankMatches).map(p=>p.product_id), ['tie','match','failed','cheap']);
  assert.equal([p('full',10,120,'full'),p('unknown',10,100)].sort(rankMatches)[0].product_id,'full');
});
test('only a verified explicit amendment replaces an earlier requirement', () => {
  const amendment={...fact,id:'amended',source_id:'2',value:42,quote:'Autonomia mínima de 42 min',replaces_quote:fact.quote,replacement_verified:true};
  let result=requirementsForItem([fact,amendment],'1');
  assert.equal(result.requirements.length,1);assert.equal(result.requirements[0].value,42);assert.equal(result.superseded_requirements.length,1);
  result=requirementsForItem([fact,{...amendment,replacement_verified:false}],'1');
  assert.equal(result.requirements.length,2);
});
test('Brazilian thousands and spelled-out quantities compare without changing units', () => {
  const r = { ...fact, key:'transmission_range',value:6000,unit:'metros',quote:'Alcance mínimo de 6.000 (seis mil) metros' };
  assert.equal(compareNumeric(r,{...r,value:6,unit:'km',quote:'Alcance de 6 km',operator:'eq'}).status,'ok');
  assert.equal(compareNumeric(r,{...r,value:5.9,unit:'km',quote:'Alcance de 5,9 km',operator:'eq'}).status,'nao_ok');
  assert.equal(compareNumeric({...fact,key:'speed',value:21,unit:'m/s',quote:'Velocidade mínima de 21 MIN'}, {...fact,key:'speed',value:21,unit:'m/s',quote:'Velocidade 21 m/s'}).status,'verificar');
  assert.equal(compareNumeric({...fact,value:3,unit:'baterias',quote:'Mínimo de 3 (três) baterias'}, {...fact,value:2,unit:'baterias',quote:'Incluídas 2 baterias'}).status,'nao_ok');
});
test('storage location and byte/bit units cannot be merged to inflate compliance', () => {
  assert.notEqual(normalizeFact({...fact,key:'microSD_capacity'}).key,normalizeFact({...fact,key:'storage_capacity'}).key);
  const r={...fact,key:'microsd_capacity',value:128,unit:'GB',quote:'Cartão mínimo de 128 GB'};
  assert.equal(compareNumeric(r,{...r,unit:'Gb',quote:'Cartão 128 Gb'}).status,'nao_ok');
  assert.equal(compareNumeric(r,{...r,unit:'GB',quote:'Cartão 128 GB'}).status,'ok');
  assert.equal(uniqueFacts([r,{...r,unit:'Gb',quote:'Cartão 128 Gb'}]).length,2);
});
