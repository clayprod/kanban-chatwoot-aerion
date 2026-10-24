const test = require('node:test');
const assert = require('node:assert/strict');

const {
  criarCatalogoAerion, precoDoParceiro, DESCONTO_TIER,
} = require('../aerionCatalogo');

const CONFIG = {
  url: 'https://loja.aerion.com.br/',
  consumer_key: 'ck_x',
  consumer_secret: 'cs_x',
};

// Resposta real da loja, encurtada (EVO Max 4T V2, consultado em 2026-10-23).
const PRODUTO_WC = {
  id: 343,
  name: 'EVO Max 4T V2 sem baterias',
  sku: '102003505',
  price: '41946.31',
  regular_price: '49349.46',
  permalink: 'https://loja.aerion.com.br/loja/produto/evo-max-4t-v2/',
  stock_status: 'instock',
  short_description: '<p>Drone <b>enterprise</b> com zoom 10x.</p>',
  categories: [{ name: 'Drones' }],
  meta_data: [
    { key: '_aerion_trade_price', value: '34034.54' },
    { key: '_aerion_price_basis', value: 'pix5' },
    { key: '_aerion_filter_camera', value: 'RGB com zoom' },
    { key: '_aerion_filter_rtk', value: 'Sim — módulo avulso' },
    { key: '_aerion_filter_license', value: '' },
  ],
};

const BUSCA_PUBLICA = [
  {
    name: 'EVO Max 4T V2 sem baterias',
    sku: '102003505',
    url: 'https://loja.aerion.com.br/loja/produto/evo-max-4t-v2/',
    image: 'https://aerion.com.br/img.png',
    family: 'EVO Max',
  },
];

const fakeFetch = (rotas) => {
  const chamadas = [];
  const impl = async (url) => {
    chamadas.push(String(url));
    for (const [padrao, resposta] of rotas) {
      if (String(url).includes(padrao)) {
        return { ok: true, status: 200, json: async () => resposta };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  impl.chamadas = chamadas;
  return impl;
};

test('busca de produto usa a rota PUBLICA, que nao tem preco', async () => {
  const f = fakeFetch([['aerion/v1/products/search', BUSCA_PUBLICA]]);
  const cat = criarCatalogoAerion({ carregarConfigLoja: async () => CONFIG, fetchImpl: f });
  const r = await cat.buscarProdutos('evo max');
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], {
    nome: 'EVO Max 4T V2 sem baterias',
    sku: '102003505',
    link: 'https://loja.aerion.com.br/loja/produto/evo-max-4t-v2/',
    imagem: 'https://aerion.com.br/img.png',
    familia: 'EVO Max',
  });
  // Sem credencial na URL: e rota publica, e e por isso que nao vaza preco.
  assert.ok(f.chamadas[0].includes('aerion/v1/products/search'));
  assert.ok(!f.chamadas[0].includes('wc/v3'));
});

test('detalhe traz preco publico, tabela de revenda e ficha tecnica', async () => {
  const f = fakeFetch([['wc/v3/products', [PRODUTO_WC]]]);
  const cat = criarCatalogoAerion({ carregarConfigLoja: async () => CONFIG, fetchImpl: f });
  const p = await cat.detalheProduto({ sku: '102003505' });
  assert.equal(p.precoPublicoPix, 41946.31);
  assert.equal(p.precoPublicoCartao, 49349.46);
  assert.equal(p.tabelaRevendaCartao, 34034.54);
  assert.equal(p.estoque, 'instock');
  assert.equal(p.resumo, 'Drone enterprise com zoom 10x.', 'HTML sai do resumo');
  assert.deepEqual(p.ficha, { 'câmera': 'RGB com zoom', RTK: 'Sim — módulo avulso' });
  assert.ok(!('licença' in p.ficha), 'meta vazia nao entra na ficha');
});

test('o detalhe nao bate na loja duas vezes para o mesmo produto', async () => {
  const f = fakeFetch([['wc/v3/products', [PRODUTO_WC]]]);
  const cat = criarCatalogoAerion({ carregarConfigLoja: async () => CONFIG, fetchImpl: f });
  await cat.detalheProduto({ sku: '102003505' });
  await cat.detalheProduto({ sku: '102003505' });
  assert.equal(f.chamadas.length, 1);
});

test('cliente final ve preco publico; revenda confirmada ve tabela', async () => {
  const f = fakeFetch([['wc/v3/products', [PRODUTO_WC]]]);
  const cat = criarCatalogoAerion({ carregarConfigLoja: async () => CONFIG, fetchImpl: f });
  const p = await cat.detalheProduto({ sku: '102003505' });

  const final = cat.precoParaPerfil(p, { revendaConfirmada: false });
  assert.equal(final.tabela, 'publico');
  assert.equal(final.pix, 41946.31);

  const parceiro = cat.precoParaPerfil(p, { revendaConfirmada: true, tier: 'none' });
  assert.equal(parceiro.tabela, 'revenda');
  assert.equal(parceiro.cartao, 34034.54, 'sem nivel, vale a tabela de revenda');

  // Gold da 8% sobre o PV; se isso ficar acima da tabela, continua valendo a tabela.
  const gold = cat.precoParaPerfil(p, { revendaConfirmada: true, tier: 'gold' });
  assert.equal(gold.cartao, 34034.54);
});

test('produto sem tabela de revenda nao inventa preco de parceiro', async () => {
  const semTabela = { ...PRODUTO_WC, meta_data: [{ key: '_aerion_trade_price', value: '' }] };
  const f = fakeFetch([['wc/v3/products', [semTabela]]]);
  const cat = criarCatalogoAerion({ carregarConfigLoja: async () => CONFIG, fetchImpl: f });
  const p = await cat.detalheProduto({ sku: '102003505' });
  // PV menos 5% ainda e um preco de parceiro legitimo quando ha nivel.
  const silver = cat.precoParaPerfil(p, { revendaConfirmada: true, tier: 'silver' });
  assert.equal(silver.pode, true);
  assert.equal(silver.cartao, 49349.46 * (1 - DESCONTO_TIER.silver));
  // Sem nivel e sem tabela nao existe preco de parceiro: melhor dizer que nao tem.
  const semNivel = cat.precoParaPerfil(p, { revendaConfirmada: true, tier: 'none' });
  assert.equal(semNivel.pode, false);
  assert.match(semNivel.motivo, /n[aã]o tem tabela de revenda/);
});

test('precoDoParceiro escolhe sempre o melhor para o parceiro', () => {
  assert.equal(precoDoParceiro({ publico: 100, tabelaRevenda: 80, tier: 'none' }), 80);
  // Gold (-8%) da 92; a tabela de 80 e melhor.
  assert.equal(precoDoParceiro({ publico: 100, tabelaRevenda: 80, tier: 'gold' }), 80);
  // Sem tabela, vale o desconto do nivel.
  assert.equal(precoDoParceiro({ publico: 100, tabelaRevenda: null, tier: 'silver' }), 95);
  assert.equal(precoDoParceiro({ publico: 100, tabelaRevenda: null, tier: 'none' }), null);
});

test('consulta de CNPJ na loja e fail-closed', async () => {
  const aprovado = criarCatalogoAerion({
    carregarConfigLoja: async () => CONFIG,
    fetchImpl: fakeFetch([['registration/cnpj/', { approved: true }]]),
  });
  assert.equal(await aprovado.cnpjAprovadoNaLoja('12.345.678/0001-95'), true);

  const negado = criarCatalogoAerion({
    carregarConfigLoja: async () => CONFIG,
    fetchImpl: fakeFetch([['registration/cnpj/', { status: 'pending' }]]),
  });
  assert.equal(await negado.cnpjAprovadoNaLoja('12345678000195'), false);

  // Loja fora do ar nao pode virar "aprovado": null significa "nao sei".
  const quebrado = criarCatalogoAerion({
    carregarConfigLoja: async () => CONFIG,
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
  });
  assert.equal(await quebrado.cnpjAprovadoNaLoja('12345678000195'), null);

  // CNPJ malformado nem sai do processo.
  assert.equal(await aprovado.cnpjAprovadoNaLoja('123'), null);
});

test('sem credencial da loja, o detalhe falha em vez de chutar', async () => {
  const cat = criarCatalogoAerion({
    carregarConfigLoja: async () => ({ url: 'https://loja.aerion.com.br' }),
    fetchImpl: fakeFetch([['wc/v3/products', [PRODUTO_WC]]]),
  });
  await assert.rejects(() => cat.detalheProduto({ sku: '1' }), /sem credencial/);
});

test('o catalogo do prompt nao carrega o preco que o lead nao pode ver', async () => {
  const f = fakeFetch([['wc/v3/products', [PRODUTO_WC]]]);
  const cat = criarCatalogoAerion({ carregarConfigLoja: async () => CONFIG, fetchImpl: f });
  const produtos = await cat.carregarCatalogo();

  // Cliente final: a tabela de revenda (34.034,54) nao pode aparecer em lugar nenhum.
  const final = cat.blocoCatalogo(produtos, { revendaConfirmada: false });
  assert.match(final, /preco publico/);
  assert.match(final, /R\$ 41\.946,31 no PIX/);
  assert.ok(!final.includes('34.034,54'), 'tabela de revenda nao pode entrar no contexto');
  assert.match(final, /NUNCA mencione tabela de revenda/);
  assert.match(final, /102003505/, 'SKU vai para a IA poder citar o produto certo');
  assert.match(final, /loja\.aerion\.com\.br\/loja\/produto\/evo-max-4t-v2/);

  // Parceiro confirmado: ve a tabela de revenda e nao ve o preco publico como oferta.
  const parceiro = cat.blocoCatalogo(produtos, { revendaConfirmada: true, tier: 'gold' });
  assert.match(parceiro, /TABELA DE REVENDA/);
  assert.match(parceiro, /nivel gold/);
  assert.match(parceiro, /R\$ 34\.034,54 no cartao/);
  assert.match(parceiro, /Nao mencione que existe outra tabela/);

  // Em qualquer caso: nada de calcular parcela, frete ou prazo.
  for (const bloco of [final, parceiro]) {
    assert.match(bloco, /Nunca calcule desconto, parcela,/);
    assert.match(bloco, /nunca prometa prazo de entrega/);
  }
});

test('catalogo fora do ar manda a IA nao afirmar nada', () => {
  const cat = criarCatalogoAerion({ carregarConfigLoja: async () => CONFIG, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  const bloco = cat.blocoCatalogo([]);
  assert.match(bloco, /indispon[ií]vel/);
  assert.match(bloco, /Nao afirme preco/);
});

test('produto sob encomenda ou sem estoque aparece marcado', async () => {
  const encomenda = { ...PRODUTO_WC, stock_status: 'onbackorder' };
  const cat = criarCatalogoAerion({
    carregarConfigLoja: async () => CONFIG,
    fetchImpl: fakeFetch([['wc/v3/products', [encomenda]]]),
  });
  const bloco = cat.blocoCatalogo(await cat.carregarCatalogo(), {});
  assert.match(bloco, /sob encomenda/);
});
