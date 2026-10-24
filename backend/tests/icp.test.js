const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REVENDA, CONSTRUCAO, ENERGIA, SEGURANCA, RESGATE, DESCONHECIDO,
  classificarIcp, podeFalarTabelaRevenda, blocoPromptIcp,
} = require('../icp');

test('classifica pelo CNAE, com o prefixo mais especifico ganhando', () => {
  // Topografia (7119-7/02) e o CNAE mais claro de construcao/topografia.
  assert.equal(classificarIcp({ cnae: '7119702' }).icp, CONSTRUCAO);
  assert.equal(classificarIcp({ cnae: '4120400' }).icp, CONSTRUCAO);
  // Geracao e transmissao de energia.
  assert.equal(classificarIcp({ cnae: '3511501' }).icp, ENERGIA);
  assert.equal(classificarIcp({ cnae: '4940000' }).icp, ENERGIA);
  // Defesa civil x seguranca publica: prefixos vizinhos, perfis diferentes.
  assert.equal(classificarIcp({ cnae: '8424800' }).icp, SEGURANCA);
  assert.equal(classificarIcp({ cnae: '8425', cnaeDescricao: 'defesa civil' }).icp, RESGATE);
  // Comercio atacadista de equipamentos.
  assert.equal(classificarIcp({ cnae: '4651601' }).icp, REVENDA);
});

test('o nome da empresa classifica quem o CNAE nao cobre', () => {
  const t = classificarIcp({ razaoSocial: 'GEO SUL TOPOGRAFIA E PROJETOS LTDA' });
  assert.equal(t.icp, CONSTRUCAO);
  assert.match(t.evidencias[0].porque, /topografia/);
  assert.equal(classificarIcp({ nomeFantasia: 'Alfa Distribuidora de Equipamentos' }).icp, REVENDA);
  assert.equal(
    classificarIcp({ razaoSocial: 'SOLARTEC ENERGIA FOTOVOLTAICA' }).icp,
    ENERGIA
  );
});

test('sem pista nenhuma devolve desconhecido, e o prompt manda PERGUNTAR', () => {
  const c = classificarIcp({ razaoSocial: 'J. M. SERVICOS LTDA' });
  assert.equal(c.icp, DESCONHECIDO);
  assert.equal(c.confianca, 0);
  const bloco = blocoPromptIcp(c);
  assert.match(bloco, /n[aã]o identificado/i);
  assert.match(bloco, /Pergunte, n[aã]o presuma/);
});

test('o que a pessoa diz vale mais que o cadastro', () => {
  // CNAE de construcao, mas ela disse que quer revender: quem manda e a fala.
  const c = classificarIcp({
    cnae: '4120400',
    razaoSocial: 'CONSTRUTORA XYZ',
    historico: 'Na verdade a gente quer revender esses drones para nossos clientes',
  });
  assert.equal(c.icp, REVENDA);
  assert.ok(c.confianca >= 0.95);
});

test('tabela de revenda exige EVIDENCIA, nao palpite de CNAE', () => {
  // CNAE de comercio sozinho e prefixo largo: pega qualquer loja. Nao libera tabela.
  const soCnae = classificarIcp({ cnae: '4651601', razaoSocial: 'LOJA DE INFORMATICA LTDA' });
  assert.equal(soCnae.icp, REVENDA, 'classifica como revenda para falar de parceria');
  assert.equal(
    podeFalarTabelaRevenda(soCnae), false,
    'mas preco de distribuidor para quem compra no varejo nao volta atras'
  );

  // Cadastro PJ aprovado na loja e prova.
  const aprovado = classificarIcp({ cnae: '4651601', cadastroB2b: true });
  assert.equal(podeFalarTabelaRevenda(aprovado), true);

  // A pessoa dizendo que revende tambem e evidencia.
  const declarou = classificarIcp({ historico: 'somos revenda de equipamentos aqui em Goiania' });
  assert.equal(declarou.icp, REVENDA);
  assert.equal(podeFalarTabelaRevenda(declarou), true);

  // Cliente final nunca.
  assert.equal(podeFalarTabelaRevenda(classificarIcp({ cnae: '7119702' })), false);
  assert.equal(podeFalarTabelaRevenda(null), false);
});

test('o bloco do prompt muda a CONVERSA conforme o perfil', () => {
  const revenda = blocoPromptIcp(classificarIcp({ cadastroB2b: true }));
  assert.match(revenda, /ICP PRINCIPAL/);
  assert.match(revenda, /PARCERIA e MARGEM/);
  assert.match(revenda, /margem de 25-35%/);
  // O erro que isso existe para evitar: falar de produtividade na obra com revenda.
  assert.match(revenda, /nunca de\s+produtividade na opera/);
  assert.doesNotMatch(revenda, /cronograma/i, 'dor de construtora nao entra em revenda');

  const energia = blocoPromptIcp(classificarIcp({ cnae: '3511501' }));
  assert.match(energia, /cliente final/);
  assert.match(energia, /helic[oó]ptero/);
  assert.match(energia, /Alpha/);
  assert.match(energia, /Pr[oó]ximo passo comercial/);
  // E manda usar como contexto, nao recitar.
  assert.match(energia, /N[aã]o recite/);
});

test('cada perfil tem dor, motivacao, objecao e proximo passo preenchidos', () => {
  for (const cnae of ['7119702', '3511501', '8424800', '8425', '4651601']) {
    const c = classificarIcp({ cnae });
    assert.notEqual(c.icp, DESCONHECIDO, cnae);
    const p = c.perfil;
    assert.ok(p.dores.length, `${p.nome} sem dores`);
    assert.ok(p.motivacoes.length, `${p.nome} sem motivacoes`);
    assert.ok(p.objecoes.length, `${p.nome} sem objecoes`);
    assert.ok(p.proximoPasso, `${p.nome} sem proximo passo`);
    assert.ok(p.produtos, `${p.nome} sem produto`);
  }
});
