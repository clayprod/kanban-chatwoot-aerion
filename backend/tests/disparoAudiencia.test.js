const test = require('node:test');
const assert = require('node:assert/strict');

const { selecionarPublico, dddDoTelefone } = require('../disparoAudiencia');

const contatos = [
  { id: 1, name: 'Ana',   phone_number: '+5511999990001', funil: '2. Em Contato',  canal: 'Site',     labels: ['quente'], atributos: {} },
  { id: 2, name: 'Bruno', phone_number: '+5521999990002', funil: '2. Em Contato',  canal: 'Indicação', labels: [],         atributos: {} },
  { id: 3, name: 'Célia', phone_number: '+5511999990003', funil: '17. Nurturing',  canal: 'Site',     labels: [],         atributos: {} },
  { id: 4, name: 'Davi',  phone_number: '+5511999990004', funil: '16. Descartado', canal: 'Site',     labels: [],         atributos: { opt_out: 'true' } },
];

test('extrai o DDD com e sem código do país', () => {
  assert.equal(dddDoTelefone('+55 (11) 99999-0001'), '11');
  assert.equal(dddDoTelefone('11999990001'), '11');
  assert.equal(dddDoTelefone(''), '');
});

test('sem combinar, grupos diferentes se cruzam (E)', () => {
  const { publico } = selecionarPublico(contatos, {
    funil_vendas: ['2. Em Contato'], tags: [], canais: [], ddds: ['11'], contatos: [], combinar: false,
  });
  assert.deepEqual(publico.map(c => c.id), [1]);
});

test('com combinar, grupos diferentes se somam (OU)', () => {
  const { publico } = selecionarPublico(contatos, {
    funil_vendas: ['2. Em Contato'], tags: [], canais: [], ddds: ['11'], contatos: [], combinar: true,
  });
  assert.deepEqual(publico.map(c => c.id), [1, 2, 3]);
});

test('lista manual de contatos não é mais cruzada em E com a etapa quando combinar está ligado', () => {
  // Era este o caso que devolvia público vazio: etapa + contatos escolhidos à mão.
  const comE = selecionarPublico(contatos, {
    funil_vendas: ['17. Nurturing'], tags: [], canais: [], ddds: [], contatos: [1], combinar: false,
  });
  assert.deepEqual(comE.publico.map(c => c.id), []);

  const comOu = selecionarPublico(contatos, {
    funil_vendas: ['17. Nurturing'], tags: [], canais: [], ddds: [], contatos: [1], combinar: true,
  });
  assert.deepEqual(comOu.publico.map(c => c.id), [1, 3]);
});

test('opt-out é sempre respeitado e contado, mesmo em OU', () => {
  const { publico, descartados } = selecionarPublico(contatos, {
    funil_vendas: ['16. Descartado'], tags: [], canais: [], ddds: [], contatos: [], combinar: true,
  });
  assert.deepEqual(publico, []);
  assert.equal(descartados.opt_out, 1);
});

test('exigindo opt-in, quem não consentiu é descartado e contado', () => {
  const { publico, descartados } = selecionarPublico(contatos, {
    funil_vendas: ['2. Em Contato'], tags: [], canais: [], ddds: [], contatos: [], combinar: false,
  }, { requireOptIn: true });
  assert.deepEqual(publico, []);
  assert.equal(descartados.sem_opt_in, 2);
});

test('telefone repetido entra uma vez só e aparece nos descartes', () => {
  const comDuplicado = [...contatos, { id: 9, name: 'Ana (dup)', phone_number: '5511999990001', funil: '2. Em Contato', canal: 'Site', labels: [], atributos: {} }];
  const { publico, descartados } = selecionarPublico(comDuplicado, {
    funil_vendas: ['2. Em Contato'], tags: [], canais: [], ddds: [], contatos: [], combinar: false,
  });
  assert.deepEqual(publico.map(c => c.id), [1, 2]);
  assert.equal(descartados.duplicados, 1);
});

test('sem nenhum seletor preenchido o público é vazio (nunca a base inteira)', () => {
  const { publico } = selecionarPublico(contatos, {
    funil_vendas: [], tags: [], canais: [], ddds: [], contatos: [], combinar: true,
  });
  assert.deepEqual(publico, []);
});
