const test = require('node:test');
const assert = require('node:assert/strict');

const {
  variacoesExigidas,
  contarVariacoes,
  validarVariacaoMensagens,
} = require('../disparoMensagens');

const OPC = { contatosPorVariacao: 25, maxVariacoes: 6 };
const texto = (t) => ({ tipo: 'texto', texto: t });
const midia = (b64, legenda) => ({ tipo: 'imagem', legenda, arquivo_base64: b64, arquivo_nome: 'a.jpg' });

test('escala a exigência a cada 25 contatos, com teto', () => {
  assert.equal(variacoesExigidas(1, OPC), 1);
  assert.equal(variacoesExigidas(25, OPC), 1);
  assert.equal(variacoesExigidas(26, OPC), 2);
  assert.equal(variacoesExigidas(64, OPC), 3);
  assert.equal(variacoesExigidas(150, OPC), 6);
  assert.equal(variacoesExigidas(10000, OPC), 6, 'nunca pede mais que o teto');
});

test('conta variações reais, ignorando caixa e espaçamento', () => {
  const r = contarVariacoes([
    texto('Oi!  Tudo bem?'),
    texto('oi! tudo bem?'),
    texto('Outra coisa'),
  ]);
  assert.equal(r.textos, 2, 'só espaço e caixa não fazem mensagem diferente');
});

test('campanha pequena passa com uma mensagem só', () => {
  assert.equal(validarVariacaoMensagens([texto('Oi, tudo bem?')], 20, OPC), null);
});

test('campanha grande com texto único é barrada', () => {
  const r = validarVariacaoMensagens([texto('Oi, tudo bem?')], 64, OPC);
  assert.ok(r, 'deveria barrar');
  assert.equal(r.campo, 'texto');
  assert.equal(r.exigidas, 3);
  assert.equal(r.textos_distintos, 1);
  assert.match(r.erro, /exige ao menos 3 mensagens diferentes/);
});

test('disfarçar com espaço e caixa não engana a validação', () => {
  const r = validarVariacaoMensagens([
    texto('Oi, tudo bem?'),
    texto('OI,   TUDO BEM?'),
    texto('oi, tudo bem?'),
  ], 64, OPC);
  assert.ok(r, 'as três são a mesma mensagem');
  assert.equal(r.textos_distintos, 1);
});

test('campanha grande com variações suficientes passa', () => {
  const r = validarVariacaoMensagens([
    texto('Oi, tudo bem? Estamos com desconto na linha Autel.'),
    texto('Tudo certo? Abrimos uma condição nos drones Autel.'),
    texto('Oi! Os drones Autel estão com desconto por aqui.'),
  ], 64, OPC);
  assert.equal(r, null);
});

test('mídia repetida é barrada mesmo com textos diferentes', () => {
  const r = validarVariacaoMensagens([
    midia('AAAA', 'Legenda um'),
    midia('AAAA', 'Legenda dois'),
    midia('AAAA', 'Legenda três'),
  ], 64, OPC);
  assert.ok(r, 'mesmo arquivo nas três');
  assert.equal(r.campo, 'midia');
  assert.equal(r.midias_distintas, 1);
  assert.match(r.erro, /ao menos 3 arquivos diferentes/);
});

test('mídia variada junto com texto variado passa', () => {
  const r = validarVariacaoMensagens([
    midia('AAAA', 'Legenda um'),
    midia('BBBB', 'Legenda dois'),
    midia('CCCC', 'Legenda três'),
  ], 64, OPC);
  assert.equal(r, null);
});

test('campanha sem mídia não é cobrada por mídia', () => {
  const r = validarVariacaoMensagens([
    texto('Primeira versão da mensagem'),
    texto('Segunda versão, bem diferente'),
    texto('Terceira versão, outra abordagem'),
  ], 64, OPC);
  assert.equal(r, null);
});

test('mais contatos exigem mais variações', () => {
  const pool = [texto('um'), texto('dois'), texto('tres')];
  assert.equal(validarVariacaoMensagens(pool, 64, OPC), null, '3 basta para 64');
  const r = validarVariacaoMensagens(pool, 120, OPC);
  assert.ok(r, '120 contatos exigem 5');
  assert.equal(r.exigidas, 5);
});
