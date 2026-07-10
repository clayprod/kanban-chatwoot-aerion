import {
  countOpenFunnelLeads,
  countOperationalLicitacoes,
  getNewEditalSignalsCount,
} from './navigationBadges';

test('conta apenas as etapas abertas do funil (1 a 12)', () => {
  const stages = Array.from({ length: 17 }, (_, index) => `${index + 1}. Etapa`);
  const contacts = stages.map(stage => ({ custom_attributes: { Funil_Vendas: stage } }));
  contacts.push({ custom_attributes: { Funil_Vendas: 'Etapa desconhecida' } });

  expect(countOpenFunnelLeads(contacts, stages)).toBe(12);
});

test('conta apenas as fases operacionais de licitações (2 a 12)', () => {
  const stages = Array.from({ length: 15 }, (_, index) => `${index + 1}. Fase`);
  const opportunities = stages.map(fase => ({ fase }));
  opportunities.push({ fase: 'Fase desconhecida' });

  expect(countOperationalLicitacoes(opportunities, stages)).toBe(11);
});

test('normaliza a quantidade de sinais novos de editais', () => {
  expect(getNewEditalSignalsCount({ novo: '7' })).toBe(7);
  expect(getNewEditalSignalsCount({ novo: -2 })).toBe(0);
  expect(getNewEditalSignalsCount()).toBe(0);
});
